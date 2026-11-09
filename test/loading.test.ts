/**
 * Tests de l'interface navigateur (`src/client/`) sans navigateur.
 *
 * Rôle : vérifier l'enchaînement des chargements côté interface. L'écran de
 * chargement apparaît dès la connexion, le formulaire est restauré après une
 * erreur et les notes s'affichent avant les devoirs. Une réponse tardive ne
 * réinjecte pas de données après un changement de session (compteur
 * `generation`), et « En voir plus » n'ajoute qu'une page, sans doublon.
 *
 * Fonctionnement : les modules clients sont importés directement (`actions.ts`,
 * `views.ts`, `homework-panel.ts`, `state.ts`), sans `app.ts` qui branche les
 * événements de la vraie page au chargement. Le navigateur est simulé par :
 * - un faux `document` dont `querySelector` renvoie un `FakeNode` par sélecteur,
 *   créé à la demande et conservé pour être inspecté ;
 * - un faux `fetch` qui transmet chaque appel `/api/<route>` au gestionnaire
 *   `server` du test, avec le corps JSON décodé ;
 * - un faux `FormData` (identifiants fixes) et des minuteries simulées, pour que
 *   le délai de 5 s des messages (`toast`) ne retienne pas le processus.
 * Avant chaque test, l'état partagé est remis à `initialState()` et les faux
 * éléments sont oubliés.
 *
 * Points d'attention :
 * - Les globales sont posées avant tout appel aux modules : `dom.ts` interroge
 *   `document` au moment de l'appel, jamais à l'import.
 * - `api` attend `fetch` puis `json()` : `flush()` laisse passer ces étapes
 *   avant de vérifier l'effet d'une réponse.
 * - Toute nouvelle dépendance des modules au navigateur (méthode d'élément,
 *   globale) doit être ajoutée au faux DOM ci-dessous.
 */
import test, { beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { load, loadHomework, moreHomework, submit } from '../src/client/actions.ts';
import { homeworkPanel } from '../src/client/homework-panel.ts';
import { card, renderRows, type RowNote } from '../src/client/views.ts';
import { initialState, state } from '../src/client/state.ts';
import * as metrics from '../src/shared/metrics.ts';
import type { Child, Dashboard } from '../src/shared/types.ts';

interface FakeNode {
  innerHTML: string;
  textContent: string;
  hidden: boolean;
  open: boolean;
  [key: string]: unknown;
}

const nodes = new Map<string, FakeNode>();
const node = (key: string): FakeNode => {
  let found = nodes.get(key);
  if (!found) {
    found = {
      innerHTML: '',
      textContent: '',
      hidden: false,
      open: false,
      dataset: {},
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener() {},
      setAttribute() {},
      reset() {},
      focus() {},
      showModal() {
        this.open = true;
      },
      close() {
        this.open = false;
      },
      querySelector: node,
      querySelectorAll() {
        return [];
      },
    };
    nodes.set(key, found);
  }
  return found;
};

type Server = (path: string, body: unknown) => Promise<unknown>;
let server: Server = async () => ({});

Object.assign(globalThis, {
  document: { querySelector: node },
  FormData: class {
    get(k: string) {
      return ({ username: 'test', password: 'secret' } as Record<string, string>)[k];
    }
  },
  fetch: (url: string, init: { body: string | null }) =>
    server(url.replace('/api/', ''), init.body === null ? undefined : JSON.parse(init.body)).then((value) =>
      Response.json(value),
    ),
});
mock.timers.enable({ apis: ['setTimeout'] });

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
};

beforeEach(() => {
  Object.assign(state, initialState());
  nodes.clear();
  server = async () => ({});
});

test('loader immédiat à la connexion et restauration du formulaire sur erreur', async () => {
  let fail: (error: Error) => void = () => {};
  server = () =>
    new Promise((_, reject) => {
      fail = reject;
    });
  const event = { preventDefault() {}, target: node('#loginForm') } as unknown as Event;
  const pending = submit(event, 'login');
  assert.equal(node('#authLoading').hidden, false);
  assert.equal(node('#loginForm').hidden, true);
  fail(new Error('Connexion refusée'));
  await pending;
  assert.equal(node('#authLoading').hidden, true);
  assert.equal(node('#loginForm').hidden, false);
  assert.equal(node('#authError').textContent, 'Connexion refusée');
});

