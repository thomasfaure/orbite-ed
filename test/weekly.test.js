import test from 'node:test';
import assert from 'node:assert/strict';
import {weeklyNotes} from '../public/metrics.js';
const note=(date,value=12)=>({date,value,outOf:20,coefficient:1});
test('semaine inclusive J à J-6, trois plus récentes, sans notes futures ni non chiffrées',()=>{
 const result=weeklyNotes([note('2026-11-01'),note('2026-10-31'),note('2026-11-07'),note('2026-11-06'),note('2026-11-05'),note('2026-11-08'),note('2026-11-07',null)],new Date('2026-11-07T12:00:00Z'));
 assert.equal(result.total,4);assert.deepEqual(result.notes.map(n=>n.date),['2026-11-07','2026-11-06','2026-11-05']);assert.equal(result.start,'2026-11-01');
});
test('jour courant calculé en heure de Paris, même à la frontière UTC',()=>{
 const result=weeklyNotes([note('2026-11-08')],new Date('2026-11-07T23:30:00Z'));
 assert.equal(result.end,'2026-11-08');assert.equal(result.notes.length,1);
 assert.equal(weeklyNotes([],new Date('2026-11-07')).total,0);
});
