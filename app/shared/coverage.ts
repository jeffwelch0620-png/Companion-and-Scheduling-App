import { canScheduleJob, manages, type CoverageDuty, type Member, type RecordOf, type Workspace } from './types';
import { availabilityConflict, canChangePublished } from './schedule-policy';
import { stationAssignmentIssue } from './station-assignment';
import { overlaps } from './validation';

export function coverageDuties(w:Workspace,shiftId:string):CoverageDuty[] {
  return w.records.filter((r):r is RecordOf<'close'>=>r.kind==='close'&&r.data.shiftId===shiftId&&r.data.phase!=='cancelled').map(r=>({id:r.id,standardId:r.data.standardId,standardRevision:r.data.standardRevision,title:r.data.standard.title,zone:r.data.standard.zone,criteria:r.data.standard.criteria,source:r.data.standard.source,version:r.data.standard.version,due:r.data.due})).sort((a,b)=>a.id.localeCompare(b.id));
}
export function coverageCoordinator(me:Member,area:string) {
  return manages(me,area,'schedule.manage')||manages(me,area,'schedule.change');
}
export function coverageIssue(w:Workspace,r:RecordOf<'coverage'>,at:string) {
  if(r.data.status!=='open')return 'This coverage offer is no longer open.';
  const s=w.records.find((s):s is RecordOf<'shift'>=>s.kind==='shift'&&s.id===r.data.shiftId);
  if(!s||!s.data.published||s.data.cancelled||s.data.releasedAt)return 'The original shift is no longer available for coverage.';
  if(s.ownerId!==r.ownerId||s.revision!==r.data.shiftRevision||s.data.position!==r.data.position||s.data.start!==r.data.start||s.data.end!==r.data.end)return 'The shift changed. Its owner needs to offer the current version again.';
  if(!w.members.some(m=>m.id===r.ownerId))return 'The original employee is no longer active. A manager must handle this shift.';
  if(Date.parse(s.data.start)<=Date.parse(at))return 'The shift has started. Contact the leader running the shift.';
  const duties=coverageDuties(w,s.id);
  if(JSON.stringify(duties)!==JSON.stringify(r.data.duties))return 'The assigned closing duties changed. Its owner needs to offer the updated duties again.';
  if(duties.some(d=>!w.records.some(s=>s.kind==='standard'&&s.id===d.standardId&&s.data.status==='approved')))return 'An assigned closing standard is no longer approved. A manager needs to resolve the assignment.';
  return '';
}
// Eligibility covers configured rules only. No title, score, or unconfigured
// labor/minor rule is treated as evidence of station clearance.
export function coverageEligible(w:Workspace,r:RecordOf<'coverage'>,m:Member,at:string) {
  if(m.locationId!==r.locationId||m.area!==r.area||m.id===r.ownerId||!w.members.some(x=>x.id===m.id)||coverageIssue(w,r,at)||!canScheduleJob(m,r.data.position))return false;
  const stationId=w.records.find((s):s is RecordOf<'shift'>=>s.kind==='shift'&&s.id===r.data.shiftId)?.data.stationId;
  if(stationAssignmentIssue(w,m,r.data.position,stationId))return false;
  if(w.records.some(s=>s.kind==='shift'&&!s.data.cancelled&&s.id!==r.data.shiftId&&s.ownerId===m.id&&overlaps(s.data,r.data)))return false;
  if(w.records.some(s=>s.kind==='request'&&s.ownerId===m.id&&s.data.type==='time-off'&&s.data.status==='approved'&&overlaps(s.data,r.data))||availabilityConflict(w,m.id,r.data))return false;
  const closes=w.records.filter((s):s is RecordOf<'close'>=>s.kind==='close'&&s.data.shiftId===r.data.shiftId&&s.data.phase!=='cancelled');
  if(closes.length&&m.position==='Dishwasher')return false;
  return closes.every(c=>m.qualifications.includes(c.data.standard.position)&&c.data.managerId!==m.id&&c.data.verifierId!==m.id&&c.data.standard.position===r.data.position&&c.data.due>=r.data.start&&c.data.due<=r.data.end);
}
export function visibleCoverage(w:Workspace,r:RecordOf<'coverage'>,me:Member,at:string) {
  return r.locationId===me.locationId&&(r.ownerId===me.id||coverageCoordinator(me,r.area)||r.data.volunteers.some(v=>v.personId===me.id)||r.data.selectedId===me.id||coverageEligible(w,r,me,at));
}
export function coverageView(w:Workspace,r:RecordOf<'coverage'>,at:string):RecordOf<'coverage'> {
  const privateAccess=r.ownerId===w.me.id||coverageCoordinator(w.me,r.area);
  return {...r,data:{...r.data,unavailableReason:coverageIssue(w,r,at),eligible:coverageEligible(w,r,w.me,at),...(!privateAccess?{note:'',history:[],volunteers:r.data.volunteers.filter(v=>v.personId===w.me.id),selectedId:r.data.selectedId===w.me.id?r.data.selectedId:undefined}:{})}};
}
export function coverageReviewers(w:Workspace,r:RecordOf<'coverage'>,replacementId?:string) {
  return w.members.filter(m=>m.id!==r.ownerId&&m.id!==replacementId&&canChangePublished(w,m,r.area,r.data)).map(m=>m.id);
}
