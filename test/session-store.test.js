import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,statSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SessionStore} from '../lib/session-store.js';
import {EcoleDirecte} from '../lib/ecoledirecte.js';
const fixture=t=>{const dir=mkdtempSync(join(tmpdir(),'orbite-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;};
test('coffre chiffré, permissions, nonce aléatoire et restauration',t=>{
 const dir=fixture(t),store=new SessionStore(dir),saved=[{id:'a'.repeat(64),expires:Date.now()+10000,auth:{token:'TOKEN_SECRET'}}];
 store.save(saved);const first=readFileSync(store.file);
 assert.ok(!first.includes(Buffer.from('TOKEN_SECRET')));assert.deepEqual(new SessionStore(dir).load(),saved);
 assert.equal(statSync(dir).mode&0o777,0o700);assert.equal(statSync(join(dir,'key')).mode&0o777,0o600);assert.equal(statSync(store.file).mode&0o777,0o600);
 store.save(saved);assert.notDeepEqual(first,readFileSync(store.file));
 store.save([]);assert.deepEqual(store.load(),[]);
});
test('coffre altéré ou clé perdue : échec sans écrasement',t=>{
 const dir=fixture(t),store=new SessionStore(dir);store.save([]);const bytes=readFileSync(store.file);bytes[bytes.length-1]^=1;writeFileSync(store.file,bytes);
 assert.throws(()=>store.load(),/déchiffré/);assert.deepEqual(readFileSync(store.file),bytes);
 unlinkSync(join(dir,'key'));assert.throws(()=>new SessionStore(dir),/Clé/);
});
test('export limité aux jetons, cookies et identités ; aucune donnée de vérification',()=>{
 const c=new EcoleDirecte();c.token='token';c.pending={motdepasse:'secret',fa:[{cv:'123456'}]};c.state='question';assert.equal(c.exportSession(),null);
 c.state='authenticated';assert.equal(c.exportSession(),null);c.pending=undefined;
 c.cookies.set('route','one');c.twoFa='two';c.gtk='gtk';c.activeId=1;c.factors=[{cv:'OTP_SECRET'}];
 c.accounts=[{id:1,idLogin:2,typeCompte:'F',password:'NEVER',profile:{eleves:[{id:11,prenom:'Test',classe:{libelle:'5e'},password:'NEVER'}]}}];
 const saved=c.exportSession();assert.ok(!JSON.stringify(saved).includes('NEVER'));assert.ok(!JSON.stringify(saved).includes('OTP_SECRET'));
 const restored=new EcoleDirecte();restored.restoreSession(saved);assert.equal(restored.state,'authenticated');assert.equal(restored.token,'token');assert.equal(restored.cookies.get('route'),'one');assert.equal(restored.pending,undefined);assert.equal(restored.accounts[0].profile.eleves[0].classe.libelle,'5e');
});
