/**
 * Coffre chiffré des sessions.
 *
 * Rôle : conserver sur disque les sessions ÉcoleDirecte authentifiées pour qu'un
 * redémarrage du serveur (mise à jour, coupure du NAS) ne déconnecte pas la famille.
 * Le coffre contient des jetons d'accès : il est chiffré et réservé au propriétaire.
 *
 * Fonctionnement : le dossier (par défaut `.orbite-data/<PORT>/`, droits 0700)
 * contient `key`, une clé aléatoire de 32 octets (0600), et `sessions.enc`. Ce
 * dernier a le format binaire suivant :
 *
 *   "ORB1" (4 octets) | IV (12) | tag GCM (16) | JSON chiffré en AES-256-GCM
 *
 * Le JSON vaut `{ version: 1, sessions: SavedSession[] }` et le chiffrement est
 * lié à une donnée authentifiée fixe (`AAD`), qui change si le format évolue.
 *
 * Points d'attention :
 * - Écriture atomique : fichier temporaire synchronisé, `rename`, puis
 *   synchronisation du dossier. Un arrêt brutal laisse l'ancien ou le nouveau
 *   coffre, jamais un fichier tronqué.
 * - Si la clé manque alors qu'un coffre existe, le constructeur échoue au lieu
 *   d'en générer une nouvelle qui rendrait le coffre illisible.
 * - Un coffre indéchiffrable fait échouer `load()` sans rien écraser.
 * - Les entrées chargées ne sont pas validées ici : `server.ts` vérifie
 *   identifiant et échéance, `EcoleDirecte.restoreSession` vérifie le contenu.
 *
 * Liens : `server.ts` (seul utilisateur), `SavedAuth` dans `ecoledirecte.ts`.
 */
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface SavedSession {
  id: string;
  expires: number;
  auth: unknown;
}

const AAD = 'Orbite sessions v1';

// N'est appelé qu'avec un dossier choisi par l'application, jamais avec un chemin issu d'une requête web.
export class SessionStore {
  directory: string;
  file: string;
  key: Buffer;

  constructor(directory: string) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    this.file = join(directory, 'sessions.enc');
    const keyFile = join(directory, 'key');
    if (!existsSync(keyFile)) {
      if (existsSync(this.file))
        throw new Error('Clé des sessions absente. Restaurez la clé ou supprimez le coffre pour vous reconnecter.');
      try {
        // `wx` : si deux instances démarrent ensemble, la seconde réutilise la clé de la première.
        writeFileSync(keyFile, randomBytes(32), { flag: 'wx', mode: 0o600 });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
    }
    chmodSync(keyFile, 0o600);
    this.key = readFileSync(keyFile);
    if (this.key.length !== 32) throw new Error('Clé des sessions invalide.');
  }

  load(): SavedSession[] {
    let bytes: Buffer;
    try {
      bytes = readFileSync(this.file);
      chmodSync(this.file, 0o600);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
    try {
      // Découpage : [0,4) signature, [4,16) IV, [16,32) tag, [32,…) données chiffrées.
      if (bytes.length < 32 || bytes.subarray(0, 4).toString() !== 'ORB1') throw new Error();
      const cipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(4, 16));
      cipher.setAAD(Buffer.from(AAD));
      cipher.setAuthTag(bytes.subarray(16, 32));
      const data = JSON.parse(Buffer.concat([cipher.update(bytes.subarray(32)), cipher.final()]).toString('utf8')) as {
        version?: unknown;
        sessions?: unknown;
      };
      if (data.version !== 1 || !Array.isArray(data.sessions)) throw new Error();
      return data.sessions as SavedSession[];
    } catch {
      throw new Error('Le coffre de sessions ne peut pas être déchiffré. Aucun fichier n’a été remplacé.');
    }
  }

  /** Remplace intégralement le coffre ; un IV neuf est tiré à chaque écriture (exigence de GCM). */
  save(sessions: SavedSession[]): void {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(AAD));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify({ version: 1, sessions }), 'utf8'), cipher.final()]);
    const bytes = Buffer.concat([Buffer.from('ORB1'), iv, cipher.getAuthTag(), encrypted]);
    const temp = join(this.directory, '.sessions-' + randomBytes(12).toString('hex') + '.tmp');
    try {
      const fd = openSync(temp, 'wx', 0o600);
      try {
        writeFileSync(fd, bytes);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temp, this.file);
      // Rend le renommage lui-même durable après une coupure de courant.
      const dir = openSync(this.directory, 'r');
      try {
        fsyncSync(dir);
      } finally {
        closeSync(dir);
      }
    } finally {
      if (existsSync(temp)) unlinkSync(temp);
    }
  }
}
