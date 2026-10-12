import {configuredLocation,assertCanonicalCheckoutMembership} from './ui-store-configuration.mjs';
import {isOffer,checkedOffer} from './coverage-swap-client.mjs';
// Isolated request-screen client. Partial reads never become a displayed workspace.
export async function loadScheduleScreen(call) {
 for(let attempt=0;attempt<3;attempt++) {
  const first=await call('/schedule-viewer');
  if(first.status!==200)throw Error('Scheduling access is unavailable. Reload after checking your connection.');
  const viewer=first.body,sets={};configuredLocation(viewer.location);let changed=false;
  for(const resource of ['roster','availability','requests','shifts','stations','coverage','swaps','leadership']) {
   const items=[],cursors=new Set();let after=null;
   do {
    const page=await call('/schedule-'+resource+'?limit=100'+(after?'&after='+after:''));
    if(page.status!==200)throw Error('Scheduling records could not be loaded. No partial schedule is shown.');
    if(page.body.workspaceRevision!==viewer.workspaceRevision){changed=true;break;}
    items.push(...page.body.items);after=page.body.nextCursor;
    if(after&&cursors.has(after))throw Error('Scheduling pagination did not advance.');
    if(after)cursors.add(after);
   }while(after);
   sets[resource]=items;if(changed)break;
  }
  const last=await call('/schedule-viewer');
  if(last.status!==200)throw Error('Scheduling access changed. Reload to continue.');
  if(changed||JSON.stringify(last.body)!==JSON.stringify(viewer))continue;
  for(const member of [...sets.roster,viewer.me])assertCanonicalCheckoutMembership({location:viewer.location},member);
  const stations=sets.stations.map(r=>({...r,data:{...r.data,...(r.data.setup?{setup:{...r.data.setup,standardIds:r.data.setup.standardIds??[],goals:r.data.setup.goals??[]}}:{})}}));
  const workspace={location:viewer.location,scheduleRevision:viewer.scheduleRevision,inputRevision:viewer.inputRevision,me:viewer.me,attendanceRevision:viewer.attendanceRevision,attendanceAreas:viewer.attendanceAreas??[],leadershipOptions:viewer.leadershipOptions??[],members:sets.roster.map(m=>({...m,capabilities:m.id===viewer.me.id?viewer.me.capabilities:[]})),records:[...sets.availability,...sets.requests,...sets.shifts,...stations,...sets.leadership],offerReviewNotices:0};
  for(const [kind,offers] of [['coverage',sets.coverage],['request',sets.swaps]])for(const r of offers)try{if(r?.kind!==kind)throw Error('Invalid offer kind');workspace.records.push(checkedOffer(workspace,r));}catch{workspace.offerReviewNotices++;}
  return workspace;
 }
 throw Error('The schedule changed while loading. Reload to get the current records.');
}
const recoveryKey=(scope,actor)=>'jmax-publication-recovery:'+encodeURIComponent(scope)+':'+encodeURIComponent(actor);
export const publicationRecoveryMessage='A previous publication may have completed. Check current published shifts before reviewing or submitting again.';
export function publicationRecovery(storage,scope,actor) {
 try {const marker=JSON.parse(storage?.getItem(recoveryKey(scope,actor))??'null');return marker?.requestId&&marker.actorId===actor&&marker.locationId===scope?marker:null;}catch{return null;}
}
export function clearPublicationRecovery(storage,scope,actor) {try{storage?.removeItem(recoveryKey(scope,actor));}catch{}}
export class ScheduleScreenSender {
 constructor({storage=null,actorId=null}={}) {this.storage=storage;this.actorId=actorId;}
 pending=null;
 async send(call,locationId,action,input,record) {
  if(!['attendance.record','attendance.correct','attendance.void','attendance.review','attendance.reopen','leadership.assign','leadership.revoke','shift.save','shift.cancel','shift.publish-batch','availability.save','availability.review','request.create','request.review','request.consent','coverage.create','coverage.volunteer','coverage.withdraw-volunteer','coverage.withdraw','coverage.approve'].includes(action)||action==='request.create'&&!['time-off','swap'].includes(input.type)||action==='request.review'&&(record?.kind!=='request'||!['time-off','swap'].includes(record?.data.type))||action==='request.consent'&&(record?.kind!=='request'||record?.data.type!=='swap')||action.startsWith('coverage.')&&action!=='coverage.create'&&record?.kind!=='coverage')throw Error('This workflow is not enabled in this preview.');
  if(action.startsWith('leadership.')&&(record&&record.kind!=='leadership'||action==='leadership.revoke'&&!record))throw Error('Open a current leadership assignment before changing it.');
  if(action==='shift.save'&&record&&(record.kind!=='shift'||record.data.cancelled||record.data.releasedAt||record.data.published&&record.data.publishedActions?.canEdit!==true))throw Error('Only unpublished, active candidate drafts or authorized published shifts can be edited in this preview.');
  if(action==='shift.cancel'&&(record?.kind!=='shift'||record.locationId!==locationId||!record.data.published||record.data.cancelled||record.data.releasedAt||!Array.isArray(input.closeTransfers)||input.closeTransfers.length>100||(input.closeTransfers.length?record.data.publishedActions?.canEdit!==true||input.closeTransfers.some(t=>!t||Object.keys(t).sort().join(',')!=='closeId,closingRevision,expectedRevision,shiftId'||!['closeId','shiftId'].every(k=>typeof t[k]==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t[k]))||!['closingRevision','expectedRevision'].every(k=>Number.isSafeInteger(t[k])&&t[k]>0)):record.data.publishedActions?.canCancel!==true)))throw Error('Review an authorized published shift and its reviewed closing transfers before cancellation.');
  if(action.startsWith('attendance.')){
   const key={'attendance.correct':'canCorrect','attendance.void':'canVoid','attendance.review':'canReview','attendance.reopen':'canReopen'}[action];
   if(action==='attendance.record'?record!==undefined||typeof input.shiftId!=='string'||!Number.isSafeInteger(input.shiftRevision)||input.shiftRevision<1:record?.kind!=='attendance'||record.locationId!==locationId||!Number.isSafeInteger(record.revision)||record.revision<1||record.revision>1000||record.data?.actions?.[key]!==true)throw Error('Reload the authorized attendance entry or shift before submitting.');
  }
  const fields={locationId,action,input,...(record?{recordId:record.id,expectedRevision:record.revision}:{})},signature=JSON.stringify(fields);
  if(this.pending&&this.pending.signature!==signature)throw Error('Retry the previous submission before changing its details. Its outcome is still unknown.');
  this.pending??={signature,command:structuredClone({requestId:crypto.randomUUID(),...fields})};
  return this.deliver(call);
 }
 async retry(call) {
  if(!this.pending)throw Error('No uncertain submission is waiting.');
  return this.deliver(call);
 }
 async deliver(call) {
  const command=this.pending.command,publication=command.action==='shift.publish-batch';
  if(publication&&this.actorId)try{this.storage?.setItem(recoveryKey(command.locationId,this.actorId),JSON.stringify({requestId:command.requestId,locationId:command.locationId,actorId:this.actorId}));}catch{}
  const response=await call('/commands',command);
  if(response.status===200&&command.action.startsWith('attendance.')){
   const r=response.body,isId=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
   if(!r||!isId(r.recordId)||command.recordId&&r.recordId!==command.recordId||r.requestId!==command.requestId||r.revision!==(command.recordId?command.expectedRevision+1:1)||!Number.isSafeInteger(r.workspaceRevision)||r.workspaceRevision<1||typeof r.appliedAt!=='string'||!Number.isFinite(Date.parse(r.appliedAt))||typeof r.replayed!=='boolean')throw Error('Attendance could not be confirmed. Keep this page open and retry the original submission.');
  }
  if(response.status===200||response.status>=400&&response.status<500){if(publication)clearPublicationRecovery(this.storage,command.locationId,this.actorId);this.pending=null;}
  if(response.status===200)return response.body;
  const code=response.body?.error?.code,issues={attendance_duplicate:'This attendance type is already recorded for the original employee and shift. Open the existing entry to correct it.',attendance_source_ineligible:'This shift is unpublished or cancelled. Review existing attendance in history.',attendance_voided:'This entry was voided. Its history remains available.',attendance_history_limit:'This entry has reached its history limit. Contact a manager before continuing.',attendance_already_reviewed:'This entry was already reviewed. Reload before reopening it.',attendance_not_reviewed:'This entry already needs review. Reload current records.',closing_transfer_selection_conflict:'Closing assignments or covering shifts changed. Reload and review every transfer again.',closing_zone_conflict:'The covering shift already has closing work for this zone. Reload and choose different coverage.',linked_task_pending:'Unfinished linked tasks must be resolved before cancellation.',offer_changed:'The shift or closing duties changed. Reload and obtain fresh consent.',replacement_consent_required:'The named replacement must accept before manager approval.',replacement_no_longer_eligible:'The replacement no longer meets the scheduling requirements. Reload and review another replacement.',coverage_offer_exists:'This shift already has an open coverage request. Reload to view it.',volunteer_missing:'The selected coworker is no longer volunteering. Reload current records.',station_setup_reference_only:'This station needs a reviewed setup before publication.',weekly_scope_review_required:'Schedule inputs need a complete source review before publication.',schedule_inputs_incomplete:'Roster and time-off inputs need review before publication.',closing_publication_review_required:'Closing instructions or assigned reviewers need correction before publication.',publication_linked_work_held:'Linked work needs review before this shift can publish.',shift_ended:'This shift has ended. Publication, edits and replacement approvals are unavailable here.'};
  throw Object.assign(Error(response.status===409?(issues[code]??'These records changed or conflict with the schedule. Reload and review before submitting again.'):response.status===403?'Your current access does not allow this submission.':response.status===401?'Sign in again, then reload and review current records.':response.status===400?'Check the submission and review current records before submitting again.':'Submission could not be confirmed. Retry the original submission to check its outcome.'),{status:response.status,code});
 }
}
