/**
 * Vues principales du tableau de bord.
 *
 * Rôle : construire l'interface à partir de `state` : barre latérale, en-tête,
 * cartes élèves, alertes de baisse, tableau « Toutes les notes », explication de
 * la méthode et écran d'accueil. Ce module fournit aussi les mises à jour
 * partielles (tableau filtré, panneau de devoirs, bouton d'actualisation) qui
 * évitent de reconstruire toute la page.
 *
 * Fonctionnement :
 * - `render()` remplace tout le contenu de `#app` par un gabarit HTML, remplit le
 *   tableau (`renderRows`), lance le remplissage des conseils IA, puis rebranche
 *   les écouteurs des filtres, perdus avec les anciens éléments.
 * - Les clics (élève, navigation, actions) ne sont pas gérés ici : ils passent
 *   par l'écouteur délégué de `app.ts`, grâce aux attributs `data-*` des gabarits.
 * - La recherche et le filtre de matière ne redessinent que le tableau, pour que
 *   le champ de saisie garde le focus.
 *
 * Points d'attention :
 * - Toute donnée ÉcoleDirecte insérée dans les gabarits passe par `e()`.
 * - Le compteur `#gradesCount` et le pied `#resultCount` suivent le filtrage du
 *   tableau ; ils sont mis à jour par `renderRows`, pas par `render`.
 * - Seuls les élèves du secondaire sont affichés (`isSecondary`), y compris en
 *   démonstration.
 *
 * Liens : `state.ts`, `format.ts`, `charts.ts`, `homework-panel.ts`,
 * `coaching-panel.ts`, `subjects-panel.ts`, `actions.ts` (appelant), `src/styles/` (classes utilisées).
 */
import {
  gradeBand,
  isSecondary,
  metrics,
  periodSubjects,
  subjectGroups,
  toTwenty,
  valid,
  weeklyNotes,
} from '../shared/metrics.ts';
import type { Child, Note } from '../shared/types.ts';
import { detailedChart, spark } from './charts.ts';
import { coachingPanel, loadCoaching } from './coaching-panel.ts';
import { $, appRoot } from './dom.ts';
import { arrow, avatar, bandTitles, date, delta, e, fmt, icon, tone } from './format.ts';
import { homeworkPanel } from './homework-panel.ts';
import { currentNotes, state } from './state.ts';
import { subjectsPanel } from './subjects-panel.ts';

export type RowNote = Note & { child: Child };

function weeklyNotesPanel(child: Child): string {
  const week = weeklyNotes(child.notes);
  return `<span class="weekly-notes"><span class="weekly-heading">7 derniers jours <small>${date(week.start)} – ${date(week.end)}</small></span>${week.notes.length ? week.notes.map((n) => `<span class="weekly-note" title="${e(n.title || n.subject)}"><span class="weekly-subject" title="${e(n.subject)}">${e(n.subject)}</span><time datetime="${e(n.date.slice(0, 10))}">${date(n.date)}</time><strong class="grade-${gradeBand(n)}">${fmt(toTwenty(n.value, n.outOf))}<small>/20</small></strong></span>`).join('') : '<span class="weekly-empty">Aucune note sur ces 7 jours.</span>'}${week.total > 3 ? `<span class="weekly-more">+ ${week.total - 3} autre${week.total - 3 > 1 ? 's' : ''} dans le tableau des notes</span>` : ''}</span>`;
}

// Carte d'un élève. `i` choisit la couleur d'accent ; la courbe détaillée remplace
// la mini-courbe quand l'élève est sélectionné.
export function card(child: Child, i: number): string {
  const { selected, period, days } = state;
  const notes = currentNotes(child);
  const subjects = periodSubjects(child.periods, period);
  const m = metrics(notes, new Date(), days, subjects);
  const p = child.periods.find((p) => p.id === period);
  const average = p?.average ?? m.average;
  const official = p?.average !== null && p?.average !== undefined;
  return `<article class="student-summary ${selected === child.id ? 'is-selected' : ''}"><button class="child-card ${selected === child.id ? 'selected' : ''} accent-${i % 6}" data-child="${e(child.id)}"><div class="card-heading">${avatar(child)}<span class="child-name">${e(child.name)}<small>${e(child.className || 'Classe non renseignée')}</small></span><span class="card-arrow">↗</span></div><div class="card-score">${fmt(average)}<span>/20</span></div><span class="score-label">${official ? 'Moyenne officielle' : 'Moyenne générale calculée'}</span>${selected === child.id ? '' : spark(notes, subjects)}<div class="card-bottom"><span class="${tone(m.trend)}" title="Évolution de la moyenne générale sur ${days} jours">${arrow(m.trend)} ${delta(m.trend)} <small>pt</small></span><span>${m.count} notes</span></div><div class="class-gap">${child.error ? `<span class="down">${e(child.error)}</span>` : m.gap === null ? `<span class="muted">${m.count ? 'Moyenne de classe indisponible' : 'Pas encore de notes chiffrées'}</span>` : `<span class="${tone(m.gap)}">${delta(m.gap)} pt</span> par rapport à la classe`}</div>${weeklyNotesPanel(child)}</button>${coachingPanel(child)}${selected === child.id ? detailedChart(child, subjects) + subjectsPanel(child, subjects) : ''}${homeworkPanel(child)}</article>`;
}

