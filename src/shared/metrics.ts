/**
 * Calculs partagés sur les notes, les dates et les classes.
 *
 * Rôle : toute la logique « métier » sans entrée-sortie. Moyennes par matière et
 * moyenne générale pondérée par les coefficients des matières, évolution sur 30
 * jours, écart à la classe, regroupement par matière, courbe d'évolution, notes de
 * la semaine, filtre des classes du secondaire, validation des photos et dates à
 * l'heure de Paris.
 *
 * Fonctionnement : fonctions pures, exécutées des deux côtés. Le serveur les importe
 * (`isSecondary`, `photoUrl`, `parisDate`) et le navigateur charge la version
 * compilée `/shared/metrics.js`. Le fichier ne doit donc dépendre ni de Node ni du DOM.
 *
 * Points d'attention :
 * - Une note n'entre dans un calcul que si `valid()` l'accepte : chiffrée, barème
 *   et coefficient strictement positifs, non exclue. Les notes sont ramenées sur
 *   20, puis pondérées par leur coefficient.
 * - Moyenne générale (`generalAverage`), comme sur le bulletin : moyenne de chaque
 *   sous-matière, puis de chaque matière, puis moyenne des matières pondérée par
 *   leurs coefficients (`Subject`, fournis par ÉcoleDirecte). Sans coefficients
 *   connus, chaque matière compte pour 1.
 * - Les jours sont des jours civils à Paris (`parisDate`) : ne pas utiliser
 *   `toISOString()` sur « maintenant », qui donnerait la date UTC et décalerait
 *   les devoirs ou la semaine autour de minuit.
 * - `isSecondary` s'appuie sur des libellés de classe libres ; ses cas sont
 *   couverts par `test/metrics.test.ts`.
 *
 * Liens : `src/client/views.ts` et `charts.ts` (affichage), `src/client/coaching.ts` (résumés IA),
 * `src/server/ecoledirecte.ts` (filtrage et dates).
 */
import type { Gradable, Note, Period, Subject } from './types.ts';

/** Note utilisable dans un calcul : valeur, barème et coefficient garantis numériques. */
export type ValidGrade<T extends Gradable = Gradable> = T & {
  value: number;
  outOf: number;
  coefficient: number;
};
type DatedGrade<T extends Gradable> = ValidGrade<T> & { date: string };
type PairedGrade<T extends Gradable> = ValidGrade<T> & { classAverage: number };

export interface Metrics {
  average: number | null;
  trend: number | null;
  /** Notes de la fenêtre de `days` jours qui se termine aujourd'hui. */
  recentCount: number;
  /** Notes antérieures à cette fenêtre (base de la moyenne de départ). */
  previousCount: number;
  gap: number | null;
  classAverage: number | null;
  pairedCount: number;
  count: number;
}

/** Ligne du tableau des matières : une matière, ses sous-matières dans `subjects`. */
export interface SubjectAverage {
  id: string;
  label: string;
  coefficient: number | null;
  average: number | null;
  /** Moyenne de classe calculée de la même façon, sur les seules évaluations qui en ont une. */
  classAverage: number | null;
  /** Moyenne officielle ÉcoleDirecte de la période, pour contrôle. */
  official: number | null;
  count: number;
  subjects: SubjectAverage[];
}

export interface SubjectGroup<T> {
  id: string;
  label: string;
  notes: T[];
}

export interface TimelinePoint<T extends Gradable> {
  date: string;
  time: number;
  notes: DatedGrade<T>[];
  average: number | null;
  classAverage: number | null;
  trend: number | null;
  count: number;
}

export type GradeBand = 'good' | 'average' | 'poor' | 'neutral';

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export const valid = <T extends Gradable>(n: T): n is ValidGrade<T> =>
  !n.excluded && finite(n.value) && finite(n.outOf) && n.outOf > 0 && finite(n.coefficient) && n.coefficient > 0;

