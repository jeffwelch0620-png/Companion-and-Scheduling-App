import {type Member,type Workspace,type WorkRecord} from './types';
import {visible} from './domain';
import {localDate} from './local-time';
import {operationsManager} from './operations';
import {ideaReviewer} from './staff-ideas';
import {guestManager,guestOwner} from './guest-reviews';
import {hireCoordinator,hireScheduler,hireEvidence} from './hire-handoff';
import {hireChecklistCurrent} from './hire-checklist';
import {complianceManager,complianceRenewalState} from './compliance';
import {promotionEditor,promotionManager,promotionOwner} from './promotions';

export const followupAreas={staffidea:'Staff ideas',guestreview:'Guest reviews',hirechecklist:'Onboarding checklist',hirehandoff:'First-shift handoff',compliance:'Inspections and permits',promotion:'Promotions'} as const;
export type FollowupKind=keyof typeof followupAreas;
export type FollowupEntry={id:string;kind:FollowupKind;tab:string;title:string;area:string;nextStep:string;mode:'your-step'|'waiting'|'review';date:string|null;dateLabel:string;dateMeaning:'due'|'target'|'event';timing:'past'|'today'|'upcoming'|'no-date';overdue:boolean;responsibleId:string|null};
export function followupReader(me:Member){return !me.scheduleOnly&&me.position!=='Dishwasher'&&(operationsManager(me)||hireCoordinator(me)||hireScheduler(me));}
// Only minimal summaries of already authorized active records. No Food scan,
// private bodies, source documents, employee assessments or notification writes.
export function followupDesk(w:Workspace,now:string):FollowupEntry[]{
 if(!followupReader(w.me)||w.me.locationId!==w.location.id)return [];
 const today=localDate(now,w.location.timezone),rows:FollowupEntry[]=[],me=w.me;
 const records=w.records.filter(r=>r.locationId===w.location.id&&visible(r,me,w));
 const scoped={...w,records};
 const current=(id:string,allowed:(m:Member)=>boolean)=>w.members.find(m=>m.id===id&&m.locationId===w.location.id&&allowed(m));
 const add=(r:WorkRecord,step:string,mode:FollowupEntry['mode'],date:string|null,dateLabel:string,responsibleId:string|null,dateMeaning:FollowupEntry['dateMeaning']='due')=>{
  const kind=r.kind as FollowupKind,timing=!date?'no-date':date<today?'past':date===today?'today':'upcoming';
  rows.push({id:r.id,kind,tab:followupAreas[kind],title:'title' in r.data?r.data.title:'Follow-up',area:r.area,nextStep:step,mode,date:date||null,dateLabel,dateMeaning,timing,overdue:!!date&&date<today&&dateMeaning!=='event',responsibleId});
 };
 for(const r of records){
  switch(r.kind){
   case 'staffidea':{
    const d=r.data,own=r.ownerId===me.id,last=d.responses.at(-1);
    if(own){if(last&&!last.readAt)add(r,'Read the latest response','your-step',null,'No response deadline entered',me.id);break;}
    if(!ideaReviewer(me,r.area)||d.status==='closed')break;
    const assigned=current(d.managerId,m=>m.id!==r.ownerId&&ideaReviewer(m,r.area));
    if(!assigned)add(r,'Assign a current independent reviewer','review',d.dueDate,'Follow-up due',null);
    else add(r,assigned.id===me.id?'Respond to the employee':'Await assigned reviewer response',assigned.id===me.id?'your-step':'waiting',d.dueDate,'Follow-up due',assigned.id);
    break;
   }
   case 'guestreview':{
    const d=r.data;if(d.status==='closed')break;
    if(d.status==='owner-review'){add(r,guestOwner(me)?'Review the recorded outcome':'Await owner review',guestOwner(me)?'your-step':'waiting',null,'No owner-review deadline entered',null);break;}
    const assigned=current(d.managerId,guestManager);
    if(!assigned)add(r,'Review the manager assignment','review',d.dueDate,'Follow-up due',null);
    else add(r,assigned.id===me.id?(d.status==='awaiting-ack'?'Accept follow-up responsibility':'Record the follow-up outcome'):'Await assigned manager follow-up',assigned.id===me.id?'your-step':'waiting',d.dueDate,'Follow-up due',assigned.id);
    break;
   }
   case 'hirechecklist':{
    const d=r.data;if(d.status==='cancelled')break;
    const fresh=hireChecklistCurrent(scoped,r);if(d.status==='reviewed'&&fresh)break;
    const pending=d.items.filter(i=>!i.check),due=pending.map(i=>i.dueDate).filter(Boolean).sort()[0]??null;
    add(r,!fresh?'Review changed or unavailable hire setup':pending.length?'Check the remaining requirements':'Review the completed checklist',!fresh?'review':'your-step',due,'Earliest unfinished requirement',null);break;
   }
   case 'hirehandoff':{
    const d=r.data;if(d.status==='cancelled')break;const e=hireEvidence(scoped,r);if(d.status==='scheduled'&&e.current)break;
    const scheduler=current(d.schedulerId,m=>m.id!==r.ownerId&&hireScheduler(m,r.area));
    if(!e.setupCurrent||!scheduler||e.needsReview){add(r,'Review changed hire, scheduler or shift evidence','review',d.targetDate,'Target first shift',scheduler?.id??null,'target');break;}
    add(r,d.schedulerId===me.id?(d.status==='awaiting-ack'?'Accept first-shift responsibility':!e.schedulable?'Review scheduling availability':'Confirm the earliest published shift'):'Await named scheduler follow-up',d.schedulerId===me.id?(!e.schedulable&&d.status==='accepted'?'review':'your-step'):'waiting',d.targetDate,'Target first shift',d.schedulerId,'target');break;
   }
   case 'compliance':{
    const d=r.data;if(d.status==='closed')break;const stale=complianceRenewalState(r,scoped)==='needs-review',assigned=current(d.responsibleId,complianceManager);
    add(r,stale?'Recheck the renewal source relationship':!assigned?'Review the responsible owner':!d.review?'Check the recorded source document':'Review recorded follow-up',stale||!assigned||!d.review?'review':d.responsibleId===me.id?'your-step':'waiting',d.dueDate,'Recorded document due',assigned?.id??null);break;
   }
   case 'promotion':{
    const d=r.data;if(!promotionEditor(r,me)||d.status==='cancelled')break;
    if(d.status==='approved'){
     if(d.endsOn<today&&!d.internal?.outcomes.length)add(r,d.internal?'Record a sourced outcome comparison':'Review unavailable planning evidence',d.internal?'your-step':'review',d.endsOn,'Offer ended',d.managerId,'event');
     break;
    }
    if(d.status==='review'){add(r,promotionOwner(me)?'Review the proposed offer':'Await owner offer review',promotionOwner(me)?'your-step':'waiting',d.startsOn,'Proposed start',null,'event');break;}
    const assigned=current(d.managerId,promotionManager);
    add(r,!assigned?'Review the planning assignment':d.managerId===me.id||promotionOwner(me)?'Complete and submit the proposal':'Await proposal planning',!assigned?'review':'your-step',d.startsOn,'Proposed start',assigned?.id??null,'event');break;
   }
  }
 }
 const rank=(x:FollowupEntry)=>x.overdue?0:x.mode==='review'?1:x.timing==='today'?2:x.mode==='your-step'?3:4;
 return rows.sort((a,b)=>rank(a)-rank(b)||(a.date??'9999').localeCompare(b.date??'9999')||a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id));
}
export function followupTarget(w:Workspace,now:string,id:string){return followupDesk(w,now).find(r=>r.id===id)??null;}
