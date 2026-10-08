'use client';

import { EmployeeDeviceSetup } from './employee-device-setup';
import { AdministratorRequestPanel } from './administrator-request';

import { useEffect, useRef, useState } from 'react';

import { capabilities, type Workspace } from '../shared/types';
import {gmOperatingSetup,gmClosingSetup} from '../shared/gm-operating-setup';

import { capabilityLabels, type AccessAccount, type AccessCommand, type AccessProfile, type AccessReview, type AccessState, type AccessResult } from '../shared/access-types';
import { nextAccessSelection, filterSetupPeople } from '../shared/onboarding';

import type { ToastPerson } from '../shared/toast-roster';

import { displayTime, localDate } from '../shared/local-time';



async function accessRequest<T=AccessState>(locationId:string,command?:AccessCommand,signal?:AbortSignal,apiRoot='/api'):Promise<T>{

  const url=apiRoot+'/access'+(command?'':'?locationId='+encodeURIComponent(locationId));

  const response=await fetch(url,{credentials:'same-origin',cache:'no-store',signal,...(command?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command)}:{})});

  const data=await response.json();

  if(!response.ok)throw new Error(data&&typeof data==='object'&&'error' in data&&typeof data.error==='string'?data.error:'Employee setup could not be loaded.');

  return data as T;

}

const initial=(person?:ToastPerson):AccessProfile=>({name:person?.name??'',email:person?.email??'',area:person?.jobs.length===1&&/^(dish|dishwasher)$/i.test(person.jobs[0].title)?'BOH':'',position:person?.jobs.length===1?person.jobs[0].title:'',capabilities:[],qualifications:[]});

function readProfile(form:FormData):AccessProfile{return {name:String(form.get('name')??''),email:String(form.get('email')??''),area:String(form.get('area')??''),position:String(form.get('position')??''),capabilities:form.getAll('capabilities') as AccessProfile['capabilities'],qualifications:String(form.get('qualifications')??'').split('\n').map(s=>s.trim()).filter(Boolean)};}

type Selection={person:ToastPerson;review?:AccessReview}|{account:AccessAccount}|{newHire:true}|{administrator:true};

const departureLabels={quit:'Quit',terminated:'Terminated',other:'Other departure'};

const accountStatus=(a:AccessAccount)=>a.administratorRequest&&a.administratorRequest.status!=='approved'?a.administratorRequest.status==='requested'?'Sign-in needs approval':a.administratorRequest.status==='invited'?'Waiting for owner sign-in':a.active?'Enabled':'Invitation cancelled':a.scheduleOnly?'On roster — sign-in not enabled':a.employment.status==='onboarding'?'New hire — not enabled':a.employment.status==='archived'?'Archived':a.active?a.claimed?'Enabled':'Awaiting sign-in':'Suspended';