export const score = (n: ValidGrade): number => (n.value / n.outOf) * 20;

const paired = <T extends Gradable>(n: ValidGrade<T>): n is PairedGrade<T> => finite(n.classAverage);
const classScore = (n: PairedGrade<Gradable>): number => (n.classAverage / n.outOf) * 20;
const time = (n: Gradable): number => Date.parse(n.date ?? '');

/**
 * Moyenne pondérée par coefficient des notes valides ; `field` choisit la valeur
 * moyennée (note sur 20 par défaut). `null` si aucune note n'est exploitable.
 */
export function mean<T extends Gradable>(
  notes: readonly T[],
  field: (n: ValidGrade<T>) => number = score,
): number | null {
  let sum = 0;
  let weights = 0;
  for (const n of notes.filter(valid)) {
    const v = field(n);
    if (Number.isFinite(v)) {
      sum += v * n.coefficient;
      weights += n.coefficient;
    }
  }
  return weights ? sum / weights : null;
}

type Field<T extends Gradable> = (n: ValidGrade<T>) => number;
interface SubjectScore {
  id: string;
  average: number | null;
  count: number;
  subjects: SubjectScore[];
}

/** Clé de la matière parente : `MATH:ALG` → `MATH:` ; une clé sans `:` est sa propre parente. */
const parentKey = (id: string): string => {
  const i = id.lastIndexOf(':');
  return i < 0 ? id : id.slice(0, i + 1);
};
const coefficientOf = (s: Subject | undefined): number | null =>
  s && finite(s.coefficient) && s.coefficient >= 0 ? s.coefficient : null;
// Valeurs réservées aux évaluations qui ont une moyenne de classe : `mean` ignore les NaN.
const pairedScore = (n: ValidGrade): number => (paired(n) ? score(n) : Number.NaN);
const pairedClassScore = (n: ValidGrade): number => (paired(n) ? classScore(n) : Number.NaN);

/**
 * Moyenne de chaque matière parente. Ses sous-matières sont moyennées séparément,
 * puis pondérées par leurs coefficients. Toutes les notes de la matière sont
 * moyennées ensemble si une sous-matière n'a pas de coefficient, si aucune n'a de
 * coefficient positif (cas du collège sur ÉcoleDirecte, où elles sont toutes à 0),
 * ou si des notes sont rattachées à la matière elle-même.
 */
function scoreSubjects<T extends Gradable>(notes: readonly T[], meta: Map<string, Subject>, field: Field<T>) {
  const parents = new Map<string, Map<string, ValidGrade<T>[]>>();
  for (const n of notes.filter(valid)) {
    const id = n.subjectId ?? '';
    let subs = parents.get(parentKey(id));
    if (!subs) {
      subs = new Map();
      parents.set(parentKey(id), subs);
    }
    subs.set(id, [...(subs.get(id) ?? []), n]);
  }
  return [...parents].map(([id, subs]): SubjectScore => {
    const all = [...subs.values()].flat();
    const parts = [...subs].map(([subId, list]): SubjectScore & { weight: number | null } => ({
      id: subId,
      average: mean(list, field),
      count: list.length,
      subjects: [],
      weight: subId === id ? null : coefficientOf(meta.get(subId)),
    }));
    let average = mean(all, field);
    if (parts.every((p) => p.weight !== null)) {
      const counted = parts.filter((p) => p.average !== null && (p.weight as number) > 0);
      const total = counted.reduce((sum, p) => sum + (p.weight as number), 0);
      if (total) average = counted.reduce((sum, p) => sum + (p.average as number) * (p.weight as number), 0) / total;
    }
    return {
      id,
      average,
      count: all.length,
      subjects: parts.filter((p) => p.id !== id).map(({ weight: _, ...p }) => p),
    };
  });
}

