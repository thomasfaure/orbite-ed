export const valid = n => !n.excluded && Number.isFinite(n.value) && Number.isFinite(n.outOf) && n.outOf>0 && Number.isFinite(n.coefficient) && n.coefficient>0;
export const score = n => n.value/n.outOf*20;
export function mean(notes, field=score) {
  let sum=0,weights=0;
  for(const n of notes.filter(valid)){const v=field(n);if(Number.isFinite(v)){sum+=v*n.coefficient;weights+=n.coefficient;}}
  return weights?sum/weights:null;
}
export function metrics(notes, now=new Date(), days=30) {
  const today=new Date(now);today.setHours(23,59,59,999);
  const end=today.getTime(),cut=end-days*86400000,begin=cut-days*86400000;
  const eligible=notes.filter(valid);
  const recent=eligible.filter(n=>new Date(n.date).getTime()>cut && new Date(n.date).getTime()<=end);
  const previous=eligible.filter(n=>new Date(n.date).getTime()>begin && new Date(n.date).getTime()<=cut);
  const a=mean(recent),b=mean(previous);
  const paired=eligible.filter(n=>Number.isFinite(n.classAverage));
  return {average:mean(eligible),trend:a!==null&&b!==null?a-b:null,recentCount:recent.length,previousCount:previous.length,gap:mean(paired,n=>score(n)-n.classAverage/n.outOf*20),classAverage:mean(paired,n=>n.classAverage/n.outOf*20),pairedCount:paired.length,count:eligible.length};
}
export function subjectGroups(notes) {
  const map=new Map();for(const n of notes){const k=n.subjectId || n.subject;if(!map.has(k))map.set(k,{id:k,label:n.subject,notes:[]});map.get(k).notes.push(n);}
  return [...map.values()].sort((a,b)=>a.label.localeCompare(b.label,'fr'));
}

export function isSecondary(className = '') {
  const label = String(className).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();
  if (/MATERNELLE|ELEMENTAIRE|PRIMAIRE|COURS MOYEN|COURS PREPARATOIRE|\b(?:CP|CE[12]?|CM[12]?|TPS|PS|MS|GS)\b/.test(label)) return false;
  return /\b(?:SIXIEME|CINQUIEME|QUATRIEME|TROISIEME|SECONDE|PREMIERE|TERMINALE|COLLEGE|LYCEE)\b/.test(label)
    || /^(?:[3456]\s*(?:EME|E|°|È)?|2\s*(?:NDE|DE|D)|1\s*(?:ERE|RE)|T(?:LE|ER|ERM)?)(?:\b|[A-Z0-9])/.test(label);
}
export function photoUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.startsWith('//') ? 'https:' + value : value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
    return url.hostname === 'ecoledirecte.com' || url.hostname.endsWith('.ecoledirecte.com') ? url.href : null;
  } catch { return null; }
}
export function gradeBand(note) {
  if (!Number.isFinite(note.value) || !Number.isFinite(note.outOf) || note.outOf <= 0 || note.excluded) return 'neutral';
  const normalized = score(note);
  return normalized >= 14 ? 'good' : normalized >= 10 ? 'average' : 'poor';
}

export function toTwenty(value, outOf) {
  return Number.isFinite(value) && Number.isFinite(outOf) && outOf > 0 ? value / outOf * 20 : null;
}

export function nextSchoolDay(now=new Date()) {
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const day=new Date(today+'T12:00:00Z');
 do {day.setUTCDate(day.getUTCDate()+1);} while([0,6].includes(day.getUTCDay()));
 return day.toISOString().slice(0,10);
}

// Regroupement par jour : aucun ordre artificiel entre évaluations le même jour.
export function gradeTimeline(notes,days=30) {
 const eligible=notes.filter(n=>valid(n)&&/^\d{4}-\d{2}-\d{2}/.test(n.date||'')&&Number.isFinite(Date.parse(n.date))).sort((a,b)=>a.date.localeCompare(b.date));
 return [...new Set(eligible.map(n=>n.date.slice(0,10)))].map(date=>{
  const daily=eligible.filter(n=>n.date.slice(0,10)===date);
  const end=Date.parse(date+'T23:59:59.999Z'),start=end-days*86400000;
  const rolling=eligible.filter(n=>Date.parse(n.date)>start&&Date.parse(n.date)<=end);
  const accumulated=eligible.filter(n=>n.date.slice(0,10)<=date);
  const paired=accumulated.filter(n=>Number.isFinite(n.classAverage));
  return {date,time:Date.parse(date+'T12:00:00Z'),notes:daily,average:mean(accumulated),classAverage:mean(paired,n=>n.classAverage/n.outOf*20),trend:rolling.length>=2?mean(rolling):null,count:rolling.length};
 });
}

export function weeklyNotes(notes,now=new Date()) {
 const end=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const startDate=new Date(end+'T12:00:00Z');startDate.setUTCDate(startDate.getUTCDate()-6);
 const start=startDate.toISOString().slice(0,10);
 const all=notes.filter(n=>valid(n)&&typeof n.date==='string'&&n.date.slice(0,10)>=start&&n.date.slice(0,10)<=end).sort((a,b)=>b.date.localeCompare(a.date));
 return {notes:all.slice(0,3),total:all.length,start,end};
}
