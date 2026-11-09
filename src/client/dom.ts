/**
 * Accès au DOM de la page.
 *
 * Rôle : regrouper les quelques primitives qui touchent directement au document :
 * sélection d'un élément (`$`), racine de l'application (`appRoot`) et message
 * temporaire (`toast`).
 *
 * Fonctionnement : chaque appel interroge le document au moment où il est fait.
 * Aucun élément n'est mis en cache au chargement du module, ce qui permet aux
 * tests de fournir un faux `document` avant d'appeler les vues.
 *
 * Points d'attention : `$` ne vérifie pas que l'élément existe. Les éléments
 * utilisés sont soit fixes dans `public/index.html` (`#app`, `#toast`, la boîte
 * `#auth`…), soit produits par `render()` juste avant.
 *
 * Liens : `public/index.html` (éléments fixes), `views.ts`, `actions.ts`, `app.ts`.
 */
export const $ = <T extends Element = HTMLElement>(s: string): T => document.querySelector(s) as T;

/** Conteneur `#app` reconstruit par `render()` ; les clics y sont délégués. */
export const appRoot = (): HTMLElement => $('#app');

export function toast(message: string): void {
  $('#toast').textContent = message;
  $('#toast').classList.add('show');
  setTimeout(() => $('#toast').classList.remove('show'), 5000);
}