/**
 * Moyenne des matières pondérée par leurs coefficients. Un coefficient 0 exclut
 * la matière ; un coefficient absent vaut 1. Si aucune matière n'a de coefficient
 * positif (coefficients inconnus), toutes comptent pour 1.
 */
function weightedSubjects(scores: SubjectScore[], meta: Map<string, Subject>): number | null {
  const rows = scores
    .filter((s) => s.average !== null)
    .map((s) => ({ average: s.average as number, coefficient: coefficientOf(meta.get(s.id)) }));
  const known = rows.some((r) => (r.coefficient ?? 0) > 0);
  let sum = 0;
  let weights = 0;
  for (const r of rows) {
    const weight = known ? (r.coefficient ?? 1) : 1;
    sum += r.average * weight;
    weights += weight;
  }
  return weights ? sum / weights : null;
}

const metaOf = (subjects: readonly Subject[]) => new Map(subjects.map((s) => [s.id, s]));

/**
 * Moyenne générale comme sur le bulletin : moyenne de chaque matière (et de ses
 * sous-matières), puis moyenne des matières pondérée par leurs coefficients.
 * Des notes sans `subjectId` forment une seule matière (simple moyenne pondérée).
 */
export function generalAverage<T extends Gradable>(
  notes: readonly T[],
  subjects: readonly Subject[] = [],
  field: Field<T> = score,
): number | null {
  const meta = metaOf(subjects);
  return weightedSubjects(scoreSubjects(notes, meta, field), meta);
}

/**
 * Matières servant à pondérer la période affichée. Pour « toutes les périodes »,
 * celles de la période annuelle d'ÉcoleDirecte. À défaut, l'union des matières de
 * toutes les périodes, sans moyennes officielles, qui ne correspondraient alors à
 * aucune période précise.
 */
export function periodSubjects(periods: readonly Period[], period: string): Subject[] {
  const chosen = periods.find((p) => (period === 'all' ? p.annual : p.id === period));
  if (chosen?.subjects?.length) return chosen.subjects;
  const union = new Map<string, Subject>();
  for (const s of periods.flatMap((p) => p.subjects ?? []))
    if (!union.has(s.id)) union.set(s.id, { ...s, average: null, classAverage: null });
  return [...union.values()];
}

/** Lignes du tableau des matières d'un élève, sous-matières incluses, triées par libellé. */
export function subjectAverages(
  notes: readonly (Gradable & Pick<Note, 'subject' | 'classAverage' | 'parentSubject' | 'subSubject'>)[],
  subjects: readonly Subject[],
): SubjectAverage[] {
  const meta = metaOf(subjects);
  const classes = new Map(
    scoreSubjects(notes, meta, pairedClassScore)
      .flatMap((s) => [s, ...s.subjects])
      .map((s) => [s.id, s.average]),
  );
  const label = (id: string, sub: boolean) => {
    const note = notes.find((n) => (sub ? n.subjectId === id : parentKey(n.subjectId ?? '') === id));
    return meta.get(id)?.label || (sub ? note?.subSubject : note?.parentSubject) || note?.subject || id;
  };
  const row = (s: SubjectScore, sub: boolean): SubjectAverage => ({
    id: s.id,
    label: label(s.id, sub),
    coefficient: coefficientOf(meta.get(s.id)),
    average: s.average,
    classAverage: classes.get(s.id) ?? null,
    official: meta.get(s.id)?.average ?? null,
    count: s.count,
    subjects: s.subjects.map((x) => row(x, true)).sort((a, b) => a.label.localeCompare(b.label, 'fr')),
  });
  return scoreSubjects(notes, meta, score)
    .map((s) => row(s, false))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
}

/**
 * Indicateurs d'une carte élève ou matière, calculés avec `generalAverage`.
 * - `trend` : évolution de la moyenne sur `days` jours, c'est-à-dire la moyenne
 *   avec toutes les notes jusqu'à ce soir moins celle avec les notes antérieures
 *   à la fenêtre ; `null` s'il n'y avait encore aucune note au début de la fenêtre.
 * - `gap` / `classAverage` : calculés uniquement sur les notes qui ont une moyenne
 *   de classe, pour comparer des ensembles identiques.
 */
