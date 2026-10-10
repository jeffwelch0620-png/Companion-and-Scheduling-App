import {configuredLocation} from './ui-store-configuration.mjs';
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
  const stations=sets.stations.map(r=>({...r,data:{...r.data,...(r.data.setup?{setup:{...r.data.setup,standardIds:r.data.setup.standardIds??[],goals:r.data.setup.goals??[]}}:{})}}));
  return {location:viewer.location,me:viewer.me,members:sets.roster.map(m=>({...m,capabilities:m.id===viewer.me.id?viewer.me.capabilities:[]})),records:[...sets.availability,...sets.requests,...sets.shifts,...stations]};
 }
 throw Error('The schedule changed while loading. Reload to get the current records.');
}
export class ScheduleScreenSender {
 pending=null;
 async send(call,locationId,action,input,record) {
  if(!['shift.save','availability.save','availability.review','request.create','request.review'].includes(action)||action==='request.create'&&input.type!=='time-off'||action==='request.review'&&record?.data.type!=='time-off')throw Error('This workflow is not enabled in this preview.');
  if(action==='shift.save'&&record&&(record.kind!=='shift'||record.data.published||record.data.cancelled||record.data.releasedAt))throw Error('Only unpublished, active candidate drafts can be edited in this preview.');
  const fields={locationId,action,input,...(record?{recordId:record.id,expectedRevision:record.revision}:{})},signature=JSON.stringify(fields);
  if(this.pending&&this.pending.signature!==signature)throw Error('Retry the previous submission before changing its details. Its outcome is still unknown.');
  this.pending??={signature,command:{requestId:crypto.randomUUID(),...fields}};
  const response=await call('/commands',this.pending.command);
  if(response.status===200){this.pending=null;return response.body;}
  if(response.status>=400&&response.status<500)this.pending=null;
  throw Error(response.status===409?'These records changed or conflict with the schedule. Reload and review before submitting again.':response.status===403?'Your current access does not allow this submission.': 'Submission could not be confirmed. Retry the same form to check its outcome.');
 }
}
