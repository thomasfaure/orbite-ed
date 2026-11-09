/**
 * Test de fumée de la feuille de style compilée (`dist/style.css`).
 *
 * Rôle : détecter une compilation SCSS ratée ou incomplète avant qu'elle n'arrive
 * dans le navigateur. Il vérifie que le fichier ne contient ni code JavaScript ni
 * syntaxe Sass résiduelle (`@use`, `@include`, variables `$`), que les sélecteurs
 * essentiels de l'interface sont présents (y compris les couleurs d'accent des
 * cartes générées par boucle) et que les accolades sont équilibrées.
 *
 * Fonctionnement : lecture du CSS compressé produit par `npm run build:styles`
 * à partir de `src/styles/main.scss`, puis recherches textuelles.
 *
 * Points d'attention : les recherches supposent la sortie compressée de Sass
 * (`sélecteur{` sans espace). Changer le style de sortie impose d'adapter ce test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Feuille compilée depuis src/styles/ : `npm test` reconstruit dist/ au préalable.
test('la feuille de style compilée reste du CSS et contient les composants essentiels', async () => {
  const css = await readFile(new URL('../dist/style.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /^\s*(?:import\s|export\s|(?:const|let)\s)/m);
  assert.doesNotMatch(css, /@use|@include|@mixin|\$[a-z]/);
  for (const selector of [':root', 'body', 'aside', '.cards', '.student-summary', '.grade-chart', '.weekly-notes'])
    assert.ok(css.includes(selector + '{'), selector);
  for (let rank = 1; rank <= 5; rank++) assert.ok(css.includes(`.child-card.accent-${rank}{`), `accent-${rank}`);
  assert.equal((css.match(/{/g) || []).length, (css.match(/}/g) || []).length);
});
