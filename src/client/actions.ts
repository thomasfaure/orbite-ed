/**
 * Actions réseau de l'interface : appels au serveur, chargements et connexion.
 *
 * Rôle : tout ce qui interroge le serveur local et met l'état à jour en
 * conséquence. Cela couvre l'appel générique `api`, le chargement en deux temps
 * du tableau de bord (`load` puis `loadHomework`), la pagination des devoirs
 * (`moreHomework`) et le parcours de connexion avec double authentification
 * (`openAuth`, `submit`, `acceptAuth`).
 *
 * Fonctionnement :
 * - `load()` récupère notes et moyennes (`/api/dashboard`) et les affiche
 *   aussitôt. `loadHomework()` charge ensuite les devoirs élève par élève, en ne
 *   remplaçant que le panneau concerné (`updateHomework`).
 * - Chaque opération mémorise `state.generation` au départ (`run`). Une réponse
 *   arrivée après un changement de contexte compare son `run` à la valeur
 *   courante et s'abandonne sans toucher à l'affichage.
 * - Une réponse 401 remet l'interface à zéro et rouvre la connexion dans `api`
 *   même ; l'erreur est quand même levée pour interrompre l'appelant.
 *
 * Points d'attention :
 * - Les appels sont séquentiels (un élève après l'autre) : le serveur refuse deux
 *   opérations ÉcoleDirecte simultanées pour une même session (409). `busy` et
 *   `homeworkLoading` empêchent l'interface d'en lancer deux.
 * - Les POST portent l'en-tête `X-Orbite-Client`, exigé par le serveur contre les
 *   requêtes intersites (CSRF).
 * - `test/loading.test.ts` pilote ces fonctions avec un faux `fetch` et un faux
 *   `document` ; toute nouvelle dépendance au navigateur doit y être simulée.
 *
 * Liens : `src/server/server.ts` (routes `/api/*`), `views.ts`, `state.ts`,
 * `app.ts` (branchement des formulaires et des boutons), `public/index.html`
 * (boîte de dialogue `#auth`).
 */
import { isSecondary } from '../shared/metrics.ts';
import type { AuthResult, Child, Dashboard, HomeworkPage } from '../shared/types.ts';
import { $, toast } from './dom.ts';
import { e } from './format.ts';
import { state } from './state.ts';
import { render, updateHomework, updateRefresh } from './views.ts';

type ErrorWithStatus = Error & { status?: number };

/**
 * Appelle l'API du serveur : GET sans corps, POST JSON sinon (avec l'en-tête
 * anti-CSRF). Une réponse 401 remet l'interface à zéro et rouvre la connexion,
 * puis l'erreur est quand même levée pour interrompre l'appelant.
 */
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch('/api/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Orbite-Client': '1' },
    body: body === undefined ? null : JSON.stringify(body),
  });
  const result = await r.json();
  if (!r.ok) {
    if (r.status === 401) {
      state.generation++;
      state.busy = false;
      state.homeworkLoading = false;
      state.data = null;
      state.authState = 'anonymous';
      render();
      openAuth();
    }
    throw Object.assign(new Error(result.error || 'Une erreur est survenue.'), { status: r.status });
  }
  return result as T;
}

export function openAuth(): void {
  state.authState = 'anonymous';
  $('#loginForm').hidden = false;
  $('#verifyForm').hidden = true;
  $('#authError').textContent = '';
  if (!$<HTMLDialogElement>('#auth').open) $<HTMLDialogElement>('#auth').showModal();
}

/**
 * Charge la première page de devoirs de chaque élève, l'un après l'autre. Une
 * erreur reste propre à l'élève concerné, sauf une 401 qui arrête tout (`api`
 * a déjà réinitialisé l'interface).
 */
export async function loadHomework(snapshot: Dashboard, run: number): Promise<void> {
  try {
    for (const child of snapshot.children) {
      if (run !== state.generation || state.data !== snapshot) return;
      try {
        const result = await api<HomeworkPage>('homework', { childId: child.id });
        if (run !== state.generation || state.data !== snapshot) return;
        Object.assign(child, result);
      } catch (err) {
        if (run !== state.generation || state.data !== snapshot) return;
        child.homeworkError = (err as Error).message;
        if ((err as ErrorWithStatus).status === 401) return;
      }
      child.homeworkLoading = false;
      updateHomework(child);
    }
  } finally {
    if (run === state.generation) {
      state.homeworkLoading = false;
      updateRefresh();
    }
  }
}

