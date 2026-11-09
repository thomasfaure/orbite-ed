import test from 'node:test';
import assert from 'node:assert/strict';
import {EcoleDirecte} from '../lib/ecoledirecte.js';
const response=(body,headers={})=>new Response(body===null?'':JSON.stringify(body),{status:200,headers});
const gtk=()=>response(null,{'set-cookie':'GTK=bootstrap; Path=/'});
const account={id:1,idLogin:101,typeCompte:'F',main:true,profile:{eleves:[{id:11,prenom:'Test',photo:'//doc1.ecoledirecte.com/PhotoEleves/test.jpg',classe:{libelle:'5e'}}]}};
const ok=()=>response({code:200,token:'secret-session',data:{accounts:[account]}});
function transport(steps){const calls=[];return {calls,fetch:async(url,options)=>{calls.push({url,options,payload:options.body?JSON.parse(options.body.get('data')):undefined});if(url.includes('/cahierdetexte.awp')) return response({code:200,data:{}});assert.ok(steps.length,'appel réseau imprévu');return steps.shift()(calls.at(-1));}};}
test('login GTK, cookies multiples, encodage des secrets, nettoyage mémoire',async()=>{
 const t=transport([()=>{const headers=new Headers();headers.append('set-cookie','GTK=gtkvalue; Path=/');headers.append('set-cookie','routing=node2; Path=/');return response(null,headers);},call=>{assert.equal(call.options.headers['X-Gtk'],'gtkvalue');assert.match(call.options.headers.Cookie,/routing=node2/);assert.equal(call.payload.motdepasse,'a+&%=é');return ok();}]);
 const client=new EcoleDirecte(t.fetch);assert.deepEqual(await client.login('parent','a+&%=é'),{state:'authenticated'});assert.equal(client.pending,undefined);client.clear();assert.equal(client.token,undefined);assert.equal(client.accounts.length,0);
});
test('QCM décodé, réponse exacte, nouveau GTK, facteurs puis notes',async()=>{
 const b64=s=>Buffer.from(s).toString('base64');
 const t=transport([gtk,()=>response({code:250,token:'challenge',data:{totp:false}}),()=>response({code:200,data:{question:b64('Quelle école ?'),propositions:[b64('École A'),b64('École B')]}}),call=>{assert.equal(call.payload.choix,b64('École B'));assert.equal(call.options.headers['X-Token'],'challenge');return response({code:200,data:{cn:'factor',cv:'proof'}});},gtk,call=>{assert.deepEqual(call.payload.fa,[{cn:'factor',cv:'proof',uniq:false}]);assert.equal(call.payload.cn,'factor');return ok();},()=>response({code:200,data:{notes:[{valeur:'18',noteSur:'20',coef:'1'}],periodes:[]}})]);
 const client=new EcoleDirecte(t.fetch);const challenge=await client.login('parent','password');assert.equal(challenge.question,'Quelle école ?');assert.equal(challenge.choices[1],'École B');await client.verify({choice:1});const result=await client.dashboard();assert.equal(result.children[0].name,'Test');assert.equal(result.children[0].notes[0].value,18);
});
test('TOTP utilise un facteur, code malformé sans requête',async()=>{
 const t=transport([gtk,()=>response({code:250,token:'challenge',data:{totp:true}}),gtk,call=>{assert.deepEqual(call.payload.fa,[{cn:'',cv:'123456'}]);return ok();}]);
 const client=new EcoleDirecte(t.fetch);assert.equal((await client.login('parent','secret')).state,'totp');await assert.rejects(()=>client.verify({code:'bad'}));assert.equal((await client.verify({code:'123456'})).state,'authenticated');
});
test('expiration supprime les secrets, erreur sans mot de passe',async()=>{
 const t=transport([gtk,ok,()=>response({code:525,message:'sensitive upstream text'})]);const client=new EcoleDirecte(t.fetch);await client.login('parent','secret');await assert.rejects(()=>client.dashboard(),err=>err.status===401&&!err.message.includes('sensitive'));assert.equal(client.token,undefined);
});
test('mauvais mot de passe effacé sans nouvelle tentative automatique',async()=>{
 const t=transport([gtk,()=>response({code:505,message:'secret upstream'})]);const client=new EcoleDirecte(t.fetch);await assert.rejects(()=>client.login('parent','secret'),/refusé/);assert.equal(client.pending,undefined);assert.equal(t.calls.length,2);
});
test('rotation des jetons, deux établissements et erreur partielle',async()=>{
 const other={...account,id:2,idLogin:202,main:false,profile:{eleves:[{id:22,prenom:'Second',photo:'//doc1.ecoledirecte.com/PhotoEleves/second.jpg',classe:{libelle:'Terminale'}}]}};
 const t=transport([gtk,()=>response({code:200,token:'one',data:{accounts:[account,other]}}),()=>response({code:200,token:'rotated',data:{notes:[]}}),call=>{assert.equal(call.options.headers['X-Token'],'rotated');assert.equal(call.payload.idUser,202);return response({code:200,token:'second'});},call=>{assert.equal(call.options.headers['X-Token'],'second');return response({code:403});}]);
 const client=new EcoleDirecte(t.fetch);await client.login('p','s');const result=await client.dashboard();assert.equal(result.children.length,2);assert.ok(result.children[1].error);assert.equal(result.children[0].error,undefined);
});

test('primaire ignoré avant tout appel, photo récupérée sur le profil secondaire',async()=>{
 const a={...account,profile:{eleves:[{id:11,prenom:'Test',classe:{libelle:'CINQUIEME C'}},{id:12,prenom:'Primaire',classe:{libelle:'COURS ELEMENTAIRE 2° AN 2'}}]}};
 const t=transport([gtk,()=>response({code:200,token:'one',data:{accounts:[a]}}),call=>{assert.match(call.url,/eleves\/11\.awp/);return response({code:200,data:{profile:{photo:'//doc1.ecoledirecte.com/PhotoEleves/test.jpg'}}});},call=>{assert.match(call.url,/eleves\/11\/notes/);return response({code:200,data:{notes:[]}});}]);
 const client=new EcoleDirecte(t.fetch);await client.login('p','s');const result=await client.dashboard();assert.equal(result.children.length,1);assert.equal(result.children[0].photo,'https://doc1.ecoledirecte.com/PhotoEleves/test.jpg');
});