/**
 * Reconstruit toute l'interface à partir de l'état courant. Les éléments
 * remplacés perdent leurs écouteurs : ceux des filtres sont rebranchés à la fin,
 * les clics passent par la délégation sur `#app`. La recherche et le filtre de
 * matière ne redessinent que le tableau (`renderRows`) pour garder le focus.
 */
export function render(): void {
  const { data, selected, period, days, search, subject, busy, homeworkLoading, sidebarCollapsed } = state;
  const app = appRoot();
  const children = (data?.children || []).filter((c) => isSecondary(c.className));
  const focus = children.filter((c) => selected === 'all' || c.id === selected);
  const all: RowNote[] = focus.flatMap((c) => currentNotes(c).map((n) => ({ ...n, child: c })));
  const periods = [...new Map(focus.flatMap((c) => c.periods.map((p) => [p.id, p] as const))).values()];
  // Alertes : matières en baisse d'au moins un point sur la fenêtre choisie, les plus fortes d'abord.
  const alerts = focus
    .flatMap((c) =>
      subjectGroups(currentNotes(c)).map((s) => ({ ...s, child: c, m: metrics(s.notes, new Date(), days) })),
    )
    .filter((s) => s.m.trend !== null && s.m.trend <= -1)
    .sort((a, b) => (a.m.trend ?? 0) - (b.m.trend ?? 0));
  app.classList.toggle('sidebar-collapsed', sidebarCollapsed);
  app.innerHTML = `<aside id="sidebar"><a class="brand" href="/" aria-label="Accueil Orbite"><img src="/favicon.svg" alt=""><span>orbite<span class="brand-dot">.</span></span></a><div class="workspace">SUIVI SCOLAIRE<span>LOCAL</span></div><nav><button class="nav active" data-nav="overview">${icon.overview}<span>Vue d’ensemble</span></button><button class="nav" data-nav="grades">${icon.notes}<span>Toutes les notes</span></button><button class="nav" data-nav="children">${icon.progress}<span>Progression</span></button></nav><div class="nav-label">ÉLÈVES <span>${children.length || '—'}</span></div><div class="children-nav">${children.map((c) => `<button class="child-nav ${selected === c.id ? 'active' : ''}" data-child="${e(c.id)}">${avatar(c, true)}${e(c.name)}<small>${e(c.className)}</small></button>`).join('') || '<p class="fine">Aucun élève connecté.</p>'}</div><div class="aside-bottom"><div class="privacy"><span>◈</span><div>Accès local<small>Réseau familial</small></div></div><button class="nav" data-action="method">${icon.help}<span>Méthode de calcul</span></button><div class="user"><div class="avatar mini">F</div><div>Espace parents<small>${data?.demo ? 'Démonstration' : data ? 'ÉcoleDirecte connecté' : 'Compte à connecter'}</small></div><button class="icon-button" data-action="${data && !data.demo ? 'logout' : 'login'}" aria-label="${data && !data.demo ? 'Déconnexion' : 'Connexion'}">${data && !data.demo ? '⏻' : '↗'}</button></div></div></aside>
 <main id="overview"><header><button class="sidebar-toggle" data-action="toggle-sidebar" aria-controls="sidebar" aria-expanded="${!sidebarCollapsed}" aria-label="${sidebarCollapsed ? 'Déplier' : 'Replier'} la navigation" title="${sidebarCollapsed ? 'Déplier' : 'Replier'} la navigation">☰</button><div class="breadcrumb">Famille <span>/</span> ${selected === 'all' ? 'Vue d’ensemble' : e(focus[0]?.name || '')}</div><div class="header-right">${data?.demo ? '<span>MODE DÉMO</span>' : ''}<button class="small-button" ${data && !data.demo && (busy || homeworkLoading) ? 'disabled' : ''} data-action="${data && !data.demo ? 'refresh' : 'login'}">${data && !data.demo ? (busy ? 'Chargement des notes…' : homeworkLoading ? 'Chargement des devoirs…' : '↻ Actualiser') : 'Connecter ÉcoleDirecte ↗'}</button></div></header>
 ${selected !== 'all' ? `<section class="heading compact-heading"><h1>Résultats de ${e(focus[0]?.name || '')}</h1></section>` : ''}
 ${
   !data
     ? welcome()
     : `<div class="toolbar"><div class="tabs"><button class="${selected === 'all' ? 'active' : ''}" data-child="all">Toute la famille</button>${focus.length === 1 ? `<span>${e(focus[0]?.name)}</span>` : ''}</div><div class="filters"><label class="sr-only" for="period">Période scolaire</label><select id="period"><option value="all">Toutes les périodes</option>${periods.map((p) => `<option value="${e(p.id)}" ${period === p.id ? 'selected' : ''}>${e(p.label)}</option>`).join('')}</select><label class="sr-only" for="window">Fenêtre de progression</label><select id="window"><option value="30" ${days === 30 ? 'selected' : ''}>Tendance sur 30 jours</option><option value="14" ${days === 14 ? 'selected' : ''}>Tendance sur 14 jours</option></select></div></div>
 <div class="section-heading"><h2>${selected === 'all' ? 'Résultats par élève' : 'Synthèse'}</h2></div><section class="cards ${selected !== 'all' ? 'individual-cards' : ''}" id="children">${focus.map((c) => card(c, children.indexOf(c))).join('') || '<div class="empty">Aucun enfant au collège ou au lycée rattaché à ce compte.</div>'}</section>
 <section class="analysis-grid"><article class="panel focus-panel"><h2>Baisses récentes par matière</h2>${
   alerts.length
     ? alerts
         .slice(0, 3)
         .map(
           (a) =>
             `<button class="insight" data-focus="${e(a.child.id)}" data-subject="${e(a.id)}"><span class="insight-dot down">↘</span><span><strong>${e(a.child.name)} · ${e(a.label)}</strong><small>${delta(a.m.trend)} pt sur ${days} jours · ${a.m.recentCount} notes récentes</small></span><span>↗</span></button>`,
         )
         .join('')
     : `<p class="muted">${all.length ? 'Aucune baisse d’au moins un point sur les matières comparables.' : 'Données insuffisantes pour calculer une évolution.'}</p>`
 }</article></section>
 <section class="panel grades-panel" id="grades"><div class="panel-heading"><div><h2>Toutes les notes <span class="count" id="gradesCount">${all.length}</span></h2></div><div class="filters"><label class="sr-only" for="search">Rechercher une note</label><input id="search" type="search" placeholder="Rechercher une évaluation…" value="${e(search)}"><label class="sr-only" for="subject">Matière</label><select id="subject"><option value="">Toutes les matières</option>${subjectGroups(
   all,
 )
   .map((s) => `<option value="${e(s.id)}" ${subject === s.id ? 'selected' : ''}>${e(s.label)}</option>`)
   .join(
     '',
   )}</select></div></div><div class="table-scroll"><table><thead><tr><th>Enfant / Évaluation</th><th>Matière</th><th>Date</th><th>Note /20</th><th>Classe /20</th><th>Écart /20</th><th>Coef.</th></tr></thead><tbody id="rows"></tbody></table></div><div class="grade-legend"><span class="grade-good">● Bonnes ≥ 14/20</span><span class="grade-average">● Moyennes ≥ 10 et &lt; 14/20</span><span class="grade-poor">● Notes &lt; 10/20</span><span>Toutes les notes et moyennes de classe sont ramenées sur 20.</span></div><div class="table-footer"><span id="resultCount"></span><span>Les notes ABS, dispensées ou non significatives restent visibles, hors calcul.</span></div></section>
 <details class="method" id="method"><summary>Comment lire ces indicateurs ?</summary><p>La moyenne générale est calculée comme sur le bulletin : les notes chiffrées sont ramenées sur 20 et pondérées par leur coefficient pour obtenir la moyenne de chaque sous-matière et de chaque matière, puis les matières sont pondérées par les coefficients de l’établissement fournis par ÉcoleDirecte. Une matière de coefficient 0 ne compte pas ; sans coefficients connus, chaque matière compte pour 1. Une moyenne officielle est affichée lorsqu’une période précise est sélectionnée et qu’ÉcoleDirecte la fournit.</p><p>L’évolution est la variation de la moyenne générale sur les ${days} derniers jours : la moyenne actuelle moins celle calculée avec les seules notes antérieures, à l’intérieur de la période sélectionnée. Sans note avant ces ${days} jours, elle reste indisponible. L’écart à la classe compare uniquement les évaluations disposant des deux notes, sur le même barème. Un tiret signifie « donnée indisponible », jamais zéro.</p><p>Les points d’attention correspondent à une baisse d’au moins un point de la moyenne d’une matière sur les ${days} derniers jours. Ils servent à ouvrir une discussion, sans classer les enfants entre eux. La moyenne de classe n’est pas affichée lorsqu’elle n’est pas disponible ou que son affichage est désactivé dans les paramètres remontés.</p></details>`
 }
 <footer><span>Orbite</span><span>${data ? `Dernière ${data.demo ? 'simulation' : 'synchronisation'} : ${new Date(data.updatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : 'Client indépendant, non affilié à ÉcoleDirecte'}</span></footer></main>`;
  if (data) renderRows(all);
  void loadCoaching();
  $('#period')?.addEventListener('change', (event) => {
    state.period = (event.target as HTMLSelectElement).value;
    state.subject = '';
    render();
  });
  $('#window')?.addEventListener('change', (event) => {
    state.days = Number((event.target as HTMLSelectElement).value);
    render();
  });
  $('#subject')?.addEventListener('change', (event) => {
    state.subject = (event.target as HTMLSelectElement).value;
    renderRows(all);
  });
  $('#search')?.addEventListener('input', (event) => {
    state.search = (event.target as HTMLInputElement).value;
    renderRows(all);
  });
}

function welcome(): string {
  if (state.busy)
    return '<section class="welcome loading-state" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span><h2>Chargement du tableau de bord…</h2><p>Récupération des notes. Les devoirs seront chargés ensuite.</p></section>';
  return `<section class="welcome"><div><h2>Connexion ÉcoleDirecte</h2><p>Connectez votre compte parent pour consulter les notes et moyennes de classe.</p><div class="welcome-actions"><button class="primary" data-action="login">Se connecter</button><button class="secondary" data-action="demo">Mode démonstration</button></div></div></section>`;
}

/** Remplit le tableau des notes selon la recherche et la matière, et met à jour les deux compteurs. */
export function renderRows(all: RowNote[]): void {
  const { search, subject } = state;
  const query = search.toLocaleLowerCase('fr-FR');
  const filtered = all
    .filter(
      (n) =>
        (!subject || n.subjectId === subject) &&
        `${n.title} ${n.subject} ${n.child.name}`.toLocaleLowerCase('fr-FR').includes(query),
    )
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  $('#rows').innerHTML =
    filtered
      .map((n) => {
        const value20 = toTwenty(n.value, n.outOf);
        const class20 = toTwenty(n.classAverage, n.outOf);
        const gap = valid(n) && class20 !== null ? (value20 as number) - class20 : null;
        return `<tr><td><div class="grade-student">${avatar(n.child, true)}<div><strong>${e(n.child.name)}</strong><small>${e(n.title)}</small></div></div></td><td><span class="subject-chip">${e(n.subject)}</span></td><td class="muted nowrap">${date(n.date)}</td><td class="note-value grade-${gradeBand(n)}" title="${bandTitles[gradeBand(n)]}">${n.value === null ? e(n.raw || '—') : fmt(value20)}<small>${value20 !== null ? ' / 20' : ''}${n.excluded ? ' · hors calcul' : ''}</small></td><td class="class-value" title="Moyenne de classe ramenée sur 20">${fmt(class20)}<small>${class20 !== null ? ' / 20' : ''}</small></td><td><span class="gap ${tone(gap)}">${arrow(gap)} ${delta(gap)}</span></td><td class="muted">${fmt(n.coefficient)}</td></tr>`;
      })
      .join('') || '<tr><td colspan="7" class="empty">Aucune note pour cette sélection.</td></tr>';
  $('#gradesCount').textContent = String(filtered.length);
  $('#resultCount').textContent = `${filtered.length} évaluation${filtered.length > 1 ? 's' : ''}`;
}

/** Met à jour le bouton d'actualisation et les boutons « En voir plus » sans tout redessiner. */
export function updateRefresh(): void {
  const { busy, homeworkLoading } = state;
  const app = appRoot();
  const button = app.querySelector<HTMLButtonElement>('[data-action="refresh"]');
  app.querySelectorAll<HTMLButtonElement>('[data-more-homework]').forEach((b) => {
    b.disabled = busy || homeworkLoading;
  });
  if (button) {
    button.disabled = busy || homeworkLoading;
    button.textContent = busy ? 'Chargement des notes…' : homeworkLoading ? 'Chargement des devoirs…' : '↻ Actualiser';
  }
}

/** Remplace uniquement le panneau de devoirs de cet élève. */
export function updateHomework(child: Child): void {
  const panel = [...appRoot().querySelectorAll<HTMLElement>('[data-homework-id]')].find(
    (p) => p.dataset.homeworkId === child.id,
  );
  if (panel) panel.outerHTML = homeworkPanel(child);
}
