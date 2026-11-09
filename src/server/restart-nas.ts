/**
 * Redémarrage de l'instance réseau local d'Orbite sur un serveur Linux (NAS, mini-PC).
 *
 * Rôle : script d'exploitation lancé à la main sur la machine serveur après
 * une mise à jour (`node dist/server/restart-nas.js`). Il arrête uniquement le
 * serveur Orbite de ce dossier, le relance détaché, puis attend qu'il réponde.
 * Il n'est jamais importé par l'application.
 *
 * Fonctionnement :
 * 1. Lit HOST, PORT et ORBITE_LOG (facultatif) dans le `.env` du projet.
 * 2. Parcourt `/proc` pour trouver les processus à arrêter : même exécutable Node,
 *    même dossier courant, script serveur reconnu, et variable
 *    `ORBITE_NAS_INSTANCE` ou `PORT` correspondante.
 * 3. Envoie SIGTERM (arrêt propre qui sauvegarde les sessions) et attend jusqu'à 5 s.
 * 4. Relance `dist/server/server.js` détaché, journal ajouté à `ORBITE_LOG`
 *    (défaut : `orbite.log` à la racine du projet), puis interroge `/api/session`
 *    jusqu'à 6 s.
 *
 * Points d'attention :
 * - Le filtrage strict évite de tuer une autre instance (port local 3210, autre
 *   copie du projet) ou un processus Node sans rapport.
 * - Aucun SIGKILL : si l'ancien serveur ne s'arrête pas, le script échoue plutôt
 *   que de risquer un coffre de sessions écrit à moitié.
 * - Dépend de `/proc` : ne fonctionne pas sur macOS.
 *
 * Liens : `start-nas.sh` (démarrage initial), `server.ts` (processus relancé).
 */
import { open, readFile, readdir, readlink, realpath } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const directory = await realpath(fileURLToPath(new URL('../../', import.meta.url)));
const serverScript = 'dist/server/server.js';
const config = parseEnv(await readFile(directory + '/.env', 'utf8'));
const hostname = config.HOST?.trim();
const port = Number(config.PORT);
if (!hostname || !Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('Renseignez HOST et PORT (1 à 65535) dans le fichier .env du serveur.');
const probeHost = hostname === '0.0.0.0' ? '127.0.0.1' : hostname;
const address = `http://${probeHost.includes(':') ? '[' + probeHost + ']' : probeHost}:${port}`;
const executable = await realpath(process.execPath);
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// Les installations antérieures à TypeScript exécutaient server.js à la racine.
const scripts = ['server.js', directory + '/server.js', serverScript, directory + '/' + serverScript];

const targets: number[] = [];
for (const entry of await readdir('/proc')) {
  if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
  try {
    const base = '/proc/' + entry;
    if ((await readlink(base + '/exe')) !== executable || (await readlink(base + '/cwd')) !== directory) continue;
    const args = (await readFile(base + '/cmdline', 'utf8')).split('\0');
    const env = (await readFile(base + '/environ', 'utf8')).split('\0');
    if (
      !args.some((a) => scripts.includes(a)) ||
      !(env.includes('ORBITE_NAS_INSTANCE=' + directory) || env.includes('PORT=' + port))
    )
      continue;
    targets.push(Number(entry));
  } catch (error) {
    if (!['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
  }
}
for (const pid of targets) process.kill(pid, 'SIGTERM');
for (let i = 0; i < 50 && targets.some(alive); i++) await sleep(100);
if (targets.some(alive)) throw new Error('Ancien serveur encore actif : arrêt du redémarrage.');

const logFile = config.ORBITE_LOG?.trim() || directory + '/orbite.log';
const log = await open(logFile, 'a');
const child = spawn(executable, [directory + '/' + serverScript], {
  cwd: directory,
  env: { ...process.env, HOST: hostname, PORT: String(port), ORBITE_NAS_INSTANCE: directory },
  detached: true,
  stdio: ['ignore', log.fd, log.fd],
});
child.on('error', (error) => {
  console.error('Démarrage impossible :', error.message);
  process.exitCode = 1;
});
child.unref();
await log.close();

let ready = false;
for (let i = 0; i < 20; i++) {
  await sleep(300);
  if (!child.pid || !alive(child.pid)) break;
  try {
    const response = await fetch(address + '/api/session', { signal: AbortSignal.timeout(1000) });
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {}
}
if (!ready) throw new Error('Serveur indisponible : consulter ' + logFile);
console.log(`Orbite redémarré : ${address} — sessions non expirées conservées.`);
