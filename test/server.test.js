import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createApp} from '../server.js';
// Exercise the real HTTP handler without opening a listening socket.
function harness(options={}){let resolveLogin;const client={state:'anonymous',clear(){this.state='anonymous';},async login(){this.state='authenticated';return {state:this.state};},async verify(){return {state:'authenticated'};},async dashboard(){return {demo:false,children:[]};}};
 const server=createApp({clientFactory:()=>client,...options});server.address=()=>({port:3210});
 async function request(path,{method='GET',headers={},data}={}){const req=Readable.from(data===undefined?[]:[JSON.stringify(data)]);Object.assign(req,{url:path,method,headers:{host:'127.0.0.1:3210',...headers}});const h={};return new Promise(resolve=>{const res={setHeader(k,v){h[k]=v;},writeHead(status,more){this.status=status;Object.assign(h,more);},end(body){let value;try{value=JSON.parse(body);}catch{value=String(body);}resolve({status:this.status,headers:h,body:value});}};server.emit('request',req,res);});}
 return {server,client,request};
}
const post={method:'POST',headers:{'content-type':'application/json','x-orbite-client':'1'},data:{username:'parent',password:'secret'}};
test('refuse host non local, CSRF et accès anonyme aux notes',async t=>{const h=harness();t.after(()=>h.server.emit('close'));
 assert.equal((await h.request('/api/session',{headers:{host:'evil.test:3210'}})).status,403);
 assert.equal((await h.request('/api/login',{...post,headers:{...post.headers,origin:'https://evil.test'}})).status,403);
 assert.equal((await h.request('/api/login',{method:'POST',data:post.data})).status,403);
 assert.equal((await h.request('/api/dashboard',{...post,data:{}})).status,401);
});
test('cookie HttpOnly, état sans secrets, notes et déconnexion',async t=>{const h=harness();t.after(()=>h.server.emit('close'));const login=await h.request('/api/login',post);assert.equal(login.status,200);assert.match(login.headers['Set-Cookie'],/HttpOnly; SameSite=Strict/);const cookie=login.headers['Set-Cookie'].split(';')[0];const headers={...post.headers,cookie};
 assert.deepEqual((await h.request('/api/session',{headers})).body,{state:'authenticated'});
 assert.equal((await h.request('/api/dashboard',{method:'POST',headers,data:{}})).status,200);
 await h.request('/api/logout',{method:'POST',headers,data:{}});
 assert.equal((await h.request('/api/dashboard',{method:'POST',headers,data:{}})).status,401);
});
test('une requête concurrente refusée ne libère pas le verrou',async t=>{const h=harness();t.after(()=>h.server.emit('close'));const login=await h.request('/api/login',post);const cookie=login.headers['Set-Cookie'].split(';')[0];let finish;h.client.dashboard=()=>new Promise(resolve=>{finish=resolve;});const options={method:'POST',headers:{...post.headers,cookie},data:{}};
 const first=h.request('/api/dashboard',options);await new Promise(resolve=>setImmediate(resolve));assert.equal((await h.request('/api/dashboard',options)).status,409);assert.equal((await h.request('/api/dashboard',options)).status,409);finish({children:[]});assert.equal((await first).status,200);
});
test('assets autorisés seulement et limitation des connexions',async t=>{const h=harness();t.after(()=>h.server.emit('close'));assert.equal((await h.request('/server.js')).status,404);assert.equal((await h.request('/')).status,200);for(let i=0;i<6;i++)await h.request('/api/login',post);assert.equal((await h.request('/api/login',post)).status,429);});

test('LAN explicite : hôte et origine exacts, autres hôtes refusés',async t=>{
 const h=harness({hostname:'192.168.1.53'});t.after(()=>h.server.emit('close'));
 assert.equal((await h.request('/api/session',{headers:{host:'192.168.1.53:3210',origin:'http://192.168.1.53:3210'}})).status,200);
 assert.equal((await h.request('/api/session',{headers:{host:'192.168.1.54:3210'}})).status,403);
 assert.equal((await h.request('/api/session',{headers:{host:'192.168.1.53:3211'}})).status,403);
 assert.equal((await h.request('/api/session',{headers:{host:'192.168.1.53:3210',origin:'http://evil.test'}})).status,403);
});
test('devoirs différés : accès, verrou partagé, cache indépendant des notes',async t=>{
 const h=harness();t.after(()=>h.server.emit('close'));
 assert.equal((await h.request('/api/homework',{...post,data:{childId:'1:11'}})).status,401);
 const login=await h.request('/api/login',post);const headers={...post.headers,cookie:login.headers['Set-Cookie'].split(';')[0]};
 const options={method:'POST',headers,data:{childId:'1:11'}};
 h.client.dashboard=async()=>({children:[{id:'1:11',notes:[],periods:[]}]});
 await h.request('/api/dashboard',{method:'POST',headers,data:{}});
 assert.equal((await h.request('/api/homework',{...options,data:{childId:'other'}})).status,404);
 let finish,count=0;
 h.client.homeworkForChild=id=>{count++;assert.equal(id,'1:11');return new Promise(resolve=>{finish=resolve;});};
 const pending=h.request('/api/homework',options);await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await h.request('/api/homework',options)).status,409);
 assert.equal((await h.request('/api/dashboard',{method:'POST',headers,data:{}})).status,409);
 finish({homework:[]});assert.equal((await pending).status,200);
 assert.equal((await h.request('/api/homework',options)).status,200);assert.equal(count,1);
});

