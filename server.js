import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {OpenAIClient} from './lib/openai.js';
import {SessionStore} from './lib/session-store.js';
import {EcoleDirecte,EdError} from './lib/ecoledirecte.js';
const root = new URL('./public/',import.meta.url);
export function createApp({clientFactory=()=>new EcoleDirecte(), hostname='127.0.0.1',sessionStore=null,aiClient=new OpenAIClient()}={}) {
  const sessions = new Map(); const attempts = []; const aiAttempts=[]; let aiActive=0;
  const persist=()=>{if(sessionStore)sessionStore.save([...sessions].flatMap(([id,s])=>{
    const auth=s.client.exportSession();
    return auth && s.expires>Date.now()?[{id,expires:s.expires,auth}]:[];
  }));};
  if(sessionStore) {
    for(const saved of sessionStore.load()) {
      if(!/^[a-f0-9]{64}$/.test(saved.id)||!Number.isFinite(saved.expires)||saved.expires<=Date.now())continue;
      const client=clientFactory();client.restoreSession(saved.auth);
      sessions.set(saved.id,{client,expires:saved.expires,busy:false});
    }
    persist();
  }
  const cleanup = setInterval(()=>{for(const [id,s] of sessions) if(Date.now()>s.expires){s.client.clear();sessions.delete(id);}try{persist();}catch{console.error("Sauvegarde des sessions indisponible.");}},60000); cleanup.unref();
  const server = http.createServer(async(req,res)=>{
    const host = req.headers.host || ''; const address = server.address();
    const allowed = [`127.0.0.1:${address.port}`,`localhost:${address.port}`,`${hostname}:${address.port}`];
    const headers = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://ecoledirecte.com https://*.ecoledirecte.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'X-Frame-Options':'DENY'};
    const json=(status,data)=>{try{persist();}catch{status=503;data={error:'Sauvegarde sécurisée des sessions impossible. Vérifiez les permissions et l’espace disque.'};}res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    let session; let ownsLock=false; let ownsAiLock=false;
    try {
      if (!allowed.includes(host)) throw new EdError('Hôte non autorisé.',403);
      if (req.headers.origin && req.headers.origin !== `http://${host}`) throw new EdError('Origine refusée.',403);
      if (req.headers['sec-fetch-site']==='cross-site') throw new EdError('Origine refusée.',403);
      const path = new URL(req.url,`http://${host}`).pathname;
      if (!path.startsWith('/api/')) {
        if (req.method!=='GET' && req.method!=='HEAD') throw new EdError('Méthode refusée.',405);
        const routes={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/ai.js':['ai.js','text/javascript'],'/coaching.js':['coaching.js','text/javascript'],'/metrics.js':['metrics.js','text/javascript'],'/demo.js':['demo.js','text/javascript'],'/style.css':['style.css','text/css'],'/favicon.svg':['favicon.svg','image/svg+xml']};
        if (!routes[path]) throw new EdError('Page introuvable.',404);
        const [file,type]=routes[path]; const body=await readFile(new URL(file,root));
        res.writeHead(200,{...headers,'Content-Type':type+'; charset=utf-8'});res.end(req.method==='HEAD'?undefined:body);return;
      }
      const id = /(?:^|; )orbite=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
      session = sessions.get(id);
      if (session && Date.now()>session.expires) {session.client.clear();sessions.delete(id);session=undefined;}
      if (req.method==='GET' && path==='/api/session') {json(200,{state:session?.client.state || 'anonymous'});return;}
      if (req.method!=='POST') throw new EdError('Méthode refusée.',405);
      if (req.headers['x-orbite-client']!=='1' || !req.headers['content-type']?.startsWith('application/json')) throw new EdError('Requête refusée.',403);
      let body=''; for await(const chunk of req) {body+=chunk; if(Buffer.byteLength(body)>16384) throw new EdError('Requête trop volumineuse.',413);}
      let data;try{data=JSON.parse(body || '{}');}catch{throw new EdError('JSON invalide.',400);}
      if (!data || typeof data!=='object' || Array.isArray(data)) throw new EdError('Données invalides.',400);
      if(path==='/api/logout') {if(session?.busy)throw new EdError('Synchronisation en cours. Réessayez la déconnexion après son achèvement.',409);session?.client.clear();sessions.delete(id);res.setHeader('Set-Cookie','orbite=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');json(200,{state:'anonymous'});return;}
      if(path==='/api/login') {
        const now=Date.now();while(attempts.length && attempts[0]<now-60000)attempts.shift();
        if(attempts.length>=6) throw new EdError('Trop de tentatives. Attendez une minute.',429);
        if(typeof data.username!=='string' || !data.username.trim() || data.username.length>256 || typeof data.password!=='string' || !data.password || data.password.length>1024) throw new EdError('Renseignez vos identifiants ÉcoleDirecte.',400);
        if(session?.busy) throw new EdError('Une opération est déjà en cours.',409);
        attempts.push(now); session?.client.clear();sessions.delete(id);
        const sid=randomBytes(32).toString('hex');session={client:clientFactory(),expires:now+10*60000,busy:true};sessions.set(sid,session);ownsLock=true;
        res.setHeader('Set-Cookie',`orbite=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`);
        const result=await session.client.login(data.username.trim(),data.password);
        if(result.state==='authenticated')session.expires=Date.now()+8*3600000;
        json(200,result);return;
      }
      if(!session)throw new EdError('Votre session a expiré. Reconnectez-vous.',401);
      if(path==='/api/ai') {
        if(session.client.state!=='authenticated')throw new EdError('Terminez la connexion à ÉcoleDirecte.',401);
        if(Object.keys(data).some(key=>key!=='input') || typeof data.input!=='string' || !data.input.trim() || data.input.length>8000)
          throw new EdError('Envoyez uniquement un texte input de 1 à 8 000 caractères.',400);
        if(!aiClient.configured)throw new EdError('OpenAI n’est pas configuré sur le serveur.',503);
        if(session.aiBusy || aiActive>=2)throw new EdError('Une demande IA est déjà en cours. Réessayez dans un instant.',429);
        const now=Date.now();session.aiAttempts ??= [];
        for(const list of [session.aiAttempts,aiAttempts])while(list.length && list[0]<=now-60000)list.shift();
        if(session.aiAttempts.length>=10 || aiAttempts.length>=30)throw new EdError('Trop de demandes IA. Attendez une minute.',429);
        session.aiAttempts.push(now);aiAttempts.push(now);session.aiBusy=true;aiActive++;ownsAiLock=true;
        const result=await aiClient.respond(data.input);
        if(sessions.get(id)!==session || session.expires<=Date.now() || session.client.state!=='authenticated')throw new EdError('Votre session a expiré. Reconnectez-vous.',401);
        json(200,result);return;
      }
      if(session.busy)throw new EdError('Une opération est déjà en cours.',409);
      session.busy=true;ownsLock=true;
      if(path==='/api/verify') {
        session.verifyAttempts=(session.verifyAttempts||0)+1;
        if(session.verifyAttempts>6){session.client.clear();throw new EdError('Vérifications trop nombreuses. Reconnectez-vous.',429);}
        const result=await session.client.verify(data);if(result.state==='authenticated')session.expires=Date.now()+8*3600000;
        json(200,result);return;
      }
      if(path==='/api/homework') {
        if(typeof data.childId!=='string' || !session.cache?.children.some(c=>c.id===data.childId))
          throw new EdError('Élève introuvable.',404);
        session.homeworkCache ??= new Map();
        const cursor=data.cursor ?? null;
        if(cursor!==null && (!Number.isSafeInteger(cursor)||cursor<0))throw new EdError('Pagination invalide.',400);
        const cacheKey=data.childId+':'+String(cursor);
        const cached=session.homeworkCache.get(cacheKey);
        if(cached && Date.now()-cached.time<60000){json(200,cached.value);return;}
        const result=await session.client.homeworkForChild(data.childId,{cursor});
        session.homeworkCache.set(cacheKey,{time:Date.now(),value:result});
        json(200,result);return;
      }
      if(path==='/api/dashboard') {
        if(session.cache && Date.now()-session.cacheTime<60000){json(200,session.cache);return;}
        const result=await session.client.dashboard();session.cache=result;session.cacheTime=Date.now();json(200,result);return;
      }
      throw new EdError('Route introuvable.',404);
    } catch(error) {json(error.status || 500,{error:error instanceof EdError?error.message:'Erreur locale inattendue.',code:error.code});}
    finally {if(session && ownsLock)session.busy=false;if(ownsAiLock){session.aiBusy=false;aiActive--;}}
  });
  server.on('close',()=>{clearInterval(cleanup);for(const s of sessions.values())s.client.clear();sessions.clear();});
  return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  try{process.loadEnvFile(fileURLToPath(new URL('./.env',import.meta.url)));}catch(error){if(error.code!=='ENOENT'){console.error('Impossible de lire la configuration .env.');process.exit(1);}}
  const port=Number(process.env.PORT || 3210);
  const hostname=process.env.HOST || '127.0.0.1';
  let sessionStore;
  try{sessionStore=new SessionStore(process.env.ORBITE_DATA_DIR || fileURLToPath(new URL('./.orbite-data/'+port+'/',import.meta.url)));}
  catch{console.error('Impossible d’ouvrir le coffre de sessions. Vérifiez la clé, les fichiers et leurs permissions.');process.exit(1);}
  const server=createApp({hostname,sessionStore});
  let stopping=false;
  const shutdown=()=>{if(stopping)return;stopping=true;server.close(()=>process.exit(0));};
  process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Le port ${port} est occupé. Essayez PORT=3211 npm start.`:`Impossible de démarrer le serveur local (${error.code || 'erreur inconnue'}).`);process.exitCode=1;});
  server.listen(port,hostname,()=>console.log(`Orbite · http://${hostname}:${port}\nSessions chiffrées sur disque ; notes et devoirs en mémoire. Ctrl+C pour arrêter.`));
}
