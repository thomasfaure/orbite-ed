/**
 * Mise en forme des valeurs affichées.
 *
 * Rôle : fonctions pures qui transforment nombres, dates et données d'élève en
 * fragments de texte ou de HTML : échappement, nombres à la française, écarts
 * signés, flèches de tendance, dates courtes, avatar et libellés des couleurs
 * de notes.
 *
 * Fonctionnement : aucune dépendance au DOM ni à l'état ; le module peut être
 * testé directement. Les gabarits HTML des vues s'appuient sur ces fonctions.
 *
 * Points d'attention :
 * - Sécurité : toute donnée venant d'ÉcoleDirecte insérée dans un gabarit HTML
 *   doit passer par `e()`. Un oubli permettrait l'injection de HTML dans la page.
 * - Une valeur absente s'affiche « — », jamais 0 : la distinction compte pour les
 *   familles (voir la méthode de calcul affichée dans l'interface).
 *
 * Liens : `views.ts`, `charts.ts`, `homework-panel.ts`, `actions.ts`,
 * `src/shared/metrics.ts` (`photoUrl`).
 */
import { photoUrl } from '../shared/metrics.ts';
import type { Child } from '../shared/types.ts';

// Échappement HTML obligatoire pour toute valeur insérée dans les gabarits des vues.
export const e = (v: unknown): string =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
export const fmt = (n: number | null | undefined): string =>
  Number.isFinite(n)
    ? (n as number).toLocaleString('fr-FR', { maximumFractionDigits: 2, minimumFractionDigits: 1 })
    : '—';
export const delta = (n: number | null): string =>
  Number.isFinite(n) ? `${(n as number) > 0 ? '+' : ''}${fmt(n)}` : '—';
export const tone = (n: number | null): string => (n === null ? 'muted' : n >= 0 ? 'up' : 'down');
export const arrow = (n: number | null): string => (n === null ? '·' : Math.abs(n) < 0.05 ? '→' : n > 0 ? '↗' : '↘');
export const date = (v: string | undefined): string => {
  const d = new Date(v ?? NaN);
  return Number.isNaN(+d) ? '—' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
};
export const icon = { overview: '◫', notes: '▤', progress: '⌁', help: 'ⓘ' };

export const bandTitles = {
  good: 'Bonne note · au moins 14/20',
  average: 'Note moyenne · de 10 à moins de 14/20',
  poor: 'Note faible · moins de 10/20',
  neutral: 'Hors classement',
};

// Initiale toujours présente sous la photo : si l'image échoue, `app.ts` la retire
// et l'initiale reste visible.
export function avatar(child: Pick<Child, 'name' | 'photo'>, mini = false): string {
  const photo = photoUrl(child.photo);
  return `<span class="avatar child-avatar ${mini ? 'mini' : ''}" title="${photo ? 'Photo ÉcoleDirecte' : 'Photo indisponible'}"><span>${e(child.name.slice(0, 1))}</span>${photo ? `<img src="${e(photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</span>`;
}
