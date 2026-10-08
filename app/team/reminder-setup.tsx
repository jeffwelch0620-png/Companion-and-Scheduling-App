'use client';
import { useEffect, useState } from 'react';
import type { Workspace } from '../shared/types';
import type { ReminderIssue, ReminderState } from '../shared/review-reminders';
import { displayTime } from '../shared/local-time';

const reasons:Record<ReminderIssue['reason'],string>={
  'missing-manager':'Assign an active, authorized review manager.',
  'missing-gm':'Assign an active, authorized GM approver.',
  'missing-owner':'Assign an independent owner escalation recipient with authority for this department.',
  'invalid-deadline':'The original review deadline needs repair.',
  'employee-unavailable':'The employee is unavailable for development reviews. Resolve the open review before continuing.',
};
async function request(locationId:string,run=false,signal?:AbortSignal,apiRoot='/api'):Promise<ReminderState> {
  const response=await fetch(apiRoot+'/reminders?locationId='+encodeURIComponent(locationId),{method:run?'POST':'GET',credentials:'same-origin',cache:'no-store',signal,...(run?{headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'run'})}:{})});
  const data=await response.json() as ReminderState&{error?:string};if(!response.ok)throw new Error(data.error||'Review follow-up could not be loaded.');return data;
}
export function ReminderSetup({w,onChanged,apiRoot='/api'}:{w:Workspace;onChanged:()=>void;apiRoot?:string}) {
  const [state,setState]=useState<ReminderState|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{const controller=new AbortController();void request(w.location.id,false,controller.signal,apiRoot).then(setState).catch(e=>{if(!controller.signal.aborted)setError(e.message)});return()=>controller.abort()},[w.location.id,apiRoot]);
  const run=async()=>{setBusy(true);setError('');try{setState(await request(w.location.id,true,undefined,apiRoot));onChanged()}catch(e){setError(e instanceof Error?e.message:'The check could not be confirmed.')}finally{setBusy(false)}};
  return <section><h1>Review follow-up</h1><p>Managers receive an Inbox reminder at 3 and 5 days overdue. At 7 days, assigned owners receive an escalation. The original deadline stays in place through GM approval.</p>
    <p>These reminders stay inside JMAX. They do not send email, texts or phone notifications.</p>
    {error&&<p className="shared-error" role="alert">{error}</p>}
    {state&&<><p>{state.checkedAt?`Last completed check: ${displayTime(state.checkedAt,w.location.timezone)}. ${state.delivered} new reminder${state.delivered===1?'':'s'} delivered.`:'No reminder check has completed yet.'}</p>
      <p>{state.scheduledAt?`Last background check observed: ${displayTime(state.scheduledAt,w.location.timezone)}. Verify that checks continue before relying on unattended delivery.`:'Background delivery has not been verified. A hosting schedule must be connected before reminders can run while nobody is using JMAX.'}</p>
      {state.issues.length>0&&<><h2>Assignments needing attention</h2><ul>{state.issues.map((issue,i)=><li key={issue.reviewId+issue.reason+i}>Review for {issue.employeeName??'an unavailable employee'}: {reasons[issue.reason]}</li>)}</ul></>}
    </>}
    <button className="shared-primary" disabled={busy} onClick={run}>{busy?'Checking…':'Check due reviews now'}</button>
    <p className="shared-muted">Only reminders still needed are delivered. Repeating a check does not duplicate an earlier reminder. Reading a reminder never approves or closes a review.</p>
  </section>;
}
