// Redémarrage ciblé de l'instance LAN d'Orbite sur le NAS.
import {readdir,readFile,readlink,realpath,open} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const directory=await realpath(fileURLToPath(new URL('.',import.meta.url)));
const config=parseEnv(await readFile(directory+'/.env','utf8'));
const hostname=config.HOST?.trim();
const port=Number(config.PORT);
if(!hostname || !Number.isInteger(port) || port<1 || port>65535)throw new Error('Renseignez HOST et PORT (1 à 65535) dans le fichier .env du NAS.');
const probeHost=hostname==='0.0.0.0'?'127.0.0.1':hostname;
const address=`http://${probeHost.includes(':')?'['+probeHost+']':probeHost}:${port}`;
const executable=await realpath(process.execPath);
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const targets=[];
for(const entry of await readdir('/proc')){
 if(!/^\d+$/.test(entry) || Number(entry)===process.pid)continue;
 try{
  const base='/proc/'+entry;
  if(await readlink(base+'/exe')!==executable || await readlink(base+'/cwd')!==directory)continue;
  const args=(await readFile(base+'/cmdline','utf8')).split('\0');
  const env=(await readFile(base+'/environ','utf8')).split('\0');
  if(!args.some(a=>a==='server.js'||a===directory+'/server.js') || !(env.includes('ORBITE_NAS_INSTANCE='+directory)||env.includes('PORT='+port)))continue;
  targets.push(Number(entry));
 }catch(error){if(!['ENOENT','ESRCH'].includes(error.code))throw error;}
}
for(const pid of targets)process.kill(pid,'SIGTERM');
for(let i=0;i<50 && targets.some(alive);i++)await sleep(100);
if(targets.some(alive))throw new Error('Ancien serveur encore actif : arrêt du redémarrage.');
const log=await open('/mnt/HD/HD_a2/orbite/lan.log','a');
const child=spawn(executable,[directory+'/server.js'],{
 cwd:directory,env:{...process.env,HOST:hostname,PORT:String(port),ORBITE_NAS_INSTANCE:directory},
 detached:true,stdio:['ignore',log.fd,log.fd]
});
child.on('error',error=>{console.error('Démarrage impossible :',error.message);process.exitCode=1;});
child.unref();
await log.close();
let ready=false;
for(let i=0;i<20;i++){
 await sleep(300);
 if(!child.pid || !alive(child.pid))break;
 try{
  const response=await fetch(address+'/api/session',{signal:AbortSignal.timeout(1000)});
  if(response.ok){ready=true;break;}
 }catch{}
}
if(!ready)throw new Error('Serveur indisponible : consulter /mnt/HD/HD_a2/orbite/lan.log');
console.log(`Orbite redémarré : ${address} — sessions non expirées conservées.`);
