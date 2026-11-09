import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('la feuille de style reste du CSS et contient les composants essentiels',async()=>{
 const css=await readFile(new URL('../public/style.css',import.meta.url),'utf8');
 assert.doesNotMatch(css,/^\s*(?:import\s|export\s|(?:const|let)\s)/m);
 for(const selector of [':root','body','aside','.cards','.student-summary','.grade-chart','.weekly-notes'])assert.ok(css.includes(selector+'{'),selector);
 assert.equal((css.match(/{/g)||[]).length,(css.match(/}/g)||[]).length);
});