export async function moreHomework(child: Child): Promise<void> {
  if (state.busy || state.homeworkLoading || child.homeworkNext == null) return;
  const snapshot = state.data;
  const run = state.generation;
  state.homeworkLoading = true;
  child.homeworkMoreLoading = true;
  child.homeworkMoreError = '';
  updateHomework(child);
  updateRefresh();
  try {
    const result = await api<HomeworkPage>('homework', { childId: child.id, cursor: child.homeworkNext });
    if (run !== state.generation || state.data !== snapshot) return;
    // Fusion par identifiant : une page ne doit jamais dupliquer un devoir ou une date déjà affichés.
    child.homework = [...new Map([...(child.homework || []), ...result.homework].map((h) => [h.id, h])).values()];
    child.homeworkDates = [
      ...new Map([...(child.homeworkDates || []), ...result.homeworkDates].map((g) => [g.date, g])).values(),
    ].sort((a, b) => a.date.localeCompare(b.date));
    child.homeworkNext = result.homeworkNext;
    child.homeworkPartial ||= result.homeworkPartial;
  } catch (err) {
    if (run === state.generation) child.homeworkMoreError = (err as Error).message;
  } finally {
    if (run === state.generation) {
      state.homeworkLoading = false;
      child.homeworkMoreLoading = false;
      updateHomework(child);
      updateRefresh();
    }
  }
}

/**
 * Charge (ou actualise) le tableau de bord. En actualisation, l'ancien affichage
 * reste visible jusqu'à l'arrivée des nouvelles données ; depuis l'accueil ou la
 * démonstration, l'écran de chargement s'affiche.
 */
export async function load(): Promise<void> {
  if (state.busy || state.homeworkLoading) return;
  state.busy = true;
  const run = ++state.generation;
  if (!state.data || state.data.demo) {
    state.data = null;
    render();
  } else updateRefresh();
  try {
    const snapshot = await api<Dashboard>('dashboard', {});
    if (run !== state.generation) return;
    snapshot.children = snapshot.children.filter((c) => isSecondary(c.className));
    snapshot.children.forEach((c) => {
      c.homeworkLoading = true;
    });
    state.data = snapshot;
    if (state.selected !== 'all' && !snapshot.children.some((c) => c.id === state.selected)) state.selected = 'all';
    state.busy = false;
    state.homeworkLoading = snapshot.children.length > 0;
    render();
    toast('Les notes sont à jour.');
    // Non attendu : les notes restent utilisables pendant le chargement des devoirs.
    void loadHomework(snapshot, run);
  } catch (err) {
    if (run === state.generation) {
      state.busy = false;
      render();
      toast((err as Error).message);
    }
  } finally {
    state.busy = false;
    updateRefresh();
  }
}

async function acceptAuth(result: AuthResult): Promise<void> {
  state.authState = result.state;
  if (result.state === 'authenticated') {
    $<HTMLDialogElement>('#auth').close();
    $<HTMLFormElement>('#loginForm').reset();
    state.selected = 'all';
    state.period = 'all';
    await load();
    return;
  }
  $('#loginForm').hidden = true;
  $('#verifyForm').hidden = false;
  $('#question').textContent = (result.state === 'question' && result.question) || 'Code de double authentification';
  $('#choices').innerHTML =
    result.state === 'question'
      ? result.choices
          .map(
            (c, i) => `<label class="choice"><input type="radio" name="choice" value="${i}" required> ${e(c)}</label>`,
          )
          .join('')
      : '<label>Code à six chiffres<input name="code" required inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="000000"></label>';
  $('#choices input')?.focus();
}

function setAuthLoading(active: boolean): void {
  state.authBusy = active;
  $('#authLoading').hidden = !active;
  $('#loginForm').hidden = active || ['question', 'totp'].includes(state.authState);
  $('#verifyForm').hidden = active || !['question', 'totp'].includes(state.authState);
  $<HTMLButtonElement>('#closeAuth').disabled = active;
  $('#auth').setAttribute('aria-busy', String(active));
}

export async function submit(event: Event, route: 'login' | 'verify'): Promise<void> {
  event.preventDefault();
  if (state.authBusy) return;
  const form = event.target as HTMLFormElement;
  const fields = new FormData(form);
  $('#authError').textContent = '';
  setAuthLoading(true);
  try {
    const payload =
      route === 'login'
        ? { username: fields.get('username'), password: fields.get('password') }
        : state.authState === 'totp'
          ? { code: fields.get('code') }
          : { choice: Number(fields.get('choice')) };
    const result = await api<AuthResult>(route, payload);
    if (route === 'login') form.reset();
    setAuthLoading(false);
    await acceptAuth(result);
  } catch (err) {
    $('#authError').textContent = (err as Error).message;
  } finally {
    setAuthLoading(false);
  }
}
