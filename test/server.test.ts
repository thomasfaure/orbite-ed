/**
 * Tests du serveur HTTP (`createApp` dans `src/server/server.ts`).
 *
 * Rôle : vérifier les garanties de sécurité et de cohérence de l'API locale.
 * Sont couverts :
 * - contrôle de l'hôte et de l'origine, protection CSRF, accès anonyme refusé ;
 * - cookie HttpOnly et réponses sans secret ;
 * - verrou par session, qui n'est pas libéré par une requête concurrente refusée ;
 * - liste blanche des fichiers servis et limitation des connexions ;
 * - mode réseau local (LAN), caches des notes et des devoirs ;
 * - persistance des sessions après redémarrage, avec rotation des jetons ;
 * - route IA : validation, verrou dédié et quotas.
 *
 * Fonctionnement : `harness()` appelle directement le gestionnaire de requêtes
 * du serveur, sans ouvrir de port. Les requêtes sont des flux `Readable` et les
 * réponses de faux objets qui capturent statut, en-têtes et corps. Le client
 * ÉcoleDirecte et l'IA sont remplacés par des doublures ; les tests de
 * persistance utilisent un vrai `SessionStore` dans un dossier temporaire
 * supprimé à la fin.
 *
 * Points d'attention : l'adresse est simulée (port 3210) car `server.address()`
 * vaut `null` sans écoute. Les fichiers statiques sont lus depuis `dist/` :
 * `npm test` reconstruit le projet avant l'exécution.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, type AppOptions, type DashboardClient } from '../src/server/server.ts';
import { SessionStore } from '../src/server/session-store.ts';
import { EcoleDirecte } from '../src/server/ecoledirecte.ts';
import type { AuthResult, Dashboard, HomeworkPage } from '../src/shared/types.ts';
import type { AIClient } from '../src/server/openai.ts';

interface Reply {
  status: number;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}
interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  data?: unknown;
}

const dashboard = (value: unknown) => value as Dashboard;

// Exécute le vrai gestionnaire HTTP sans ouvrir de socket d'écoute.
function harness(options: AppOptions = {}) {
  const client = {} as DashboardClient;
  Object.assign(client, {
    state: 'anonymous',
    clear() {
      client.state = 'anonymous';
    },
    async login(): Promise<AuthResult> {
      client.state = 'authenticated';
      return { state: 'authenticated' };
    },
    async verify(): Promise<AuthResult> {
      return { state: 'authenticated' };
    },
    async dashboard() {
      return dashboard({ demo: false, children: [] });
    },
  });
  const server = createApp({ clientFactory: () => client, ...options });
  Object.assign(server, { address: () => ({ port: 3210 }) });
  async function request(path: string, { method = 'GET', headers = {}, data }: RequestOptions = {}): Promise<Reply> {
    const req = Readable.from(data === undefined ? [] : [JSON.stringify(data)]);
    Object.assign(req, { url: path, method, headers: { host: '127.0.0.1:3210', ...headers } });
    const h: Record<string, string> = {};
    return new Promise((resolve) => {
      const res = {
        status: 0,
        setHeader(k: string, v: string) {
          h[k] = v;
        },
        writeHead(status: number, more: Record<string, string>) {
          this.status = status;
          Object.assign(h, more);
        },
        end(body: unknown) {
          let value: unknown;
          try {
            value = JSON.parse(String(body));
          } catch {
            value = String(body);
          }
          // Les tests ne lisent les propriétés que des réponses JSON ; un fichier statique reste une chaîne.
          resolve({ status: this.status, headers: h, body: value as Reply['body'] });
        },
      };
      server.emit('request', req, res);
    });
  }
  return { server, client, request };
}

const post = {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-orbite-client': '1' },
  data: { username: 'parent', password: 'secret' },
};
const cookieOf = (reply: Reply) => reply.headers['Set-Cookie']?.split(';')[0] ?? '';
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('refuse host non local, CSRF et accès anonyme aux notes', async (t) => {
  const h = harness();
  t.after(() => h.server.emit('close'));
  assert.equal((await h.request('/api/session', { headers: { host: 'evil.test:3210' } })).status, 403);
  assert.equal(
    (await h.request('/api/login', { ...post, headers: { ...post.headers, origin: 'https://evil.test' } })).status,
    403,
  );
  assert.equal((await h.request('/api/login', { method: 'POST', data: post.data })).status, 403);
  assert.equal((await h.request('/api/dashboard', { ...post, data: {} })).status, 401);
});

test('cookie HttpOnly, état sans secrets, notes et déconnexion', async (t) => {
  const h = harness();
  t.after(() => h.server.emit('close'));
  const login = await h.request('/api/login', post);
  assert.equal(login.status, 200);
  assert.match(login.headers['Set-Cookie'] ?? '', /HttpOnly; SameSite=Strict/);
  const headers = { ...post.headers, cookie: cookieOf(login) };
  assert.deepEqual((await h.request('/api/session', { headers })).body, { state: 'authenticated' });
  assert.equal((await h.request('/api/dashboard', { method: 'POST', headers, data: {} })).status, 200);
  await h.request('/api/logout', { method: 'POST', headers, data: {} });
  assert.equal((await h.request('/api/dashboard', { method: 'POST', headers, data: {} })).status, 401);
});

test('une requête concurrente refusée ne libère pas le verrou', async (t) => {
  const h = harness();
  t.after(() => h.server.emit('close'));
  const login = await h.request('/api/login', post);
  let finish: (value: Dashboard) => void = () => {};
  h.client.dashboard = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const options = { method: 'POST', headers: { ...post.headers, cookie: cookieOf(login) }, data: {} };
  const first = h.request('/api/dashboard', options);
  await tick();
  assert.equal((await h.request('/api/dashboard', options)).status, 409);
  assert.equal((await h.request('/api/dashboard', options)).status, 409);
  finish(dashboard({ children: [] }));
  assert.equal((await first).status, 200);
});

test('assets autorisés seulement et limitation des connexions', async (t) => {
  const h = harness();
  t.after(() => h.server.emit('close'));
  assert.equal((await h.request('/server.js')).status, 404);
  assert.equal((await h.request('/')).status, 200);
  for (let i = 0; i < 6; i++) await h.request('/api/login', post);
  assert.equal((await h.request('/api/login', post)).status, 429);
});

test('LAN explicite : hôte et origine exacts, autres hôtes refusés', async (t) => {
  const h = harness({ hostname: '192.168.1.20' });
  t.after(() => h.server.emit('close'));
  assert.equal(
    (await h.request('/api/session', { headers: { host: '192.168.1.20:3210', origin: 'http://192.168.1.20:3210' } }))
      .status,
    200,
  );
  assert.equal((await h.request('/api/session', { headers: { host: '192.168.1.21:3210' } })).status, 403);
  assert.equal((await h.request('/api/session', { headers: { host: '192.168.1.20:3211' } })).status, 403);
  assert.equal(
    (await h.request('/api/session', { headers: { host: '192.168.1.20:3210', origin: 'http://evil.test' } })).status,
    403,
  );
});

test('devoirs différés : accès, verrou partagé, cache indépendant des notes', async (t) => {
  const h = harness();
  t.after(() => h.server.emit('close'));
  assert.equal((await h.request('/api/homework', { ...post, data: { childId: '1:11' } })).status, 401);
  const login = await h.request('/api/login', post);
  const headers = { ...post.headers, cookie: cookieOf(login) };
  const options = { method: 'POST', headers, data: { childId: '1:11' } };
  h.client.dashboard = async () => dashboard({ children: [{ id: '1:11', notes: [], periods: [] }] });
  await h.request('/api/dashboard', { method: 'POST', headers, data: {} });
  assert.equal((await h.request('/api/homework', { ...options, data: { childId: 'other' } })).status, 404);
  let finish: (value: HomeworkPage) => void = () => {};
  let count = 0;
  h.client.homeworkForChild = ((id: string) => {
    count++;
    assert.equal(id, '1:11');
    return new Promise((resolve) => {
      finish = resolve;
    });
  }) as DashboardClient['homeworkForChild'];
  const pending = h.request('/api/homework', options);
  await tick();
  assert.equal((await h.request('/api/homework', options)).status, 409);
  assert.equal((await h.request('/api/dashboard', { method: 'POST', headers, data: {} })).status, 409);
  finish({ homework: [] } as unknown as HomeworkPage);
  assert.equal((await pending).status, 200);
  assert.equal((await h.request('/api/homework', options)).status, 200);
  assert.equal(count, 1);
});

test('redémarrage : même cookie restauré, rotation persistée, déconnexion durable et expiration', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'orbite-server-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  class Client extends EcoleDirecte {
    override async login(): Promise<AuthResult> {
      this.state = 'authenticated';
      this.token = 'first-token';
      this.accounts = [];
      return { state: 'authenticated' };
    }
    override async dashboard() {
      assert.equal(this.token, 'first-token');
      this.token = 'rotated-token';
      return dashboard({ children: [] });
    }
  }
  const factory = () => new Client();
  const first = harness({ clientFactory: factory, sessionStore: new SessionStore(directory) });
  const login = await first.request('/api/login', post);
  assert.equal(login.status, 200);
  const headers = { ...post.headers, cookie: cookieOf(login) };
  const expiry = new SessionStore(directory).load()[0]?.expires;
  await first.request('/api/dashboard', { method: 'POST', headers, data: {} });
  first.server.emit('close');
  const saved = new SessionStore(directory).load()[0];
  assert.ok(saved);
  assert.equal((saved.auth as { token: string }).token, 'rotated-token');
  const second = harness({ clientFactory: factory, sessionStore: new SessionStore(directory) });
  assert.equal((await second.request('/api/session', { headers })).body.state, 'authenticated');
  assert.equal(new SessionStore(directory).load()[0]?.expires, expiry);
  await second.request('/api/logout', { method: 'POST', headers, data: {} });
  second.server.emit('close');
  const third = harness({ clientFactory: factory, sessionStore: new SessionStore(directory) });
  assert.equal((await third.request('/api/session', { headers })).body.state, 'anonymous');
  third.server.emit('close');
  const store = new SessionStore(directory);
  const c = factory();
  await c.login();
  store.save([{ id: 'a'.repeat(64), expires: Date.now() - 1, auth: c.exportSession() }]);
  const fourth = harness({ clientFactory: factory, sessionStore: store });
  assert.deepEqual(store.load(), []);
  fourth.server.emit('close');
});

test('API IA : authentification complète, CSRF, validation et fichiers privés', async (t) => {
  let calls = 0;
  const aiClient = {
    configured: true,
    respond: async () => {
      calls++;
      return { text: 'OK', complete: true };
    },
  } as unknown as AIClient;
  const h = harness({ aiClient });
  t.after(() => h.server.emit('close'));
  const aiPost = { ...post, data: { input: 'Test' } };
  assert.equal((await h.request('/api/ai', aiPost)).status, 401);
  const login = await h.request('/api/login', post);
  const headers = { ...post.headers, cookie: cookieOf(login) };
  h.client.state = 'question';
  assert.equal((await h.request('/api/ai', { ...aiPost, headers })).status, 401);
  h.client.state = 'authenticated';
  assert.equal(
    (await h.request('/api/ai', { ...aiPost, headers: { ...headers, origin: 'https://evil.test' } })).status,
    403,
  );
  assert.equal(
    (await h.request('/api/ai', { ...aiPost, headers, data: { input: 'Test', model: 'expensive' } })).status,
    400,
  );
  assert.equal((await h.request('/api/ai', { ...aiPost, headers })).body.text, 'OK');
  assert.equal(calls, 1);
  for (const path of ['/.env', '/.env.example', '/src/server/openai.ts', '/dist/server/openai.js', '/server.js'])
    assert.equal((await h.request(path)).status, 404);
  assert.equal((await h.request('/client/ai.js')).status, 200);
});

test('IA indépendante du chargement scolaire, verrou IA et quota', async (t) => {
  let finish: (value: unknown) => void = () => {};
  const aiClient = {
    configured: true,
    respond: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  } as unknown as AIClient;
  const h = harness({ aiClient });
  t.after(() => h.server.emit('close'));
  const login = await h.request('/api/login', post);
  const headers = { ...post.headers, cookie: cookieOf(login) };
  const options = { method: 'POST', headers, data: { input: 'Test' } };
  const pending = h.request('/api/ai', options);
  await tick();
  assert.equal((await h.request('/api/ai', options)).status, 429);
  assert.equal((await h.request('/api/dashboard', { method: 'POST', headers, data: {} })).status, 200);
  finish({ text: 'OK' });
  assert.equal((await pending).status, 200);
  aiClient.respond = async () => ({ text: 'OK' }) as Awaited<ReturnType<AIClient['respond']>>;
  for (let i = 0; i < 9; i++) assert.equal((await h.request('/api/ai', options)).status, 200);
  assert.equal((await h.request('/api/ai', options)).status, 429);
});
