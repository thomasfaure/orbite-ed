import * as coaching from '../public/coaching.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as metrics from '../public/metrics.js';
const source=(await readFile(new URL('../public/app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
function ui(){
 const nodes=new Map();
 const node=key=>{if(!nodes.has(key))nodes.set(key,{innerHTML:'',textContent:'',hidden:false,open:false,dataset:{},classList:{add(){},remove(){},toggle(){}},addEventListener(){},setAttribute(){},reset(){},focus(){},showModal(){this.open=true;},close(){this.open=false;},querySelector:node,querySelectorAll(){return [];}});return nodes.get(key);};
 const context=vm.createContext({...metrics,...coaching,askAI:async()=>({text:"Conseil",complete:true}),document:{querySelector:node},Intl,Date,console,setTimeout(){},FormData:class{get(k){return {username:'test',password:'secret'}[k];}}});
 vm.runInContext(source.slice(0,source.lastIndexOf('\nrender();')),context);
 return {context,node,run:s=>vm.runInContext(s,context)};
}
test('loader immédiat à la connexion et restauration du formulaire sur erreur',async()=>{
 const h=ui();let fail;
 h.context.mock=()=>new Promise((_,reject)=>{fail=reject;});h.run('api=mock');
 h.context.event={preventDefault(){},target:h.node('#loginForm')};
 const pending=h.run("submit(event,'login')");
 assert.equal(h.node('#authLoading').hidden,false);assert.equal(h.node('#loginForm').hidden,true);
 fail(new Error('Connexion refusée'));await pending;
 assert.equal(h.node('#authLoading').hidden,true);assert.equal(h.node('#loginForm').hidden,false);assert.equal(h.node('#authError').textContent,'Connexion refusée');
});
test('les notes deviennent visibles avant la résolution des devoirs',async()=>{
 const h=ui();let notes,homework;const calls=[];
 h.context.mock=(path)=>{calls.push(path);return new Promise(resolve=>{if(path==='dashboard')notes=resolve;else homework=resolve;});};h.run('api=mock');
 const pending=h.run('load()');assert.match(h.node('#app').innerHTML,/Chargement du tableau de bord/);
 notes({updatedAt:new Date().toISOString(),children:[{id:'1:11',name:'Test',className:'5e',notes:[],periods:[]}]});await pending;
 assert.deepEqual(calls,['dashboard','homework']);assert.match(h.node('#app').innerHTML,/Résultats par élève/);assert.match(h.node('#app').innerHTML,/Chargement des devoirs/);
 assert.equal(h.run('busy'),false);assert.equal(h.run('homeworkLoading'),true);
 homework({homework:[]});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.run('homeworkLoading'),false);assert.equal(h.run('data.children[0].homework.length'),0);
});
test('une réponse différée ne réinjecte pas les données après un changement de session',async()=>{
 const h=ui();let done;
 h.context.mock=()=>new Promise(resolve=>{done=resolve;});h.run('api=mock; data={children:[{id:"1:11"}]}; homeworkLoading=true');
 const pending=h.run('loadHomework(data,generation)');h.run('generation++;data=null;homeworkLoading=false');done({homework:[{text:'ancien compte'}]});await pending;
 assert.equal(h.run('data'),null);
});
test('dates séparées, ratio et bouton de pagination, bordure sélectionnée sur le conteneur',()=>{
 const h=ui();h.context.child={id:'1:11',name:'Test',className:'5e',notes:[],periods:[],homework:[{id:'1',dueDate:metrics.nextSchoolDay(),subject:'Maths',text:'Exercice'}],homeworkDates:[{date:metrics.nextSchoolDay(),done:4,total:5}],homeworkNext:1};
 const html=h.run('homeworkPanel(child)');assert.match(html,/4\/5/);assert.match(html,/<progress max="5" value="4"/);assert.match(html,/homework-urgent/);assert.match(html,/En voir plus/);
 h.run("selected='1:11'");assert.match(h.run('card(child,0)'),/student-summary is-selected/);
});
test('En voir plus ajoute une page au seul enfant demandé sans doublons',async()=>{
 const h=ui();h.run("data={children:[{id:'1:11',homework:[{id:'a'}],homeworkDates:[],homeworkNext:1},{id:'1:22',homework:[]}]}");
 h.context.mock=async(path,payload)=>{assert.equal(path,'homework');assert.equal(payload.childId,'1:11');assert.equal(payload.cursor,1);return {homework:[{id:'a'},{id:'b'}],homeworkDates:[],homeworkNext:null};};h.run('api=mock');
 await h.run('moreHomework(data.children[0])');assert.equal(h.run('data.children[0].homework.length'),2);assert.equal(h.run('data.children[1].homework.length'),0);assert.equal(h.run('homeworkLoading'),false);
});