test('redémarrage : même cookie restauré, rotation persistée, déconnexion durable et expiration',async t=>{
 const {SessionStore}=await import('../lib/session-store.js');const {EcoleDirecte}=await import('../lib/ecoledirecte.js');
 const fs=await import('node:fs');const os=await import('node:os');const path=await import('node:path');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'orbite-server-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 class Client extends EcoleDirecte {
  async login(){this.state='authenticated';this.token='first-token';this.accounts=[];return {state:this.state};}
  async dashboard(){assert.equal(this.token,'first-token');this.token='rotated-token';return {children:[]};}
 }
 const factory=()=>new Client();
 const first=harness({clientFactory:factory,sessionStore:new SessionStore(directory)});
 const login=await first.request('/api/login',post);assert.equal(login.status,200);
 const headers={...post.headers,cookie:login.headers['Set-Cookie'].split(';')[0]};
 const expiry=new SessionStore(directory).load()[0].expires;
 await first.request('/api/dashboard',{method:'POST',headers,data:{}});
 first.server.emit('close');
 assert.equal(new SessionStore(directory).load()[0].auth.token,'rotated-token');
 const second=harness({clientFactory:factory,sessionStore:new SessionStore(directory)});
 assert.equal((await second.request('/api/session',{headers})).body.state,'authenticated');
 assert.equal(new SessionStore(directory).load()[0].expires,expiry);
 await second.request('/api/logout',{method:'POST',headers,data:{}});second.server.emit('close');
 const third=harness({clientFactory:factory,sessionStore:new SessionStore(directory)});
 assert.equal((await third.request('/api/session',{headers})).body.state,'anonymous');third.server.emit('close');
 const store=new SessionStore(directory);const c=factory();await c.login();store.save([{id:'a'.repeat(64),expires:Date.now()-1,auth:c.exportSession()}]);
 const fourth=harness({clientFactory:factory,sessionStore:store});assert.deepEqual(store.load(),[]);fourth.server.emit('close');
});

test('API IA : authentification complète, CSRF, validation et fichiers privés',async t=>{
 let calls=0;const aiClient={configured:true,respond:async input=>{calls++;return {text:'OK',complete:true};}};
 const h=harness({aiClient});t.after(()=>h.server.emit('close'));
 const aiPost={...post,data:{input:'Test'}};
 assert.equal((await h.request('/api/ai',aiPost)).status,401);
 const login=await h.request('/api/login',post);const headers={...post.headers,cookie:login.headers['Set-Cookie'].split(';')[0]};
 h.client.state='question';assert.equal((await h.request('/api/ai',{...aiPost,headers})).status,401);h.client.state='authenticated';
 assert.equal((await h.request('/api/ai',{...aiPost,headers:{...headers,origin:'https://evil.test'}})).status,403);
 assert.equal((await h.request('/api/ai',{...aiPost,headers,data:{input:'Test',model:'expensive'}})).status,400);
 assert.equal((await h.request('/api/ai',{...aiPost,headers})).body.text,'OK');assert.equal(calls,1);
 for(const path of ['/.env','/.env.example','/lib/openai.js'])assert.equal((await h.request(path)).status,404);
 assert.equal((await h.request('/ai.js')).status,200);
});
test('IA indépendante du chargement scolaire, verrou IA et quota',async t=>{
 let finish;const aiClient={configured:true,respond:()=>new Promise(resolve=>{finish=resolve;})};
 const h=harness({aiClient});t.after(()=>h.server.emit('close'));
 const login=await h.request('/api/login',post);const headers={...post.headers,cookie:login.headers['Set-Cookie'].split(';')[0]};const options={method:'POST',headers,data:{input:'Test'}};
 const pending=h.request('/api/ai',options);await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await h.request('/api/ai',options)).status,429);
 assert.equal((await h.request('/api/dashboard',{method:'POST',headers,data:{}})).status,200);
 finish({text:'OK'});assert.equal((await pending).status,200);
 aiClient.respond=async()=>({text:'OK'});
 for(let i=0;i<9;i++)assert.equal((await h.request('/api/ai',options)).status,200);
 assert.equal((await h.request('/api/ai',options)).status,429);
});