export function metrics(
  notes: readonly Gradable[],
  now = new Date(),
  days = 30,
  subjects: readonly Subject[] = [],
): Metrics {
  // Fin de journée dans le fuseau d'exécution (navigateur), pour inclure les notes du jour.
  const today = new Date(now);
  today.setHours(23, 59, 59, 999);
  const end = today.getTime();
  const cut = end - days * 86400000;
  const eligible = notes.filter(valid);
  const recent = eligible.filter((n) => time(n) > cut && time(n) <= end);
  const before = eligible.filter((n) => time(n) <= cut);
  const a = generalAverage(
    eligible.filter((n) => time(n) <= end),
    subjects,
  );
  const b = generalAverage(before, subjects);
  const student = generalAverage(eligible, subjects, pairedScore);
  const classAverage = generalAverage(eligible, subjects, pairedClassScore);
  return {
    average: generalAverage(eligible, subjects),
    trend: a !== null && b !== null ? a - b : null,
    recentCount: recent.length,
    previousCount: before.length,
    gap: student !== null && classAverage !== null ? student - classAverage : null,
    classAverage,
    pairedCount: eligible.filter(paired).length,
    count: eligible.length,
  };
}

/** Regroupe les notes par `subjectId` (une sous-matière forme son propre groupe), triées par libellé. */
export function subjectGroups<T extends { subjectId?: string; subject: string }>(
  notes: readonly T[],
): SubjectGroup<T>[] {
  const map = new Map<string, SubjectGroup<T>>();
  for (const n of notes) {
    const k = n.subjectId || n.subject;
    let group = map.get(k);
    if (!group) {
      group = { id: k, label: n.subject, notes: [] };
      map.set(k, group);
    }
    group.notes.push(n);
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'fr'));
}

/**
 * Indique si un libellé de classe désigne le collège ou le lycée.
 * Le libellé est d'abord normalisé (sans accents, en majuscules). Les classes de
 * maternelle et d'élémentaire sont exclues en premier, car « CE2 » ou « PS »
 * pourraient sinon ressembler à une abréviation. Sont ensuite reconnus les
 * niveaux en toutes lettres et les abréviations usuelles : « 6E », « 4EME B »,
 * « 2NDE », « 1ERE », « TLE », « TERM »…
 */
export function isSecondary(className: string | null | undefined = ''): boolean {
  const label = String(className)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
  if (
    /MATERNELLE|ELEMENTAIRE|PRIMAIRE|COURS MOYEN|COURS PREPARATOIRE|\b(?:CP|CE[12]?|CM[12]?|TPS|PS|MS|GS)\b/.test(label)
  )
    return false;
  return (
    /\b(?:SIXIEME|CINQUIEME|QUATRIEME|TROISIEME|SECONDE|PREMIERE|TERMINALE|COLLEGE|LYCEE)\b/.test(label) ||
    /^(?:[3456]\s*(?:EME|E|°|È)?|2\s*(?:NDE|DE|D)|1\s*(?:ERE|RE)|T(?:LE|ER|ERM)?)(?:\b|[A-Z0-9])/.test(label)
  );
}

/**
 * N'accepte que les photos HTTPS hébergées par ecoledirecte.com (URL `//…`
 * complétée en HTTPS). Toute autre URL est rejetée, ce qui respecte la CSP
 * `img-src` du serveur et empêche de pister la famille via une image tierce.
 */
export function photoUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.startsWith('//') ? 'https:' + value : value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
    return url.hostname === 'ecoledirecte.com' || url.hostname.endsWith('.ecoledirecte.com') ? url.href : null;
  } catch {
    return null;
  }
}

