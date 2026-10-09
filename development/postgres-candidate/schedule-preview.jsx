// Existing Companion forms, isolated fictional PostgreSQL data.
import React,{useState,useEffect,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {WorkspaceForm,RecordDetail} from '../../app/team/workspace-forms';
import {ScheduleRequests} from '../../app/team/schedule-requests';
import {localDate} from '../../app/shared/local-time';
import {loadScheduleScreen,ScheduleScreenSender} from './schedule-screen-client.mjs';
import '../../app/team/workspace.css';
import '../../app/team/schedule-mobile.css';
import '../../app/team/jmax-shell.css';
import '../../app/team/inviting-theme.css';
const scope='fictional-schedule-preview';
async function call(actor,path,command){
 const tokenResponse=await fetch('/fixture-token?actor='+actor);
 if(!tokenResponse.ok)throw Error('Preview identity unavailable.');
 const {token}=await tokenResponse.json();
 const response=await fetch('/api/operations/'+scope+path,{method:command?'POST':'GET',headers:{Authorization:'Bearer '+token,...(command?{'Content-Type':'application/json'}:{})},...(command?{body:JSON.stringify(command)}:{})});
 return {status:response.status,body:await response.json()};
}
function Preview(){
 const [actor,setActor]=useState('schedule-worker'),[w,setWorkspace]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[view,setView]=useState(null);
 const sender=useRef(new ScheduleScreenSender()),generation=useRef(0),inFlight=useRef(false);
 async function refresh(who=actor){const id=++generation.current;setWorkspace(null);try{const next=await loadScheduleScreen((...args)=>call(who,...args));if(id===generation.current)setWorkspace(next);}catch(e){if(id===generation.current)setError(e.message);}}
 useEffect(()=>{sender.current=new ScheduleScreenSender();setView(null);setError('');setMessage('');refresh(actor);return()=>{generation.current++;};},[actor]);
 async function send(action,input,record){
  if(inFlight.current)throw Error('Please wait for the current submission.');inFlight.current=true;setBusy(true);setError('');
  try{await sender.current.send((...args)=>call(actor,...args),scope,action,input,record);setView(null);setMessage('Submission saved.');await refresh();return true;}
  catch(e){setError(e.message);throw e;}finally{inFlight.current=false;setBusy(false);}
 }
 const selected=w&&view?.id?w.records.find(r=>r.id===view.id):null,now=new Date().toISOString(),day=w?localDate(now,w.location.timezone):'';
 return <main className="shared-ui jmax-combined" style={{maxWidth:960,margin:'24px auto',padding:24}}>
  <h1>Companion scheduling · local preview</h1><p>Fictional records. Availability and time-off requests only. Schedule publication, copying and attendance are separate preparation steps.</p>
  <label>Preview employee <select aria-label="Preview employee" value={actor} disabled={busy||!!sender.current.pending} onChange={e=>setActor(e.target.value)}><option value="schedule-worker">Fictional employee</option><option value="schedule-manager">Fictional schedule manager</option><option value="schedule-foreign">Fictional other-department manager</option></select></label>
  <button disabled={busy||!!sender.current.pending} onClick={()=>{setView(null);setError('');refresh();}}>Reload current records</button>
  {error&&<p role="alert" className="shared-error">{error}</p>}<p role="status">{message}</p>
  {sender.current.pending&&<p>Keep this page open and retry the same submission. Scheduling requests require a connection; they are not saved in the employee task offline queue.</p>}
  {w?<fieldset disabled={busy} style={{border:0,padding:0}}>
   {!view&&<ScheduleRequests w={w} now={now} busy={busy} onBack={()=>setMessage('This preview covers requests; the full schedule board is pending.')} onTimeOff={()=>setView({kind:'time-off'})} onAvailability={()=>setView({kind:'availability'})} onOpen={r=>setView({id:r.id})}/>}
   {view&&<button disabled={!!sender.current.pending} onClick={()=>setView(null)}>Back to requests</button>}
   {view?.kind&&<WorkspaceForm key={actor+view.kind} kind={view.kind} w={w} day={day} send={send} onError={setError}/>}
   {selected?.kind==='request'&&<p>This candidate can approve time off with no affected shifts or with eligible, unlinked drafts. Published or linked work must be resolved separately before approval.</p>}
   {selected&&<RecordDetail key={selected.id+':'+selected.revision} record={selected} w={w} now={now} send={async(...args)=>{try{return await send(...args);}catch{return false;}}} onError={setError} onOpen={r=>setView({id:r.id})} onWeek={()=>setMessage('Full schedule board is pending.')} onGuides={()=>{}} onAskWeek={()=>{}}/>}
  </fieldset>:<p>Current records are not loaded. Reload to continue.</p>}
 </main>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
