import {nextSchoolDay} from './metrics.js';
export function demoData() {
  const names=['Gabriel','Louise','Arthur','Alice','Louis','Jeanne'];
  const classes=['Terminale','3e','5e','CM2','CE1','Grande section'];
  const subjects=['Mathématiques','Français','Histoire-géo','Anglais','Physique-chimie','SVT'];
  const today=new Date();const year=today.getMonth()<8?today.getFullYear()-1:today.getFullYear();
  const start=`${year}-09-01`,end=`${year+1}-07-10`;
  return {demo:true,updatedAt:today.toISOString(),children:names.map((name,c)=>{
    const notes=c===5?[]:Array.from({length:42},(_,i)=>{
      const subject=subjects[i%6], ago=2+Math.floor(i/6)*8+i%3;
      const date=new Date(today);date.setDate(today.getDate()-ago);
      const value=Math.min(20,Math.max(5,Math.round((13.6+c*.4+Math.sin(i*2.7+c)*3+(i<18?(c===2?-2:1.8):0))*2)/2));
      return {id:c*100+i,subject,subjectId:String(i%6),title:['Contrôle de connaissances','Évaluation de chapitre','Devoir maison','Expression écrite'][i%4],date:date.toISOString().slice(0,10),period:'demo',value,raw:String(value),outOf:20,coefficient:i%4===0?2:1,classAverage:Math.round((11.5+Math.sin(i)*1.5)*10)/10,excluded:false};
    });
    const homework=Array.from({length:3-c%3},(_,i)=>{
      const d=new Date(today);d.setDate(d.getDate()+i*2);if(i===0)d.setTime(new Date(nextSchoolDay(today)+'T12:00:00Z').getTime());
      return {id:'hw-'+c+'-'+i,dueDate:d.toLocaleDateString('en-CA'),subject:subjects[(c+i)%6],text:['Exercices 4 et 5 page 82. Justifier chaque réponse.','Relire le chapitre et apprendre les définitions.','Préparer une présentation orale de deux minutes.'][i],status:'pending',exam:i===1,documents:[]};
    });
    const homeworkDates=[...new Set(homework.map(h=>h.dueDate))].sort().map(date=>({date,done:4,total:4+homework.filter(h=>h.dueDate===date).length,unknown:0}));
    return {homework,homeworkDates,homeworkNext:null,id:'demo-'+c,name,className:classes[c],school:'Établissement de démonstration',notes,periods:[{id:'demo',label:'Période de démonstration',start,end,average:null,classAverage:null}]};
  })};
}
