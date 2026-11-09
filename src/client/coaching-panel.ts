/**
 * Affichage des conseils IA sous les cartes élèves.
 *
 * Rôle : produire l'emplacement du conseil (`coachingPanel`) et le remplir après
 * coup (`loadCoaching`). La préparation des données et la consigne envoyée au
 * modèle restent dans `coaching.ts` ; ce module gère le moment des demandes et
 * l'endroit où le texte s'affiche.
 *
 * Fonctionnement : `render()` insère un emplacement par carte puis lance
 * `loadCoaching()`. La boucle traite un élève après l'autre ; les réponses sont
 * mises en cache par `createCoachingCache`, si bien qu'un nouvel affichage avec
 * les mêmes filtres réutilise les conseils déjà obtenus.
 *
 * Points d'attention :
 * - Le contexte d'affichage (données, période, fenêtre, `generation`) est figé au
 *   départ. Dès qu'il change, la boucle s'arrête : le `render()` suivant a relancé
 *   la sienne, et les demandes en file sont annulées avant tout appel payant.
 * - Le texte du modèle est inséré via `textContent`, jamais en HTML.
 * - Mode démonstration, élève en erreur ou sans note : un texte fixe est affiché
 *   et rien n'est envoyé à l'IA.
 *
 * Liens : `coaching.ts`, `ai.ts`, `views.ts` (`card`, `render`), `state.ts`.
 */
import type { Child } from '../shared/types.ts';
import { askAI } from './ai.ts';
import { coachingContext, coachingPrompt, createCoachingCache } from './coaching.ts';
import { appRoot } from './dom.ts';
import { e } from './format.ts';
import { state } from './state.ts';

const coachingCache = createCoachingCache(askAI);

export function coachingPanel(child: Child): string {
  return `<div class="student-coaching" data-coaching-id="${e(child.id)}" aria-live="polite"><small>Conseil personnalisé · IA</small><p role="status">Préparation du conseil…</p></div>`;
}

/**
 * Remplit les conseils IA des cartes affichées, un élève après l'autre. Le
 * contexte d'affichage est figé au départ ; dès qu'il change (données, filtre,
 * fenêtre), la boucle s'arrête : le `render()` suivant a relancé la sienne.
 */
export async function loadCoaching(): Promise<void> {
  const snapshot = state.data;
  const run = state.generation;
  const viewPeriod = state.period;
  const viewDays = state.days;
  if (!snapshot) {
    coachingCache.clear();
    return;
  }
  const current = () =>
    state.data === snapshot && state.generation === run && state.period === viewPeriod && state.days === viewDays;
  const panelOf = (child: Child) =>
    [...appRoot().querySelectorAll<HTMLElement>('[data-coaching-id]')].find((p) => p.dataset.coachingId === child.id);
  for (const child of snapshot.children) {
    if (!current()) return;
    if (!panelOf(child)) continue;
    const context = coachingContext(child, viewPeriod, viewDays);
    let text: string;
    if (snapshot.demo) text = 'Mode démonstration : les conseils IA sont disponibles après connexion.';
    else if (child.error) text = 'Les résultats sont indisponibles pour préparer un conseil fiable.';
    else if (!context.count) text = 'Pas encore assez de notes pour préparer ton conseil.';
    else {
      const prompt = coachingPrompt(context);
      try {
        text = await coachingCache.get(child.id + ':' + prompt, prompt, current);
      } catch {
        text = 'Conseil indisponible pour le moment. Les résultats restent consultables.';
      }
    }
    if (!current()) return;
    // Retrouver le bloc : un changement de filtre peut avoir remplacé le DOM.
    const target = panelOf(child);
    const paragraph = target?.querySelector('p');
    if (paragraph) {
      paragraph.textContent = text;
      paragraph.title = text;
    }
  }
}
