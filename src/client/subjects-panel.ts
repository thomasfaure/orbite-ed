/**
 * Tableau des moyennes par matière d'un élève.
 *
 * Rôle : détailler, dans la vue d'un élève, d'où vient sa moyenne générale.
 * Chaque matière apparaît avec son coefficient, sa moyenne calculée, la moyenne
 * officielle d'ÉcoleDirecte et la moyenne de classe, puis ses sous-matières en
 * retrait (Anglais > Écrit, Anglais > Oral). Une dernière ligne rappelle la
 * moyenne générale calculée et, si elle est fournie, la moyenne générale officielle.
 *
 * Fonctionnement : les lignes viennent de `subjectAverages` (`src/shared/metrics.ts`),
 * avec les notes de la période affichée (`currentNotes`) et les matières de cette
 * période (`periodSubjects`, transmises par `card`). Le HTML est inséré par
 * `render()`, sous le graphique détaillé.
 *
 * Points d'attention :
 * - La colonne ÉcoleDirecte sert de contrôle : un écart avec la moyenne calculée
 *   signale une règle propre à l'établissement (arrondis, notes non publiées,
 *   pondération différente des sous-matières). Elle est vide pour « Toutes les
 *   périodes » sans période annuelle, ou si l'établissement masque les moyennes.
 * - Une matière de coefficient 0 est affichée mais ne compte pas dans la moyenne
 *   générale ; un coefficient inconnu est affiché « — » et compte pour 1.
 * - Les libellés viennent d'ÉcoleDirecte et passent par `e()`.
 *
 * Liens : `views.ts` (`card`), `src/shared/metrics.ts`, `src/styles/_panels.scss`
 * (classes `subjects-*`).
 */
import { type SubjectAverage, generalAverage, subjectAverages } from '../shared/metrics.ts';
import type { Child, Subject } from '../shared/types.ts';
import { e, fmt } from './format.ts';
import { currentNotes, state } from './state.ts';

const coefficient = (s: SubjectAverage) =>
  s.coefficient === null
    ? '—'
    : s.coefficient === 0
      ? '<span title="Ne compte pas dans la moyenne générale">0</span>'
      : s.coefficient.toLocaleString('fr-FR');

function row(s: SubjectAverage, sub: boolean): string {
  return `<tr class="${sub ? 'subject-sub' : 'subject-main'}"><td>${sub ? '<span aria-hidden="true">↳ </span>' : ''}${e(s.label)}</td><td>${coefficient(s)}</td><td class="note-value"><strong>${fmt(s.average)}</strong></td><td class="muted">${fmt(s.official)}</td><td class="class-value">${fmt(s.classAverage)}</td><td class="muted">${s.count}</td></tr>`;
}

export function subjectsPanel(child: Child, subjects: readonly Subject[]): string {
  const notes = currentNotes(child);
  const rows = subjectAverages(notes, subjects);
  if (!rows.length) return '';
  const official = child.periods.find((p) => p.id === state.period)?.average ?? null;
  return `<section class="panel subjects-panel" aria-label="Moyennes par matière de ${e(child.name)}"><div class="panel-heading"><h2>Moyennes par matière</h2><span class="muted">Sur 20</span></div><div class="table-scroll"><table><thead><tr><th>Matière</th><th>Coef.</th><th>Moyenne</th><th>ÉcoleDirecte</th><th>Classe</th><th>Notes</th></tr></thead><tbody>${rows
    .map((s) => row(s, false) + s.subjects.map((x) => row(x, true)).join(''))
    .join(
      '',
    )}</tbody><tfoot><tr class="subject-total"><td>Moyenne générale</td><td></td><td class="note-value"><strong>${fmt(generalAverage(notes, subjects))}</strong></td><td class="muted">${fmt(official)}</td><td></td><td></td></tr></tfoot></table></div><p class="chart-explanation">Moyenne d’une matière : moyenne de ses notes pondérées par leur coefficient, ou de ses sous-matières pondérées par leur coefficient quand ÉcoleDirecte le fournit. Moyenne générale : moyenne des matières pondérée par leur coefficient (0 = ne compte pas, « — » = inconnu, compte pour 1). La colonne ÉcoleDirecte reprend les moyennes officielles, pour contrôle ; la classe est calculée sur les mêmes évaluations.</p></section>`;
}