export function AccessSetupPanel({w,onChanged,apiRoot='/api'}:{w:Workspace;onChanged:()=>Promise<void>;apiRoot?:string}){

  const [state,setState]=useState<AccessState|null>(null),[selected,setSelected]=useState<Selection|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState<AccessCommand|null>(null),[section,setSection]=useState<'roster'|'accounts'|'hires'|'archived'>('roster');
  const [search,setSearch]=useState(''),[showArchived,setShowArchived]=useState(false),[showLinked,setShowLinked]=useState(false),[editingProfile,setEditingProfile]=useState(false);
  const busyRef=useRef(false);

  const generation=useRef(0),root=useRef<HTMLDivElement>(null),heading=useRef<HTMLHeadingElement>(null);

  useEffect(()=>{const controller=new AbortController(),serial=++generation.current;const invalidate=()=>{generation.current++;controller.abort()};void accessRequest(w.location.id,undefined,controller.signal,apiRoot).then(s=>{if(serial===generation.current)setState(s)}).catch(e=>{if(!controller.signal.aborted)setError(e.message)});return invalidate},[w.location.id,apiRoot]);

  const reload=async()=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');try{const fresh=await accessRequest(w.location.id,undefined,undefined,apiRoot);setState(fresh);setPending(null);setSelected(previous=>previous&&'account' in previous?fresh.accounts.find(a=>a.id===previous.account.id)?{account:fresh.accounts.find(a=>a.id===previous.account.id)!}:null:previous&&'person' in previous?{person:fresh.roster?.employees.find(p=>p.toastEmployeeId===previous.person.toastEmployeeId)??previous.person,review:fresh.reviews.find(r=>r.employeeId===previous.person.toastEmployeeId&&r.restaurantGuid===fresh.roster?.restaurantGuid)}:previous)}catch(e){setError(e instanceof Error?e.message:'Employee setup could not be loaded.')}finally{busyRef.current=false;setBusy(false)}};
  const refreshToast=async()=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');setNotice('');try{const response=await fetch(apiRoot+'/integrations/toast',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({locationId:w.location.id})});const data=await response.json() as {error?:string};if(!response.ok)throw Error(data.error??'Could not refresh the employee list.');setState(await accessRequest(w.location.id,undefined,undefined,apiRoot));setNotice('Employee list updated. Choose the person to set up.')}catch(e){setError(e instanceof Error?e.message:'Could not refresh the employee list.')}finally{busyRef.current=false;setBusy(false)}};

  const run=async(command:AccessCommand)=>{

    if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');setNotice('');setPending(command);

    try{

      const result=await accessRequest<AccessResult>(w.location.id,command,undefined,apiRoot);
      const fresh=await accessRequest(w.location.id,undefined,undefined,apiRoot);setPending(null);setState(fresh);setSelected(nextAccessSelection(fresh,command,result));setEditingProfile(false);

      setNotice(command.action==='administrator.add'?'Administrator invitation saved. Ask them to use Owner sign-in with the personal email you entered, then review their verified sign-in here.':command.action==='administrator.approve'?'Verified administrator sign-in approved. They can press Try again to open JMAX.':command.action==='administrator.cancel'?'Sign-in request cancelled. No new access was granted.':command.action==='administrator.resend'?'Invitation restarted. Ask them to sign in again before approving.':command.action==='hire.save'?'New hire saved. Sign-in remains disabled until the saved setup is reviewed and enabled.':command.action==='account.archive'?'Employee archived. Access is blocked; history and unfinished responsibilities are retained.':command.action==='hire.activate'||command.action==='account.rehire'?'Reviewed employee access enabled. No invitation was sent.':command.action==='review.save'?'Review saved. Employee access is unchanged.':command.action==='account.suspend'?'Access suspended. Work history is retained; review any outstanding responsibilities.':command.action==='review.apply'?'Toast identity linked. New accounts can sign in; existing accounts keep their current access.':'Employee access updated.');

      if(command.action==='hire.save')setSection('hires');else if(command.action==='account.archive')setSection('archived');else if(command.action==='administrator.add'||command.action==='hire.activate'||command.action==='account.rehire')setSection('accounts');

      await onChanged();

    }catch(e){setError(e instanceof Error?e.message:'The change could not be confirmed.')}finally{busyRef.current=false;setBusy(false)}

  };

  const send=(action:AccessCommand['action'],input:Record<string,unknown>,record?:{id:string;revision:number})=>run({requestId:crypto.randomUUID(),locationId:w.location.id,action,input,...(record?{recordId:record.id,expectedRevision:record.revision}:{})});

  const choose=(selection:Selection)=>{setSelected(selection);setEditingProfile(false);setNotice('');setError('');};

  const selectedKey=selected&&('account' in selected?selected.account.id:'person' in selected?selected.person.toastEmployeeId:'newHire' in selected?'new':'administrator');
  const selectedStep=selected&&('account' in selected?selected.account.active?'signin':'review':'person' in selected&&selected.review?'review':'details');
  useEffect(()=>{if(selectedKey){root.current?.focus();root.current?.scrollIntoView({block:'start'})}},[selectedKey,selectedStep]);

  const review=selected&&'person' in selected?selected.review:undefined,person=selected&&'person' in selected?selected.person:undefined,account=selected&&'account' in selected?selected.account:undefined;

  const newHire=!!selected&&'newHire' in selected,newAdministrator=!!selected&&'administrator' in selected,today=localDate(new Date().toISOString(),w.location.timezone);

  return <section>

    <div className="shared-heading"><h1 ref={heading} tabIndex={-1}>Employee setup</h1><button disabled={busy} onClick={()=>void reload()}>Refresh status</button><button disabled={busy||!!pending} onClick={()=>choose({newHire:true})}>Add new hire</button><button disabled={busy||!!pending} onClick={()=>choose({administrator:true})}>Add administrator</button></div>

    <p>Review each person before enabling sign-in. Toast job titles do not assign permissions or station clearance.</p>

    {error&&<p role="alert" className="shared-error">{error}</p>}

    {busy&&<p role="status">{pending?.action==='review.apply'||pending?.action==='hire.activate'?'Enabling employee access…':'Saving and refreshing employee setup…'}</p>}
    {pending&&!busy&&<p>Your last change was not confirmed. <button onClick={()=>void run(pending)}>Retry the same change</button> Refresh status before making a different change.</p>}

    {notice&&<p role="status" className="shared-notice">{notice}</p>}

    {!state&&!error&&<p>Loading employee setup…</p>}

    {state&&<fieldset disabled={busy||!!pending}>

      {!selected&&<><div className="shared-actions"><button aria-pressed={section==='roster'} onClick={()=>setSection('roster')}>Set up from Toast</button><button aria-pressed={section==='accounts'} onClick={()=>setSection('accounts')}>Help employee sign in</button><button aria-pressed={section==='hires'} onClick={()=>setSection('hires')}>New hire drafts</button><button aria-pressed={section==='archived'} onClick={()=>setSection('archived')}>Archived employees</button></div><label className="shared-field">Find an employee<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Name, email, or job"/></label></>}

      {!selected&&state.accounts.some(a=>a.employment.status==='archived'&&a.outstanding>0)&&<aside aria-label="Departed employees with unfinished work"><h2>Departure follow-up</h2>{state.accounts.filter(a=>a.employment.status==='archived'&&a.outstanding>0).map(a=><p key={a.id}><button onClick={()=>choose({account:a})}>{a.name} · {a.outstanding} responsibilities need review</button></p>)}</aside>}

      {selected?<div ref={root} tabIndex={-1}>

        <button onClick={()=>setSelected(null)}>Back to employee list</button>
        {!newAdministrator&&<ol className="onboarding-steps" aria-label="Employee setup progress"><li>1. Find employee</li><li aria-current={person||newHire||account?.employment.status==='onboarding'?'step':undefined}>2. Review access</li><li aria-current={account?.active?'step':undefined}>3. Sign in</li></ol>}

        <h2>{newAdministrator?'Add administrator':newHire?'New hire':person?.name??account?.name}</h2>

        {newAdministrator&&<form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void send('administrator.add',{name:String(f.get('name')??''),email:String(f.get('email')??''),coOwner:f.get('coOwner')==='on',identityConfirmed:f.get('identity')==='on',note:'Identity and matching restaurant administrator permissions confirmed.'})}}><p>Invite a co-owner or administrator to {w.location.name}. They sign in with their own personal account, then you approve the verified sign-in before these permissions take effect.</p><label className="shared-field">Full name<input name="name" required maxLength={200}/></label><label className="shared-field">Personal email<input name="email" type="email" required maxLength={254}/></label><label className="shared-check"><input name="coOwner" type="checkbox"/>This person is a co-owner.</label><details><summary>Permissions they will receive</summary><ul>{w.me.capabilities.map(c=><li key={c}>{capabilityLabels[c]}</li>)}</ul></details><label className="shared-check"><input name="identity" type="checkbox" required/>I confirmed this person’s identity and authorize the same restaurant administrator access I have.</label><button className="shared-primary">Save administrator invitation</button></form>}
        {newHire&&<><p>Record the hire now, even before Toast has been connected. Enable sign-in separately after reviewing the saved setup. A later Toast record can be linked to this same account.</p><ProfileForm value={initial()} lockedEmail={false} draft={false} excluded={false} note="" hiring hireDate={today} submit={(p,note,_exclude,_identity,_clearances,hireDate)=>send('hire.save',{profile:p,note,hireDate})}/></>}

        {person&&<><p>Toast jobs: {person.jobs.map(j=>j.title).join(' · ')||'No jobs assigned'}</p>{person.issues.map((s,i)=><p key={i}>{s}</p>)}</>}

        {account&&<><p>{account.active?'Access enabled':accountStatus(account)} · {account.email}</p>{account.active&&apiRoot==='/api'&&<EmployeeDeviceSetup actorId={w.me.id} key={account.id+':'+account.revision} account={account} timezone={w.location.timezone} onChanged={async()=>{await reload();await onChanged()}}/>}{account.employment.hireDate&&<p>Hire / start date: {account.employment.hireDate}</p>}{account.employment.status==='archived'&&<p>{account.employment.departureReason?departureLabels[account.employment.departureReason]:''} · Last employment date: {account.employment.endedDate}</p>}{account.outstanding>0&&<p>{account.outstanding} outstanding responsibilities. A responsible manager must reassign or close remaining work through its normal workflow.</p>}{!!account.responsibilities.length&&<ul>{account.responsibilities.map(r=><li key={r.category}>{r.count} · {r.category}</li>)}</ul>}{account.id===w.me.id&&<p>Another administrator must change your own access.</p>}</>}

        {account?.administratorRequest&&account.id!==w.me.id&&<AdministratorRequestPanel account={account} send={send}/>}
        {!newHire&&!newAdministrator&&!(account?.administratorRequest?.kind==='invitation'&&account.administratorRequest.status!=='approved')&&(review?.memberId?<p>This Toast identity is already linked. Use Companion accounts to manage access.</p>:account?.employment.status==='archived'?<details><summary>Rehire this employee</summary><p>Keep the same person and history. Review their current job, permissions and training again; old permissions and clearances are not preselected.</p><ProfileForm value={{...account,capabilities:[],qualifications:[]}} lockedEmail={account.claimed} draft={false} excluded={false} note="" rehiring hireDate={today} submit={(p,note,_exclude,identityConfirmed,clearancesConfirmed,hireDate)=>send('account.rehire',{profile:p,note,identityConfirmed,clearancesConfirmed,hireDate},account)}/></details>:<>

          {(review?.status==='draft'||account?.employment.status==='onboarding'||account?.active)&&!editingProfile?<button onClick={()=>setEditingProfile(true)}>Edit job and access</button>:<ProfileForm key={(account?.id??review?.id??person?.toastEmployeeId??'')+':'+(account?.revision??review?.revision??0)}

            value={account??review?.profile??initial(person)} lockedEmail={!!account?.claimed} disabled={account?.id===w.me.id} draft={!!person} excluded={review?.status==='excluded'} note={review?.note??''} hiring={account?.employment.status==='onboarding'} hireDate={account?.employment.hireDate??today}

            submit={(p,note,exclude,identityConfirmed,clearancesConfirmed,hireDate)=>person?send('review.save',{profile:p,note,exclude,restaurantGuid:state.roster?.restaurantGuid,employeeId:person.toastEmployeeId,sourceAt:state.roster?.retrievedAt},review):account?.employment.status==='onboarding'?send('hire.save',{profile:p,note,hireDate},account):send('account.save',{profile:p,note,identityConfirmed,clearancesConfirmed},account)}/>}

          {account?.employment.status==='onboarding'&&!editingProfile&&<form className="onboarding-review" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void send('hire.activate',{identityConfirmed:f.get('identity')==='on',clearancesConfirmed:f.get('clearances')==='on',note:'Manager confirmed the saved new-hire identity, job and permissions.'},account)}}><h3>Review and enable</h3><p>{w.location.name}</p><AccessSummary profile={account}/><label className="shared-check"><input type="checkbox" name="identity" required/>This is the correct person, and I approve the access shown.</label>{!!account.qualifications.length&&<label className="shared-check"><input type="checkbox" name="clearances" required/>I verified these station clearances against approved training records.</label>}<button className="shared-primary">Enable employee access</button></form>}

          {review?.status==='draft'&&!editingProfile&&<ApplyReview key={review.id+':'+review.revision} review={review} restaurant={w.location.name} state={state} accounts={state.accounts.filter(a=>a.id!==w.me.id)} submit={(memberId,note,clearancesConfirmed,replaceArchivedToastLink)=>{const existing=state.accounts.find(a=>a.id===memberId);return send('review.apply',{note,identityConfirmed:true,clearancesConfirmed,...(replaceArchivedToastLink?{replaceArchivedToastLink:true}:{}),...(existing?{memberId:existing.id,memberRevision:existing.revision}:{})},review)}}/>}

        </>)}

        {account?.active&&account.id!==w.me.id&&<details><summary>Suspend access</summary><form onSubmit={e=>{e.preventDefault();void send('account.suspend',{note:String(new FormData(e.currentTarget).get('suspendNote')??'')},account)}}><label className="shared-field">Reason for suspension<textarea name="suspendNote" required maxLength={2000}/></label><p>This blocks further workspace requests immediately. It does not cancel shifts or mark work complete.</p><button>Suspend employee access</button></form></details>}

        {account&&account.employment.status!=='archived'&&account.id!==w.me.id&&<details><summary>Archive after departure</summary><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void send('account.archive',{endedDate:String(f.get('endedDate')??''),departureReason:String(f.get('departureReason')??''),note:String(f.get('archiveNote')??''),confirmed:f.get('departureConfirmed')==='on'},account)}}><p>Archive someone who has left. Access is blocked immediately. History and remaining work stay available for authorized review; no Toast or payroll record is changed.</p><label className="shared-field">Departure reason<select name="departureReason" required defaultValue=""><option value="">Choose a reason</option><option value="quit">Quit</option><option value="terminated">Terminated</option><option value="other">Other departure</option></select></label><label className="shared-field">Last employment date<input name="endedDate" type="date" required max={today} defaultValue={today}/></label><label className="shared-field">Departure record note<textarea name="archiveNote" required maxLength={2000}/></label><label className="shared-check"><input type="checkbox" name="departureConfirmed" required/>I confirmed this employee has left and reviewed their remaining responsibilities.</label><button>Archive employee</button></form></details>}


        {account&&<details><summary>Recent employee setup history</summary><p>From the restaurant’s 500 most recent setup changes. The complete audit is retained.</p>{state.history.filter(h=>h.targetId===account.id).map(h=><article key={h.id}><strong>{h.action.replaceAll('.',' · ')} · {state.accounts.find(a=>a.id===h.actorId)?.name??'Administrator'}</strong><p>{displayTime(h.at,w.location.timezone)} · {h.note}</p>{h.employment&&<p>{h.employment.status} · Hire date: {h.employment.hireDate??'Not recorded'}{h.employment.endedDate?' · Last date: '+h.employment.endedDate:''}{h.employment.departureReason?' · '+departureLabels[h.employment.departureReason]:''}</p>}</article>)}</details>}

      </div>:section==='roster'?<>

        {state.rosterMismatch&&<p role="alert">The connected Toast restaurant changed. Read its roster before making new links.</p>}

        {!state.roster?<><p>No employee list has been loaded yet.</p><button onClick={()=>void refreshToast()}>Refresh from Toast</button></>:<>

          <p>Updated {displayTime(state.roster.retrievedAt,w.location.timezone)}</p>
          <button onClick={()=>void refreshToast()}>Refresh from Toast</button>
          <div className="shared-actions"><label className="shared-check"><input type="checkbox" checked={showLinked} onChange={e=>setShowLinked(e.target.checked)}/>Include people already set up</label><label className="shared-check"><input type="checkbox" checked={showArchived} onChange={e=>setShowArchived(e.target.checked)}/>Include archived Toast records</label></div>

          <div className="shared-list">{filterSetupPeople(state,search,showArchived,showLinked).map(({person:p,review:r,account:linked})=><button key={p.toastEmployeeId} onClick={()=>choose(linked?{account:linked}:{person:p,review:r})}><span><strong>{p.name}</strong><small>{p.jobs.map(j=>j.title).join(' · ')||'No jobs assigned'}{p.archived?' · archived':''}</small></span><em>{linked?accountStatus(linked):r?.status==='excluded'?'Excluded':r?'Continue review':'Set up'}</em></button>)}</div>
          {!filterSetupPeople(state,search,showArchived,showLinked).length&&<p>No employees match these filters. Try another search, include people already set up, or refresh from Toast.</p>}

        </>}

      </>:<div className="shared-list">{state.accounts.filter(a=>a.employment.status===(section==='hires'?'onboarding':section==='archived'?'archived':'active')&&`${a.name} ${a.email} ${a.position}`.toLowerCase().includes(search.trim().toLowerCase())).map(a=><button key={a.id} onClick={()=>choose({account:a})}><span><strong>{a.name}</strong><small>{a.email} · {a.area} · {a.position}{a.outstanding?' · '+a.outstanding+' outstanding responsibilities':''}</small></span><em>{accountStatus(a)}</em></button>)}{!state.accounts.some(a=>a.employment.status===(section==='hires'?'onboarding':section==='archived'?'archived':'active')&&`${a.name} ${a.email} ${a.position}`.toLowerCase().includes(search.trim().toLowerCase()))&&<p>No employees match this list and search.</p>}</div>}

    </fieldset>}

  </section>;

}