test('les notes deviennent visibles avant la résolution des devoirs', async () => {
  let notes: (value: unknown) => void = () => {};
  let homework: (value: unknown) => void = () => {};
  const calls: string[] = [];
  server = (path) => {
    calls.push(path);
    return new Promise((resolve) => {
      if (path === 'dashboard') notes = resolve;
      else homework = resolve;
    });
  };
  const pending = load();
  assert.match(node('#app').innerHTML, /Chargement du tableau de bord/);
  notes({
    updatedAt: new Date().toISOString(),
    children: [{ id: '1:11', name: 'Test', className: '5e', notes: [], periods: [] }],
  });
  await pending;
  assert.deepEqual(calls, ['dashboard', 'homework']);
  assert.match(node('#app').innerHTML, /Résultats par élève/);
  assert.match(node('#app').innerHTML, /Chargement des devoirs/);
  assert.equal(state.busy, false);
  assert.equal(state.homeworkLoading, true);
  homework({ homework: [] });
  await flush();
  assert.equal(state.homeworkLoading, false);
  assert.equal(state.data?.children[0]?.homework?.length, 0);
});

test('une réponse différée ne réinjecte pas les données après un changement de session', async () => {
  let done: (value: unknown) => void = () => {};
  server = () =>
    new Promise((resolve) => {
      done = resolve;
    });
  const snapshot = { children: [{ id: '1:11' }] } as unknown as Dashboard;
  state.data = snapshot;
  state.homeworkLoading = true;
  const pending = loadHomework(snapshot, state.generation);
  state.generation++;
  state.data = null;
  state.homeworkLoading = false;
  done({ homework: [{ text: 'ancien compte' }] });
  await pending;
  assert.equal(state.data, null);
  assert.equal(snapshot.children[0]?.homework, undefined);
});

test('dates séparées, ratio et bouton de pagination, bordure sélectionnée sur le conteneur', () => {
  const child = {
    id: '1:11',
    name: 'Test',
    className: '5e',
    notes: [],
    periods: [],
    homework: [{ id: '1', dueDate: metrics.nextSchoolDay(), subject: 'Maths', text: 'Exercice' }],
    homeworkDates: [{ date: metrics.nextSchoolDay(), done: 4, total: 5 }],
    homeworkNext: 1,
  } as unknown as Child;
  const html = homeworkPanel(child);
  assert.match(html, /4\/5/);
  assert.match(html, /<progress max="5" value="4"/);
  assert.match(html, /homework-urgent/);
  assert.match(html, /En voir plus/);
  state.selected = '1:11';
  assert.match(card(child, 0), /student-summary is-selected/);
});

test('la recherche met à jour le compteur « Toutes les notes » et le pied du tableau', () => {
  const row = (title: string) =>
    ({
      title,
      subject: 'Mathématiques',
      subjectId: 'MATHS:',
      child: { name: 'Test' },
      date: '2026-11-02',
      value: 12,
      outOf: 20,
      coefficient: 1,
      classAverage: null,
      excluded: false,
      raw: '12',
    }) as unknown as RowNote;
  const rows = [row('Contrôle de fractions'), row('Oral'), row('Contrôle de géométrie')];
  state.search = 'contrôle';
  renderRows(rows);
  assert.equal(node('#gradesCount').textContent, '2');
  assert.equal(node('#resultCount').textContent, '2 évaluations');
  state.search = '';
  renderRows(rows);
  assert.equal(node('#gradesCount').textContent, '3');
});

test('En voir plus ajoute une page au seul enfant demandé sans doublons', async () => {
  state.data = {
    children: [
      { id: '1:11', homework: [{ id: 'a' }], homeworkDates: [], homeworkNext: 1 },
      { id: '1:22', homework: [] },
    ],
  } as unknown as Dashboard;
  server = async (path, body) => {
    const payload = body as { childId: string; cursor: number };
    assert.equal(path, 'homework');
    assert.equal(payload.childId, '1:11');
    assert.equal(payload.cursor, 1);
    return { homework: [{ id: 'a' }, { id: 'b' }], homeworkDates: [], homeworkNext: null };
  };
  const [first, second] = state.data.children as [Child, Child];
  await moreHomework(first);
  assert.equal(first.homework?.length, 2);
  assert.equal(second.homework?.length, 0);
  assert.equal(state.homeworkLoading, false);
});
