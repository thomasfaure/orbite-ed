/**
 * Client OpenAI côté serveur.
 *
 * Rôle : transmettre un texte à l'API OpenAI Responses et renvoyer une réponse
 * normalisée (`AIResult`). C'est le seul endroit qui connaît la clé
 * `OPENAI_API_KEY` ; le navigateur passe toujours par la route `/api/ai`, qui sert
 * aussi aux conseils de coaching par élève.
 *
 * Fonctionnement : un unique appel `POST /v1/responses` (modèle `OPENAI_MODEL`,
 * `gpt-5-mini` par défaut), avec des instructions système fixes, `store: false`
 * (aucune conservation côté OpenAI) et un délai maximal de 45 secondes. Le texte
 * assistant est extrait des blocs `output_text` ou `refusal` de la réponse.
 *
 * Points d'attention :
 * - Les erreurs OpenAI sont traduites en `EdError` avec des messages génériques :
 *   le détail technique et la clé ne doivent jamais remonter au navigateur.
 * - Une réponse `incomplete` (limite de jetons atteinte) reste acceptée si elle
 *   contient du texte ; elle est signalée par `complete: false`.
 * - Le serveur applique ses propres quotas avant d'appeler ce client.
 *
 * Liens : `server.ts` (route `/api/ai`), `src/client/ai.ts` (appelant navigateur).
 */
import { EdError } from './ecoledirecte.ts';
import type { AIResult } from '../shared/types.ts';

/** Contrat minimal utilisé par le serveur ; les tests fournissent leur propre implémentation. */
export interface AIClient {
  readonly configured: boolean;
  respond(input: string): Promise<AIResult>;
}

interface ResponsesContent {
  type?: string;
  text?: unknown;
  refusal?: unknown;
}

interface ResponsesBody {
  status?: string;
  output?: { type?: string; role?: string; content?: ResponsesContent[] }[];
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
}

export interface OpenAIOptions {
  apiKey?: string;
  model?: string;
  transport?: typeof fetch;
}

export class OpenAIClient implements AIClient {
  apiKey: string | undefined;
  model: string;
  fetch: typeof fetch;

  constructor({
    apiKey = process.env.OPENAI_API_KEY,
    model = process.env.OPENAI_MODEL || 'gpt-5-mini',
    transport = fetch,
  }: OpenAIOptions = {}) {
    this.apiKey = apiKey?.trim();
    this.model = model;
    this.fetch = transport;
  }

  get configured(): boolean {
    return !!this.apiKey;
  }

  async respond(input: string): Promise<AIResult> {
    if (typeof input !== 'string' || !input.trim() || input.length > 8000)
      throw new EdError('Le texte doit contenir entre 1 et 8 000 caractères.', 400);
    if (!this.configured) throw new EdError('OpenAI n’est pas configuré sur le serveur.', 503);
    let response: Response;
    let body: ResponsesBody;
    try {
      response = await this.fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(45000),
        headers: { Authorization: 'Bearer ' + this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          input: input.trim(),
          store: false,
          max_output_tokens: 2048,
          instructions:
            'Réponds en français, clairement et brièvement. Tu es un assistant du tableau de bord familial Orbite. Ne prétends pas accéder à des données qui ne figurent pas dans la demande.',
        }),
      });
    } catch (error) {
      const name = (error as Error | undefined)?.name;
      throw new EdError(
        name === 'TimeoutError' || name === 'AbortError'
          ? 'OpenAI met trop de temps à répondre. Réessayez.'
          : 'OpenAI est momentanément injoignable.',
        504,
      );
    }
    if (!response.ok) {
      const message =
        response.status === 429
          ? 'Limite ou quota OpenAI atteint. Réessayez plus tard.'
          : [401, 403].includes(response.status)
            ? 'La configuration OpenAI du serveur doit être vérifiée.'
            : 'La requête OpenAI a échoué.';
      throw new EdError(message, response.status === 429 ? 429 : 502);
    }
    try {
      body = (await response.json()) as ResponsesBody;
    } catch {
      throw new EdError('Réponse OpenAI non reconnue.', 502);
    }
    // La sortie mélange messages, raisonnements et appels d'outils : seuls les
    // messages de l'assistant contiennent le texte à afficher.
    if (!['completed', 'incomplete'].includes(body.status ?? '') || !Array.isArray(body.output))
      throw new EdError('Réponse OpenAI indisponible.', 502);
    const parts = body.output
      .filter((item) => item.type === 'message' && item.role === 'assistant')
      .flatMap((item) => (Array.isArray(item.content) ? item.content : []));
    const text = parts
      .map((part) => (part.type === 'output_text' ? part.text : part.type === 'refusal' ? part.refusal : ''))
      .filter((value): value is string => typeof value === 'string')
      .join('\n')
      .trim();
    if (!text)
      throw new EdError(
        body.status === 'incomplete'
          ? 'La réponse dépasse la limite autorisée. Reformulez une demande plus courte.'
          : 'OpenAI n’a pas renvoyé de texte.',
        502,
      );
    const count = (value: unknown): number | null =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
    return {
      text,
      complete: body.status === 'completed',
      refused: parts.some((p) => p.type === 'refusal'),
      usage: { inputTokens: count(body.usage?.input_tokens), outputTokens: count(body.usage?.output_tokens) },
    };
  }
}
