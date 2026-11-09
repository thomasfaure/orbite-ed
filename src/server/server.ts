/**
 * Serveur HTTP d'Orbite.
 *
 * Rôle : point d'entrée de l'application. Il sert l'interface (fichiers statiques
 * sur liste blanche) et expose l'API JSON `/api/*` utilisée par le navigateur :
 * session, connexion ÉcoleDirecte et double authentification, tableau de bord,
 * devoirs paginés, déconnexion et assistant IA.
 *
 * Fonctionnement : `createApp()` construit un `http.Server` sans l'ouvrir, ce qui
 * permet aux tests d'injecter de fausses requêtes. Chaque navigateur reçoit un cookie
 * `orbite` (64 caractères hexadécimaux) qui désigne une session en mémoire. Une
 * session porte son propre client ÉcoleDirecte, des caches de 60 secondes et des
 * verrous. Les sessions authentifiées sont réécrites dans le coffre chiffré
 * (`session-store.ts`) avant chaque réponse JSON. Lancé directement (`node
 * dist/server/server.js`), le module lit `.env`, ouvre le coffre et écoute HOST:PORT.
 *
 * Points d'attention :
 * - ÉcoleDirecte fait tourner son jeton à chaque réponse : deux appels simultanés
 *   pour une même session invalideraient la session. Le verrou `busy` sérialise donc
 *   connexion, vérification, notes et devoirs ; l'IA dispose d'un verrou séparé.
 * - Sécurité locale : Host et Origin contrôlés, en-tête `X-Orbite-Client` et JSON
 *   obligatoires sur les POST (protection CSRF), corps limité à 16 Kio, quotas de
 *   connexion et d'IA. Aucun secret n'est renvoyé au navigateur.
 * - Les chemins sont résolus depuis la racine du projet pour fonctionner à
 *   l'identique depuis `src/` (tests) et `dist/` (exécution).
 *
 * Liens : `ecoledirecte.ts` (client API), `session-store.ts` (persistance),
 * `openai.ts` (IA), `src/client/app.ts` (consommateur de l'API).
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { OpenAIClient, type AIClient } from './openai.ts';
import { SessionStore } from './session-store.ts';
import { EcoleDirecte, EdError, type SavedAuth, type VerifyInput } from './ecoledirecte.ts';
import type { AuthResult, AuthState, Dashboard, HomeworkPage } from '../shared/types.ts';

// Identique depuis src/server (tests) et dist/server (exécution compilée).
const projectRoot = new URL('../../', import.meta.url);

// Liste blanche exhaustive : tout autre chemin répond 404, ce qui empêche de servir
// `.env`, le coffre de sessions ou les sources. Les scripts et la feuille de style
// viennent de `dist/` : ils doivent avoir été compilés (`npm run build`).
const assets = new Map<string, [file: URL, type: string]>([
  ['/', [new URL('public/index.html', projectRoot), 'text/html']],
  ['/style.css', [new URL('dist/style.css', projectRoot), 'text/css']],
  ['/favicon.svg', [new URL('public/favicon.svg', projectRoot), 'image/svg+xml']],
  ...['client/app.js', 'client/ai.js', 'client/coaching.js', 'client/demo.js', 'shared/metrics.js'].map(
    (file): [string, [URL, string]] => ['/' + file, [new URL('dist/' + file, projectRoot), 'text/javascript']],
  ),
]);

/** Contrat attendu du client ÉcoleDirecte ; les tests y substituent une doublure. */
export interface DashboardClient {
  state: AuthState;
  clear(): void;
  login(username: string, password: string): Promise<AuthResult>;
  verify(input: VerifyInput): Promise<AuthResult>;
  dashboard(): Promise<Dashboard>;
  homeworkForChild(childId: string, options: { cursor: number | null }): Promise<HomeworkPage>;
  exportSession(): SavedAuth | null;
  restoreSession(saved: unknown): void;
}

interface Session {
  client: DashboardClient;
  /** Échéance absolue (ms) : 10 min pendant la vérification, puis 8 h après authentification. */
  expires: number;
  /** Verrou des appels ÉcoleDirecte ; seul le gestionnaire qui l'a pris (`ownsLock`) le relâche. */
  busy: boolean;
  aiBusy?: boolean;
  aiAttempts?: number[];
  verifyAttempts?: number;
  cache?: Dashboard;
  cacheTime?: number;
  homeworkCache?: Map<string, { time: number; value: HomeworkPage }>;
}

