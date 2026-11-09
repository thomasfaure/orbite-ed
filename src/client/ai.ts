/**
 * Accès navigateur à l'assistant IA.
 *
 * Rôle : point d'entrée unique du navigateur vers l'IA. Il envoie un texte à la
 * route `/api/ai` du serveur Orbite, qui détient la clé OpenAI et applique les
 * quotas ; le navigateur ne contacte jamais OpenAI directement.
 *
 * Fonctionnement : un `POST` JSON avec l'en-tête `X-Orbite-Client` exigé par la
 * protection CSRF du serveur, et le cookie de session (`same-origin`). Une
 * réponse en erreur devient une exception portant `status`, pour distinguer une
 * session expirée (401) d'un quota atteint (429).
 *
 * Points d'attention :
 * - Tout ce qui est passé dans `input` part chez OpenAI : l'appelant choisit
 *   explicitement les données transmises (voir `coaching.ts`, qui n'envoie que
 *   des statistiques agrégées, sans nom ni prénom).
 * - Le texte renvoyé vient d'un modèle : l'afficher avec `textContent`.
 *
 * Liens : `src/server/server.ts` (route `/api/ai`), `src/client/coaching.ts`,
 * `src/client/coaching-panel.ts`.
 */
import type { AIResult, ApiError } from '../shared/types.ts';

/** Appelle uniquement le serveur Orbite ; aucune clé OpenAI dans le navigateur.
 * Le texte passé en input sera transmis à OpenAI. Rien n'est joint automatiquement.
 * Afficher text via textContent (jamais innerHTML sans assainissement).
 */
export async function askAI(input: string, { signal }: { signal?: AbortSignal } = {}): Promise<AIResult> {
  const response = await fetch('/api/ai', {
    method: 'POST',
    credentials: 'same-origin',
    signal: signal ?? null,
    headers: { 'Content-Type': 'application/json', 'X-Orbite-Client': '1' },
    body: JSON.stringify({ input }),
  });
  let result: AIResult & Partial<ApiError>;
  try {
    result = await response.json();
  } catch {
    throw new Error('Réponse du serveur non reconnue.');
  }
  if (!response.ok)
    throw Object.assign(new Error(result.error || 'La demande IA a échoué.'), { status: response.status });
  return result;
}
