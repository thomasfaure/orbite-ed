/**
 * Tests du client OpenAI serveur (`src/server/openai.ts`).
 *
 * Rôle : vérifier que l'appel à l'API Responses respecte les paramètres imposés
 * (modèle, `store: false`, instructions, limite de jetons) et que seul le texte
 * de l'assistant est renvoyé. Une clé absente ou une entrée invalide ne doivent
 * déclencher aucun appel facturé. Les erreurs du fournisseur ou du réseau ne
 * doivent laisser fuir ni le corps brut ni la clé, et les réponses incomplètes
 * ou refusées doivent être signalées.
 *
 * Fonctionnement : un faux transport (`fetch`) inspecte la requête produite et
 * renvoie des réponses construites pour chaque cas.
 *
 * Points d'attention : dans les cas d'erreur, la clé et les corps de réponse
 * contiennent le mot `secret`, qui sert de témoin : les assertions vérifient
 * qu'il n'apparaît dans aucun message renvoyé.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIClient } from '../src/server/openai.ts';

type Transport = (
  url: string,
  options: RequestInit & { headers: Record<string, string>; body: string },
) => Promise<unknown>;
const transport = (fn: Transport) => fn as unknown as typeof fetch;
type Failure = Error & { status?: number };

test('Responses : clé backend, paramètres imposés et extraction de texte sans métadonnées', async () => {
  const client = new OpenAIClient({
    apiKey: 'secret-server',
    model: 'test-model',
    transport: transport(async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(options.headers.Authorization, 'Bearer secret-server');
      assert.equal(options.redirect, 'error');
      const body = JSON.parse(options.body);
      assert.equal(body.input, 'Bonjour');
      assert.equal(body.model, 'test-model');
      assert.equal(body.store, false);
      assert.equal(body.max_output_tokens, 2048);
      assert.equal(body.tools, undefined);
      return new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            { type: 'reasoning', summary: [] },
            { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Réponse' }] },
          ],
          usage: { input_tokens: 10, output_tokens: 4 },
          private: 'NEVER_RETURN',
        }),
      );
    }),
  });
  const result = await client.respond(' Bonjour ');
  assert.equal(result.text, 'Réponse');
  assert.equal(result.complete, true);
  assert.equal(result.usage.outputTokens, 4);
  assert.ok(!JSON.stringify(result).includes('NEVER_RETURN'));
});

test('clé absente et entrée invalide : aucun appel payant', async () => {
  let calls = 0;
  const client = new OpenAIClient({
    apiKey: '',
    transport: transport(async () => {
      calls++;
    }),
  });
  await assert.rejects(
    () => client.respond('bonjour'),
    (e: Failure) => e.status === 503,
  );
  await assert.rejects(
    () => client.respond(' '),
    (e: Failure) => e.status === 400,
  );
  await assert.rejects(
    () => client.respond('a'.repeat(8001)),
    (e: Failure) => e.status === 400,
  );
  assert.equal(calls, 0);
});

test('erreurs fournisseur et réseau ne renvoient ni corps brut ni secret', async () => {
  for (const status of [401, 403, 429, 500]) {
    const client = new OpenAIClient({
      apiKey: 'secret',
      transport: transport(async () => new Response('NEVER_RETURN secret', { status })),
    });
    await assert.rejects(
      () => client.respond('test'),
      (e: Failure) =>
        !e.message.includes('secret') &&
        !e.message.includes('NEVER_RETURN') &&
        e.status === (status === 429 ? 429 : 502),
    );
  }
  const timeout = new OpenAIClient({
    apiKey: 'secret',
    transport: transport(async () => {
      throw Object.assign(new Error('secret'), { name: 'TimeoutError' });
    }),
  });
  await assert.rejects(
    () => timeout.respond('test'),
    (e: Failure) => e.status === 504 && !e.message.includes('secret'),
  );
});

test('réponse incomplète ou refus signalés explicitement', async () => {
  for (const status of ['completed', 'incomplete']) {
    const c = new OpenAIClient({
      apiKey: 'secret',
      transport: transport(
        async () =>
          new Response(
            JSON.stringify({
              status,
              output: [
                { type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'Demande refusée' }] },
              ],
            }),
          ),
      ),
    });
    const result = await c.respond('test');
    assert.equal(result.refused, true);
    assert.equal(result.complete, status === 'completed');
  }
});
