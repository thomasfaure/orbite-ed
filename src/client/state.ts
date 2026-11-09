/**
 * État de l'interface navigateur.
 *
 * Rôle : source unique de l'état mutable de l'application (données chargées,
 * filtres, élève sélectionné, indicateurs de chargement, compteur de contexte).
 * Les vues le lisent pour produire le HTML ; les actions et les gestionnaires
 * d'événements le modifient puis appellent `render()`.
 *
 * Fonctionnement : un objet `state` exporté et modifié directement. Les modules
 * ES partagent la même instance, ce qui remplace les anciennes variables de
 * module de `app.ts`. `initialState()` décrit l'état de départ ; les tests
 * l'utilisent pour repartir d'un état propre.
 *
 * Points d'attention :
 * - `generation` doit être incrémenté à chaque changement de contexte
 *   (rechargement, déconnexion, démonstration, session expirée) : les réponses
 *   asynchrones obtenues sous un autre numéro sont ignorées.
 * - `busy` et `homeworkLoading` sérialisent les appels au serveur, qui refuse deux
 *   opérations ÉcoleDirecte simultanées pour une même session (409).
 *
 * Liens : lu et modifié par `views.ts`, `actions.ts`, `coaching-panel.ts`,
 * `homework-panel.ts`, `charts.ts` et `app.ts`.
 */
import type { AuthState, Child, Dashboard, Note } from '../shared/types.ts';

export interface AppState {
  data: Dashboard | null;
  /** Identifiant de l'élève affiché, ou `all` pour la vue familiale. */
  selected: string;
  /** Filtre de matière du tableau des notes (`subjectId`), vide pour toutes. */
  subject: string;
  /** Période scolaire filtrée (`Period.id`), ou `all`. */
  period: string;
  /** Fenêtre de tendance en jours (30 ou 14). */
  days: number;
  search: string;
  authState: AuthState;
  /** Chargement des notes en cours ; bloque l'actualisation et les devoirs supplémentaires. */
  busy: boolean;
  /** Chargement de devoirs en cours (initial ou « En voir plus »), un seul à la fois. */
  homeworkLoading: boolean;
  /** Requête de connexion ou de vérification en cours dans la boîte de dialogue. */
  authBusy: boolean;
  /** Compteur de contexte : toute réponse asynchrone obtenue sous un autre numéro est ignorée. */
  generation: number;
  sidebarCollapsed: boolean;
}

export const initialState = (): AppState => ({
  data: null,
  selected: 'all',
  subject: '',
  period: 'all',
  days: 30,
  search: '',
  authState: 'anonymous',
  busy: false,
  homeworkLoading: false,
  authBusy: false,
  generation: 0,
  sidebarCollapsed: false,
});

export const state: AppState = initialState();

/** Notes de l'élève limitées à la période sélectionnée. */
export function currentNotes(child: Child): Note[] {
  return child.notes.filter((n) => state.period === 'all' || n.period === state.period);
}
