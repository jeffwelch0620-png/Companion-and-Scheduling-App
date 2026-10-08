'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Workspace } from '../shared/types';
import type { ToastSetup } from '../shared/toast-service';
import { displayTime } from '../shared/local-time';
import {ToastDayPanel} from './toast-day-panel';

class ToastReadError extends Error {constructor(message:string,public status:number,public nextAttemptAt?:string){super(message)}}
async function fetchSetup(locationId:string,refresh:boolean,signal:AbortSignal,apiRoot='/api'):Promise<ToastSetup>{
  const path=apiRoot+'/integrations/toast';
  const response=await fetch(refresh?path:`${path}?locationId=${encodeURIComponent(locationId)}`,{credentials:'same-origin',cache:'no-store',signal,...(refresh?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({locationId})}:{})});
  const data:unknown=await response.json();
  if(!response.ok)throw new ToastReadError(data&&typeof data==='object'&&'error' in data&&typeof data.error==='string'?data.error:'Could not read the Toast connection.',response.status,data&&typeof data==='object'&&'nextAttemptAt' in data&&typeof data.nextAttemptAt==='string'?data.nextAttemptAt:undefined);
  return data as ToastSetup;
}

export function ToastSetupPanel({w,apiRoot='/api'}:{w:Workspace;apiRoot?:string}) {
  const [value,setValue]=useState<ToastSetup|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(true),[search,setSearch]=useState(''),[showArchived,setShowArchived]=useState(false);
  const requestRef=useRef<AbortController|null>(null),generation=useRef(0);
  const load=useCallback((refresh=false)=>{
    requestRef.current?.abort();const controller=new AbortController();requestRef.current=controller;
    const serial=++generation.current;
    return fetchSetup(w.location.id,refresh,controller.signal,apiRoot).then(data=>{if(serial===generation.current)setValue(data)}).catch(e=>{
      if(!controller.signal.aborted&&serial===generation.current){
        if(e instanceof ToastReadError&&[401,403].includes(e.status))setValue(null);
        setError(e instanceof ToastReadError&&e.nextAttemptAt?`${e.message} Try again after ${displayTime(e.nextAttemptAt,w.location.timezone)}.`:e instanceof Error?e.message:'Could not read the Toast connection.');
      }
    }).finally(()=>{if(serial===generation.current)setBusy(false)});
  },[w.location.id,w.location.timezone,apiRoot]);
  useEffect(()=>{const invalidate=()=>{generation.current++;requestRef.current?.abort()};void load();return invalidate},[load]);
  const start=(refresh=false)=>{setBusy(true);setError('');void load(refresh)};
  const roster=value?.roster,employees=roster?.employees??[];
  const filtered=employees.filter(e=>(showArchived||!e.archived)&&`${e.name} ${e.jobs.map(j=>j.title).join(' ')}`.toLowerCase().includes(search.trim().toLowerCase()));
  const current=employees.filter(e=>!e.archived),needsReview=current.filter(e=>e.issues.length>0);
  return <section aria-busy={busy}>
    <ToastDayPanel key={w.location.id} w={w} apiRoot={apiRoot}/>
    <div className="shared-heading"><h1>Toast employee setup</h1><button disabled={busy} onClick={()=>start()}>Reload saved roster</button></div>
    <p>Review the people and jobs received from Toast before setting up their Companion access.</p>
    {error&&<p role="alert" className="shared-error">{error}</p>}
    {!value&&<p>{busy?'Checking the connection…':'The connection could not be loaded.'}</p>}
    {value&&<>
      <p><strong>{value.configured?'Toast connection settings are present.':'Toast is not connected to this restaurant in JMAX yet.'}</strong>{value.configured&&!roster&&' Read the roster to verify the connection.'}</p>
      {value.unmatchedLocation&&<p className="shared-error">The Toast restaurant setting changed. Read and verify its roster before using it for setup.</p>}
      <button className="shared-primary" disabled={busy||!value.configured} onClick={()=>start(true)}>{busy?'Reading…':'Read employees and jobs from Toast'}</button>
      <p className="shared-muted">This reads Toast and saves a review copy. It does not create invitations, change app permissions or update Toast.</p>
      {roster?<>
        <p>Last successful read: {displayTime(roster.retrievedAt,w.location.timezone)}</p>
        <p>{current.length} unarchived records · {employees.length-current.length} archived · {needsReview.length} with setup issues</p>
        <p className="shared-muted">A roster can include shared or system accounts. Job titles do not grant manager, purchasing or trainer authority.</p>
        {roster.issues.map((issue,i)=><p className="shared-error" key={i}>{issue}</p>)}
        <label className="shared-field">Find a person or job<input value={search} onInput={e=>setSearch(e.currentTarget.value)} onChange={e=>setSearch(e.target.value)} type="search"/></label>
        {search&&<button onClick={()=>setSearch('')}>Clear search</button>}
        <label className="shared-check"><input type="checkbox" checked={showArchived} onChange={e=>setShowArchived(e.target.checked)}/>Include archived records</label>
        <div className="shared-roster">{filtered.map(e=><article key={e.toastEmployeeId}><h2>{e.name}{e.archived?' · archived':''}</h2><p>{e.jobs.length?e.jobs.map(j=>`${j.title}${j.archived?' (archived or unavailable)':''}`).join(' · '):'No job assigned in Toast'}</p>{e.issues.length>0&&<ul>{e.issues.map((issue,i)=><li key={i}>{issue}</li>)}</ul>}</article>)}</div>
        {!filtered.length&&<p>No matching records.</p>}
      </>:<p>No verified API roster has been saved for this restaurant.</p>}
    </>}
  </section>;
}
