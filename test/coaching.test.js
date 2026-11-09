import test from 'node:test';
import assert from 'node:assert/strict';
import {coachingContext,coachingPrompt,createCoachingCache} from '../public/coaching.js';
const now=new Date('2026-11-07T12:00:00Z');
function child(a,b){return {id:'private-id',name:'Private Name',photo:'private-photo',periods:[{id:'T1',average:17}],notes:[{subject:'Mathématiques',period:'T1',date:'2026-09-20',value:a,outOf:20,coefficient:1},{subject:'Mathématiques',period:'T1',date:'2026-11-01',value:b,outOf:20,coefficient:1}]};}
test('contexte : hausse, baisse, stabilité, période et données insuffisantes sans identité',()=>{
 for(const [a,b,direction] of [[10,14,'up'],[14,10,'down'],[12,12,'stable']])assert.equal(coachingContext(child(a,b),'all',30,now).direction,direction);
 const c=coachingContext(child(10,14),'T1',30,now);assert.equal(c.displayedAverage,17);assert.equal(c.official,true);
 const prompt=coachingPrompt(c);assert.doesNotMatch(prompt,/private-id|Private Name|private-photo/);
 assert.equal(coachingContext(child(10,14),'T2',30,now).count,0);
 assert.equal(coachingContext(child(10,14),'all',14,now).direction,'unknown');
});
test('cache : dédoublonnage et sérialisation des appels',async()=>{
 let release;const calls=[];
 const cache=createCoachingCache(async input=>{calls.push(input);if(input==='A')await new Promise(r=>release=r);return {text:input,complete:true};});
 const a=cache.get('a','A'),same=cache.get('a','A'),b=cache.get('b','B');
 assert.equal(a,same);await new Promise(r=>setImmediate(r));assert.deepEqual(calls,['A']);
 release();assert.equal(await a,'A');assert.equal(await b,'B');assert.deepEqual(calls,['A','B']);
 await cache.get('a','A');assert.equal(calls.length,2);
});
test('contexte abandonné non envoyé, retour au filtre possible, réponse incomplète refusée',async()=>{
 let calls=0;const cache=createCoachingCache(async()=>{calls++;return {text:'Bravo',complete:true};});
 await assert.rejects(cache.get('a','A',()=>false));assert.equal(calls,0);
 assert.equal(await cache.get('a','A'),'Bravo');assert.equal(calls,1);
 const invalid=createCoachingCache(async()=>({text:'tronqué',complete:false}));
 await assert.rejects(invalid.get('a','A'),/indisponible/);
});
