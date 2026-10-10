import {configuredLocation,assertCanonicalCheckoutMembership} from './ui-store-configuration.mjs';
// Isolated request-screen client. Partial reads never become a displayed workspace.
export async function loadScheduleScreen(call) {
 for(let attempt=0;attempt<3;attempt++) {
  const first=await call('/schedule-viewer');
  if(first.status!==200)throw Error('Scheduling access is unavailable. Reload after checking your connection.');
  const viewer=first.body,sets={};configuredLocation(viewer.location);let changed=false;
  for(const resource of ['roster','availability','requests','shifts','stations']) {
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
  return {location:viewer.location,me:viewer.me,members:sets.roster.map(m=>({...m,capabilities:m.id===viewer.me.id?viewer.me.capabilities:[]})),records:[...sets.availability,...sets.requests,...sets.shifts,...stations]};
 }
 throw Error('The schedule changed while loading. Reload to get the current records.');
}
export class ScheduleScreenSender {
 pending=null;
 async send(call,locationId,action,input,record) {
  if(!['shift.save','shift.publish-batch','availability.save','availability.review','request.create','request.review'].includes(action)||action==='request.create'&&input.type!=='time-off'||action==='request.review'&&record?.data.type!=='time-off')throw Error('This workflow is not enabled in this preview.');
  if(action==='shift.save'&&record&&(record.kind!=='shift'||record.data.published||record.data.cancelled||record.data.releasedAt))throw Error('Only unpublished, active candidate drafts can be edited in this preview.');
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
  const response=await call('/commands',this.pending.command);
  if(response.status===200){this.pending=null;return response.body;}
  if(response.status>=400&&response.status<500)this.pending=null;
  const code=response.body?.error?.code,issues={station_setup_reference_only:'This station needs a reviewed setup before publication.',weekly_scope_review_required:'Schedule inputs need a complete source review before publication.',schedule_inputs_incomplete:'Roster and time-off inputs need review before publication.',closing_publication_review_required:'Closing instructions or assigned reviewers need correction before publication.',publication_linked_work_held:'Linked work needs review before this shift can publish.',shift_ended:'This shift has ended and cannot be published or edited here.'};
  throw Object.assign(Error(response.status===409?(issues[code]??'These records changed or conflict with the schedule. Reload and review before submitting again.'):response.status===403?'Your current access does not allow this submission.':response.status===401?'Sign in again, then reload and review current records.':response.status===400?'Check the submission and review current records before submitting again.':'Submission could not be confirmed. Retry the original submission to check its outcome.'),{status:response.status,code});
 }
}
