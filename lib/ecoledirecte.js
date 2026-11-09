import {isSecondary,photoUrl} from '../public/metrics.js';
const BASE = 'https://api.ecoledirecte.com/v3/';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
export class EdError extends Error {
  constructor(message, status = 502, code) { super(message); this.status = status; this.code = code; }
}
export class EcoleDirecte {
  constructor(transport = fetch) { this.fetch = transport; this.cookies = new Map(); this.version = process.env.ED_API_VERSION || '4.96.3'; this.state = 'anonymous'; this.accounts = []; this.factors = []; }
  capture(res) {
    for (const cookie of res.headers.getSetCookie()) {
      const pair = cookie.split(';')[0]; const i = pair.indexOf('=');
      if (i > 0) this.cookies.set(pair.slice(0,i), pair.slice(i+1));
    }
    this.gtk = res.headers.get('x-gtk') || this.cookies.get('GTK') || this.gtk;
    this.token = res.headers.get('x-token') || this.token;
    this.twoFa = res.headers.get('2fa-token') || this.twoFa;
  }
  async request(path, data, bootstrap = false) {
    const headers = {'User-Agent':UA, Accept:'application/json', Origin:'https://www.ecoledirecte.com', Referer:'https://www.ecoledirecte.com/'};
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k,v])=>`${k}=${v}`).join('; ');
    if (this.token) headers['X-Token'] = this.token;
    if (this.twoFa) headers['2FA-Token'] = this.twoFa;
    if (this.gtk && path.startsWith('login') && !bootstrap) headers['X-Gtk'] = this.gtk;
    if (!bootstrap) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    let response;
    try { response = await this.fetch(BASE + path + (path.includes('?')?'&':'?') + 'v=' + encodeURIComponent(this.version), {method:bootstrap?'GET':'POST', headers, body:bootstrap?undefined:new URLSearchParams({data:JSON.stringify(data ?? {})}), signal:AbortSignal.timeout(20000), redirect:'error'}); }
    catch { throw new EdError('ÉcoleDirecte est injoignable. Vérifiez votre connexion, puis réessayez.'); }
    this.capture(response);
    if (!response.ok) throw new EdError(`ÉcoleDirecte est indisponible (HTTP ${response.status}).`);
    if (bootstrap) {
      const text = await response.text();
      try { this.gtk = JSON.parse(text).token || this.gtk; } catch {}
      if (!this.gtk) throw new EdError('Le jeton initial GTK est absent. Le protocole ÉcoleDirecte a peut-être évolué.');
      return;
    }
    let body; try { body = await response.json(); } catch { throw new EdError('Réponse ÉcoleDirecte non reconnue.'); }
    this.token = response.headers.get('x-token') || body.token || this.token;
    if ([520,521,525].includes(Number(body.code))) { this.clear(); throw new EdError('Votre session a expiré. Reconnectez-vous.',401,body.code); }
    if (![200,250].includes(Number(body.code))) {
      const messages = {505:'Identifiant, mot de passe ou vérification refusé.',517:'Version API refusée. Ajustez ED_API_VERSION.',516:'Compte temporairement bloqué. Connectez-vous sur le site ÉcoleDirecte.',535:'Établissement ou compte indisponible.'};
      throw new EdError(messages[body.code] || `ÉcoleDirecte a refusé la demande (code ${body.code ?? 'inconnu'}).`,400,body.code);
    }
    return body;
  }
  async login(username,password) {
    this.clear(); this.pending = {identifiant:username,motdepasse:password,isReLogin:false,uuid:'',fa:[]};
    try { return await this.replay(); } catch (e) { this.clear(); throw e; }
  }
  async replay() {
    this.gtk = undefined;
    await this.request('login.awp?gtk=1',undefined,true);
    return this.accept(await this.request('login.awp',this.pending));
  }
  async accept(body) {
    if (Number(body.code) === 200) {
      if (!this.token || !Array.isArray(body.data?.accounts)) throw new EdError('Réponse de connexion incomplète.');
      this.accounts = body.data.accounts;
      this.activeId = body.data.id ?? this.accounts.find(a=>a.main)?.id ?? this.accounts[0]?.id;
      this.pending = undefined; this.factors = []; this.state = 'authenticated';
      return {state:this.state};
    }
    if (!this.pending || ++this.challenges > 4) { this.clear(); throw new EdError('Vérifications répétées. Connectez-vous une fois sur le site ÉcoleDirecte.',400); }
    if (body.data?.totp) { this.state = 'totp'; return {state:'totp'}; }
    const question = await this.request('connexion/doubleauth.awp?verbe=get',{});
    if (Number(question.code)!==200 || !question.data?.question || !question.data.propositions?.length) throw new EdError('Question de sécurité indisponible.');
    this.choices = question.data.propositions; this.state = 'question';
    return {state:'question',question:Buffer.from(question.data.question,'base64').toString('utf8'),choices:this.choices.map(v=>Buffer.from(v,'base64').toString('utf8'))};
  }
  async verify({choice,code}) {
    if (!this.pending) throw new EdError('Relancez la connexion.',400);
    if (this.state === 'totp') {
      if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new EdError('Saisissez le code à six chiffres.',400);
      this.pending.fa = [{cn:'',cv:code}];
    } else if (this.state === 'question') {
      if (!Number.isInteger(choice) || !this.choices[choice]) throw new EdError('Choisissez une réponse.',400);
      const answer = await this.request('connexion/doubleauth.awp?verbe=post',{choix:this.choices[choice]});
      const {cn,cv} = answer.data || {};
      if (Number(answer.code)!==200 || !cn || !cv) throw new EdError('Réponse de sécurité refusée.',400);
      this.factors.push({cn,cv,uniq:false}); Object.assign(this.pending,{cn,cv,fa:this.factors});
    } else throw new EdError('Aucune vérification en cours.',400);
    return this.replay();
  }
  async dashboard() {
    if (this.state!=='authenticated') throw new EdError('Connectez-vous à votre compte parent.',401);
    const children = [];
    for (const account of this.accounts) {
      const students = (account.typeCompte === 'E' ? [account] : account.profile?.eleves || []).filter(s=>isSecondary(s.classe?.libelle || s.profile?.classe?.libelle || s.classe?.code || s.profile?.classe?.code));
      if (!students.length) continue;
      try {
        if (account.id !== this.activeId) {
          if (!account.idLogin) throw new EdError('Le contexte de cet établissement ne peut pas être sélectionné.');
          const switched = await this.request('renewtoken.awp?verbe=post',{idUser:account.idLogin,uuid:''});
          if (Number(switched.code)!==200) throw new EdError('Changement de contexte refusé.');
          this.activeId = account.id;
        }
        for (const student of students) {
          const child = {photo:photoUrl(student.photo || student.profile?.photo),id:`${account.id}:${student.id}`,name:student.prenom || 'Élève',lastName:student.nom || '',className:student.classe?.libelle || student.profile?.classe?.libelle || '',school:student.nomEtablissement || account.nomEtablissement || ''};
          if (!child.photo) {
            try {
              const profile = await this.request(`eleves/${encodeURIComponent(student.id)}.awp?verbe=get`,{});
              child.photo = photoUrl(profile.data?.photo || profile.data?.profile?.photo);
            } catch(e) { if(e.status === 401) throw e; }
          }
          try {
            const response = await this.request(`eleves/${encodeURIComponent(student.id)}/notes.awp?verbe=get`,{anneeScolaire:''});
            if (Number(response.code)!==200) throw new EdError('Accès aux notes à vérifier sur ÉcoleDirecte.');
            Object.assign(child,normalizeNotes(response.data));
          } catch(e) { if (e.status===401) throw e; Object.assign(child,{error:e.message,notes:[],periods:[]}); }
          children.push(child);
        }
      } catch(e) {
        if (e.status===401) throw e;
        for (const s of students) if (!children.some(c=>c.id===`${account.id}:${s.id}`)) children.push({id:`${account.id}:${s.id}`,name:s.prenom || 'Élève',className:s.classe?.libelle || '',error:e.message,notes:[],periods:[]});
      }
    }
    return {demo:false,updatedAt:new Date().toISOString(),children};
  }
  async homeworkForChild(childId,options={}) {
    if(this.state!=='authenticated') throw new EdError('Reconnectez-vous.',401);
    for(const account of this.accounts) {
      const students=account.typeCompte==='E'?[account]:account.profile?.eleves || [];
      const student=students.find(s=>`${account.id}:${s.id}`===childId && isSecondary(s.classe?.libelle || s.profile?.classe?.libelle || s.classe?.code || s.profile?.classe?.code));
      if(!student) continue;
      if(account.id!==this.activeId) {
        if(!account.idLogin) throw new EdError('Contexte de cet établissement indisponible.');
        const switched=await this.request('renewtoken.awp?verbe=post',{idUser:account.idLogin,uuid:''});
        if(Number(switched.code)!==200) throw new EdError('Changement de contexte refusé.');
        this.activeId=account.id;
      }
      return this.homework(student.id,options);
    }
    throw new EdError('Élève introuvable.',404);
  }
  async homework(studentId,{cursor=null,now=new Date()}={}) {
    const path=`Eleves/${encodeURIComponent(studentId)}/cahierdetexte`;
    this.homeworkSnapshots ??= new Map();
    let snapshot=this.homeworkSnapshots.get(String(studentId));
    if(!snapshot || (cursor===null && Date.now()-snapshot.time>=60000)) {
      const index=await this.request(path+'.awp?verbe=get',{});
      if(Number(index.code)!==200 || !index.data || Array.isArray(index.data) || typeof index.data!=='object') throw new EdError('Cahier de textes indisponible.');
      const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
      const end=new Date(today+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+29);
      const entries=[];let partial=false;
      for(const [dueDate,rows] of Object.entries(index.data).sort(([a],[b])=>a.localeCompare(b))) {
        if(!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)||!Array.isArray(rows)){partial=true;continue;}
        if(dueDate<today)continue;
        for(const h of rows)if(h && h.aFaire!==false)entries.push({...h,dueDate,key:dueDate+':'+String(h.idDevoir ?? entries.length)});
      }
      snapshot={entries,details:new Map(),time:Date.now(),end:end.toISOString().slice(0,10),partial};
      this.homeworkSnapshots.set(String(studentId),snapshot);
    }
    const pending=snapshot.entries.filter(h=>homeworkDone(h.effectue)!==true);
    const initialCount=pending.filter(h=>h.dueDate<=snapshot.end).length;
    const offset=cursor===null?0:cursor;
    if(!Number.isSafeInteger(offset)||offset<0||offset>pending.length)throw new EdError('Pagination invalide. Actualisez les devoirs.',400);
    const selected=pending.slice(offset,cursor===null?initialCount:offset+5);
    const dates=new Set(cursor===null?snapshot.entries.filter(h=>h.dueDate<=snapshot.end).map(h=>h.dueDate):selected.map(h=>h.dueDate));
    let partial=snapshot.partial;const items=[];
    for(const dueDate of new Set(selected.map(h=>h.dueDate))) {
      if(snapshot.details.has(dueDate))continue;
      try {
        const day=await this.request(path+'/'+dueDate+'.awp?verbe=get',{});
        if(Number(day.code)!==200||!Array.isArray(day.data?.matieres))throw new EdError('Détail indisponible.');
        snapshot.details.set(dueDate,day.data.matieres);
      }catch(e){if(e.status===401)throw e;partial=true;}
    }
    const status=h=>{
      const detail=snapshot.details.get(h.dueDate)?.find(m=>h.idDevoir!=null&&String(m.aFaire?.idDevoir??m.id)===String(h.idDevoir));
      return {detail,done:homeworkDone(detail?.aFaire?.effectue)??homeworkDone(h.effectue)};
    };
    for(const h of selected) {
      const {detail,done}=status(h);if(done===true)continue;
      const task=detail?.aFaire;if(!task)partial=true;
      items.push({id:h.key,dueDate:h.dueDate,subject:detail?.matiere||h.matiere||'Matière',text:homeworkText(task?.contenu),status:done===false?'pending':'unknown',exam:!!(detail?.interrogation??h.interrogation),documents:(Array.isArray(task?.documents)?task.documents:[]).map(d=>String(d.libelle||'Pièce jointe'))});
    }
    const homeworkDates=[...dates].sort().map(date=>{
      const rows=snapshot.entries.filter(h=>h.dueDate===date);
      return {date,total:rows.length,done:rows.filter(h=>status(h).done===true).length,unknown:rows.filter(h=>status(h).done===null).length};
    });
    const next=offset+selected.length;
    return {homework:items,homeworkDates,homeworkPartial:partial,homeworkNext:next<pending.length?next:null,homeworkUntil:snapshot.end};
  }
  exportSession() {
    if(this.state!=='authenticated' || this.pending || !this.token)return null;
    return {version:1,token:this.token,gtk:this.gtk,twoFa:this.twoFa,cookies:[...this.cookies],activeId:this.activeId,
      accounts:this.accounts.map(account=>({...sessionIdentity(account),idLogin:account.idLogin,main:account.main,typeCompte:account.typeCompte,
        profile:{classe:sessionIdentity(account.profile||{}).classe,photo:photoUrl(account.profile?.photo),eleves:(account.profile?.eleves||[]).map(sessionIdentity)}}))};
  }
  restoreSession(saved) {
    if(saved?.version!==1 || typeof saved.token!=='string' || !saved.token || !Array.isArray(saved.accounts) || !Array.isArray(saved.cookies) || !saved.cookies.every(p=>Array.isArray(p)&&p.length===2&&p.every(v=>typeof v==='string')))throw new Error('Session sauvegardée invalide.');
    this.clear();this.token=saved.token;this.gtk=saved.gtk;this.twoFa=saved.twoFa;
    this.cookies=new Map(saved.cookies);this.accounts=saved.accounts;this.activeId=saved.activeId;this.state='authenticated';
  }
  clear() { this.homeworkSnapshots?.clear(); this.cookies.clear(); this.gtk=undefined; this.token=undefined; this.twoFa=undefined; this.pending=undefined; this.accounts=[]; this.factors=[]; this.choices=[]; this.challenges=0; this.state='anonymous'; }
}
export function number(value) {
  if (typeof value==='number') return Number.isFinite(value)?value:null;
  if (typeof value!=='string' || !/^-?\d+(?:[.,]\d+)?$/.test(value.trim())) return null;
  return Number(value.trim().replace(',','.'));
}
// Le libellé d'une note peut désigner la sous-matière (Oral/Écrit).
function noteSubject(note,periods) {
 const code=String(note.codeMatiere||''),sub=String(note.codeSousMatiere||'');
 const disciplines=p=>Array.isArray(p.ensembleMatieres?.disciplines)?p.ensembleMatieres.disciplines:[];
 const local=periods.filter(p=>(p.codePeriode||p.idPeriode)===note.codePeriode).flatMap(disciplines);
 const all=periods.flatMap(disciplines);
 const label=d=>String(d.discipline||d.libelleMatiere||'').trim();
 const matches=d=>String(d.codeMatiere||'')===code;
 const parentMatch=d=>matches(d)&&!d.codeSousMatiere&&!d.sousMatiere;
 const uniqueLabel=rows=>{const labels=[...new Set(rows.map(label).filter(Boolean))];return labels.length===1?labels[0]:'';};
 const parent=uniqueLabel(local.filter(parentMatch))||uniqueLabel(all.filter(parentMatch));
 const subMatch=d=>matches(d)&&sub&&String(d.codeSousMatiere||'')===sub;
 const raw=String(note.libelleMatiere||'').trim();
 const generic=/^(oral|[ée]crit)$/i.test(raw);
 const hasSub=!!sub||generic;
 const parentSubject=parent||(!generic&&!sub?raw:'')||code||'Matière non précisée';
 const subSubject=hasSub?(String(note.libelleSousMatiere||'').trim()||uniqueLabel(local.filter(subMatch))||uniqueLabel(all.filter(subMatch))||(raw!==parentSubject?raw:'')):'';
 return {parentSubject,subSubject,subject:subSubject&&subSubject!==parentSubject?`${parentSubject} · ${subSubject}`:parentSubject};
}
export function normalizeNotes(data = {}) {
  const settings = data.parametrage || {};
  return {
    periods:(data.periodes || []).map(p=>({id:p.codePeriode || p.idPeriode,label:p.periode,annual:p.annuel,start:p.dateDebut,end:p.dateFin,average:settings.affichageMoyenne===false || settings.moyenneGenerale===false?null:number(p.ensembleMatieres?.moyenneGenerale),classAverage:settings.moyenneClasse===false?null:number(p.ensembleMatieres?.moyenneClasse)})),
    notes:settings.affichageNote===false?[]:(data.notes || []).map(n=>({id:n.id,...noteSubject(n,data.periodes||[]),subjectId:`${n.codeMatiere || n.libelleMatiere}:${n.codeSousMatiere || ''}`,title:n.devoir || n.typeDevoir || 'Évaluation',date:n.date,period:n.codePeriode,value:n.enLettre?null:number(n.valeur),raw:String(n.valeur ?? ''),outOf:number(n.noteSur),coefficient:number(n.coef) ?? 1,classAverage:settings.affichageMoyenneDevoir===false || settings.moyenneClasse===false?null:number(n.moyenneClasse),excluded:!!n.nonSignificatif || !!n.enLettre})),
  };
}

export function homeworkDone(value) {
  if(value===true || value===1 || value==='true' || value==='1') return true;
  if(value===false || value===0 || value==='false' || value==='0') return false;
  return null;
}
export function homeworkText(value) {
  if(typeof value!=='string' || !value) return '';
  const html=Buffer.from(value,'base64').toString('utf8');
  const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',eacute:'é',egrave:'è',agrave:'à',ecirc:'ê',ccedil:'ç',ocirc:'ô',ugrave:'ù',rsquo:'’',lsquo:'‘',ndash:'–',mdash:'—'};
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'')
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|li|h[1-6])>/gi,'\n').replace(/<[^>]*>/g,'')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(all,key)=>{
      if(key[0]!=='#') return entities[key] ?? all;
      const n=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));
      return n>0 && n<=0x10ffff?String.fromCodePoint(n):'';
    }).replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n').trim();
}

function sessionIdentity(s) {
  const classe=s.classe||s.profile?.classe;
  return {id:s.id,prenom:s.prenom,nom:s.nom,nomEtablissement:s.nomEtablissement,photo:photoUrl(s.photo||s.profile?.photo),classe:classe?{code:classe.code,libelle:classe.libelle}:undefined};
}