function ProfileForm({value,lockedEmail,disabled,draft,excluded,note,submit,hiring=false,rehiring=false,hireDate}:{value:AccessProfile;lockedEmail:boolean;disabled?:boolean;draft:boolean;excluded:boolean;note:string;hiring?:boolean;rehiring?:boolean;hireDate?:string;submit:(p:AccessProfile,note:string,exclude:boolean,identity:boolean,clearances:boolean,hireDate:string)=>Promise<unknown>}){

  const [position,setPosition]=useState(value.position),[area,setArea]=useState(value.area),[selectedCapabilities,setSelectedCapabilities]=useState(value.capabilities);
  const dish=/^(dish|dishwasher)$/i.test(position.trim());

  return <form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void submit(readProfile(f),String(f.get('note')??''),f.get('exclude')==='on',f.get('identity')==='on',f.get('clearances')==='on',String(f.get('hireDate')??''))}}><fieldset disabled={disabled}>

    <label className="shared-field">Employee name<input name="name" defaultValue={value.name} maxLength={200} required={!draft}/></label>

    <label className="shared-field">Personal email<input name="email" type="email" defaultValue={value.email} maxLength={254} readOnly={lockedEmail} required={!draft}/></label>

    {(hiring||rehiring)&&<label className="shared-field">{rehiring?'Rehire date':'Hire / start date'}<input type="date" name="hireDate" required defaultValue={hireDate}/></label>}

    <div className="shared-grid"><label className="shared-field">Department<select name="area" value={area} onChange={e=>setArea(e.currentTarget.value)} required={!draft}><option value="">Choose department</option><option>FOH</option><option>BOH</option><option>Executive</option></select></label><label className="shared-field">Primary job<input name="position" value={position} onChange={e=>setPosition(e.currentTarget.value)} maxLength={100} required={!draft}/></label></div>

    {dish&&<p>Dish-only accounts use BOH with Schedule and Inbox only. Use the actual primary job for an employee who also works other stations.</p>}

    <details open={selectedCapabilities.length>0}><summary>Additional permissions</summary><p>Ordinary employee access includes their own schedule, requests, and permitted learning. Select extra permissions only when approved.</p><button type="button" disabled={dish} onClick={()=>{const setup=gmOperatingSetup();setArea(setup.area);setPosition(setup.position);setSelectedCapabilities(setup.capabilities)}}>Use GM operating scope</button><button type="button" disabled={dish} onClick={()=>{const setup=gmClosingSetup();setArea(setup.area);setPosition(setup.position);setSelectedCapabilities(setup.capabilities)}}>Use GM operating and closing scope</button><p>This replaces the selected permissions with front and back of house operating logs, task management and Food/count/prep management in this restaurant. The closing option also proposes final closing confirmation; a named independent manager and scheduled leadership are still required. Review the proposed access before saving and enabling sign-in. Scheduling, People, purchasing and restaurant administration require their own separate permissions.</p><fieldset><legend>Additional permissions</legend>{capabilities.map(cap=><label className="shared-check" key={cap}><input type="checkbox" name="capabilities" value={cap} checked={selectedCapabilities.includes(cap)} onChange={e=>{const checked=e.currentTarget.checked;setSelectedCapabilities(previous=>checked?[...previous,cap]:previous.filter(c=>c!==cap))}} disabled={dish}/>{capabilityLabels[cap]}</label>)}</fieldset></details>

    <details open={value.qualifications.length>0}><summary>Approved station clearances</summary><label className="shared-field">Approved station clearances, one per line<textarea name="qualifications" defaultValue={value.qualifications.join('\n')} maxLength={4000}/></label>

    <p>A job title or assessment score does not establish clearance. Leave this empty until approved training records have been checked.</p></details>

    {draft?<label className="shared-check"><input type="checkbox" name="exclude" defaultChecked={excluded}/>Exclude this Toast record from personal access setup</label>:hiring?<p>Saving records the proposed setup. Sign-in stays disabled until a separate review enables it.</p>:<><label className="shared-check"><input type="checkbox" name="identity" required/>I confirmed this employee’s identity and the permissions shown.</label><label className="shared-check"><input type="checkbox" name="clearances"/>I checked changes to station clearances against approved training records.</label></>}

    <label className="shared-field">{draft||hiring?'Setup note':'Reason for access change'}<textarea name="note" defaultValue={note||(draft||hiring?'Employee setup reviewed for individual access.':'')} required maxLength={2000}/></label>

    <button className="shared-primary">{hiring?'Save and review new hire':rehiring?'Rehire with reviewed access':draft?'Save and review access':'Save reviewed access'}</button>

  </fieldset></form>;

}

