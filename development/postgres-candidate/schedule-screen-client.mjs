import {configuredLocation,assertCanonicalCheckoutMembership} from './ui-store-configuration.mjs';
import {isOffer,checkedOffer} from './coverage-swap-client.mjs';
import {isGroupAction,groupSelection,checkedGroupResult,setGroupRecovery,clearGroupRecovery} from './copy-batch-client.mjs';
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
  if(isGroupAction(action)){
   groupSelection(action,input);
   if(record!==undefined||input.confirmed!==true||typeof input.reviewToken!=='string'||!/^[a-f0-9]{64}$/.test(input.reviewToken)||typeof input.note!=='string'||!input.note.trim()||input.note.trim().length>2000)throw Error('Refresh and confirm the complete copy or batch review with a reason.');
  }
  if(!['shift.copy-week','shift.save-batch','leave.resolve','correction.propose','correction.approve','correction.reject','correction.withdraw','attendance.record','attendance.correct','attendance.void','attendance.review','attendance.reopen','leadership.assign','leadership.revoke','shift.save','shift.cancel','shift.publish-batch','availability.save','availability.review','request.create','request.review','request.consent','coverage.create','coverage.volunteer','coverage.withdraw-volunteer','coverage.withdraw','coverage.approve'].includes(action)||action==='request.create'&&!['time-off','swap'].includes(input.type)||action==='request.review'&&(record?.kind!=='request'||!['time-off','swap'].includes(record?.data.type))||action==='request.consent'&&(record?.kind!=='request'||record?.data.type!=='swap')||action.startsWith('coverage.')&&action!=='coverage.create'&&record?.kind!=='coverage')throw Error('This workflow is not enabled in this preview.');
  if(action==='leave.resolve'&&record?.kind!=='leave-review')throw Error('Open a current leave review flag before resolving it.');
  if(action.startsWith('leadership.')&&(record&&record.kind!=='leadership'||action==='leadership.revoke'&&!record))throw Error('Open a current leadership assignment before changing it.');
  if(action==='shift.save'&&record&&(record.kind!=='shift'||record.data.cancelled||record.data.releasedAt||record.data.published&&record.data.publishedActions?.canEdit!==true))throw Error('Only unpublished, active candidate drafts or authorized published shifts can be edited in this preview.');
  if(action==='shift.cancel'&&(record?.kind!=='shift'||record.locationId!==locationId||!record.data.published||record.data.cancelled||record.data.releasedAt||!Array.isArray(input.closeTransfers)||input.closeTransfers.length>100||(input.closeTransfers.length?record.data.publishedActions?.canEdit!==true||input.closeTransfers.some(t=>!t||Object.keys(t).sort().join(',')!=='closeId,closingRevision,expectedRevision,shiftId'||!['closeId','shiftId'].every(k=>typeof t[k]==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t[k]))||!['closingRevision','expectedRevision'].every(k=>Number.isSafeInteger(t[k])&&t[k]>0)):record.data.publishedActions?.canCancel!==true)))throw Error('Review an authorized published shift and its reviewed closing transfers before cancellation.');
  if(action.startsWith('attendance.')){
   const key={'attendance.correct':'canCorrect','attendance.void':'canVoid','attendance.review':'canReview','attendance.reopen':'canReopen'}[action];
   if(action==='attendance.record'?record!==undefined||typeof input.shiftId!=='string'||!Number.isSafeInteger(input.shiftRevision)||input.shiftRevision<1:record?.kind!=='attendance'||record.locationId!==locationId||!Number.isSafeInteger(record.revision)||record.revision<1||record.revision>1000||record.data?.actions?.[key]!==true)throw Error('Reload the authorized attendance entry or shift before submitting.');
  }
  if(action.startsWith('correction.')){
   const key={'correction.approve':'canApprove','correction.reject':'canReject','correction.withdraw':'canWithdraw'}[action];
   if(action==='correction.propose'?record!==undefined||typeof input.shiftId!=='string'||!Number.isSafeInteger(input.shiftRevision)||input.shiftRevision<1||!Number.isSafeInteger(input.expectedCorrectionRevision)||input.expectedCorrectionRevision<0||input.expectedCorrectionRevision>=1000:record?.kind!=='shift-correction'||record.locationId!==locationId||!Number.isSafeInteger(record.revision)||record.revision<1||record.revision>=1000||record.data?.actions?.[key]!==true)throw Error('Reload the authorized completed shift or correction before submitting.');
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
  if(isGroupAction(command.action))setGroupRecovery(this.storage,command,this.actorId);
  if(publication&&this.actorId)try{this.storage?.setItem(recoveryKey(command.locationId,this.actorId),JSON.stringify({requestId:command.requestId,locationId:command.locationId,actorId:this.actorId}));}catch{}
  const response=await call('/commands',command);
  if(response.status===200&&isGroupAction(command.action)){
   try{checkedGroupResult(command.action,response.body,command);}catch{throw Error('The complete group result could not be confirmed. Keep this page open and retry the original submission.');}
  }
  if(response.status===200&&command.action.startsWith('attendance.')){
   const r=response.body,isId=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
   if(!r||!isId(r.recordId)||command.recordId&&r.recordId!==command.recordId||r.requestId!==command.requestId||r.revision!==(command.recordId?command.expectedRevision+1:1)||!Number.isSafeInteger(r.workspaceRevision)||r.workspaceRevision<1||typeof r.appliedAt!=='string'||!Number.isFinite(Date.parse(r.appliedAt))||typeof r.replayed!=='boolean')throw Error('Attendance could not be confirmed. Keep this page open and retry the original submission.');
  }
  if(response.status===200&&command.action==='leave.resolve'){
   const r=response.body;if(!r||r.recordId!==command.recordId||r.requestId!==command.requestId||r.revision!==command.expectedRevision+1||r.reviewStatus!=='resolved'||!Number.isSafeInteger(r.leaveReviewRevision)||r.leaveReviewRevision<1||!Number.isSafeInteger(r.workspaceRevision)||r.workspaceRevision<1||typeof r.appliedAt!=='string'||!Number.isFinite(Date.parse(r.appliedAt))||typeof r.replayed!=='boolean')throw Error('Leave review could not be confirmed. Keep this page open and retry the original submission.');
  }
  if(response.status===200&&command.action.startsWith('correction.')){
   const r=response.body,isId=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),expected=command.action==='correction.propose'?command.input.expectedCorrectionRevision+1:command.expectedRevision+1;
   const status=command.action==='correction.propose'?['pending','applied']:[{'correction.approve':'applied','correction.reject':'rejected','correction.withdraw':'withdrawn'}[command.action]];
   if(!r||!isId(r.recordId)||command.recordId&&r.recordId!==command.recordId||r.requestId!==command.requestId||r.revision!==expected||!Number.isSafeInteger(r.workspaceRevision)||r.workspaceRevision<1||typeof r.appliedAt!=='string'||!Number.isFinite(Date.parse(r.appliedAt))||typeof r.replayed!=='boolean'||!status.includes(r.correctionStatus)||!Number.isSafeInteger(r.effectiveRevision)||r.effectiveRevision<0||r.effectiveRevision>r.revision||r.correctionStatus==='applied'&&r.effectiveRevision!==r.revision||r.correctionStatus!=='applied'&&r.effectiveRevision>=r.revision)throw Error('Correction could not be confirmed. Keep this page open and retry the original submission.');
  }
  const internalInvariant=response.status===500&&response.body?.error?.code==='internal_invariant';
  if(response.status===200||response.status>=400&&response.status<500||internalInvariant){if(publication)clearPublicationRecovery(this.storage,command.locationId,this.actorId);if(isGroupAction(command.action))clearGroupRecovery(this.storage,command.locationId,this.actorId);this.pending=null;}
  if(response.status===200)return response.body;
  const code=response.body?.error?.code,issues={copy_review_changed:'The source or destination changed, or a start time passed. Reload current drafts and refresh the copy review.',batch_review_changed:'The source or destination changed, or a start time passed. Reload current drafts and refresh the batch review.',leave_review_changed:'The leave or shift changed. Reload the flag and review it again.',leave_review_resolved:'This flag was already resolved. Open its retained review history.',leave_review_source_unavailable:'The approved leave or identity needs reconciliation before this flag can be resolved.',leave_review_evidence_changed:'An evidence record changed. Reload and review the reference again.',correction_position_unknown:'Use the original position or an active scheduling job at this store. Reload before submitting again.',correction_source_conflict:'The original shift changed. Reload and reconcile before applying a correction.',correction_pending:'A proposal is already awaiting independent approval. Reload to review it.',correction_not_pending:'This proposal was already decided. Reload current correction history.',ownership_notice_unresolved:'Ownership notice recipients require configuration before this correction can apply.',correction_no_change:'Change at least one planned detail before submitting.',correction_source_ineligible:'Open a completed, published shift before proposing a correction.',correction_history_limit:'This correction has reached its history limit. Contact an authorized manager.',attendance_duplicate:'This attendance type is already recorded for the original employee and shift. Open the existing entry to correct it.',attendance_source_ineligible:'This shift is unpublished or cancelled. Review existing attendance in history.',attendance_voided:'This entry was voided. Its history remains available.',attendance_history_limit:'This entry has reached its history limit. Contact a manager before continuing.',attendance_already_reviewed:'This entry was already reviewed. Reload before reopening it.',attendance_not_reviewed:'This entry already needs review. Reload current records.',closing_transfer_selection_conflict:'Closing assignments or covering shifts changed. Reload and review every transfer again.',closing_zone_conflict:'The covering shift already has closing work for this zone. Reload and choose different coverage.',linked_task_pending:'Unfinished linked tasks must be resolved before cancellation.',offer_changed:'The shift or closing duties changed. Reload and obtain fresh consent.',replacement_consent_required:'The named replacement must accept before manager approval.',replacement_no_longer_eligible:'The replacement no longer meets the scheduling requirements. Reload and review another replacement.',coverage_offer_exists:'This shift already has an open coverage request. Reload to view it.',volunteer_missing:'The selected coworker is no longer volunteering. Reload current records.',station_setup_reference_only:'This station needs a reviewed setup before publication.',weekly_scope_review_required:'Schedule inputs need a complete source review before publication.',schedule_inputs_incomplete:'Roster and time-off inputs need review before publication.',closing_publication_review_required:'Closing instructions or assigned reviewers need correction before publication.',publication_linked_work_held:'Linked work needs review before this shift can publish.',shift_ended:'This shift has ended. Publication, edits and replacement approvals are unavailable here.'};
  throw Object.assign(Error(internalInvariant?'Reload current drafts and contact an administrator.':response.status===503&&code==='coordination_retry'?'Another store is updating these records. Retry the original submission.':response.status===409?(issues[code]??'These records changed or conflict with the schedule. Reload and review before submitting again.'):response.status===403?'Your current access does not allow this submission.':response.status===401?'Sign in again, then reload and review current records.':response.status===400?(issues[code]??'Check the submission and review current records before submitting again.'):'Submission could not be confirmed. Retry the original submission to check its outcome.'),{status:response.status,code});
 }
}
