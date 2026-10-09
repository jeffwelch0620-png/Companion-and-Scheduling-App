import {IndexedDbQueueStorage,OfflineTaskQueue} from './offline-task-queue.mjs';
const storage=new IndexedDbQueueStorage('jmax-candidate-browser-verification');
const queue=new OfflineTaskQueue(storage,{maxAgeMs:86400000}); // Test policy only, not an adopted retention limit.
const report=document.getElementById('report');
async function call(actor,path,command){
 const token=await (await fetch('/fixture-token?actor='+actor)).json();
 const response=await fetch('/api/operations/fictional-a'+path,{
  method:command?'POST':'GET',headers:{Authorization:'Bearer '+token.token,...(command?{'Content-Type':'application/json'}:{})},
  ...(command?{body:JSON.stringify(command)}:{})
 });
 return {status:response.status,body:await response.json()};
}
async function show(note='Records loaded from IndexedDB after page load'){
 const entries=await queue.list('employee','fictional-a');
 report.textContent=JSON.stringify({note,entries:entries.map(e=>({requestId:e.requestId,recordId:e.command.recordId,
  status:e.status,attempts:e.attempts,replayed:e.result?.replayed,error:e.error}))},null,2);
}
async function action(button,operation){
 button.disabled=true;try{await operation();}catch(error){report.textContent='FAILED: '+error.message;}finally{button.disabled=false;}
}
document.getElementById('prepare').onclick=event=>action(event.target,async()=>{
 const created=await call('manager','/commands',{requestId:crypto.randomUUID(),locationId:'fictional-a',action:'task.create',
  input:{title:'Fictional browser queue task',detail:'Verify persistence and retry.',kind:'task',
   ownerId:'10000000-0000-0000-0000-000000000002',due:'2026-10-10T12:00:00-04:00'}});
 if(created.status!==200)throw new Error(JSON.stringify(created));
 await queue.enqueue('employee','fictional-a',{requestId:crypto.randomUUID(),locationId:'fictional-a',
  action:'task.transition',recordId:created.body.recordId,expectedRevision:created.body.revision,
  input:{step:'ready',note:'Fictional browser offline evidence.'}});
 await show('QUEUED: no ready command has been sent to the server. Reload to verify persistence.');
});
document.getElementById('lost').onclick=event=>action(event.target,async()=>{
 await queue.flush('employee','fictional-a',async command=>{
  const result=await call('employee','/commands',command);
  if(result.status!==200)return result;
  throw new Error('Simulated response lost after commit.');
 });
 await show('UNCERTAIN: response lost after server commit. Reload, then reconnect with the same request ID.');
});
document.getElementById('retry').onclick=event=>action(event.target,async()=>{
 const entries=await queue.flush('employee','fictional-a',command=>call('employee','/commands',command));
 if(!entries.length)throw new Error('Create a queued task first.');
 const checks=[];
 for(const entry of entries){
  const record=await call('employee','/tasks/'+entry.command.recordId);
  const readyEvents=record.body.data?.history?.filter(h=>h.action==='ready').length;
  checks.push({requestId:entry.requestId,status:entry.status,replayed:entry.result?.replayed,
   phase:record.body.data?.phase,readyEvents,pass:entry.status==='applied'&&readyEvents===1&&record.body.data.phase==='verification'});
 }
 report.textContent=JSON.stringify({note:checks.every(c=>c.pass)?'PASS: real IndexedDB reload and PostgreSQL replay produced one effect':'FAILED',checks},null,2);
});
await show();
