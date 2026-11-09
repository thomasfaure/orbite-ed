import {askAI} from './ai.js';
import {coachingContext,coachingPrompt,createCoachingCache} from './coaching.js';
import {demoData} from './demo.js';
import {metrics,toTwenty,score,valid,subjectGroups,isSecondary,photoUrl,gradeBand,nextSchoolDay,gradeTimeline,weeklyNotes} from './metrics.js';
const $=s=>document.querySelector(s), app=$('#app');
let data=null, selected='all', subject='', period='all', days=30, search='', authState='anonymous', busy=false, homeworkLoading=false, authBusy=false, generation=0;
let sidebarCollapsed=false;
try{sidebarCollapsed=localStorage.getItem('orbite-sidebar-collapsed')==='1';}catch{}
const coachingCache=createCoachingCache(askAI);
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number.isFinite(n)?n.toLocaleString('fr-FR',{maximumFractionDigits:2,minimumFractionDigits:1}):'—';
const delta=n=>Number.isFinite(n)?`${n>0?'+':''}${fmt(n)}`:'—';
const tone=n=>n===null?'muted':n>=0?'up':'down';
const arrow=n=>n===null?'·':Math.abs(n)<.05?'→':n>0?'↗':'↘';
const date=v=>{const d=new Date(v);return Number.isNaN(+d)?'—':d.toLocaleDateString('fr-FR',{day:'numeric',month:'short'});};
const icon={overview:'◫',notes:'▤',progress:'⌁',help:'ⓘ'};
async function api(path,body){const r=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-Orbite-Client':'1'},body:body===undefined?undefined:JSON.stringify(body)});const result=await r.json();if(!r.ok){if(r.status===401){generation++;busy=false;homeworkLoading=false;data=null;authState='anonymous';render();openAuth();}throw Object.assign(new Error(result.error || 'Une erreur est survenue.'),{status:r.status});}return result;}
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');setTimeout(()=>$('#toast').classList.remove('show'),5000);}
function avatar(child, mini=false) {
 const photo=photoUrl(child.photo);
 return `<span class="avatar child-avatar ${mini?'mini':''}" title="${photo?'Photo ÉcoleDirecte':'Photo indisponible'}"><span>${e(child.name.slice(0,1))}</span>${photo?`<img src="${e(photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:''}</span>`;
}
app.addEventListener('error', event=>{if(event.target.matches?.('.child-avatar img')) event.target.remove();}, true);
function currentNotes(child){return child.notes.filter(n=>period==='all'||n.period===period);}
function spark(notes,cls='spark'){
  const list=gradeTimeline(notes,days);
  if(!list.length)return '<div class="spark-empty">Aucune moyenne disponible.</div>';
  const start=list[0].time,end=list.at(-1).time;
  const values=list.flatMap(p=>[p.average,p.classAverage,p.trend]).filter(Number.isFinite);
  const ymax=Math.max(20,Math.ceil(Math.max(...values)/5)*5),ymin=Math.min(0,Math.floor(Math.min(...values)/5)*5);
  const x=t=>start===end?138:8+(t-start)/(end-start)*260;
  const y=v=>64-(v-ymin)/(ymax-ymin)*54;
  const points=list.map(p=>`${x(p.time)},${y(p.average)}`).join(' ');
  return `<svg class="${cls}" viewBox="0 0 276 72" role="img" aria-label="Évolution de la moyenne cumulée de l’élève sur 20"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>${list.length===1?`<circle cx="138" cy="${y(list[0].average)}" r="3" fill="currentColor"/>`:''}</svg>`;
}
function detailedChart(child) {
 const points=gradeTimeline(currentNotes(child),days);
 if(!points.length)return '<section class="panel detailed-chart"><h2>Évolution des résultats</h2><p class="muted">Aucune note chiffrée datée pour cette période.</p></section>';
 const left=58,right=930,top=24,bottom=300;
 const start=points[0].time,end=points.at(-1).time;
 const x=t=>start===end?(left+right)/2:left+(t-start)/(end-start)*(right-left);
 const values=points.flatMap(p=>[p.average,p.classAverage,p.trend]).filter(Number.isFinite);
 const ymax=Math.max(20,Math.ceil(Math.max(...values)/5)*5),ymin=Math.min(0,Math.floor(Math.min(...values)/5)*5);
 const y=v=>bottom-(v-ymin)/(ymax-ymin)*(bottom-top);
 const label=d=>new Date(d+'T12:00:00Z').toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'2-digit',timeZone:'UTC'});
 const line=(field,cls)=>{
  let active=false;const path=points.map(p=>{if(p[field]===null){active=false;return '';}const part=`${active?'L':'M'}${x(p.time)},${y(p[field])}`;active=true;return part;}).join(' ');
  return `<path class="${cls}" d="${path}"/>`+points.filter(p=>p[field]!==null).map(p=>`<circle class="${cls}" cx="${x(p.time)}" cy="${y(p[field])}" r="3"><title>${e(label(p.date))} · ${field==='trend'?`Tendance ${days} jours (${p.count} notes)`:field==='classAverage'?'Moyenne cumulée de classe':'Moyenne cumulée de l’élève'} : ${fmt(p[field])}/20</title></circle>`).join('');
 };
 const ticks=Array.from({length:6},(_,i)=>start+(end-start)*i/5).filter((t,i)=>start!==end||i===0);
 let grid='';for(let v=ymin;v<=ymax;v+=5)grid+=`<line x1="${left}" x2="${right}" y1="${y(v)}" y2="${y(v)}" class="chart-grid"/><text x="${left-12}" y="${y(v)+4}" text-anchor="end">${v}</text>`;
 return `<section class="panel detailed-chart" aria-label="Évolution des notes de ${e(child.name)}"><div class="panel-heading"><h2>Évolution des résultats</h2><span class="muted">Notes sur 20</span></div><div class="chart-key"><span class="key-student">Moyenne de l’élève</span><span class="key-class">Moyenne cumulée de classe</span><span class="key-trend">Tendance sur ${days} jours</span></div><div class="chart-scroll" tabindex="0" role="region" aria-label="Graphique défilant horizontalement sur petit écran"><svg class="grade-chart" viewBox="0 0 960 350" role="img" aria-label="Notes et moyennes de classe par date, tendance pondérée sur ${days} jours"><title>Évolution des résultats sur la période sélectionnée</title>${grid}<path d="M${left} ${top}V${bottom}H${right}" class="chart-axis"/>${ticks.map(t=>`<text x="${x(t)}" y="325" text-anchor="middle">${e(label(new Date(t).toISOString().slice(0,10)))}</text>`).join('')}${line('average','series-student')}${line('classAverage','series-class')}${line('trend','series-trend')}</svg></div><p class="chart-explanation">Chaque point représente la moyenne cumulée depuis le début de la période sélectionnée, pondérée par les coefficients. La courbe de classe cumule les moyennes des mêmes évaluations lorsqu’elles sont disponibles ; ce n’est pas la moyenne générale officielle de la classe. La tendance est une moyenne glissante pondérée par les coefficients sur ${days} jours, à partir de deux notes ; ce n’est pas une prévision.${points.some(p=>p.classAverage!==null)?'':' Moyennes de classe indisponibles.'} Survolez les points pour les détails.</p></section>`;
}
function homeworkPanel(child) {
 const list=child.homework || [], urgent=nextSchoolDay();
 const dates=child.homeworkDates || [...new Set(list.map(h=>h.dueDate))].sort().map(date=>({date,total:null,done:null}));
 return `<section class="homework" data-homework-id="${e(child.id)}" aria-label="Devoirs de ${e(child.name)}"><div class="homework-heading"><h3>Devoirs à faire</h3>${Array.isArray(child.homework)?`<span class="count">${list.length}</span>`:''}</div>
 ${child.homeworkLoading?'<p class="inline-loading" role="status"><span class="spinner" aria-hidden="true"></span>Chargement des devoirs…</p>':child.homeworkError?`<p class="homework-warning" role="status">${e(child.homeworkError)}</p>`:!Array.isArray(child.homework)?'<p class="muted">Devoirs en attente de chargement.</p>':`
 <p class="homework-caption">${child.homeworkDates?'30 prochains jours · progression déclarée sur ÉcoleDirecte':'Redémarrez le serveur pour activer la pagination et la progression.'}</p>
 ${child.homeworkPartial?'<p class="homework-warning">Certains détails sont indisponibles.</p>':''}
 ${dates.map(group=>{
 const tasks=list.filter(h=>h.dueDate===group.date);
 const label=new Date(group.date+'T12:00:00Z').toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',timeZone:'Europe/Paris'});
 return `<div class="homework-day"><div class="homework-date">${group.total!==null?`<span class="homework-progress" title="${group.done} devoirs cochés comme faits sur ${group.total}"><progress max="${group.total||1}" value="${group.done}" aria-label="Devoirs faits le ${e(label)}"></progress><span>${group.done}/${group.total}</span></span>`:''}<time datetime="${e(group.date)}">${e(label)}</time></div>
 ${group.unknown?'<p class="homework-caption">Certains statuts ne sont pas renseignés.</p>':''}
 ${tasks.length?`<ul class="homework-list">${tasks.map(h=>`<li class="${h.dueDate===urgent?'homework-urgent':''}"><div class="homework-meta"><strong>${e(h.subject)}</strong>${h.dueDate===urgent?'<span class="urgent-label">Pour le prochain jour de semaine</span>':''}</div>${h.exam?'<span class="homework-tag">Évaluation à préparer</span>':''}${h.status==='unknown'?'<span class="homework-tag">Statut non renseigné</span>':''}<p class="homework-text">${e(h.text||'Consigne indisponible : consulter le cahier de textes.')}</p>${h.documents?.length?`<p class="homework-caption">Sur ÉcoleDirecte : ${h.documents.map(e).join(', ')}</p>`:''}</li>`).join('')}</ul>`:group.done===group.total?'<p class="homework-complete">Tous les devoirs sont cochés comme faits.</p>':'<p class="homework-caption">Autres devoirs disponibles avec « En voir plus ».</p>'}</div>`;
 }).join('') || '<p class="muted">Aucun devoir sur les 30 prochains jours.</p>'}
 ${child.homeworkMoreError?`<p class="homework-warning" role="status">${e(child.homeworkMoreError)}</p>`:''}
 ${child.homeworkNext!=null?`<button class="small-button homework-more" data-more-homework="${e(child.id)}" ${homeworkLoading||child.homeworkMoreLoading?'disabled':''}>${child.homeworkMoreLoading?'Chargement…':'En voir plus'}<span> · 5 devoirs</span></button>`:''}`}
 <a class="homework-link" href="https://www.ecoledirecte.com/" target="_blank" rel="noopener noreferrer">Ouvrir ÉcoleDirecte ↗</a></section>`;
}
function coachingPanel(child) {
 return `<div class="student-coaching" data-coaching-id="${e(child.id)}" aria-live="polite"><small>Conseil personnalisé · IA</small><p role="status">Préparation du conseil…</p></div>`;
}
async function loadCoaching() {
 const snapshot=data,run=generation,viewPeriod=period,viewDays=days;
 if(!snapshot){coachingCache.clear();return;}
 const current=()=>data===snapshot&&generation===run&&period===viewPeriod&&days===viewDays;
 for(const child of snapshot.children) {
  if(!current())return;
  const panel=[...app.querySelectorAll('[data-coaching-id]')].find(p=>p.dataset.coachingId===child.id);
  if(!panel)continue;
  const context=coachingContext(child,viewPeriod,viewDays);
  let text;
  if(snapshot.demo)text='Mode démonstration : les conseils IA sont disponibles après connexion.';
  else if(child.error)text='Les résultats sont indisponibles pour préparer un conseil fiable.';
  else if(!context.count)text='Pas encore assez de notes pour préparer ton conseil.';
  else {
   const prompt=coachingPrompt(context);
   try {text=await coachingCache.get(child.id+':'+prompt,prompt,current);}
   catch {text='Conseil indisponible pour le moment. Les résultats restent consultables.';}
  }
  if(!current())return;
  // Retrouver le bloc : un changement de filtre peut avoir remplacé le DOM.
  const target=[...app.querySelectorAll('[data-coaching-id]')].find(p=>p.dataset.coachingId===child.id);
  if(target){const paragraph=target.querySelector('p');paragraph.textContent=text;paragraph.title=text;}
 }
}
function weeklyNotesPanel(child) {
 const week=weeklyNotes(child.notes);
 return `<span class="weekly-notes"><span class="weekly-heading">7 derniers jours <small>${date(week.start)} – ${date(week.end)}</small></span>${week.notes.length?week.notes.map(n=>`<span class="weekly-note" title="${e(n.title||n.subject)}"><span class="weekly-subject" title="${e(n.subject)}">${e(n.subject)}</span><time datetime="${e(n.date.slice(0,10))}">${date(n.date)}</time><strong class="grade-${gradeBand(n)}">${fmt(toTwenty(n.value,n.outOf))}<small>/20</small></strong></span>`).join(''):'<span class="weekly-empty">Aucune note sur ces 7 jours.</span>'}${week.total>3?`<span class="weekly-more">+ ${week.total-3} autre${week.total-3>1?'s':''} dans le tableau des notes</span>`:''}</span>`;
}
function card(child,i){const notes=currentNotes(child),m=metrics(notes,new Date(),days);const p=child.periods.find(p=>p.id===period);const average=p?.average??m.average;const official=p?.average!==null&&p?.average!==undefined;
 return `<article class="student-summary ${selected===child.id?'is-selected':''}"><button class="child-card ${selected===child.id?'selected':''} accent-${i%6}" data-child="${e(child.id)}"><div class="card-heading">${avatar(child)}<span class="child-name">${e(child.name)}<small>${e(child.className || 'Classe non renseignée')}</small></span><span class="card-arrow">↗</span></div><div class="card-score">${fmt(average)}<span>/20</span></div><span class="score-label">${official?'Moyenne officielle':'Moyenne indicative des notes'}</span>${selected===child.id?'':spark(notes)}<div class="card-bottom"><span class="${tone(m.trend)}">${arrow(m.trend)} ${delta(m.trend)} <small>pt</small></span><span>${m.count} notes</span></div><div class="class-gap">${child.error?`<span class="down">${e(child.error)}</span>`:m.gap===null?`<span class="muted">${m.count?'Moyenne de classe indisponible':'Pas encore de notes chiffrées'}</span>`:`<span class="${tone(m.gap)}">${delta(m.gap)} pt</span> par rapport à la classe`}</div>${weeklyNotesPanel(child)}</button>${coachingPanel(child)}${selected===child.id?detailedChart(child):''}${homeworkPanel(child)}</article>`;
}
function render(){
 const children=(data?.children||[]).filter(c=>isSecondary(c.className)), focus=children.filter(c=>selected==='all'||c.id===selected), all=focus.flatMap(c=>currentNotes(c).map(n=>({...n,child:c})));
 const periods=[...new Map(focus.flatMap(c=>c.periods.map(p=>[p.id,p]))).values()];
 const recent=all.filter(n=>+new Date(n.date)>Date.now()-days*86400000 && +new Date(n.date)<=Date.now());
 const growing=focus.filter(c=>metrics(currentNotes(c),new Date(),days).trend>0).length;
 const alerts=focus.flatMap(c=>subjectGroups(currentNotes(c)).map(s=>({...s,child:c,m:metrics(s.notes,new Date(),days)}))).filter(s=>s.m.trend!==null&&s.m.trend<=-1).sort((a,b)=>a.m.trend-b.m.trend);
 app.classList.toggle('sidebar-collapsed',sidebarCollapsed);
 app.innerHTML=`<aside id="sidebar"><a class="brand" href="/" aria-label="Accueil Orbite"><img src="/favicon.svg" alt=""><span>orbite<span class="brand-dot">.</span></span></a><div class="workspace">SUIVI SCOLAIRE<span>LOCAL</span></div><nav><button class="nav active" data-nav="overview">${icon.overview}<span>Vue d’ensemble</span></button><button class="nav" data-nav="grades">${icon.notes}<span>Toutes les notes</span></button><button class="nav" data-nav="children">${icon.progress}<span>Progression</span></button></nav><div class="nav-label">ÉLÈVES <span>${children.length || '—'}</span></div><div class="children-nav">${children.map((c,i)=>`<button class="child-nav ${selected===c.id?'active':''}" data-child="${e(c.id)}">${avatar(c,true)}${e(c.name)}<small>${e(c.className)}</small></button>`).join('') || '<p class="fine">Aucun élève connecté.</p>'}</div><div class="aside-bottom"><div class="privacy"><span>◈</span><div>Accès local<small>Réseau familial</small></div></div><button class="nav" data-action="method">${icon.help}<span>Méthode de calcul</span></button><div class="user"><div class="avatar mini">F</div><div>Espace parents<small>${data?.demo?'Démonstration':data?'ÉcoleDirecte connecté':'Compte à connecter'}</small></div><button class="icon-button" data-action="${data&&!data.demo?'logout':'login'}" aria-label="${data&&!data.demo?'Déconnexion':'Connexion'}">${data&&!data.demo?'⏻':'↗'}</button></div></div></aside>
 <main id="overview"><header><button class="sidebar-toggle" data-action="toggle-sidebar" aria-controls="sidebar" aria-expanded="${!sidebarCollapsed}" aria-label="${sidebarCollapsed?'Déplier':'Replier'} la navigation" title="${sidebarCollapsed?'Déplier':'Replier'} la navigation">☰</button><div class="breadcrumb">Famille <span>/</span> ${selected==='all'?'Vue d’ensemble':e(focus[0]?.name || '')}</div><div class="header-right">${data?.demo?'<span>MODE DÉMO</span>':''}<button class="small-button" ${data&&!data.demo&&(busy||homeworkLoading)?'disabled':''} data-action="${data&&!data.demo?'refresh':'login'}">${data&&!data.demo?(busy?'Chargement des notes…':homeworkLoading?'Chargement des devoirs…':'↻ Actualiser'):'Connecter ÉcoleDirecte ↗'}</button></div></header>
 ${selected!=='all'?`<section class="heading compact-heading"><h1>Résultats de ${e(focus[0]?.name || '')}</h1></section>`:''}
 ${!data?welcome():`<div class="toolbar"><div class="tabs"><button class="${selected==='all'?'active':''}" data-child="all">Toute la famille</button>${focus.length===1?`<span>${e(focus[0].name)}</span>`:''}</div><div class="filters"><label class="sr-only" for="period">Période scolaire</label><select id="period"><option value="all">Toutes les périodes</option>${periods.map(p=>`<option value="${e(p.id)}" ${period===p.id?'selected':''}>${e(p.label)}</option>`).join('')}</select><label class="sr-only" for="window">Fenêtre de progression</label><select id="window"><option value="30" ${days===30?'selected':''}>Tendance sur 30 jours</option><option value="14" ${days===14?'selected':''}>Tendance sur 14 jours</option></select></div></div>
 <div class="section-heading"><h2>${selected==='all'?'Résultats par élève':'Synthèse'}</h2></div><section class="cards ${selected!=='all'?'individual-cards':''}" id="children">${focus.map(c=>card(c,children.indexOf(c))).join('') || '<div class="empty">Aucun enfant au collège ou au lycée rattaché à ce compte.</div>'}</section>
 <section class="analysis-grid"><article class="panel focus-panel"><h2>Baisses récentes par matière</h2>${alerts.length?alerts.slice(0,3).map(a=>`<button class="insight" data-focus="${e(a.child.id)}" data-subject="${e(a.id)}"><span class="insight-dot down">↘</span><span><strong>${e(a.child.name)} · ${e(a.label)}</strong><small>${delta(a.m.trend)} pt sur ${days} jours · ${a.m.recentCount} notes récentes</small></span><span>↗</span></button>`).join(''):`<p class="muted">${all.length?'Aucune baisse d’au moins un point sur les matières comparables.':'Données insuffisantes pour calculer une évolution.'}</p>`}</article></section>
 <section class="panel grades-panel" id="grades"><div class="panel-heading"><div><h2>Toutes les notes <span class="count">${all.length}</span></h2></div><div class="filters"><label class="sr-only" for="search">Rechercher une note</label><input id="search" type="search" placeholder="Rechercher une évaluation…" value="${e(search)}"><label class="sr-only" for="subject">Matière</label><select id="subject"><option value="">Toutes les matières</option>${subjectGroups(all).map(s=>`<option value="${e(s.id)}" ${subject===s.id?'selected':''}>${e(s.label)}</option>`).join('')}</select></div></div><div class="table-scroll"><table><thead><tr><th>Enfant / Évaluation</th><th>Matière</th><th>Date</th><th>Note /20</th><th>Classe /20</th><th>Écart /20</th><th>Coef.</th></tr></thead><tbody id="rows"></tbody></table></div><div class="grade-legend"><span class="grade-good">● Bonnes ≥ 14/20</span><span class="grade-average">● Moyennes ≥ 10 et &lt; 14/20</span><span class="grade-poor">● Notes &lt; 10/20</span><span>Toutes les notes et moyennes de classe sont ramenées sur 20.</span></div><div class="table-footer"><span id="resultCount"></span><span>Les notes ABS, dispensées ou non significatives restent visibles, hors calcul.</span></div></section>
 <details class="method" id="method"><summary>Comment lire ces indicateurs ?</summary><p>Les moyennes indicatives sont calculées à partir des notes chiffrées ramenées sur 20 et pondérées par leur coefficient. Elles ne remplacent pas le bulletin : la pondération par matière et les règles de l’établissement peuvent différer. Une moyenne officielle est affichée lorsqu’une période précise est sélectionnée et qu’ÉcoleDirecte la fournit.</p><p>La tendance compare les ${days} derniers jours aux ${days} jours précédents, à l’intérieur de la période sélectionnée. Le nombre et la difficulté des évaluations peuvent varier. Sans note dans les deux fenêtres, le résultat reste indisponible. L’écart à la classe compare uniquement les évaluations disposant des deux notes, sur le même barème. Un tiret signifie « donnée indisponible », jamais zéro.</p><p>Les points d’attention correspondent à une baisse d’au moins un point dans une matière. Ils servent à ouvrir une discussion, sans classer les enfants entre eux. La moyenne de classe n’est pas affichée lorsqu’elle n’est pas disponible ou que son affichage est désactivé dans les paramètres remontés.</p></details>`}
 <footer><span>Orbite</span><span>${data?`Dernière ${data.demo?'simulation':'synchronisation'} : ${new Date(data.updatedAt).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}`:'Client indépendant, non affilié à ÉcoleDirecte'}</span></footer></main>`;
 if(data)renderRows(all);
 void loadCoaching();
 $('#period')?.addEventListener('change',event=>{period=event.target.value;subject='';render();});
 $('#window')?.addEventListener('change',event=>{days=Number(event.target.value);render();});
 $('#subject')?.addEventListener('change',event=>{subject=event.target.value;renderRows(all);});
 $('#search')?.addEventListener('input',event=>{search=event.target.value;renderRows(all);});
}
function welcome(){if(busy)return '<section class="welcome loading-state" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span><h2>Chargement du tableau de bord…</h2><p>Récupération des notes. Les devoirs seront chargés ensuite.</p></section>';return `<section class="welcome"><div><h2>Connexion ÉcoleDirecte</h2><p>Connectez votre compte parent pour consulter les notes et moyennes de classe.</p><div class="welcome-actions"><button class="primary" data-action="login">Se connecter</button><button class="secondary" data-action="demo">Mode démonstration</button></div></div></section>`;}
function renderRows(all){const query=search.toLocaleLowerCase('fr-FR');const filtered=all.filter(n=>(!subject||n.subjectId===subject)&&`${n.title} ${n.subject} ${n.child.name}`.toLocaleLowerCase('fr-FR').includes(query)).sort((a,b)=>(b.date||'').localeCompare(a.date||''));$('#rows').innerHTML=filtered.map(n=>{const value20=toTwenty(n.value,n.outOf), class20=toTwenty(n.classAverage,n.outOf);const gap=valid(n)&&class20!==null?value20-class20:null;return `<tr><td><div class="grade-student">${avatar(n.child,true)}<div><strong>${e(n.child.name)}</strong><small>${e(n.title)}</small></div></div></td><td><span class="subject-chip">${e(n.subject)}</span></td><td class="muted nowrap">${date(n.date)}</td><td class="note-value grade-${gradeBand(n)}" title="${({good:'Bonne note · au moins 14/20',average:'Note moyenne · de 10 à moins de 14/20',poor:'Note faible · moins de 10/20',neutral:'Hors classement'})[gradeBand(n)]}">${n.value===null?e(n.raw || '—'):fmt(value20)}<small>${value20!==null?' / 20':''}${n.excluded?' · hors calcul':''}</small></td><td class="class-value" title="Moyenne de classe ramenée sur 20">${fmt(class20)}<small>${class20!==null?' / 20':''}</small></td><td><span class="gap ${tone(gap)}">${arrow(gap)} ${delta(gap)}</span></td><td class="muted">${fmt(n.coefficient)}</td></tr>`;}).join('')||'<tr><td colspan="7" class="empty">Aucune note pour cette sélection.</td></tr>';$('#resultCount').textContent=`${filtered.length} évaluation${filtered.length>1?'s':''}`;}
function openAuth(){authState='anonymous';$('#loginForm').hidden=false;$('#verifyForm').hidden=true;$('#authError').textContent='';if(!$('#auth').open)$('#auth').showModal();}
function updateRefresh() {
 const button=app.querySelector('[data-action="refresh"]');
 app.querySelectorAll('[data-more-homework]').forEach(b=>{b.disabled=busy||homeworkLoading;});
 if(button){button.disabled=busy||homeworkLoading;button.textContent=busy?'Chargement des notes…':homeworkLoading?'Chargement des devoirs…':'↻ Actualiser';}
}
function updateHomework(child) {
 const panel=[...app.querySelectorAll('[data-homework-id]')].find(p=>p.dataset.homeworkId===child.id);
 if(panel)panel.outerHTML=homeworkPanel(child);
}
async function loadHomework(snapshot,run) {
 try {
  for(const child of snapshot.children) {
   if(run!==generation || data!==snapshot)return;
   try {const result=await api('homework',{childId:child.id});if(run!==generation || data!==snapshot)return;Object.assign(child,result);}
   catch(err){if(run!==generation || data!==snapshot)return;child.homeworkError=err.message;if(err.status===401)return;}
   child.homeworkLoading=false;updateHomework(child);
  }
 } finally {if(run===generation){homeworkLoading=false;updateRefresh();}}
}
async function moreHomework(child) {
 if(busy||homeworkLoading||child.homeworkNext==null)return;
 const snapshot=data,run=generation;homeworkLoading=true;child.homeworkMoreLoading=true;child.homeworkMoreError='';updateHomework(child);updateRefresh();
 try {
  const result=await api('homework',{childId:child.id,cursor:child.homeworkNext});
  if(run!==generation||data!==snapshot)return;
  child.homework=[...new Map([...child.homework,...result.homework].map(h=>[h.id,h])).values()];
  child.homeworkDates=[...new Map([...(child.homeworkDates||[]),...result.homeworkDates].map(g=>[g.date,g])).values()].sort((a,b)=>a.date.localeCompare(b.date));
  child.homeworkNext=result.homeworkNext;child.homeworkPartial ||= result.homeworkPartial;
 }catch(err){if(run===generation)child.homeworkMoreError=err.message;}
 finally {if(run===generation){homeworkLoading=false;child.homeworkMoreLoading=false;updateHomework(child);updateRefresh();}}
}
async function load(){
 if(busy||homeworkLoading)return;
 busy=true;const run=++generation;
 if(!data || data.demo){data=null;render();}else updateRefresh();
 try {
  const snapshot=await api('dashboard',{});
  if(run!==generation)return;
  snapshot.children=snapshot.children.filter(c=>isSecondary(c.className));
  snapshot.children.forEach(c=>{c.homeworkLoading=true;});
  data=snapshot;
  if(selected!=='all'&&!data.children.some(c=>c.id===selected))selected='all';
  busy=false;homeworkLoading=snapshot.children.length>0;render();
  toast('Les notes sont à jour.');
  void loadHomework(snapshot,run);
 }catch(err){if(run===generation){busy=false;render();toast(err.message);}}
 finally{busy=false;updateRefresh();}
}
async function acceptAuth(result){authState=result.state;if(authState==='authenticated'){$('#auth').close();$('#loginForm').reset();selected='all';period='all';await load();return;}$('#loginForm').hidden=true;$('#verifyForm').hidden=false;$('#question').textContent=result.question || 'Code de double authentification';$('#choices').innerHTML=authState==='totp'?'<label>Code à six chiffres<input name="code" required inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="000000"></label>':result.choices.map((c,i)=>`<label class="choice"><input type="radio" name="choice" value="${i}" required> ${e(c)}</label>`).join('');$('#choices input')?.focus();}
function setAuthLoading(active) {
 authBusy=active;
 $('#authLoading').hidden=!active;
 $('#loginForm').hidden=active||['question','totp'].includes(authState);
 $('#verifyForm').hidden=active||!['question','totp'].includes(authState);
 $('#closeAuth').disabled=active;
 $('#auth').setAttribute('aria-busy',String(active));
}
async function submit(event,route){
 event.preventDefault();if(authBusy)return;
 const form=event.target,fields=new FormData(form);
 $('#authError').textContent='';setAuthLoading(true);
 try{
  const payload=route==='login'?{username:fields.get('username'),password:fields.get('password')}:authState==='totp'?{code:fields.get('code')}:{choice:Number(fields.get('choice'))};
  const result=await api(route,payload);
  if(route==='login')form.reset();
  setAuthLoading(false);
  await acceptAuth(result);
 }catch(err){$('#authError').textContent=err.message;}
 finally{setAuthLoading(false);}
}
$('#auth').addEventListener('cancel',event=>{if(authBusy)event.preventDefault();});
$('#loginForm').addEventListener('submit',ev=>submit(ev,'login'));$('#verifyForm').addEventListener('submit',ev=>submit(ev,'verify'));
$('#closeAuth').addEventListener('click',()=>$('#auth').close());
$('#auth').addEventListener('close',()=>{$('#loginForm').reset();$('#verifyForm').reset();if(['question','totp'].includes(authState)){api('logout',{}).catch(()=>{});authState='anonymous';}});
app.addEventListener('click',async event=>{
 const more=event.target.closest('[data-more-homework]');if(more){const target=data?.children.find(c=>c.id===more.dataset.moreHomework);if(target)await moreHomework(target);return;}
 const child=event.target.closest('[data-child]');if(child){selected=child.dataset.child;subject='';period='all';render();return;}
 const focus=event.target.closest('[data-focus]');if(focus){selected=focus.dataset.focus;subject=focus.dataset.subject;render();$('#grades').scrollIntoView({behavior:'smooth'});return;}
 const nav=event.target.closest('[data-nav]');if(nav){if(nav.dataset.nav==='overview'){selected='all';subject='';render();}document.getElementById(nav.dataset.nav)?.scrollIntoView({behavior:'smooth'});return;}
 const action=event.target.closest('[data-action]')?.dataset.action;
 if(action==='toggle-sidebar'){sidebarCollapsed=!sidebarCollapsed;try{localStorage.setItem('orbite-sidebar-collapsed',sidebarCollapsed?'1':'0');}catch{}render();return;}
 if(action==='login')openAuth();
 if(action==='demo'){generation++;homeworkLoading=false;data=demoData();data.children=data.children.filter(c=>isSecondary(c.className));selected='all';period='all';subject='';render();}
 if(action==='refresh')await load();
 if(action==='logout'){try{await api('logout',{});generation++;homeworkLoading=false;data=null;selected='all';authState='anonymous';render();}catch(err){toast(err.message);}}
 if(action==='method'){if($('#method')){$('#method').open=true;$('#method').scrollIntoView({behavior:'smooth'});}else toast('Connectez votre compte ou explorez la démo pour voir les indicateurs.');}
});
render();
try {const session=await api('session');if(session.state==='authenticated'){authState=session.state;await load();}}catch(err){toast(err.message);}