function AccessSummary({profile}:{profile:AccessProfile}) {
  return <div className="onboarding-summary"><strong>{profile.name}</strong><p>{profile.email} · {profile.area} · {profile.position}</p><p>Access: {profile.capabilities.length?profile.capabilities.map(c=>capabilityLabels[c]).join('; '):'Ordinary employee — no additional permissions'}</p><p>Approved station clearances: {profile.qualifications.join(', ')||'None recorded'}</p></div>;
}

export function ApplyReview({review,accounts,restaurant,state,submit}:{review:AccessReview;accounts:AccessAccount[];restaurant:string;state:AccessState;submit:(memberId:string,note:string,clearances:boolean,replaceArchivedToastLink:boolean)=>Promise<unknown>}){
  const matching=accounts.filter(a=>a.email.toLowerCase()===review.profile.email.toLowerCase()),[existing,setExisting]=useState(''),[replaceArchived,setReplaceArchived]=useState(false);
  const account=matching.find(a=>a.id===existing);
  const priorLinks=account?state.reviews.filter(r=>r.status==='applied'&&r.memberId===account.id):[],oldLink=priorLinks.length===1?priorLinks[0]:null;
  const checkedRehire=account?[...state.history].filter(h=>h.targetId===account.id&&h.action==='account.rehire').sort((a,b)=>b.at.localeCompare(a.at))[0]:undefined;
  const roster=state.roster,currentReview=!!roster&&!state.rosterMismatch&&review.restaurantGuid===roster.restaurantGuid&&review.sourceAt===roster.retrievedAt&&roster.employees.some(p=>p.toastEmployeeId===review.employeeId&&!p.archived&&JSON.stringify(p)===JSON.stringify(review.source));
  const canReplace=!!account&&account.active&&account.employment.status==='active'&&checkedRehire?.employment?.status==='active'&&JSON.stringify(checkedRehire.employment)===JSON.stringify(account.employment)&&!!oldLink&&oldLink.restaurantGuid===roster?.restaurantGuid&&!!roster?.employees.some(p=>p.toastEmployeeId===oldLink.employeeId&&p.archived)&&currentReview;
  const needsReplacement=priorLinks.length>0;
  const incomplete=!review.profile.name||!review.profile.email||!review.profile.area||!review.profile.position;
  return <form className="onboarding-review" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget),confirmedReplacement=f.get('replaceArchivedToastLink')==='on';if(incomplete||matching.length>0&&!account||f.get('identity')!=='on'||needsReplacement&&(!canReplace||!confirmedReplacement))return;void submit(existing,review.note+' Manager confirmed the displayed identity and access.',f.get('clearances')==='on',needsReplacement&&confirmedReplacement)}}>
    <h3>Review and enable</h3><p>{restaurant}</p>
    <AccessSummary profile={account??review.profile}/>
    {matching.length>0&&<><p>A JMAX account already uses this email. Review the existing identity and select it explicitly to preserve its history.</p><label className="shared-field">Existing account<select required value={existing} onChange={e=>{setExisting(e.target.value);setReplaceArchived(false)}}><option value="">Choose the matching person</option>{matching.map(a=><option key={a.id} value={a.id}>{a.name} · {a.position}</option>)}</select></label></>}
    {account&&<p>Linking preserves this account&apos;s current permissions and {account.employment.status==='archived'?'archived':!account.active?'disabled':'enabled'} access. It does not activate a suspended or archived employee.</p>}
    {needsReplacement&&(canReplace?<><p>This employee has a prior Toast record that the current roster marks archived. A checked rehire is recorded. Replacing the link keeps the same JMAX person, history and reviewed access.</p><label className="shared-check"><input type="checkbox" name="replaceArchivedToastLink" checked={replaceArchived} required onChange={e=>setReplaceArchived(e.target.checked)}/>I confirmed the old Toast record is retired and the new record belongs to this same rehired employee.</label><p>The server will recheck the same person&apos;s current rehire and account revision before changing either link. If the person or employment record changed, refresh and review again.</p></>:<p role="alert">This account already has a Toast link. Refresh the roster and confirm the same person&apos;s checked rehire before replacing a retired record. A current or unreviewed link cannot be replaced here.</p>)}
    <label className="shared-check"><input type="checkbox" name="identity" required/>This is the correct person and personal email, and I approve the access shown.</label>
    {!account&&!!review.profile.qualifications.length&&<label className="shared-check"><input type="checkbox" name="clearances" required/>I verified these station clearances against approved training records.</label>}
    {incomplete&&<p role="alert">Complete the missing name, email, department, or job using Edit job and access.</p>}
    <p>No email is sent. Their sign-in code will be available here after access is enabled.</p>
    <button className="shared-primary" disabled={incomplete||matching.length>0&&!existing||needsReplacement&&(!canReplace||!replaceArchived)}>{account?'Link to this employee':'Enable employee access'}</button>
  </form>;
}
