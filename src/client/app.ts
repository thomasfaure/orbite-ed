/**
 * Point d'entrée de l'application navigateur d'Orbite.
 *
 * Rôle : brancher l'interface sur la page et la démarrer. Chargé par
 * `public/index.html` sous la forme compilée `/client/app.js` (module ES). Le
 * reste du code est réparti en modules :
 * - `state.ts` : état partagé ;
 * - `views.ts` : rendu HTML ;
 * - `actions.ts` : appels réseau et connexion ;
 * - `charts.ts`, `homework-panel.ts`, `coaching-panel.ts` : panneaux des cartes ;
 * - `format.ts` et `dom.ts` : utilitaires.
 *
 * Fonctionnement :
 * - Les écouteurs de la boîte de dialogue `#auth` (fixe dans la page) sont
 *   branchés une fois.
 * - Les clics dans `#app` passent par un seul écouteur délégué, qui lit les
 *   attributs `data-*` des gabarits : `render()` peut remplacer tout le contenu
 *   sans rebrancher ces écouteurs.
 * - Au démarrage : premier affichage, puis reprise d'une session restée ouverte
 *   côté serveur (`/api/session`).
 *
 * Points d'attention :
 * - Ce module a des effets de bord à l'import (écouteurs, appel réseau) : il ne
 *   doit être importé par aucun autre module. Les tests importent les modules
 *   qu'il assemble, pas celui-ci.
 * - Chaque fichier client compilé doit figurer dans la liste blanche `assets` de
 *   `src/server/server.ts`, sinon le navigateur reçoit une 404 à l'import.
 *
 * Liens : `public/index.html`, `src/server/server.ts` (fichiers servis),
 * `src/client/demo.ts` (mode démonstration).
 */
import { isSecondary } from '../shared/metrics.ts';
import type { AuthState } from '../shared/types.ts';
import { api, load, moreHomework, openAuth, submit } from './actions.ts';
import { demoData } from './demo.ts';
import { $, appRoot, toast } from './dom.ts';
import { state } from './state.ts';
import { render } from './views.ts';

const app = appRoot();
try {
  state.sidebarCollapsed = localStorage.getItem('orbite-sidebar-collapsed') === '1';
} catch {}

// Les erreurs de chargement d'image ne remontent pas : on les capture (dernier
// argument `true`) pour retirer une photo cassée et laisser voir l'initiale.
app.addEventListener(
  'error',
  (event) => {
    const target = event.target as Element;
    if (target.matches?.('.child-avatar img')) target.remove();
  },
  true,
);

$('#auth').addEventListener('cancel', (event) => {
  if (state.authBusy) event.preventDefault();
});
$('#loginForm').addEventListener('submit', (ev) => submit(ev, 'login'));
$('#verifyForm').addEventListener('submit', (ev) => submit(ev, 'verify'));
$('#closeAuth').addEventListener('click', () => $<HTMLDialogElement>('#auth').close());
// Fermer la boîte pendant une double authentification abandonne la connexion
// côté serveur, pour ne pas laisser une session en attente.
$('#auth').addEventListener('close', () => {
  $<HTMLFormElement>('#loginForm').reset();
  $<HTMLFormElement>('#verifyForm').reset();
  if (['question', 'totp'].includes(state.authState)) {
    api('logout', {}).catch(() => {});
    state.authState = 'anonymous';
  }
});

app.addEventListener('click', async (event) => {
  const target = event.target as Element;
  const more = target.closest<HTMLElement>('[data-more-homework]');
  if (more) {
    const child = state.data?.children.find((c) => c.id === more.dataset.moreHomework);
    if (child) await moreHomework(child);
    return;
  }
  const child = target.closest<HTMLElement>('[data-child]');
  if (child) {
    state.selected = child.dataset.child ?? 'all';
    state.subject = '';
    state.period = 'all';
    render();
    return;
  }
  const focus = target.closest<HTMLElement>('[data-focus]');
  if (focus) {
    state.selected = focus.dataset.focus ?? 'all';
    state.subject = focus.dataset.subject ?? '';
    render();
    $('#grades').scrollIntoView({ behavior: 'smooth' });
    return;
  }
  const nav = target.closest<HTMLElement>('[data-nav]');
  if (nav) {
    if (nav.dataset.nav === 'overview') {
      state.selected = 'all';
      state.subject = '';
      render();
    }
    document.getElementById(nav.dataset.nav ?? '')?.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
  if (action === 'toggle-sidebar') {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    try {
      localStorage.setItem('orbite-sidebar-collapsed', state.sidebarCollapsed ? '1' : '0');
    } catch {}
    render();
    return;
  }
  if (action === 'login') openAuth();
  if (action === 'demo') {
    // Invalide un éventuel chargement réel en cours avant d'afficher la démonstration.
    state.generation++;
    state.homeworkLoading = false;
    const demo = demoData();
    demo.children = demo.children.filter((c) => isSecondary(c.className));
    state.data = demo;
    state.selected = 'all';
    state.period = 'all';
    state.subject = '';
    render();
  }
  if (action === 'refresh') await load();
  if (action === 'logout') {
    try {
      await api('logout', {});
      state.generation++;
      state.homeworkLoading = false;
      state.data = null;
      state.selected = 'all';
      state.authState = 'anonymous';
      render();
    } catch (err) {
      toast((err as Error).message);
    }
  }
  if (action === 'method') {
    const method = $<HTMLDetailsElement>('#method');
    if (method) {
      method.open = true;
      method.scrollIntoView({ behavior: 'smooth' });
    } else toast('Connectez votre compte ou explorez la démo pour voir les indicateurs.');
  }
});

// Démarrage : premier affichage, puis reprise d'une session restée ouverte (cookie
// valide ou session restaurée depuis le coffre après un redémarrage du serveur).
render();
try {
  const session = await api<{ state: AuthState }>('session');
  if (session.state === 'authenticated') {
    state.authState = session.state;
    await load();
  }
} catch (err) {
  toast((err as Error).message);
}
