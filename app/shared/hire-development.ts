import {manages,personName,type RecordOf,type Workspace} from './types';
import {visibleDevelopment} from './followthrough';
import type {HireCandidate} from './hire-handoff';
import {localDate} from './local-time';

export type HireDevelopmentRecord=RecordOf<'development'>&{archived:boolean};
const validDay=(day:string)=>/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day+'T00:00:00Z'))&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day;
export function hireDevelopmentReview(w:Workspace,employee:HireCandidate,records:HireDevelopmentRecord[],now:string){
 const today=localDate(now,w.location.timezone);
 return records.filter(r=>r.locationId===w.location.id&&r.ownerId===employee.id&&r.area===employee.area&&r.data.hireDate===employee.hireDate&&visibleDevelopment(r,w.me)).map(r=>{
  const d=r.data,manager=w.members.find(m=>m.id===d.managerId),approver=w.members.find(m=>m.id===d.approverId);
  const managerAvailable=!!manager&&!manager.scheduleOnly&&manager.position!=='Dishwasher'&&manager.id!==r.ownerId&&manages(manager,r.area,'people.manage');
  const approverAvailable=!!approver&&!approver.scheduleOnly&&approver.position!=='Dishwasher'&&approver.id!==r.ownerId&&approver.id!==d.managerId&&manages(approver,r.area,'people.approve');
  const lastDecision=[...d.history].reverse().find(h=>h.action==='gm-approved'||h.action==='gm-returned');
  const validDecision=!!lastDecision&&Number.isFinite(Date.parse(lastDecision.at))&&Date.parse(lastDecision.at)<=Date.parse(now)&&localDate(lastDecision.at,w.location.timezone)>=d.hireDate;
  // A saved phase is not sufficient evidence of a recorded GM decision.
  // Current authority labels describe follow-up responsibility, not retroactive revocation.
  const approvalRecorded=d.phase==='approved'&&validDecision&&lastDecision!.action==='gm-approved'&&lastDecision!.actorId===d.approverId&&d.approverId!==r.ownerId&&d.approverId!==d.managerId;
  const guides=d.stations.map(s=>{
   if(!s.standardId)return 'manual-source' as const;
   const guide=w.records.find(g=>g.kind==='standard'&&g.locationId===r.locationId&&g.area===r.area&&g.id===s.standardId);
   if(!guide||guide.kind!=='standard'||guide.data.status!=='approved')return 'unavailable' as const;
   return guide.revision===s.standardRevision?'current' as const:'changed' as const;
  });
  return {id:r.id,revision:r.revision,archived:r.archived,phase:d.phase,hireDate:d.hireDate,
   originalDueDate:validDay(d.originalDueDate)?d.originalDueDate:null,
   overdueDays:!r.archived&&!['approved','cancelled'].includes(d.phase)&&validDay(d.originalDueDate)?Math.max(0,Math.floor((Date.parse(today)-Date.parse(d.originalDueDate))/86400000)):0,
   manager:{name:personName(w,d.managerId,'Former or unavailable manager'),available:managerAvailable},
   approver:{name:personName(w,d.approverId,'Former or unavailable reviewer'),available:approverAvailable},
   approvalRecorded,
   lastDecision:lastDecision?{outcome:lastDecision.action==='gm-approved'?'approved' as const:'returned' as const,at:validDecision?lastDecision.at:null,by:personName(w,lastDecision.actorId,'Former or unavailable reviewer')}:null,
   guideStatus:{current:guides.filter(g=>g==='current').length,changed:guides.filter(g=>g==='changed').length,unavailable:guides.filter(g=>g==='unavailable').length,manual:guides.filter(g=>g==='manual-source').length},
  };
 }).sort((a,b)=>(a.archived===b.archived?0:a.archived?1:-1)||(a.originalDueDate??'').localeCompare(b.originalDueDate??'')||a.id.localeCompare(b.id));
}

