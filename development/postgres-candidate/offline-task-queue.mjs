// Candidate browser queue. Tokens are supplied at send time and never persisted.
// Only ready submissions on existing ordinary tasks are supported.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class QueueError extends Error {}
const copy=value=>structuredClone(value);
function entryKey(subject,scope,requestId){return JSON.stringify([subject,scope,requestId]);}

export class IndexedDbQueueStorage {
 constructor(name='jmax-candidate-task-queue',factory=globalThis.indexedDB){
  if(!factory)throw new QueueError('durable_storage_unavailable');
  this.name=name;this.factory=factory;this.opening=null;
 }
 open(){
  if(!this.opening)this.opening=new Promise((resolve,reject)=>{
   const request=this.factory.open(this.name,1);
   request.onupgradeneeded=()=>request.result.createObjectStore('entries',{keyPath:'key'});
   request.onsuccess=()=>resolve(request.result);
   request.onerror=()=>{this.opening=null;reject(request.error);};
   request.onblocked=()=>{this.opening=null;reject(new QueueError('storage_blocked'));};
  });return this.opening;
 }
 async mutate(key,operation){
  const db=await this.open();
  return new Promise((resolve,reject)=>{
   const tx=db.transaction('entries','readwrite'),store=tx.objectStore('entries');
   let outcome,error;
   const request=store.get(key);
   request.onsuccess=()=>{
    try{
     const change=operation(request.result?copy(request.result):undefined);
     outcome=copy(change.value);
     if(change.entry)store.put(copy(change.entry));else if(change.remove)store.delete(key);
    }catch(e){error=e;tx.abort();}
   };
   tx.oncomplete=()=>resolve(outcome);
   tx.onabort=tx.onerror=()=>reject(error??tx.error??new QueueError('storage_failure'));
  });
 }
 async all(){
  const db=await this.open();
  return new Promise((resolve,reject)=>{
   const tx=db.transaction('entries','readonly'),request=tx.objectStore('entries').getAll();
   let entries;
   request.onsuccess=()=>{entries=request.result;};
   tx.oncomplete=()=>resolve(copy(entries??[]));
   tx.onabort=tx.onerror=()=>reject(tx.error??new QueueError('storage_failure'));
  });
 }
 async close(){if(this.opening){(await this.opening).close();this.opening=null;}}
}

export class OfflineTaskQueue {
 constructor(storage,{maxAgeMs,leaseMs=30000,now=()=>Date.now()}){
  if(!Number.isFinite(maxAgeMs)||maxAgeMs<=0||!Number.isFinite(leaseMs)||leaseMs<=0)
   throw new QueueError('queue_policy_required');
  this.storage=storage;this.maxAgeMs=maxAgeMs;this.leaseMs=leaseMs;this.now=now;
 }
 async enqueue(subject,scope,command){
  if(typeof subject!=='string'||!subject||typeof scope!=='string'||!scope)
   throw new QueueError('identity_required');
  if(!command||command.locationId!==scope||command.action!=='task.transition'
   ||!uuid.test(command.requestId??'')||!uuid.test(command.recordId??'')
   ||!Number.isSafeInteger(command.expectedRevision)||command.expectedRevision<1
   ||!command.input||command.input.step!=='ready'||typeof command.input.note!=='string'
   ||!command.input.note.trim()||command.input.note.trim().length>8000
   ||Object.keys(command.input).some(k=>!['step','note'].includes(k))
   ||Object.keys(command).some(k=>!['requestId','locationId','action','recordId','expectedRevision','input'].includes(k)))
   throw new QueueError('offline_action_not_supported');
  const payload=copy(command),key=entryKey(subject,scope,command.requestId);
  return this.storage.mutate(key,previous=>{
   if(previous){
    if(JSON.stringify(previous.command)!==JSON.stringify(payload))throw new QueueError('request_payload_conflict');
    return {value:previous};
   }
   const entry={key,subject,scope,requestId:payload.requestId,command:payload,status:'pending',
    createdAt:this.now(),attempts:0,lease:null,result:null,error:null};
   return {entry,value:entry};
  });
 }
 async list(subject,scope){
  return (await this.storage.all()).filter(e=>e.subject===subject&&e.scope===scope)
   .sort((a,b)=>a.createdAt-b.createdAt||a.key.localeCompare(b.key));
 }
 async flush(subject,scope,send){
  const entries=await this.list(subject,scope);
  for(const entry of entries){
   const lease=crypto.randomUUID(),now=this.now();
   const reserved=await this.storage.mutate(entry.key,current=>{
    if(!current||!['pending','needs_auth','sending'].includes(current.status))
     return {value:null};
    if(current.status==='sending'&&current.lease?.until>now)return {value:null};
    if(now-current.createdAt>this.maxAgeMs){
     const expired={...current,status:'needs_review',error:'queue_age_exceeded',lease:null};
     return {entry:expired,value:null};
    }
    const next={...current,status:'sending',attempts:current.attempts+1,lease:{id:lease,until:now+this.leaseMs}};
    return {entry:next,value:next};
   });
   if(!reserved)continue;
   let update;
   try{
    // Caller obtains a fresh token for this subject/session. No stored bearer token.
    const response=await send(copy(reserved.command));
    if(response.status>=200&&response.status<300){
     const body=response.body;
     if(!body||body.requestId!==reserved.requestId||body.recordId!==reserved.command.recordId
      ||!Number.isInteger(body.revision)||body.revision<=reserved.command.expectedRevision
      ||!Number.isInteger(body.workspaceRevision)||typeof body.appliedAt!=='string'
      ||typeof body.replayed!=='boolean')throw new QueueError('unconfirmed_response');
     update={status:'applied',result:copy(body),error:null};
    }else if(response.status===401)update={status:'needs_auth',error:'authentication_required'};
    else if(response.status===403)update={status:'blocked',error:'access_denied'};
    else if(response.status===409)update={status:'needs_review',error:response.body?.error?.code??'record_changed'};
    else if(response.status>=500||[408,429].includes(response.status))update={status:'pending',error:'temporarily_unavailable'};
    else update={status:'rejected',error:'invalid_submission'};
   }catch{update={status:'pending',error:'delivery_uncertain'};}
   await this.storage.mutate(entry.key,current=>{
    if(current?.lease?.id!==lease)return {value:null};
    const next={...current,...update,lease:null};return {entry:next,value:next};
   });
   if(update.status==='needs_auth'||update.status==='pending')break;
  }
  return this.list(subject,scope);
 }
}
