// Existing Companion forms, isolated fictional PostgreSQL data.
import React,{useState,useEffect,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {WorkspaceForm,RecordDetail} from '../../app/team/workspace-forms';
import {ScheduleRequests} from '../../app/team/schedule-requests';
import {ScheduleBoard} from './ui-schedule-board';
import {ShiftEditor} from './ui-shift-editor';
import {manages} from '../../app/shared/types';
import {localDate,nextDate,displayTime} from '../../app/shared/local-time';
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
 const [actor,setActor]=useState('schedule-worker'),[w,setWorkspace]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[view,setView]=useState(null),[screen,setScreen]=useState('schedule'),[week,setWeek]=useState(''),[boardView,setBoardView]=useState('day'),[draftDay,setDraftDay]=useState('');
 const sender=useRef(new ScheduleScreenSender()),generation=useRef(0),inFlight=useRef(false);
 async function refresh(who=actor){const id=++generation.current;setWorkspace(null);try{const next=await loadScheduleScreen((...args)=>call(who,...args));if(id===generation.current)setWorkspace(next);}catch(e){if(id===generation.current)setError(e.message);}}
 useEffect(()=>{sender.current=new ScheduleScreenSender();setView(null);setScreen('schedule');setError('');setMessage('');refresh(actor);return()=>{generation.current++;};},[actor]);
 async function send(action,input,record){
  if(inFlight.current)throw Error('Please wait for the current submission.');inFlight.current=true;setBusy(true);setError('');
  try{await sender.current.send((...args)=>call(actor,...args),scope,action,input,record);setView(null);setMessage('Submission saved.');await refresh();return true;}
  catch(e){setError(e.message);throw e;}finally{inFlight.current=false;setBusy(false);}
 }
 const selected=w&&view?.id?w.records.find(r=>r.id===view.id):null,now=new Date().toISOString(),day=w?localDate(now,w.location.timezone):'';
 const monday=day?nextDate(day,-((new Date(day+'T12:00:00Z').getUTCDay()+6)%7)):'',weekStart=week||monday,days=weekStart?Array.from({length:7},(_,i)=>nextDate(weekStart,i)):[];
 const shifts=w?w.records.filter(r=>r.kind==='shift'&&!r.data.cancelled&&days.includes(localDate(r.data.start,w.location.timezone))):[];
 const canDraft=w&&w.members.some(m=>manages(w.me,m.area,'schedule.manage'));
 return <main className="shared-ui jmax-combined" style={{maxWidth:960,margin:'24px auto',padding:24}}>
  <h1>Companion scheduling · local preview</h1><p>Fictional records. Schedule board, individual drafts, availability and time-off requests. Publication, copying, coverage and attendance are separate preparation steps; attendance is not loaded here.</p>
  <label>Preview employee <select aria-label="Preview employee" value={actor} disabled={busy||!!sender.current.pending} onChange={e=>setActor(e.target.value)}><option value="schedule-worker">Fictional employee</option><option value="schedule-manager">Fictional schedule manager</option><option value="schedule-foreign">Fictional other-department manager</option></select></label>
  <button disabled={busy||!!sender.current.pending} onClick={()=>{setView(null);setError('');refresh();}}>Reload current records</button>
  {error&&<p role="alert" className="shared-error">{error}</p>}<p role="status">{message}</p>
  {sender.current.pending&&<p>Keep this page open and retry the same submission. Scheduling requests require a connection; they are not saved in the employee task offline queue.</p>}
  {w?<fieldset disabled={busy} style={{border:0,padding:0}}>
   {!view&&screen==='requests'&&<ScheduleRequests w={w} now={now} busy={busy} onBack={()=>setScreen('schedule')} onTimeOff={()=>setView({kind:'time-off'})} onAvailability={()=>setView({kind:'availability'})} onOpen={r=>setView({id:r.id})}/>}
   {!view&&screen==='schedule'&&<section className="schedule-week">
    {canDraft&&<button className="shared-primary" onClick={()=>{setDraftDay(days.includes(draftDay)?draftDay:days.includes(day)?day:weekStart);setView({kind:'draft'});}}>Create shift draft</button>}
    <ScheduleBoard key={actor+weekStart} w={w} now={now} days={days} shifts={shifts} selected={[]} onSelect={()=>setMessage('Weekly publication selection is pending.')} onOpen={r=>setView({id:r.id})} busy={busy} onRequests={()=>setScreen('requests')} pendingRequests={w.records.filter(r=>['request','availability'].includes(r.kind)&&r.data.status==='pending').length} onDayChange={setDraftDay} view={boardView} onViewChange={setBoardView} weekNavigation={<div className="shared-actions"><button onClick={()=>setWeek(nextDate(weekStart,-7))}>Previous week</button><span>Week of {weekStart}</span><button onClick={()=>setWeek(nextDate(weekStart,7))}>Next week</button></div>}/>
   </section>}
   {view&&<button disabled={!!sender.current.pending} onClick={()=>setView(null)}>Back to {screen==='requests'?'requests':'schedule'}</button>}
   {view?.kind&&view.kind!=='draft'&&<WorkspaceForm key={actor+view.kind} kind={view.kind} w={w} day={day} send={send} onError={setError}/>}
   {(view?.kind==='draft'||view?.edit)&&<ShiftEditor key={actor+':'+(selected?.id??'new')} w={w} day={draftDay||weekStart} shift={view?.edit?selected:undefined} send={send} onError={setError}/>}
   {selected?.kind==='shift'&&!view?.edit&&<section><h2>{selected.data.stationName??selected.data.position}</h2><p>{w.members.find(m=>m.id===selected.ownerId)?.name??'Unavailable employee'} · {selected.data.published?'Published':'Draft'}</p><p>{displayTime(selected.data.start,w.location.timezone)} → {displayTime(selected.data.end,w.location.timezone)}</p>{!selected.data.published&&manages(w.me,selected.area,'schedule.manage')&&<><p>Only command-created, unlinked candidate drafts can be edited. Imported references remain protected.</p><button onClick={()=>setView({id:selected.id,edit:true})}>Edit draft</button></>}<p>Publication, published changes, closing duties and attendance controls are not enabled in this screen.</p></section>}
   {selected?.kind==='request'&&<p>This candidate can approve time off with no affected shifts or with eligible, unlinked drafts. Published or linked work must be resolved separately before approval.</p>}
   {selected&&selected.kind!=='shift'&&<RecordDetail key={selected.id+':'+selected.revision} record={selected} w={w} now={now} send={async(...args)=>{try{return await send(...args);}catch{return false;}}} onError={setError} onOpen={r=>setView({id:r.id})} onWeek={()=>setScreen('schedule')} onGuides={()=>{}} onAskWeek={()=>{}}/>}
  </fieldset>:<p>Current records are not loaded. Reload to continue.</p>}
 </main>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
