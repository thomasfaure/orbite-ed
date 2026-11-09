import test from 'node:test';
import assert from 'node:assert/strict';
import {EcoleDirecte,homeworkText} from '../lib/ecoledirecte.js';
const b64=s=>Buffer.from(s).toString('base64');
const setup=handler=>{const c=new EcoleDirecte();c.state='authenticated';c.request=handler;return c;};
test('devoirs : tri, filtre effectués, consigne et statuts inconnus',async()=>{
 const calls=[];
 const c=setup(async path=>{
  calls.push(path);
  if(path.includes('/cahierdetexte.awp')) return {code:200,data:{
   '2026-11-10':[{idDevoir:3,effectue:'false',matiere:'Anglais'}],
   '2026-11-09':[{idDevoir:1,effectue:false,matiere:'Maths'},{idDevoir:2,effectue:true},{idDevoir:4}],
   '2026-11-11':[{idDevoir:5,effectue:1}]
  }};
  if(path.includes('2026-11-09')) return {code:200,data:{matieres:[
   {matiere:'Mathématiques',aFaire:{idDevoir:1,effectue:false,contenu:b64('<p>Exercice &amp; leçon<br>page 12</p>'),documents:[{libelle:'Fiche.pdf'}]}},
   {id:4,aFaire:{contenu:b64('<p>Lecture</p>')}}
  ]}};
  return {code:200,data:{matieres:[{id:3,aFaire:{effectue:false,contenu:b64('Learn vocabulary')}}]}};
 });
 const result=await c.homework(11,{now:new Date('2026-11-07T12:00:00Z')});
 assert.deepEqual(result.homework.map(h=>h.id),['2026-11-09:1','2026-11-09:4','2026-11-10:3']);
 assert.equal(result.homework[0].text,'Exercice & leçon\npage 12');
 assert.equal(result.homework[1].status,'unknown');
 assert.equal(result.homework[2].status,'pending');
 assert.deepEqual(result.homework[0].documents,['Fiche.pdf']);
 assert.equal(result.homeworkPartial,false);
 assert.equal(calls.length,3);
 assert.ok(calls.every(p=>p.includes('verbe=get')));
});
test('détail indisponible conserve échéance et matière sans inventer la consigne',async()=>{
 const c=setup(async path=>{if(path.includes('/cahierdetexte.awp'))return {code:200,data:{'2026-11-09':[{idDevoir:1,effectue:false,matiere:'SVT'}]}};throw new Error('down');});
 const result=await c.homework(11,{now:new Date('2026-11-07T12:00:00Z')});
 assert.equal(result.homeworkPartial,true);assert.equal(result.homework[0].subject,'SVT');assert.equal(result.homework[0].text,'');
});
test('statut du détail actualisé et expiration propagée',async()=>{
 const c=setup(async path=>path.includes('/cahierdetexte.awp')?{code:200,data:{'2026-11-09':[{idDevoir:1,effectue:false}]}}:{code:200,data:{matieres:[{aFaire:{idDevoir:1,effectue:true}}]}});
 assert.deepEqual((await c.homework(11,{now:new Date('2026-11-07T12:00:00Z')})).homework,[]);
 c.homeworkSnapshots.clear();c.request=async()=>{throw Object.assign(new Error('expired'),{status:401});};
 await assert.rejects(()=>c.homework(11,{now:new Date('2026-11-07T12:00:00Z')}),e=>e.status===401);
});
test('réponse invalide distincte de la liste vide, texte HTML jamais rendu comme HTML',async()=>{
 const c=setup(async()=>({code:200,data:null}));
 await assert.rejects(()=>c.homework(1));
 assert.equal(homeworkText(b64('<script>alert(1)</script><p>&#233; &lt;img src=x&gt;</p>')),'é <img src=x>');
});
test('dashboard ne charge aucun devoir ; chargement différé vérifie le compte',async()=>{
 const calls=[];
 const c=setup(async path=>{calls.push(path);return {code:200,data:{notes:[]}};});
 c.activeId=1;c.accounts=[{id:1,typeCompte:'E',prenom:'Test',photo:'https://api.ecoledirecte.com/photo.jpg',profile:{classe:{libelle:'5e'}}}];
 const child=(await c.dashboard()).children[0];
 assert.equal(child.homework,undefined);assert.equal(calls.length,1);assert.match(calls[0],/notes/);
 await assert.rejects(()=>c.homeworkForChild('other:1'),e=>e.status===404);
 c.homework=async id=>({homework:[{id}]});
 assert.deepEqual(await c.homeworkForChild('1:1'),{homework:[{id:1}]});
});
test('devoirs différés changent le contexte établissement avant de lire',async()=>{
 const c=setup(async(path,payload)=>{assert.match(path,/renewtoken/);assert.equal(payload.idUser,202);return {code:200};});
 c.activeId=1;c.accounts=[{id:2,idLogin:202,typeCompte:'E',profile:{classe:{libelle:'Terminale'}}}];
 c.homework=async id=>{assert.equal(c.activeId,2);return {homework:[]};};
 assert.deepEqual(await c.homeworkForChild('2:2'),{homework:[]});
});
test('30 jours seulement puis lots de cinq, progression complète et isolation élève',async()=>{
 const calls=[];const now=new Date('2026-11-07T12:00:00Z');
 const early=Array.from({length:5},(_,i)=>({idDevoir:i,effectue:i<4,matiere:'Maths'}));
 const later=Array.from({length:12},(_,i)=>({idDevoir:100+i,effectue:false,matiere:'Français'}));
 const c=setup(async path=>{calls.push(path);
  if(path.includes('/cahierdetexte.awp'))return {code:200,data:{'2026-11-08':early,'2026-12-06':[{idDevoir:50,effectue:false}],'2026-12-07':later}};
  const rows=path.includes('2026-11-08')?early:path.includes('2026-12-06')?[{idDevoir:50,effectue:false}]:later;
  return {code:200,data:{matieres:rows.map(h=>({aFaire:{...h,contenu:b64('Consigne')}}))}};
 });
 const first=await c.homework(11,{now});
 assert.equal(first.homework.length,2);assert.equal(first.homeworkNext,2);
 assert.deepEqual(first.homeworkDates[0],{date:'2026-11-08',done:4,total:5,unknown:0});
 assert.ok(!calls.some(p=>p.includes('2026-12-07.awp')));
 const page=await c.homework(11,{now,cursor:first.homeworkNext});assert.equal(page.homework.length,5);assert.equal(page.homeworkNext,7);
 const second=await c.homework(11,{now,cursor:page.homeworkNext});assert.equal(second.homework.length,5);
 const last=await c.homework(11,{now,cursor:second.homeworkNext});assert.equal(last.homework.length,2);assert.equal(last.homeworkNext,null);
 assert.equal(new Set([...first.homework,...page.homework,...second.homework,...last.homework].map(h=>h.id)).size,14);
 assert.equal(calls.filter(p=>p.includes('2026-12-07.awp')).length,1);
 await c.homework(22,{now});assert.ok(calls.some(p=>p.includes('Eleves/22/')));
});
