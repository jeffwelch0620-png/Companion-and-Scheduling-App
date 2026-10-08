'use client';
import {useEffect,useRef,useState} from 'react';
import type {Workspace} from '../shared/types';
import type {ToastScheduleSnapshot} from '../shared/toast-schedule';
import {object} from '../shared/validation';

type Preview={locationId:string;previewOnly:true;source:'toast-labor-scheduled-shifts';snapshot:ToastScheduleSnapshot;employees:{toastEmployeeId:string;memberId:string;name:string}[]};
export function ToastSchedulePreview({w,weekStart,apiRoot='/api'}:{w:Workspace;weekStart:string;apiRoot?:string}){
 const scope=apiRoot+':'+w.location.id+':'+weekStart;
 const [state,setState]=useState<{scope:string;busy:boolean;error:string;preview:Preview|null}|null>(null),request=useRef<AbortController|null>(null);
 useEffect(()=>()=>{request.current?.abort()},[scope]);
 const current=state?.scope===scope?state:null;
 async function read(){
  request.current?.abort();const controller=new AbortController();request.current=controller;
  setState({scope,busy:true,error:'',preview:null});
  try{
   const response=await fetch(apiRoot+'/integrations/toast-schedule?'+new URLSearchParams({locationId:w.location.id,weekStart}),{credentials:'same-origin',cache:'no-store',signal:controller.signal});
   const data=object(await response.json());if(!response.ok)throw Error(typeof data.error==='string'?data.error:'Toast planned shifts could not be read.');
   const snapshot=object(data.snapshot);
   if(data.locationId!==w.location.id||data.previewOnly!==true||data.source!=='toast-labor-scheduled-shifts'||snapshot.weekStart!==weekStart||snapshot.timezone!==w.location.timezone||!Array.isArray(snapshot.shifts)||!Array.isArray(data.employees))throw Error('The schedule response does not match this restaurant and week.');
   if(!controller.signal.aborted)setState({scope,busy:false,error:'',preview:data as unknown as Preview});
  }catch(error){if(!controller.signal.aborted)setState({scope,busy:false,error:error instanceof Error?error.message:'The Toast schedule read was not completed.',preview:null})}
 }
 if(w.me.position==='Dishwasher'||!w.me.capabilities.includes('location.manage'))return null;
 return <details className="schedule-secondary"><summary>Compare Toast planned shifts</summary><p>Read the POS schedule for this restaurant and week. This comparison does not change or publish either schedule, and it does not establish what appears in Sling.</p><button disabled={current?.busy} onClick={()=>void read()}>{current?.busy?'Reading Toast shifts…':'Read Toast planned shifts'}</button>{current?.error&&<p role="alert">{current.error}</p>}{current?.preview&&<ToastScheduleSnapshotView preview={current.preview}/>}</details>;
}
export function ToastScheduleSnapshotView({preview}:{preview:Preview}){
 const {snapshot,employees}=preview,active=snapshot.shifts.filter(s=>!s.deleted),names=new Map(employees.map(e=>[e.toastEmployeeId,e.name]));
 const unmatched=active.filter(s=>!names.has(s.toastEmployeeId)).length;
 const time=(at:string)=>new Date(at).toLocaleString('en-US',{timeZone:snapshot.timezone,weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
 return <section aria-label="Toast planned-shift comparison"><p role="status">{active.length} planned shifts · {snapshot.shifts.length-active.length} cancelled records · {unmatched} shifts without a verified employee match.</p><p className="shared-muted">Read {time(snapshot.retrievedAt)}. Matches use previously enabled Toast employee records; names and job titles do not grant access.</p>{!active.length?<p>Toast returned no active planned shifts for this week. This does not establish whether Sling has a schedule.</p>:<div className="shared-roster">{active.map(s=><article key={s.toastShiftId}><h3>{names.get(s.toastEmployeeId)??'Unmatched Toast employee'}</h3><p>{time(s.start)} – {time(s.end)}</p>{!names.has(s.toastEmployeeId)&&<p>Review employee setup before importing or assigning this shift.</p>}</article>)}</div>}</section>;
}
