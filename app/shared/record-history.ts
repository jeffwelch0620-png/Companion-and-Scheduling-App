import {operationalLearningReviewer} from './operational-learning';
import {ideaReviewer} from './staff-ideas';
import { has, manages, type WorkRecord, type Workspace } from './types';
import {hireCoordinator,hireEvidence} from './hire-handoff';
import {hireChecklistCurrent} from './hire-checklist';
import { visible } from './domain';
import { localDate } from './local-time';
import { checkinReviewer, retainedCheckinIds } from './shift-checkin';

export const historyBatchSize=50;
export function historyManager(w:Workspace){return !w.me.scheduleOnly&&w.me.position!=='Dishwasher'&&['location.manage','schedule.manage','people.manage','people.approve','tasks.manage','orders.review'].some(c=>w.me.capabilities.includes(c as typeof w.me.capabilities[number]));}
export function canFileRecord(w:Workspace,r:WorkRecord){
  if(!historyManager(w))return false;
  // An owner may file old terminal rows for storage housekeeping, but this
  // grants no content access. The preview redacts private rows and history
  // reads continue to use the original record permissions.
  if(has(w.me,'location.manage'))return true;
  if(!visible(r,w.me,w))return false;
  switch(r.kind){
    case 'learningcase':return operationalLearningReviewer(w.me,r.area);
    case 'staffidea':return ideaReviewer(w.me,r.area);
    case 'hirehandoff':return hireCoordinator(w.me,r.area);
    case 'hirechecklist':return hireCoordinator(w.me,r.area);
    case 'shiftcheckin':return checkinReviewer(w.me,r.area);
    case 'shift':case 'request':case 'leadership':case 'availability':case 'coverage':case 'staffing':return manages(w.me,r.area,'schedule.manage');
    case 'attendance':case 'development':case 'feedback':return manages(w.me,r.area,'people.manage');
    case 'goal':return manages(w.me,r.area,r.data.type==='development'?'people.manage':'tasks.manage');
    case 'task':case 'close':case 'handoff':return manages(w.me,r.area,'tasks.manage');
    case 'message':return r.data.automated===true;
    case 'order':return has(w.me,'orders.review');
    default:return false;
  }
}
// Only operational dependencies hold an old record in the active workspace.
// Copy-source identifiers are provenance and do not make an old shift active.
export function recordDependencies(r:WorkRecord):string[]{
  switch(r.kind){
    case 'learningcase':return r.data.status==='withdrawn'?[]:[...new Set([r.data.source.id,r.data.asset?.id].filter((id):id is string=>!!id))];
    case 'achievement':return r.data.status==='earned'?[...new Set(r.data.sourceRefs.map(source=>source.id))]:[];
    case 'opening':return [...new Set((r.data.onboarding?.links??[]).map(l=>l.handoffId))];
    case 'compliance':return r.data.renewal?[r.data.renewal.previousId]:[];
    case 'maintenance':return r.data.asset?[r.data.asset.id]:[];
    case 'hirehandoff':return r.data.confirmation?[r.data.confirmation.shiftId]:[];
    case 'shiftentry':return [...new Set([...r.data.issueIds,...r.data.versions.flatMap(v=>v.issueIds)])];
    case 'attendance':case 'shiftcheckin':return [r.data.shiftId];
    case 'request':return r.data.shiftId?[r.data.shiftId]:[];
    case 'close':return [r.data.shiftId,r.data.standardId];
    case 'goal':return r.data.standardId?[r.data.standardId]:[];
    case 'message':return [...new Set([r.data.recordId,r.data.context?.recordId,r.data.context?.standardId].filter((s):s is string=>!!s))];
    case 'handoff':return [r.data.outgoingLeadershipId,r.data.incomingLeadershipId];
    case 'coverage':return [r.data.shiftId,...r.data.duties.flatMap(d=>[d.id,d.standardId])];
    case 'availability':return r.data.replacesId?[r.data.replacesId]:[];
    case 'proficiency':return [r.data.stationId];
    default:return [];
  }
}
export function completedBefore(r:WorkRecord,before:string,zone='UTC'):boolean{
  const old=(s:string|undefined)=>!!s&&Number.isFinite(Date.parse(s))&&(/^\d{4}-\d{2}-\d{2}$/.test(s)?s:localDate(s,zone))<before;
  if(!old(r.updatedAt))return false;
  switch(r.kind){
    case 'shift':return (r.data.published||r.data.cancelled)&&old(r.data.end);
    case 'hirehandoff':return r.data.status==='cancelled'||r.data.status==='scheduled'&&old(r.data.confirmation?.end);
    case 'hirechecklist':return r.data.status==='reviewed'||r.data.status==='cancelled';
    case 'staffidea':return r.data.status==='closed'&&!!r.data.responses.at(-1)?.readAt;
    case 'learningcase':return r.data.status==='withdrawn';
    case 'recognition':return r.data.status==='withdrawn';
    case 'opening':return r.data.status==='closed'&&(r.data.applicants??[]).every(a=>['closed','withdrawn'].includes(a.stage));
    case 'catering':return r.data.status==='cancelled'||r.data.status==='completed';
    case 'equipment':case 'maintenance':return r.data.status==='retired';
    case 'servicecontact':return r.data.status==='retired';
    case 'promotion':return r.data.status==='cancelled'||r.data.status==='approved'&&old(r.data.endsOn);
    case 'compliance':case 'guestreview':return r.data.status==='closed';
    case 'attendance':case 'shiftcheckin':return old(r.data.shift.end);
    case 'message':return !!r.data.automated&&r.data.recipients.length>0&&r.data.recipients.every(id=>r.data.readBy.includes(id));
    case 'request':return ['approved','declined'].includes(r.data.status)&&old(r.data.end);
    case 'leadership':return old(r.data.end);
    case 'availability':return ['declined','superseded'].includes(r.data.status)&&old(r.data.endDate);
    case 'close':return ['closed','cancelled'].includes(r.data.phase)&&old(r.data.due);
    case 'task':return r.data.phase==='closed'&&old(r.data.due);
    case 'handoff':return ['resolved','cancelled'].includes(r.data.phase)&&old(r.data.due);
    case 'goal':return ['closed','cancelled','declined'].includes(r.data.phase)&&old(r.data.due);
    case 'development':return ['approved','cancelled'].includes(r.data.phase);
    case 'feedback':return r.data.status==='closed';
    case 'order':return r.data.status==='approved';
    case 'coverage':return r.data.status!=='open'&&old(r.data.end);
    case 'staffing':return r.data.status==='retired'&&old(r.data.end);
    // Current source versions and station/proficiency facts remain active.
    default:return false;
  }
}
export function historyPlan(w:Workspace,before:string){
  const retained=retainedCheckinIds(w);
  const candidates=w.records.filter(r=>!retained.has(r.id)&&(r.kind!=='hirehandoff'||r.data.status!=='scheduled'||hireEvidence(w,r).current)&&(r.kind!=='hirechecklist'||r.data.status!=='reviewed'||hireChecklistCurrent(w,r))&&canFileRecord(w,r)&&completedBefore(r,before,w.location.timezone)).sort((a,b)=>a.updatedAt.localeCompare(b.updatedAt)||a.id.localeCompare(b.id));
  const selected:WorkRecord[]=[],chosen=new Set<string>();
  const incoming=new Map<string,string[]>();
  for(const r of w.records)for(const dependency of recordDependencies(r))if(dependency!==r.id)incoming.set(dependency,[...(incoming.get(dependency)??[]),r.id]);
  // File dependants first, then their now-unneeded parent. An unread notice,
  // unresolved assignment or inaccessible private record keeps its parent live.
  let changed=true;
  while(changed&&selected.length<historyBatchSize){changed=false;for(const r of candidates){if(chosen.has(r.id)||(incoming.get(r.id)??[]).some(id=>!chosen.has(id)))continue;chosen.add(r.id);selected.push(r);changed=true;if(selected.length===historyBatchSize)break;}}
  return {records:selected,remainingCandidates:candidates.length-selected.length};
}
