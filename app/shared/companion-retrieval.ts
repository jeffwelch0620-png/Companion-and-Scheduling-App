import type { ChatSource } from './companion-chat-types';
import type { WorkRecord, Workspace } from './types';
import { myWork } from './my-work';

const words=(value:string)=>value.toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]+/gu)??[];
const generic=new Set('the and for with from this that these those what when where which whose how why can could would should please help need want tell about into have has was were are not now next then still also just more through walk learn explain instructions instruction guide station closing close assignment work saved sample'.split(' '));
function label(r:WorkRecord):string{
  if(r.kind==='standard')return [r.data.title,r.data.position,r.data.zone].join(' ');
  if(r.kind==='close')return [r.data.standard.title,r.data.standard.position,r.data.standard.zone].join(' ');
  if(r.kind==='shift')return [r.data.position,r.data.stationName].filter(Boolean).join(' ');
  return 'title' in r.data&&typeof r.data.title==='string'?r.data.title:'';
}

// Rank only already-permitted records. Match short station names such as Fry,
// and keep the last cited work available for pronoun-only follow-ups. A newly
// named station takes priority over that conversation focus.
export function rankedCompanionRecords(w:Workspace,question:string,at:string,focus:ChatSource[]=[],explicitId?:string):WorkRecord[]{
  const tokens=[...new Set(words(question).filter(t=>t.length>=3&&!generic.has(t)))];
  const positions=new Set([w.me.position,...w.records.filter(r=>r.kind==='shift'&&r.ownerId===w.me.id&&r.data.published&&!r.data.cancelled&&Date.parse(r.data.end)>=Date.parse(at)&&Date.parse(r.data.start)<=Date.parse(at)+7*86400000).map(r=>(r.data as {position:string}).position)].map(p=>p.toLocaleLowerCase('en-US')));
  const candidates=w.records.filter(r=>['shift','leadership','close','task','handoff','goal','standard','order'].includes(r.kind));
  const hits=new Map(candidates.map(r=>{const set=new Set(words(label(r)));return [r.id,tokens.filter(t=>set.has(t)).length]}));
  const hasNamedMatch=candidates.some(r=>(hits.get(r.id)??0)>0);
  const ownWork=myWork(w,at),shiftGuides=new Set(ownWork.guides.map(g=>g.id));
  const phrase=' '+words(question).join(' ')+' ';
  const asksOwnShift=/\b(today|tonight|my(?:\s+[\w-]+){0,4}\s+shift|this shift|my station|my job)\b/i.test(question);
  const namedOther=candidates.some(r=>r.kind==='standard'&&!shiftGuides.has(r.id)&&phrase.includes(' '+words(r.data.position).join(' ')+' '))||candidates.some(r=>r.kind==='goal'&&r.data.title.length>5&&phrase.includes(' '+words(r.data.title).join(' ')+' '));
  const boundToShift=!explicitId&&asksOwnShift&&!namedOther&&!!(ownWork.shift||ownWork.ambiguous);
  const goalIds=new Set(ownWork.relatedGoals.map(g=>g.id));
  const useShift=!hasNamedMatch&&(!focus.length||/\b(today|tonight|shift|my station|my job|next step|should i|need to|opening|closing)\b/i.test(question));
  const score=(r:WorkRecord)=>{
    const match=hits.get(r.id)??0;
    const standardPosition=r.kind==='standard'?r.data.position:r.kind==='close'?r.data.standard.position:'';
    return match*100+Number(match>0&&r.kind==='standard')*100
      +Number(useShift&&shiftGuides.has(r.id))*350
      +Number(focus.some(s=>s.id===r.id&&s.revision===r.revision))*(hasNamedMatch?10:300)
      +Number(r.ownerId===w.me.id)*40+Number(r.kind==='close')*15+Number(r.kind==='goal'&&/\bgoals?\b/i.test(question))*80
      +Number(positions.has(standardPosition.toLocaleLowerCase('en-US')))*(r.kind==='standard'?70:30);
  };
  // A missing station method must stay missing. Do not pad a personal shift
  // answer with another station's guide, including methods embedded in goals.
  return candidates.filter(r=>!boundToShift||(r.kind==='standard'?shiftGuides.has(r.id):r.kind==='goal'?goalIds.has(r.id):r.kind==='close'?r.data.shiftId===ownWork.shift?.id||!['closed','cancelled'].includes(r.data.phase)&&(r.ownerId===w.me.id||r.data.correction?.personId===w.me.id||r.data.managerId===w.me.id||r.data.verifierId===w.me.id):true)).sort((a,b)=>score(b)-score(a)||a.id.localeCompare(b.id));
}
