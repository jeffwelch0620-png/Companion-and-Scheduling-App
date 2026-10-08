import {has,type RecordOf,type Workspace} from './types';
import {hireCoordinator,hireEvidence,type HireCandidate} from './hire-handoff';
import {hireChecklistCurrent,hireChecklistProgress} from './hire-checklist';
import {eligibleForStation} from './station-assignment';
import {stationProficiency} from './workforce';
import {localDate} from './local-time';
import {requireThat} from './validation';
import {hireDevelopmentReview,type HireDevelopmentRecord} from './hire-development';

export type HireReviewRecord=(RecordOf<'hirechecklist'>|RecordOf<'hirehandoff'>)&{archived:boolean};
export function buildHireReview(w:Workspace,employee:HireCandidate,history:HireReviewRecord[],lastSignedInAt:string|null,now:string,development:HireDevelopmentRecord[]=[]){
 requireThat(hireCoordinator(w.me,employee.area),'Employee follow-up access is required for this department.',403);
 const today=localDate(now,w.location.timezone);
 const rows=history.filter(r=>r.locationId===w.location.id&&r.ownerId===employee.id&&r.area===employee.area&&r.data.hireDate===employee.hireDate);
 const checklists=rows.filter((r):r is RecordOf<'hirechecklist'>&{archived:boolean}=>r.kind==='hirechecklist').map(r=>({id:r.id,revision:r.revision,archived:r.archived,status:r.data.status,current:hireChecklistCurrent(w,r),...hireChecklistProgress(r,today),reviewedAt:r.data.review?.at??null}));
 const handoffs=rows.filter((r):r is RecordOf<'hirehandoff'>&{archived:boolean}=>r.kind==='hirehandoff').map(r=>({id:r.id,revision:r.revision,archived:r.archived,status:r.data.status,schedulerName:r.data.schedulerName,targetDate:r.data.targetDate,acknowledgedAt:r.data.acknowledgment?.at??null,confirmedStart:r.data.confirmation?.start??null,confirmationCurrent:!r.archived&&r.data.position===employee.position&&hireEvidence(w,r).current}));
 const member=w.members.find(m=>m.id===employee.id&&m.locationId===w.location.id&&m.area===employee.area);
 const stations=w.records.filter((r):r is RecordOf<'station'>=>r.kind==='station'&&r.locationId===w.location.id&&r.area===employee.area&&r.data.status==='active'&&!!member&&eligibleForStation(w,member,r)).map(station=>{
  const p=stationProficiency(w,employee.id,station),at=p.record?.data.assessedAt;
  const duringHire=!!at&&Number.isFinite(Date.parse(at))&&Date.parse(at)<=Date.parse(now)&&localDate(at,w.location.timezone)>=employee.hireDate!;
  const state=!p.record?'not-assessed':!duringHire?'earlier-or-invalid-date':!p.current?'definition-changed':!p.level?'not-assessed':station.data.independentLevel===null?'threshold-unset':p.level.value>=station.data.independentLevel?'meets-threshold':'below-threshold';
  return {id:station.id,title:station.data.title,state,assessmentId:p.record?.id??null,assessedAt:at&&Number.isFinite(Date.parse(at))?at:null,levelLabel:p.current?p.level?.label??null:null,thresholdLabel:station.data.levels.find(l=>l.value===station.data.independentLevel)?.label??null};
 }).sort((a,b)=>a.title.localeCompare(b.title)||a.id.localeCompare(b.id));
 requireThat(stations.length<=100,'This hire has too many station assignments for this review.',503);
 const validSignIn=lastSignedInAt&&Number.isFinite(Date.parse(lastSignedInAt))&&Date.parse(lastSignedInAt)<=Date.parse(now)&&localDate(lastSignedInAt,w.location.timezone)>=employee.hireDate!?lastSignedInAt:null;
 return {schemaVersion:'jmax-hire-review.v2' as const,locationId:w.location.id,workspaceRevision:w.location.revision,viewerId:w.me.id,checkedAt:now,timezone:w.location.timezone,employee:{id:employee.id,name:employee.name,area:employee.area,position:employee.position,hireDate:employee.hireDate,revision:employee.revision,status:employee.status,active:employee.active,scheduleOnly:employee.scheduleOnly},development:hireDevelopmentReview(w,employee,development,now),signIn:has(w.me,'location.manage')?{visibility:'owner' as const,lastSignedInAt:validSignIn}:{visibility:'owner-only' as const,lastSignedInAt:null},checklists,handoffs,stations};
}
export type HireReview=ReturnType<typeof buildHireReview>;

// Every selection owns its result; late successes and errors cannot replace it.
export function createHireReviewLoader(publish:(value:{data:HireReview|null;error:string})=>void,fetcher:typeof fetch=fetch){
 let generation=0,controller:AbortController|undefined;
 return {cancel(){generation++;controller?.abort();},async load(locationId:string,employee:HireCandidate,viewerId:string){
  const run=++generation;controller?.abort();controller=new AbortController();publish({data:null,error:''});
  try{const response=await fetcher('/api/people/hire-review?'+new URLSearchParams({locationId,employeeId:employee.id}),{cache:'no-store',signal:controller.signal});const data=await response.json() as HireReview;
   if(run!==generation)return;
   if(!response.ok)throw new Error('The hire review could not be loaded. Refresh the workspace and try again.');
   if(!data||data.schemaVersion!=='jmax-hire-review.v2'||data.locationId!==locationId||data.viewerId!==viewerId||data.employee?.id!==employee.id||data.employee?.revision!==employee.revision)throw new Error('Employee setup changed. Refresh the workspace before reviewing.');
   publish({data,error:''});
  }catch(error){if(run===generation)publish({data:null,error:error instanceof Error?error.message:'The hire review is unavailable.'});}
 }};
}
