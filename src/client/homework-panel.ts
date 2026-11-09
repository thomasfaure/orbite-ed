/**
 * Panneau « Devoirs à faire » d'un élève.
 *
 * Rôle : produire le HTML des devoirs affichés sous chaque carte. Les devoirs sont
 * regroupés par date d'échéance, avec une barre de progression par jour, le
 * marquage du prochain jour ouvré, les évaluations à préparer, les pièces
 * jointes et le bouton « En voir plus ».
 *
 * Fonctionnement : fonction pure de l'élève et de `state.homeworkLoading`. Les
 * champs `homework*` de l'élève sont remplis par `actions.ts` (`loadHomework`,
 * `moreHomework`). Après chaque chargement, `views.ts` (`updateHomework`)
 * remplace uniquement ce panneau, sans reconstruire la page.
 *
 * Points d'attention :
 * - Sans `homeworkDates` (réponse d'un serveur d'une ancienne version), les dates
 *   sont déduites des devoirs eux-mêmes, sans barre de progression.
 * - Les consignes sont déjà réduites à du texte par le serveur et sont de
 *   nouveau échappées ici par `e()`.
 * - L'attribut `data-homework-id` sert à retrouver le panneau ;
 *   `data-more-homework` déclenche la pagination via la délégation de clics.
 *
 * Liens : `views.ts` (`card`, `updateHomework`), `actions.ts`, `app.ts` (clics),
 * `src/styles/_homework.scss`.
 */
import { nextSchoolDay } from '../shared/metrics.ts';
import type { Child, HomeworkDate } from '../shared/types.ts';
import { e } from './format.ts';
import { state } from './state.ts';

export function homeworkPanel(child: Child): string {
  const list = child.homework || [];
  const urgent = nextSchoolDay();
  const dates: HomeworkDate[] =
    child.homeworkDates ||
    [...new Set(list.map((h) => h.dueDate))].sort().map((date) => ({ date, total: null, done: null }));
  return `<section class="homework" data-homework-id="${e(child.id)}" aria-label="Devoirs de ${e(child.name)}"><div class="homework-heading"><h3>Devoirs à faire</h3>${Array.isArray(child.homework) ? `<span class="count">${list.length}</span>` : ''}</div>
 ${
   child.homeworkLoading
     ? '<p class="inline-loading" role="status"><span class="spinner" aria-hidden="true"></span>Chargement des devoirs…</p>'
     : child.homeworkError
       ? `<p class="homework-warning" role="status">${e(child.homeworkError)}</p>`
       : !Array.isArray(child.homework)
         ? '<p class="muted">Devoirs en attente de chargement.</p>'
         : `
 <p class="homework-caption">${child.homeworkDates ? '30 prochains jours · progression déclarée sur ÉcoleDirecte' : 'Redémarrez le serveur pour activer la pagination et la progression.'}</p>
 ${child.homeworkPartial ? '<p class="homework-warning">Certains détails sont indisponibles.</p>' : ''}
 ${
   dates
     .map((group) => {
       const tasks = list.filter((h) => h.dueDate === group.date);
       const label = new Date(group.date + 'T12:00:00Z').toLocaleDateString('fr-FR', {
         weekday: 'long',
         day: 'numeric',
         month: 'long',
         timeZone: 'Europe/Paris',
       });
       return `<div class="homework-day"><div class="homework-date">${group.total !== null ? `<span class="homework-progress" title="${group.done} devoirs cochés comme faits sur ${group.total}"><progress max="${group.total || 1}" value="${group.done}" aria-label="Devoirs faits le ${e(label)}"></progress><span>${group.done}/${group.total}</span></span>` : ''}<time datetime="${e(group.date)}">${e(label)}</time></div>
 ${group.unknown ? '<p class="homework-caption">Certains statuts ne sont pas renseignés.</p>' : ''}
 ${tasks.length ? `<ul class="homework-list">${tasks.map((h) => `<li class="${h.dueDate === urgent ? 'homework-urgent' : ''}"><div class="homework-meta"><strong>${e(h.subject)}</strong>${h.dueDate === urgent ? '<span class="urgent-label">Pour le prochain jour de semaine</span>' : ''}</div>${h.exam ? '<span class="homework-tag">Évaluation à préparer</span>' : ''}${h.status === 'unknown' ? '<span class="homework-tag">Statut non renseigné</span>' : ''}<p class="homework-text">${e(h.text || 'Consigne indisponible : consulter le cahier de textes.')}</p>${h.documents?.length ? `<p class="homework-caption">Sur ÉcoleDirecte : ${h.documents.map(e).join(', ')}</p>` : ''}</li>`).join('')}</ul>` : group.done === group.total ? '<p class="homework-complete">Tous les devoirs sont cochés comme faits.</p>' : '<p class="homework-caption">Autres devoirs disponibles avec « En voir plus ».</p>'}</div>`;
     })
     .join('') || '<p class="muted">Aucun devoir sur les 30 prochains jours.</p>'
 }
 ${child.homeworkMoreError ? `<p class="homework-warning" role="status">${e(child.homeworkMoreError)}</p>` : ''}
 ${child.homeworkNext != null ? `<button class="small-button homework-more" data-more-homework="${e(child.id)}" ${state.homeworkLoading || child.homeworkMoreLoading ? 'disabled' : ''}>${child.homeworkMoreLoading ? 'Chargement…' : 'En voir plus'}<span> · 5 devoirs</span></button>` : ''}`
 }
 <a class="homework-link" href="https://www.ecoledirecte.com/" target="_blank" rel="noopener noreferrer">Ouvrir ÉcoleDirecte ↗</a></section>`;
}
