/**
 * Graphiques SVG des résultats.
 *
 * Rôle : produire les deux graphiques d'un élève. La mini-courbe (`spark`) figure
 * sur chaque carte ; le graphique détaillé (`detailedChart`) remplace la
 * mini-courbe quand l'élève est sélectionné. Le second montre trois séries :
 * moyenne cumulée de l'élève, moyenne cumulée de classe et tendance glissante.
 *
 * Fonctionnement : les points viennent de `gradeTimeline` (`src/shared/metrics.ts`)
 * et sont projetés dans un repère SVG fixe (`viewBox`). L'axe horizontal est
 * proportionnel au temps et l'axe vertical couvre au moins 0 à 20. Le SVG est
 * renvoyé sous forme de texte, inséré par `render()`.
 *
 * Points d'attention :
 * - La fenêtre de tendance (`state.days`) et la période (`currentNotes`)
 *   viennent de l'état : changer de filtre impose un nouveau `render()`.
 * - Les libellés de dates sont échappés par `e()` ; les nombres sont calculés.
 * - L'apparence des séries (couleurs, épaisseurs) est définie dans
 *   `src/styles/_chart.scss` via les classes `series-*`.
 *
 * Liens : `views.ts` (`card`), `state.ts`, `format.ts`, `src/shared/metrics.ts`.
 */
import { gradeTimeline } from '../shared/metrics.ts';
import type { Child, Note } from '../shared/types.ts';
import { e, fmt } from './format.ts';
import { currentNotes, state } from './state.ts';

type TimelineField = 'average' | 'classAverage' | 'trend';

// Mini-courbe d'une carte (276 × 72). L'échelle verticale couvre au moins 0 à 20
// et s'élargit par paliers de 5 si une valeur en sort.
export function spark(notes: Note[], cls = 'spark'): string {
  const list = gradeTimeline(notes, state.days);
  const first = list[0];
  const last = list.at(-1);
  if (!first || !last) return '<div class="spark-empty">Aucune moyenne disponible.</div>';
  const start = first.time;
  const end = last.time;
  const values = list.flatMap((p) => [p.average, p.classAverage, p.trend]).filter(Number.isFinite) as number[];
  const ymax = Math.max(20, Math.ceil(Math.max(...values) / 5) * 5);
  const ymin = Math.min(0, Math.floor(Math.min(...values) / 5) * 5);
  const x = (t: number) => (start === end ? 138 : 8 + ((t - start) / (end - start)) * 260);
  const y = (v: number | null) => 64 - (((v as number) - ymin) / (ymax - ymin)) * 54;
  const points = list.map((p) => `${x(p.time)},${y(p.average)}`).join(' ');
  return `<svg class="${cls}" viewBox="0 0 276 72" role="img" aria-label="Évolution de la moyenne cumulée de l’élève sur 20"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>${list.length === 1 ? `<circle cx="138" cy="${y(first.average)}" r="3" fill="currentColor"/>` : ''}</svg>`;
}

export function detailedChart(child: Child): string {
  const days = state.days;
  const points = gradeTimeline(currentNotes(child), days);
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last)
    return '<section class="panel detailed-chart"><h2>Évolution des résultats</h2><p class="muted">Aucune note chiffrée datée pour cette période.</p></section>';
  const left = 58;
  const right = 930;
  const top = 24;
  const bottom = 300;
  const start = first.time;
  const end = last.time;
  const x = (t: number) => (start === end ? (left + right) / 2 : left + ((t - start) / (end - start)) * (right - left));
  const values = points.flatMap((p) => [p.average, p.classAverage, p.trend]).filter(Number.isFinite) as number[];
  const ymax = Math.max(20, Math.ceil(Math.max(...values) / 5) * 5);
  const ymin = Math.min(0, Math.floor(Math.min(...values) / 5) * 5);
  const y = (v: number) => bottom - ((v - ymin) / (ymax - ymin)) * (bottom - top);
  const label = (d: string) =>
    new Date(d + 'T12:00:00Z').toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: '2-digit',
      timeZone: 'UTC',
    });
  // Une valeur `null` interrompt le tracé (`M` relance un segment) au lieu de relier
  // deux points éloignés par-dessus un trou de données.
  const line = (field: TimelineField, cls: string) => {
    let active = false;
    const path = points
      .map((p) => {
        const value = p[field];
        if (value === null) {
          active = false;
          return '';
        }
        const part = `${active ? 'L' : 'M'}${x(p.time)},${y(value)}`;
        active = true;
        return part;
      })
      .join(' ');
    return (
      `<path class="${cls}" d="${path}"/>` +
      points
        .flatMap((p) => {
          const value = p[field];
          return value === null
            ? []
            : [
                `<circle class="${cls}" cx="${x(p.time)}" cy="${y(value)}" r="3"><title>${e(label(p.date))} · ${field === 'trend' ? `Tendance ${days} jours (${p.count} notes)` : field === 'classAverage' ? 'Moyenne cumulée de classe' : 'Moyenne cumulée de l’élève'} : ${fmt(value)}/20</title></circle>`,
              ];
        })
        .join('')
    );
  };
  const ticks = Array.from({ length: 6 }, (_, i) => start + ((end - start) * i) / 5).filter(
    (_, i) => start !== end || i === 0,
  );
  let grid = '';
  for (let v = ymin; v <= ymax; v += 5)
    grid += `<line x1="${left}" x2="${right}" y1="${y(v)}" y2="${y(v)}" class="chart-grid"/><text x="${left - 12}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  return `<section class="panel detailed-chart" aria-label="Évolution des notes de ${e(child.name)}"><div class="panel-heading"><h2>Évolution des résultats</h2><span class="muted">Notes sur 20</span></div><div class="chart-key"><span class="key-student">Moyenne de l’élève</span><span class="key-class">Moyenne cumulée de classe</span><span class="key-trend">Tendance sur ${days} jours</span></div><div class="chart-scroll" tabindex="0" role="region" aria-label="Graphique défilant horizontalement sur petit écran"><svg class="grade-chart" viewBox="0 0 960 350" role="img" aria-label="Notes et moyennes de classe par date, tendance pondérée sur ${days} jours"><title>Évolution des résultats sur la période sélectionnée</title>${grid}<path d="M${left} ${top}V${bottom}H${right}" class="chart-axis"/>${ticks.map((t) => `<text x="${x(t)}" y="325" text-anchor="middle">${e(label(new Date(t).toISOString().slice(0, 10)))}</text>`).join('')}${line('average', 'series-student')}${line('classAverage', 'series-class')}${line('trend', 'series-trend')}</svg></div><p class="chart-explanation">Chaque point représente la moyenne cumulée depuis le début de la période sélectionnée, pondérée par les coefficients. La courbe de classe cumule les moyennes des mêmes évaluations lorsqu’elles sont disponibles ; ce n’est pas la moyenne générale officielle de la classe. La tendance est une moyenne glissante pondérée par les coefficients sur ${days} jours, à partir de deux notes ; ce n’est pas une prévision.${points.some((p) => p.classAverage !== null) ? '' : ' Moyennes de classe indisponibles.'} Survolez les points pour les détails.</p></section>`;
}
