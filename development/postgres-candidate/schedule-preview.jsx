// Existing Companion forms, isolated fictional PostgreSQL data.
import React,{useState,useEffect,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {WorkspaceForm,RecordDetail} from '../../app/team/workspace-forms';
import {LeadershipBoard,LeadershipEditor,LeadershipDetail} from './ui-leadership';
import {ClosingTransferCancellation} from './ui-closing-transfer';
import {AttendanceHistory,ShiftAttendance} from './ui-attendance';
import {PublishedShiftChanges} from './ui-published-shift';
import {CoverageSwapBoard,ShiftReplacementForm,CoverageSwapDetail} from './ui-coverage-swap';
import {isOffer} from './coverage-swap-client.mjs';
import {ScheduleRequests} from '../../app/team/schedule-requests';
import {ScheduleBoard} from './ui-schedule-board';
import {ShiftEditor} from './ui-shift-editor';
import {WeeklyPublicationReview} from './ui-weekly-publication';
import {loadWeeklyPublicationReview,publishableDrafts} from './weekly-publication-client.mjs';
import {manages} from '../../app/shared/types';
import {localDate,nextDate,displayTime} from '../../app/shared/local-time';
import {loadScheduleScreen,ScheduleScreenSender,publicationRecovery,clearPublicationRecovery,publicationRecoveryMessage} from './schedule-screen-client.mjs';
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
 const [actor,setActor]=useState('schedule-worker'),[w,setWorkspace]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[view,setView]=useState(null),[screen,setScreen]=useState('schedule'),[week,setWeek]=useState(''),[boardView,setBoardView]=useState('day'),[draftDay,setDraftDay]=useState(''),[selectedIds,setSelectedIds]=useState([]),[publicationReview,setPublicationReview]=useState(null);
 const [recovery,setRecovery]=useState(null);
 const sender=useRef(new ScheduleScreenSender()),generation=useRef(0),inFlight=useRef(false);
 function deviceStorage(){try{return sessionStorage;}catch{return null;}}
 async function refresh(who=actor){const id=++generation.current;setWorkspace(null);setRecovery(null);setSelectedIds([]);setPublicationReview(null);try{const next=await loadScheduleScreen((...args)=>call(who,...args));if(id===generation.current){setWorkspace(next);setRecovery(publicationRecovery(deviceStorage(),scope,next.me.id));if(!sender.current.pending)sender.current=new ScheduleScreenSender({storage:deviceStorage(),actorId:next.me.id});}}catch(e){if(id===generation.current)setError(e.message);}}
 useEffect(()=>{sender.current=new ScheduleScreenSender();setView(null);setScreen('schedule');setError('');setMessage('');refresh(actor);return()=>{generation.current++;};},[actor]);
 async function send(action,input,record){
  if(inFlight.current)throw Error('Please wait for the current submission.');inFlight.current=true;setBusy(true);setError('');setMessage('');
  try{await sender.current.send((...args)=>call(actor,...args),scope,action,input,record);setView(null);setMessage('Submission saved.');await refresh();return true;}
  catch(e){setError(e.message);if(!sender.current.pending){setPublicationReview(null);await refresh();}throw e;}finally{inFlight.current=false;setBusy(false);}
 }
 async function reviewSelection(){if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');setMessage('');setPublicationReview(null);try{setPublicationReview(await loadWeeklyPublicationReview((...args)=>call(actor,...args),w,weekStart,selectedIds));}catch(e){setError(e.message);}finally{inFlight.current=false;setBusy(false);}}
 async function retrySubmission(){if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');setMessage('');try{await sender.current.retry((...args)=>call(actor,...args));setView(null);setMessage('Submission saved.');await refresh();}catch(e){setError(e.message);if(!sender.current.pending){setPublicationReview(null);await refresh();}}finally{inFlight.current=false;setBusy(false);}}
 const selected=w&&view?.id?w.records.find(r=>r.id===view.id):null,now=new Date().toISOString(),day=w?localDate(now,w.location.timezone):'';
 const monday=day?nextDate(day,-((new Date(day+'T12:00:00Z').getUTCDay()+6)%7)):'',weekStart=week||monday,days=weekStart?Array.from({length:7},(_,i)=>nextDate(weekStart,i)):[];
 const shifts=w?w.records.filter(r=>r.kind==='shift'&&!r.data.cancelled&&days.includes(localDate(r.data.start,w.location.timezone))):[];
 const eligible=w?publishableDrafts(w,weekStart,now):[];
 const canDraft=w&&w.members.some(m=>manages(w.me,m.area,'schedule.manage'));
 function changeWeek(next){setMessage('');setError('');setWeek(next);setSelectedIds([]);setPublicationReview(null);setView(null);}
 function selectDraft(r,checked){setPublicationReview(null);setSelectedIds(old=>checked?old.includes(r.id)?old:[...old,r.id].slice(0,100):old.filter(id=>id!==r.id));}
 return <main className="shared-ui jmax-combined" style={{maxWidth:960,margin:'24px auto',padding:24}}>
  <h1>Companion scheduling | local preview</h1><p>Fictional records. Scheduling, dated leadership and private manager attendance. Coverage and named replacement requests include explicit consent and independent approval. Copying and completed-shift corrections remain separate preparation steps.</p>
  <label>Preview employee <select aria-label="Preview employee" value={actor} disabled={busy||!!sender.current.pending} onChange={e=>setActor(e.target.value)}><option value="schedule-worker">Fictional employee</option><option value="schedule-replacement">Fictional replacement employee</option><option value="schedule-manager">Fictional schedule manager</option><option value="schedule-publisher">Fictional schedule publisher</option><option value="schedule-foreign">Fictional other-department manager</option></select></label>
  <button disabled={busy||!!sender.current.pending} onClick={()=>{setView(null);setError('');refresh();}}>Reload current records</button>
  {error&&<p role="alert" className="shared-error">{error}</p>}<p role="status">{message}</p>
  {w&&recovery&&<section role="alert"><p>{publicationRecoveryMessage}</p><button disabled={busy||!!sender.current.pending} onClick={()=>{clearPublicationRecovery(deviceStorage(),scope,w.me.id);setRecovery(null);}}>I checked current published shifts</button></section>}
  {sender.current.pending&&!busy&&<p>Keep this page open and retry the original submission. Scheduling requests require a connection; they are not saved in the employee task offline queue.</p>}
  {sender.current.pending&&!busy&&<button disabled={busy} onClick={retrySubmission}>Retry original submission</button>}
  {w?<fieldset disabled={busy||!!sender.current.pending} style={{border:0,padding:0}}>
   {!view&&screen==='requests'&&<ScheduleRequests w={{...w,records:w.records.filter(r=>!isOffer(r))}} now={now} busy={busy} onBack={()=>setScreen('schedule')} onTimeOff={()=>setView({kind:'time-off'})} onAvailability={()=>setView({kind:'availability'})} onOpen={r=>setView({id:r.id})}/>}
   {!view&&screen==='leadership'&&<LeadershipBoard w={w} onOpen={r=>setView({id:r.id})} onCreate={()=>setView({kind:'leadership'})} onBack={()=>setScreen('schedule')}/>}
   {!view&&screen==='coverage'&&<CoverageSwapBoard w={w} onOpen={r=>setView({id:r.id})} onBack={()=>setScreen('schedule')}/>}
   {!view&&screen==='attendance'&&<AttendanceHistory key={w.me.id} w={w} call={path=>call(actor,path)} send={send} onError={setError} onBack={()=>setScreen('schedule')}/>}
   {!view&&screen==='schedule'&&<section className="schedule-week">
    <button onClick={()=>setScreen('leadership')}>Dated shift leadership</button>
    {Array.isArray(w.attendanceAreas)&&w.attendanceAreas.length>0&&<button onClick={()=>setScreen('attendance')}>Attendance history</button>}
    <button onClick={()=>setScreen('coverage')}>Coverage and replacement requests</button>{w.offerReviewNotices>0&&<p role="status">Some replacement requests need review. Open coverage requests to review the notice or contact a manager.</p>}
    {canDraft&&<button className="shared-primary" onClick={()=>{setDraftDay(days.includes(draftDay)?draftDay:days.includes(day)?day:weekStart);setView({kind:'draft'});}}>Create shift draft</button>}
    {eligible.length>0&&!publicationReview&&<div className="schedule-draft-actions"><p>{selectedIds.length} selected drafts; up to 100 per publication.</p><div className="shared-actions"><button onClick={()=>setSelectedIds(eligible.slice(0,100).map(r=>r.id))}>Select eligible drafts</button><button disabled={!selectedIds.length} onClick={()=>setSelectedIds([])}>Clear selection</button><button disabled={!selectedIds.length} onClick={reviewSelection}>Review selected drafts</button></div></div>}
    {publicationReview&&<WeeklyPublicationReview w={w} review={publicationReview} now={now} busy={busy} send={send} onError={setError} onBack={()=>setPublicationReview(null)}/>}
    <ScheduleBoard key={actor+weekStart} w={w} now={now} days={days} shifts={shifts} selected={selectedIds} onSelect={selectDraft} onOpen={r=>setView({id:r.id})} busy={busy} onRequests={()=>setScreen('requests')} pendingRequests={w.records.filter(r=>!isOffer(r)&&['request','availability'].includes(r.kind)&&r.data.status==='pending').length} onDayChange={setDraftDay} view={boardView} onViewChange={setBoardView} weekNavigation={<div className="shared-actions"><button onClick={()=>changeWeek(nextDate(weekStart,-7))}>Previous week</button><span>Week of {weekStart}</span><button onClick={()=>changeWeek(nextDate(weekStart,7))}>Next week</button></div>}/>
   </section>}
   {view&&<button disabled={!!sender.current.pending} onClick={()=>setView(null)}>Back to {screen==='requests'?'requests':screen==='coverage'?'replacement requests':screen==='leadership'?'leadership':'schedule'}</button>}
   {view?.kind&&view.kind!=='draft'&&view.kind!=='leadership'&&<WorkspaceForm key={actor+view.kind} kind={view.kind} w={w} day={day} send={send} onError={setError}/>}
   {(view?.kind==='leadership'||view?.leadershipEdit)&&<LeadershipEditor key={actor+':leader:'+selected?.id} w={w} record={view?.leadershipEdit?selected:undefined} day={day} send={send} onError={setError}/>}
   {selected?.kind==='leadership'&&!view?.leadershipEdit&&<LeadershipDetail w={w} record={selected} onEdit={()=>setView({id:selected.id,leadershipEdit:true})} send={send} onError={setError}/>}
   {(view?.kind==='draft'||view?.edit)&&<ShiftEditor key={actor+':'+(selected?.id??'new')} w={w} day={draftDay||weekStart} shift={view?.edit?selected:undefined} send={send} onError={setError}/>}
   {selected?.kind==='shift'&&view?.cancellationReview&&<ClosingTransferCancellation key={selected.id+':cancel:'+selected.revision+':'+w.location.revision} w={w} record={selected} call={path=>call(actor,path)} send={send} onError={setError} onBack={()=>setView({id:selected.id})}/>}
   {selected?.kind==='shift'&&!view?.edit&&!view?.cancellationReview&&<section><h2>{selected.data.stationName??selected.data.position}</h2><p>{w.members.find(m=>m.id===selected.ownerId)?.name??'Unavailable employee'} | {selected.data.published?'Published':'Draft'}</p><p>{displayTime(selected.data.start,w.location.timezone)} → {displayTime(selected.data.end,w.location.timezone)}</p>{!selected.data.published&&manages(w.me,selected.area,'schedule.manage')&&<><p>Only command-created, unlinked candidate drafts can be edited. Imported references remain protected.</p><button onClick={()=>setView({id:selected.id,edit:true})}>Edit draft</button></>}<p>Select eligible drafts on the schedule board to review weekly publication and attached closing responsibilities. Manager attendance is available below; completed-record corrections remain separate.</p>{selected.data.published&&<PublishedShiftChanges key={selected.id+':published:'+selected.revision} w={w} record={selected} send={send} onError={setError} onReviewCancellation={()=>setView({id:selected.id,cancellationReview:true})}/>}<ShiftAttendance key={actor+':attendance:'+selected.id+':'+selected.revision} w={w} shift={selected} call={path=>call(actor,path)} send={send} onError={setError} onHistory={()=>{setView(null);setScreen('attendance');}}/><ShiftReplacementForm key={selected.id+':'+selected.revision} w={w} shift={selected} send={send} now={now} onOpen={r=>{setScreen('coverage');setView({id:r.id});}} onError={setError}/></section>}
   {selected?.kind==='request'&&selected.data.type==='time-off'&&<p>This candidate can approve time off with no affected shifts or with eligible, unlinked drafts. Published or linked work must be resolved separately before approval.</p>}
   {selected&&isOffer(selected)&&<CoverageSwapDetail key={selected.id+':'+selected.revision} w={w} record={selected} send={send} now={now} onError={setError}/>}
   {selected&&selected.kind!=='shift'&&selected.kind!=='leadership'&&!isOffer(selected)&&<RecordDetail key={selected.id+':'+selected.revision} record={selected} w={w} now={now} send={async(...args)=>{try{return await send(...args);}catch{return false;}}} onError={setError} onOpen={r=>setView({id:r.id})} onWeek={()=>setScreen('schedule')} onGuides={()=>{}} onAskWeek={()=>{}}/>}
  </fieldset>:<p>Current records are not loaded. Reload to continue.</p>}
 </main>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