/** Couleur d'une note : ≥ 14/20 bonne, ≥ 10/20 moyenne, sinon faible ; neutre si non chiffrée. */
export function gradeBand(note: Gradable): GradeBand {
  if (!finite(note.value) || !finite(note.outOf) || note.outOf <= 0 || note.excluded) return 'neutral';
  const normalized = (note.value / note.outOf) * 20;
  return normalized >= 14 ? 'good' : normalized >= 10 ? 'average' : 'poor';
}

export function toTwenty(value: number | null | undefined, outOf: number | null | undefined): number | null {
  return finite(value) && finite(outOf) && outOf > 0 ? (value / outOf) * 20 : null;
}

/** Jour civil à Paris au format `YYYY-MM-DD` (la locale `en-CA` produit justement ce format). */
export function parisDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Prochain jour ouvré (lundi à vendredi) après aujourd'hui à Paris. Les vacances
 * et jours fériés ne sont pas connus. Midi UTC sert d'ancre : ajouter des jours ne
 * change jamais de date à cause d'un passage à l'heure d'été.
 */
export function nextSchoolDay(now = new Date()): string {
  const day = new Date(parisDate(now) + 'T12:00:00Z');
  do {
    day.setUTCDate(day.getUTCDate() + 1);
  } while ([0, 6].includes(day.getUTCDay()));
  return day.toISOString().slice(0, 10);
}

/**
 * Points de la courbe d'évolution, un par jour ayant au moins une note (aucun
 * ordre artificiel entre les évaluations d'un même jour). Pour chaque jour :
 * - `average` / `classAverage` : moyennes générales cumulées depuis le début jusqu'à ce jour ;
 * - `trend` : moyenne générale glissante sur les `days` jours qui se terminent ce jour-là, publiée
 *   seulement avec au moins deux notes dans la fenêtre pour éviter une courbe en dents de scie.
 */
export function gradeTimeline<T extends Gradable>(
  notes: readonly T[],
  days = 30,
  subjects: readonly Subject[] = [],
): TimelinePoint<T>[] {
  const dated = (n: T): n is DatedGrade<T> =>
    valid(n) && /^\d{4}-\d{2}-\d{2}/.test(n.date || '') && Number.isFinite(Date.parse(n.date as string));
  const eligible = notes.filter(dated).sort((a, b) => a.date.localeCompare(b.date));
  return [...new Set(eligible.map((n) => n.date.slice(0, 10)))].map((date) => {
    const daily = eligible.filter((n) => n.date.slice(0, 10) === date);
    const end = Date.parse(date + 'T23:59:59.999Z');
    const start = end - days * 86400000;
    const rolling = eligible.filter((n) => Date.parse(n.date) > start && Date.parse(n.date) <= end);
    const accumulated = eligible.filter((n) => n.date.slice(0, 10) <= date);
    return {
      date,
      time: Date.parse(date + 'T12:00:00Z'),
      notes: daily,
      average: generalAverage(accumulated, subjects),
      classAverage: generalAverage(accumulated, subjects, pairedClassScore),
      trend: rolling.length >= 2 ? generalAverage(rolling, subjects) : null,
      count: rolling.length,
    };
  });
}

/**
 * Notes des sept derniers jours à Paris (aujourd'hui compris) : les trois plus
 * récentes pour l'aperçu, et le total pour le badge.
 */
export function weeklyNotes<T extends Gradable>(notes: readonly T[], now = new Date()) {
  const end = parisDate(now);
  const startDate = new Date(end + 'T12:00:00Z');
  startDate.setUTCDate(startDate.getUTCDate() - 6);
  const start = startDate.toISOString().slice(0, 10);
  const all = notes
    .filter(
      (n): n is DatedGrade<T> =>
        valid(n) && typeof n.date === 'string' && n.date.slice(0, 10) >= start && n.date.slice(0, 10) <= end,
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  return { notes: all.slice(0, 3), total: all.length, start, end };
}
