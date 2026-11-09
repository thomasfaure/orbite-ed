/**
 * Types partagés entre le serveur et le navigateur.
 *
 * Rôle : contrat unique des données échangées sur l'API `/api/*`. Le serveur
 * (`ecoledirecte.ts`) produit ces structures à partir des réponses brutes
 * d'ÉcoleDirecte ; le client (`actions.ts`, `views.ts`, `demo.ts`, `coaching.ts`)
 * les consomme.
 * Les formats bruts d'ÉcoleDirecte restent confinés côté serveur.
 *
 * Fonctionnement : déclarations de types seulement. Avec `verbatimModuleSyntax`,
 * les imports `import type` disparaissent à la compilation, et ce fichier ne
 * produit aucun code exécuté ; il n'est pas servi au navigateur.
 *
 * Points d'attention :
 * - `null` signifie toujours « valeur absente ou masquée par l'établissement »,
 *   jamais zéro : les calculs de `metrics.ts` ignorent ces valeurs.
 * - Les dates sont des chaînes ISO `YYYY-MM-DD` (éventuellement suivies d'une
 *   heure) interprétées comme des jours civils à Paris.
 * - Toute modification de ces types touche les deux côtés de l'API et la
 *   démonstration : `npm run typecheck` signale les usages à adapter.
 *
 * Liens : `src/server/ecoledirecte.ts`, `src/shared/metrics.ts`, `src/client/*`.
 */

/** Forme minimale d'une note pour les calculs de moyenne (`metrics.ts`). */
export interface Gradable {
  /** Note obtenue ; `null` pour « Abs », « Disp », lettre ou note masquée. */
  value: number | null;
  /** Barème (20, 10, 40…) ; les calculs ramènent tout sur 20. */
  outOf: number | null;
  coefficient: number | null;
  /** Note affichée mais exclue des moyennes (non significative, en lettres). */
  excluded?: boolean;
  date?: string | undefined;
  classAverage?: number | null;
}

export interface Note extends Gradable {
  id?: number | string | undefined;
  parentSubject?: string;
  subSubject?: string;
  /** Libellé affiché : « Matière » ou « Matière · Sous-matière ». */
  subject: string;
  /** Clé de regroupement stable `codeMatière:codeSousMatière`. */
  subjectId: string;
  title: string;
  /** Code de période ÉcoleDirecte (correspond à `Period.id`). */
  period?: string | undefined;
  /** Valeur telle qu'affichée par ÉcoleDirecte, conservée pour les notes non chiffrées. */
  raw: string;
  classAverage: number | null;
  excluded: boolean;
}

/** Les champs optionnels reprennent ceux d'ÉcoleDirecte, qui peuvent manquer. */
export interface Period {
  id?: string | undefined;
  label?: string | undefined;
  annual?: boolean | undefined;
  start?: string | undefined;
  end?: string | undefined;
  average: number | null;
  classAverage: number | null;
}

/** Les devoirs faits ne sont jamais renvoyés ; `unknown` quand ÉcoleDirecte ne précise pas l'état. */
export type HomeworkStatus = 'pending' | 'unknown';

export interface Homework {
  id: string;
  dueDate: string;
  subject: string;
  text: string;
  status: HomeworkStatus;
  exam: boolean;
  documents: string[];
}

/** Résumé d'une journée du cahier de textes : nombre de devoirs, dont faits et d'état inconnu. */
export interface HomeworkDate {
  date: string;
  total: number | null;
  done: number | null;
  unknown?: number;
}

/** Réponse de `/api/homework` (voir `EcoleDirecte.homework`). */
export interface HomeworkPage {
  homework: Homework[];
  homeworkDates: HomeworkDate[];
  /** Vrai si une partie des devoirs n'a pas pu être lue : l'interface le signale. */
  homeworkPartial: boolean;
  /** Curseur à renvoyer pour la page suivante, `null` s'il n'y en a plus. */
  homeworkNext: number | null;
  /** Dernier jour couvert par le premier affichage. */
  homeworkUntil: string;
}

/**
 * Élève affiché. Les champs `homework*` sont absents de `/api/dashboard` : le
 * client les ajoute après `/api/homework`, avec ses propres états de chargement.
 */
export interface Child {
  /** `idCompte:idÉlève`, unique même si l'élève figure sous plusieurs comptes. */
  id: string;
  name: string;
  lastName?: string;
  className: string;
  school?: string;
  /** URL HTTPS vers ecoledirecte.com uniquement (filtrée par `photoUrl`). */
  photo?: string | null;
  notes: Note[];
  periods: Period[];
  /** Message affiché à la place des notes quand cet élève n'a pas pu être chargé. */
  error?: string;
  homework?: Homework[];
  homeworkDates?: HomeworkDate[];
  homeworkPartial?: boolean;
  homeworkNext?: number | null;
  homeworkUntil?: string;
  homeworkLoading?: boolean;
  homeworkError?: string;
  homeworkMoreLoading?: boolean;
  homeworkMoreError?: string;
}

export interface Dashboard {
  demo: boolean;
  updatedAt: string;
  children: Child[];
}

/** `question` et `totp` : connexion en attente d'une double authentification. */
export type AuthState = 'anonymous' | 'authenticated' | 'question' | 'totp';

export type AuthResult =
  { state: 'authenticated' } | { state: 'totp' } | { state: 'question'; question: string; choices: string[] };

export interface AIResult {
  text: string;
  complete: boolean;
  refused: boolean;
  usage: { inputTokens: number | null; outputTokens: number | null };
}

export interface ApiError {
  error: string;
  code?: unknown;
}
