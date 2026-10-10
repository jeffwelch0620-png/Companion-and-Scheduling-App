// Isolated fictional preview; existing Companion components are imported unchanged.
import React,{useState,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {FollowForm,FollowDetail} from '../../app/team/followthrough-forms';
import '../../app/team/workspace.css';
import {IndexedDbQueueStorage,OfflineTaskQueue} from './offline-task-queue.mjs';
const scope='fictional-a';
const members=[['manager','001','Fictional manager','Kitchen manager',['tasks.manage']],['employee','002','Fictional employee','Cook',[]]]
 .map(([actor,end,name,position,capabilities])=>({actor,id:'10000000-0000-0000-0000-000000000'+end,locationId:scope,name,position,capabilities,area:'BOH',qualifications:[]}));
const queue=new OfflineTaskQueue(new IndexedDbQueueStorage('jmax-candidate-companion-forms'),{maxAgeMs:86400000});
const shiftFixture={id:'30000000-0000-0000-0000-000000000001',locationId:scope,ownerId:members[1].id,area:'BOH',kind:'shift',revision:1,updatedAt:'2026-10-08T12:00:00Z',data:{personId:members[1].id,start:'2026-10-09T12:00:00-04:00',end:'2026-10-09T20:00:00-04:00',position:'Cook',published:true,cancelled:false}};
async function call(actor,path,command){
 const tokenResponse=await fetch('/fixture-token?actor='+actor);
 if(!tokenResponse.ok)throw Error('Preview identity unavailable.');
 const {token}=await tokenResponse.json();
 const response=await fetch('/api/operations/'+scope+path,{method:command?'POST':'GET',headers:{Authorization:'Bearer '+token,...(command?{'Content-Type':'application/json'}:{})},...(command?{body:JSON.stringify(command)}:{})});
 return {status:response.status,body:await response.json()};
}
function Preview(){
 const [actor,setActor]=useState('manager'),[records,setRecords]=useState([]),[selected,setSelected]=useState(null),[offline,setOffline]=useState(false),[message,setMessage]=useState(''),[entries,setEntries]=useState([]),[busy,setBusy]=useState(false),[filter,setFilter]=useState('');
 const me=members.find(m=>m.actor===actor);
 const w={location:{id:scope,name:'Fictional restaurant',timezone:'America/New_York',revision:1},me,members,records:[...records,shiftFixture]};
 async function refresh(who=actor){
  const all=[];let after=null;
  do{const result=await call(who,'/tasks?limit=100'+(after?'&after='+after:''));if(result.status!==200)throw Error('Cannot load tasks: '+(result.body.error?.code??result.status));all.push(...result.body.items);after=result.body.nextCursor;}while(after);
  setRecords(all);setEntries(await queue.list(who,scope));
 }
 useEffect(()=>{let active=true;setRecords([]);setSelected(null);setMessage('');(async()=>{try{const all=[];let after=null;do{const result=await call(actor,'/tasks?limit=100'+(after?'&after='+after:''));if(result.status!==200)throw Error('Task loading failed');all.push(...result.body.items);after=result.body.nextCursor;}while(after);const saved=await queue.list(actor,scope);if(active){setRecords(all);setEntries(saved);}}catch(e){if(active)setMessage(e.message);}})();return()=>{active=false;};},[actor]);
 async function send(action,input,record){
  if(busy)throw Error('Please wait for the current submission.');
  if(action==='task.create'&&(!['task','issue','handoff'].includes(input.kind)||input.kind==='handoff'&&input.shiftId)||!['task.create','task.transition','task.reassign'].includes(action))throw Error('Linked handoffs, full shift checkout and overnight manager handoffs still need migration.');
  const command={requestId:crypto.randomUUID(),locationId:scope,action,input,...(record?{recordId:record.id,expectedRevision:record.revision}:{})};
  setBusy(true);
  try{
   if(action==='task.transition'&&input.step==='ready'){
    const retained=await queue.list(actor,scope);
    if(retained.some(e=>e.command.recordId===record.id&&e.status!=='applied'))throw Error('This task already has a saved submission. Reconnect or review its status before submitting again.');
    await queue.enqueue(actor,scope,command);
    if(!offline)await queue.flush(actor,scope,c=>call(actor,'/commands',c));
    const current=await queue.list(actor,scope);setEntries(current);
    const saved=current.find(e=>e.requestId===command.requestId);
    setMessage(saved?.status==='applied'?'Submitted for review.':saved?.status==='pending'?'Saved on this device; awaiting submission.':'Submission needs attention: '+saved?.status);
   }else{
    if(offline)throw Error('Assignments and manager checks require a connection.');
    const result=await call(actor,'/commands',command);if(result.status!==200)throw Error('Submission failed: '+(result.body.error?.code??result.status));
    setSelected(result.body.recordId);setMessage(action==='task.create'?'Work assigned.':action==='task.reassign'?'Work reassigned.':'Manager check saved.');
   }
   if(!offline)await refresh();
  }finally{setBusy(false);}
 }
 async function reconnect(){setBusy(true);try{await queue.flush(actor,scope,c=>call(actor,'/commands',c));setOffline(false);await refresh();setMessage('Reconnected. Review the saved submission status below.');}catch(e){setMessage(e.message);}finally{setBusy(false);}}
 const record=records.find(r=>r.id===selected);
 return <main style={{maxWidth:1080,margin:'24px auto',padding:24,fontFamily:'system-ui'}} className="shared-workspace">
  <h1>Companion task forms · PostgreSQL preview</h1><p>Fictional local test. Tasks can require a published shift. Closing a task does not confirm manager checkout.</p>
  <label>Preview employee <select aria-label="Preview employee" value={actor} disabled={busy} onChange={e=>setActor(e.target.value)}>{members.map(m=><option key={m.actor} value={m.actor}>{m.name}</option>)}</select></label>
  <label style={{marginLeft:24}}><input type="checkbox" checked={offline} disabled={busy} onChange={e=>setOffline(e.target.checked)}/>Simulate delayed submission</label>
  <button disabled={busy} onClick={reconnect}>Reconnect and submit saved work</button>
  <p role="status">{message}</p>
  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:32}}>
   <section><h2>{actor==='manager'?'Assign work':'Your assigned work'}</h2>{actor==='manager'&&<FollowForm key={actor} kind="task" w={w} send={send} onError={setMessage}/>}
    <h2>Tasks</h2><label>Find task <input aria-label="Find task" value={filter} onChange={e=>setFilter(e.target.value)}/></label><ul>{records.filter(r=>r.data.title.toLowerCase().includes(filter.toLowerCase())).map(r=><li key={r.id}><button onClick={()=>setSelected(r.id)}>{r.data.title} · {r.data.phase}</button></li>)}</ul></section>
   <section><h2>{record?.data.title??'Select a task'}</h2>{record&&<FollowDetail key={record.id+':'+record.revision+':'+actor} record={record} w={w} send={send} onError={setMessage}/>}</section>
  </div>
  <section><h2>Saved submissions for this employee</h2><ul>{entries.map(e=><li key={e.requestId}>{e.status} · {e.command.input.note} · attempts {e.attempts}</li>)}</ul></section>
 </main>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
