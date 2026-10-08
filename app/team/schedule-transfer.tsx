'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Workspace } from '../shared/types';
import {object} from '../shared/validation';
type Preview={pending:boolean;sourceId:string;revision:number;weekStart:string;weekEnd:string;people:number;shifts:number;newPeople:number;minutes:number;conflicts:string[]};
export function ScheduleTransfer({w,onChanged}:{w:Workspace;onChanged:(start:string)=>Promise<void>}){
 const scope=w.location.id,scopeRef=useRef(scope);scopeRef.current=scope;
 const [state,setState]=useState<{scope:string;view:Preview|null;error:string;busy:boolean}>({scope,view:null,error:'',busy:false});
 const generation=useRef(0),alive=useRef(false),request=useRef<AbortController|null>(null);
 const current=state.scope===scope?state:null,view=current?.view??null,error=current?.error??'',busy=current?.busy??true;
 const read=useCallback(async()=>{
  request.current?.abort();const abort=new AbortController();request.current=abort;const serial=++generation.current;
  const isCurrent=()=>alive.current&&!abort.signal.aborted&&generation.current===serial&&scopeRef.current===scope;
  setState({scope,view:null,error:'',busy:true});
  try{const response=await fetch('/api/schedule-transfer?locationId='+encodeURIComponent(scope),{cache:'no-store',credentials:'same-origin',signal:abort.signal}),data=object(await response.json());if(!response.ok)throw Error(typeof data.error==='string'?data.error:'The saved week could not be loaded.');
   if(data.locationId!==undefined&&data.locationId!==scope||typeof data.pending!=='boolean')throw Error('The saved week response did not match this restaurant.');
   if(data.pending){const count=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0,date=(value:unknown)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
    if(typeof data.sourceId!=='string'||!data.sourceId||!count(data.revision)||Number(data.revision)<1||!date(data.weekStart)||!date(data.weekEnd)||String(data.weekEnd)<String(data.weekStart)||!['people','shifts','newPeople','minutes'].every(k=>count(data[k]))||!Array.isArray(data.conflicts)||data.conflicts.some(v=>typeof v!=='string'))throw Error('The saved week response needs review before adding shifts.');}
   if(isCurrent())setState({scope,view:data.pending?data as unknown as Preview:null,error:'',busy:false});
  }catch(e){if(isCurrent())setState({scope,view:null,error:e instanceof Error?e.message:'The saved week could not be loaded.',busy:false});}
 },[scope]);
 useEffect(()=>{alive.current=true;void read();return()=>{alive.current=false;generation.current++;request.current?.abort()}},[read]);
 const transfer=async()=>{if(!view||busy||view.conflicts.length)return;request.current?.abort();const abort=new AbortController();request.current=abort;const serial=++generation.current,selected=view;
  const isCurrent=()=>alive.current&&!abort.signal.aborted&&generation.current===serial&&scopeRef.current===scope;
  setState({scope,view:selected,busy:true,error:''});
  try{const response=await fetch('/api/schedule-transfer',{method:'POST',credentials:'same-origin',signal:abort.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({locationId:scope,sourceId:selected.sourceId,revision:selected.revision,confirmed:true})}),data=object(await response.json());if(!response.ok)throw Error(typeof data.error==='string'?data.error:'The saved shifts could not be added.');
   if(data.locationId!==undefined&&data.locationId!==scope||data.pending!==false||data.weekStart!==selected.weekStart||data.shifts!==undefined&&data.shifts!==selected.shifts||data.people!==undefined&&data.people!==selected.people)throw Error('The saved-week result could not be confirmed. Reload before trying again.');
   if(isCurrent()){setState({scope,view:null,busy:false,error:''});await onChanged(selected.weekStart);}
  }catch(e){if(isCurrent())setState({scope,view:selected,error:e instanceof Error?e.message:'Could not add shifts.',busy:false});}
 };
 if(!view?.pending&&!error)return null;
 return <aside className="shared-card">{error&&<><p role="alert">{error}</p><button disabled={busy} onClick={()=>void read()}>Reload saved week</button></>}{view?.pending&&<><h2>Add your saved week</h2><p>{view.weekStart} – {view.weekEnd} · {view.shifts} shifts · {view.people} people</p><p>These assignments will appear in this schedule. Employee sign-in stays disabled until you enable it.</p>{view.conflicts.map(name=><p key={name}>Needs review: {name}</p>)}<button className="shared-primary" disabled={busy||!!view.conflicts.length} onClick={()=>void transfer()}>{busy?'Adding shifts…':'Add saved shifts'}</button></>}</aside>;
}