interface RequestData {
  username?: unknown;
  password?: unknown;
  input?: unknown;
  childId?: unknown;
  cursor?: unknown;
  choice?: unknown;
  code?: unknown;
}

export interface AppOptions {
  clientFactory?: () => DashboardClient;
  hostname?: string;
  sessionStore?: SessionStore | null;
  aiClient?: AIClient;
}

const SESSION_HOURS = 8;
const PENDING_MINUTES = 10;

/**
 * Crée le serveur sans l'ouvrir. Toutes les dépendances sont injectables pour les
 * tests ; sans `sessionStore`, les sessions restent uniquement en mémoire.
 * Les sessions sauvegardées non expirées sont restaurées avec leur échéance
 * d'origine : un redémarrage ne prolonge jamais une session.
 */
export function createApp({
  clientFactory = () => new EcoleDirecte(),
  hostname = '127.0.0.1',
  sessionStore = null,
  aiClient = new OpenAIClient(),
}: AppOptions = {}): http.Server {
  const sessions = new Map<string, Session>();
  // Horodatages des tentatives sur la dernière minute (fenêtres glissantes).
  const attempts: number[] = [];
  const aiAttempts: number[] = [];
  // Appels OpenAI en cours, toutes sessions confondues (deux au maximum).
  let aiActive = 0;

  // Réécrit tout le coffre : seules les sessions authentifiées et non expirées y
  // figurent, jamais un mot de passe ni une vérification en attente. Appelée avant
  // chaque réponse pour enregistrer le dernier jeton tourné par ÉcoleDirecte.
  const persist = (): void => {
    if (!sessionStore) return;
    sessionStore.save(
      [...sessions].flatMap(([id, s]) => {
        const auth = s.client.exportSession();
        return auth && s.expires > Date.now() ? [{ id, expires: s.expires, auth }] : [];
      }),
    );
  };

  if (sessionStore) {
    for (const saved of sessionStore.load()) {
      if (!/^[a-f0-9]{64}$/.test(saved.id) || !Number.isFinite(saved.expires) || saved.expires <= Date.now()) continue;
      const client = clientFactory();
      client.restoreSession(saved.auth);
      sessions.set(saved.id, { client, expires: saved.expires, busy: false });
    }
    persist();
  }

  const cleanup = setInterval(() => {
    for (const [id, s] of sessions)
      if (Date.now() > s.expires) {
        s.client.clear();
        sessions.delete(id);
      }
    try {
      persist();
    } catch {
      console.error('Sauvegarde des sessions indisponible.');
    }
  }, 60000);
  cleanup.unref();

  const server = http.createServer(async (req, res) => {
    const host = req.headers.host || '';
    const address = server.address() as AddressInfo;
    const allowed = [`127.0.0.1:${address.port}`, `localhost:${address.port}`, `${hostname}:${address.port}`];
    const headers = {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://ecoledirecte.com https://*.ecoledirecte.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'X-Frame-Options': 'DENY',
    };
    // Une sauvegarde impossible devient une erreur 503 explicite plutôt qu'une
    // réussite silencieuse qui perdrait le jeton au prochain redémarrage.
    const json = (status: number, data: unknown): void => {
      try {
        persist();
      } catch {
        status = 503;
        data = { error: 'Sauvegarde sécurisée des sessions impossible. Vérifiez les permissions et l’espace disque.' };
      }
      res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    };
    let session: Session | undefined;
    let ownsLock = false;
    let ownsAiLock = false;
    try {
      // Contre le DNS rebinding et les requêtes intersites : seul l'hôte d'écoute est
      // accepté, et une Origin éventuelle doit lui correspondre exactement.
      if (!allowed.includes(host)) throw new EdError('Hôte non autorisé.', 403);
      if (req.headers.origin && req.headers.origin !== `http://${host}`) throw new EdError('Origine refusée.', 403);
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new EdError('Origine refusée.', 403);
      const path = new URL(req.url ?? '/', `http://${host}`).pathname;

      if (!path.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new EdError('Méthode refusée.', 405);
        const asset = assets.get(path);
        if (!asset) throw new EdError('Page introuvable.', 404);
        const [file, type] = asset;
        const body = await readFile(file);
        res.writeHead(200, { ...headers, 'Content-Type': type + '; charset=utf-8' });
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      }

      const id = /(?:^|; )orbite=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1] ?? '';
      session = sessions.get(id);
      if (session && Date.now() > session.expires) {
        session.client.clear();
        sessions.delete(id);
        session = undefined;
      }
      if (req.method === 'GET' && path === '/api/session') {
        json(200, { state: session?.client.state || 'anonymous' });
        return;
      }
      if (req.method !== 'POST') throw new EdError('Méthode refusée.', 405);
      // Un formulaire tiers ne peut ni ajouter cet en-tête personnalisé ni envoyer
      // du JSON sans requête préliminaire CORS : c'est la protection CSRF.
      if (req.headers['x-orbite-client'] !== '1' || !req.headers['content-type']?.startsWith('application/json'))
        throw new EdError('Requête refusée.', 403);
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 16384) throw new EdError('Requête trop volumineuse.', 413);
      }
      let data: RequestData;
      try {
        data = JSON.parse(body || '{}') as RequestData;
      } catch {
        throw new EdError('JSON invalide.', 400);
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new EdError('Données invalides.', 400);

      if (path === '/api/logout') {
        if (session?.busy)
          throw new EdError('Synchronisation en cours. Réessayez la déconnexion après son achèvement.', 409);
        session?.client.clear();
        sessions.delete(id);
        res.setHeader('Set-Cookie', 'orbite=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
        json(200, { state: 'anonymous' });
        return;
      }

      if (path === '/api/login') {
        const now = Date.now();
        while (attempts.length && (attempts[0] ?? 0) < now - 60000) attempts.shift();
        if (attempts.length >= 6) throw new EdError('Trop de tentatives. Attendez une minute.', 429);
        if (
          typeof data.username !== 'string' ||
          !data.username.trim() ||
          data.username.length > 256 ||
          typeof data.password !== 'string' ||
          !data.password ||
          data.password.length > 1024
        )
          throw new EdError('Renseignez vos identifiants ÉcoleDirecte.', 400);
        if (session?.busy) throw new EdError('Une opération est déjà en cours.', 409);
        attempts.push(now);
        // Nouvel identifiant à chaque connexion (pas de fixation de session) ; la
        // session verrouillée naît courte et n'est prolongée qu'une fois authentifiée.
        session?.client.clear();
        sessions.delete(id);
        const sid = randomBytes(32).toString('hex');
        session = { client: clientFactory(), expires: now + PENDING_MINUTES * 60000, busy: true };
        sessions.set(sid, session);
        ownsLock = true;
        res.setHeader('Set-Cookie', `orbite=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`);
        const result = await session.client.login(data.username.trim(), data.password);
        if (result.state === 'authenticated') session.expires = Date.now() + SESSION_HOURS * 3600000;
        json(200, result);
        return;
      }

      if (!session) throw new EdError('Votre session a expiré. Reconnectez-vous.', 401);
      const current = session;

      // L'IA n'utilise pas le verrou `busy` : elle ne parle pas à ÉcoleDirecte et ne
      // doit pas bloquer le chargement des notes ou des devoirs.
      if (path === '/api/ai') {
        if (current.client.state !== 'authenticated') throw new EdError('Terminez la connexion à ÉcoleDirecte.', 401);
        if (
          Object.keys(data).some((key) => key !== 'input') ||
          typeof data.input !== 'string' ||
          !data.input.trim() ||
          data.input.length > 8000
        )
          throw new EdError('Envoyez uniquement un texte input de 1 à 8 000 caractères.', 400);
        if (!aiClient.configured) throw new EdError('OpenAI n’est pas configuré sur le serveur.', 503);
        if (current.aiBusy || aiActive >= 2)
          throw new EdError('Une demande IA est déjà en cours. Réessayez dans un instant.', 429);
        const now = Date.now();
        current.aiAttempts ??= [];
        for (const list of [current.aiAttempts, aiAttempts])
          while (list.length && (list[0] ?? 0) <= now - 60000) list.shift();
        if (current.aiAttempts.length >= 10 || aiAttempts.length >= 30)
          throw new EdError('Trop de demandes IA. Attendez une minute.', 429);
        current.aiAttempts.push(now);
        aiAttempts.push(now);
        current.aiBusy = true;
        aiActive++;
        ownsAiLock = true;
        const result = await aiClient.respond(data.input);
        // La session a pu être fermée ou expirer pendant l'appel (jusqu'à 45 s).
        if (sessions.get(id) !== current || current.expires <= Date.now() || current.client.state !== 'authenticated')
          throw new EdError('Votre session a expiré. Reconnectez-vous.', 401);
        json(200, result);
        return;
      }

      // Une requête refusée ici ne doit pas relâcher le verrou d'une autre : seul le
      // gestionnaire qui pose `busy` le libère dans le `finally` (cf. `ownsLock`).
      if (current.busy) throw new EdError('Une opération est déjà en cours.', 409);
      current.busy = true;
      ownsLock = true;

      if (path === '/api/verify') {
        current.verifyAttempts = (current.verifyAttempts || 0) + 1;
        if (current.verifyAttempts > 6) {
          current.client.clear();
          throw new EdError('Vérifications trop nombreuses. Reconnectez-vous.', 429);
        }
        const result = await current.client.verify(data);
        if (result.state === 'authenticated') current.expires = Date.now() + SESSION_HOURS * 3600000;
        json(200, result);
        return;
      }

      if (path === '/api/homework') {
        const childId = data.childId;
        // Seuls les élèves déjà renvoyés par le tableau de bord de cette session sont
        // acceptés : le navigateur ne peut pas choisir un identifiant arbitraire.
        if (typeof childId !== 'string' || !current.cache?.children.some((c) => c.id === childId))
          throw new EdError('Élève introuvable.', 404);
        current.homeworkCache ??= new Map();
        const cursor = data.cursor ?? null;
        if (cursor !== null && (!Number.isSafeInteger(cursor) || (cursor as number) < 0))
          throw new EdError('Pagination invalide.', 400);
        const cacheKey = childId + ':' + String(cursor);
        const cached = current.homeworkCache.get(cacheKey);
        if (cached && Date.now() - cached.time < 60000) {
          json(200, cached.value);
          return;
        }
        const result = await current.client.homeworkForChild(childId, { cursor: cursor as number | null });
        current.homeworkCache.set(cacheKey, { time: Date.now(), value: result });
        json(200, result);
        return;
      }

      if (path === '/api/dashboard') {
        if (current.cache && Date.now() - (current.cacheTime ?? 0) < 60000) {
          json(200, current.cache);
          return;
        }
        const result = await current.client.dashboard();
        current.cache = result;
        current.cacheTime = Date.now();
        json(200, result);
        return;
      }

      throw new EdError('Route introuvable.', 404);
    } catch (error) {
      // Seuls les messages EdError, rédigés pour l'utilisateur, sont transmis ; toute
      // autre erreur reste générique pour ne pas exposer de détail interne.
      json((error as { status?: number })?.status || 500, {
        error: error instanceof EdError ? error.message : 'Erreur locale inattendue.',
        code: (error as { code?: unknown })?.code,
      });
    } finally {
      if (session && ownsLock) session.busy = false;
      if (ownsAiLock && session) {
        session.aiBusy = false;
        aiActive--;
      }
    }
  });

  server.on('close', () => {
    clearInterval(cleanup);
    for (const s of sessions.values()) s.client.clear();
    sessions.clear();
  });
  return server;
}

