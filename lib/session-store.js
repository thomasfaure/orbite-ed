import {mkdirSync,readFileSync,writeFileSync,renameSync,chmodSync,existsSync,unlinkSync,openSync,fsyncSync,closeSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';

// Only called with an application-owned directory, never a web request path.
export class SessionStore {
  constructor(directory) {
    this.directory=directory;
    mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);
    this.file=join(directory,'sessions.enc');const keyFile=join(directory,'key');
    if(!existsSync(keyFile)) {
      if(existsSync(this.file))throw new Error('Clé des sessions absente. Restaurez la clé ou supprimez le coffre pour vous reconnecter.');
      try{writeFileSync(keyFile,randomBytes(32),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
    }
    chmodSync(keyFile,0o600);this.key=readFileSync(keyFile);
    if(this.key.length!==32)throw new Error('Clé des sessions invalide.');
  }
  load() {
    let bytes;
    try{bytes=readFileSync(this.file);chmodSync(this.file,0o600);}catch(e){if(e.code==='ENOENT')return [];throw e;}
    try {
      if(bytes.length<32 || bytes.subarray(0,4).toString()!=='ORB1')throw new Error();
      const cipher=createDecipheriv('aes-256-gcm',this.key,bytes.subarray(4,16));
      cipher.setAAD(Buffer.from('Orbite sessions v1'));cipher.setAuthTag(bytes.subarray(16,32));
      const data=JSON.parse(Buffer.concat([cipher.update(bytes.subarray(32)),cipher.final()]).toString('utf8'));
      if(data.version!==1 || !Array.isArray(data.sessions))throw new Error();
      return data.sessions;
    }catch{throw new Error('Le coffre de sessions ne peut pas être déchiffré. Aucun fichier n’a été remplacé.');}
  }
  save(sessions) {
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);
    cipher.setAAD(Buffer.from('Orbite sessions v1'));
    const encrypted=Buffer.concat([cipher.update(JSON.stringify({version:1,sessions}),'utf8'),cipher.final()]);
    const bytes=Buffer.concat([Buffer.from('ORB1'),iv,cipher.getAuthTag(),encrypted]);
    const temp=join(this.directory,'.sessions-'+randomBytes(12).toString('hex')+'.tmp');
    try {
      const fd=openSync(temp,'wx',0o600);
      try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
      renameSync(temp,this.file);
      const dir=openSync(this.directory,'r');try{fsyncSync(dir);}finally{closeSync(dir);}
    }finally{if(existsSync(temp))unlinkSync(temp);}
  }
}