// Démarrage uniquement en exécution directe ; un import (tests) ne lance rien.
// Les variables déjà présentes dans l'environnement priment sur `.env`.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.loadEnvFile(fileURLToPath(new URL('.env', projectRoot)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Impossible de lire la configuration .env.');
      process.exit(1);
    }
  }
  const port = Number(process.env.PORT || 3210);
  const hostname = process.env.HOST || '127.0.0.1';
  let sessionStore: SessionStore;
  try {
    sessionStore = new SessionStore(
      process.env.ORBITE_DATA_DIR || fileURLToPath(new URL('.orbite-data/' + port + '/', projectRoot)),
    );
  } catch {
    console.error('Impossible d’ouvrir le coffre de sessions. Vérifiez la clé, les fichiers et leurs permissions.');
    process.exit(1);
  }
  const server = createApp({ hostname, sessionStore });
  let stopping = false;
  // Arrêt propre : `close` laisse finir les requêtes en cours, donc la dernière
  // rotation de jeton est sauvegardée avant la sortie.
  const shutdown = (): void => {
    if (stopping) return;
    stopping = true;
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  server.on('error', (error: NodeJS.ErrnoException) => {
    console.error(
      error.code === 'EADDRINUSE'
        ? `Le port ${port} est occupé. Essayez PORT=3211 npm start.`
        : `Impossible de démarrer le serveur local (${error.code || 'erreur inconnue'}).`,
    );
    process.exitCode = 1;
  });
  server.listen(port, hostname, () =>
    console.log(
      `Orbite · http://${hostname}:${port}\nSessions chiffrées sur disque ; notes et devoirs en mémoire. Ctrl+C pour arrêter.`,
    ),
  );
}
