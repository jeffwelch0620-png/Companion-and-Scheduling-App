import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {generateKeyPair,exportJWK,createLocalJWKSet,SignJWT,errors} from 'jose';
import {indexedDB} from 'fake-indexeddb';
import {createTaskHandler,makeJwtVerifier} from './task-http.ts';
import {IndexedDbQueueStorage,OfflineTaskQueue} from './offline-task-queue.mjs';
import {member,creator,owner,db} from './closing-test-fixture.mjs';
import {executeTask} from './task-adapter.ts';
import {clearCachedEmployee} from './checkout-queue-client.mjs';

const issuer='https://fictional.invalid/auth/v1';
const {privateKey,publicKey}=await generateKeyPair('ES256'),jwk=await exportJWK(publicKey);jwk.kid='fictional-recovery-key';
const localKeys=createLocalJWKSet({keys:[jwk]});
async function signed(subject,sessionId,extra={}){return new SignJWT({role:'authenticated',session_id:sessionId,...extra})
 .setSubject(subject).setIssuer(issuer).setAudience('authenticated').setIssuedAt().setExpirationTime('2m')
 .setProtectedHeader({alg:'ES256',kid:jwk.kid}).sign(privateKey);}
function queue(t,options={}){const storage=new IndexedDbQueueStorage(randomUUID(),indexedDB),q=new OfflineTaskQueue(storage,{maxAgeMs:1000,...options});t.after(()=>storage.close());return {q,storage};}
const ready=()=>({requestId:randomUUID(),recordId:randomUUID(),expectedRevision:1,locationId:'fictional-a',action:'task.transition',input:{step:'ready',note:'Fictional observed work'}});
function request(token,command){return new Request('https://candidate.invalid/api/operations/fictional-a/'+(command?'commands':'tasks'),{method:command?'POST':'GET',headers:{Authorization:'Bearer '+token,...(command?{'Content-Type':'application/json'}:{})},...(command?{body:JSON.stringify(command)}:{})});}
const response=async r=>({status:r.status,body:await r.json()});

test('key-service timeout, network and malformed key data are retryable without database access or detail leaks',async()=>{
 const token=await signed('fictional-recovery',randomUUID());let calls=0;
 const database={transaction:async()=>{calls++;throw Error('Must not reach database');}};
 for(const failure of [new errors.JWKSTimeout(),new TypeError('Private network URL'),new errors.JWKSInvalid('Private key-service body')]){
  const h=createTaskHandler(database,makeJwtVerifier({issuer,audience:'authenticated',getKey:async()=>{throw failure;}}));
  const result=await response(await h(request(token)));assert.equal(result.status,503);assert.equal(result.body.error.code,'authentication_service_unavailable');
 }
 assert.equal(calls,0);
});
test('invalid or unmatched credentials require login; malformed claims do not enter the database',async()=>{
 const database={transaction:async()=>{throw Error('Must not reach database');}};
 const h=createTaskHandler(database,makeJwtVerifier({issuer,audience:'authenticated',getKey:localKeys}));
 for(const token of ['broken-token',await signed('fictional-recovery',randomUUID(),{role:'service_role'}),await signed('fictional-recovery','bad-session')]){
  const result=await response(await h(request(token)));assert.equal(result.status,401);assert.equal(result.body.error.code,'authentication_required');
 }
 const unmatched=createTaskHandler(database,makeJwtVerifier({issuer,audience:'authenticated',getKey:async()=>{throw new errors.JWKSNoMatchingKey();}}));
 assert.equal((await unmatched(request(await signed('fictional-recovery',randomUUID())))).status,401);
});
test('revoked and expired database sessions retain queued work; a new session applies the same intent once',async t=>{
 const actor=await member([]),sessionId=randomUUID();await owner.query("INSERT INTO candidate_identity.sessions VALUES($1,$2,true,clock_timestamp()+interval '1 hour')",[sessionId,actor.subject]);
 const task=await executeTask(db,creator,'fictional-a',{requestId:randomUUID(),locationId:'fictional-a',action:'task.create',input:{title:'Fictional renewed-session task',detail:'Recovery without duplicate work',kind:'task',ownerId:actor.membershipId,due:'2031-06-01T18:00:00-04:00'}});
 const c={...ready(),recordId:task.recordId,expectedRevision:task.revision},{q}=queue(t,{maxAgeMs:86400000});await q.enqueue(actor.subject,'fictional-a',c);
 const h=createTaskHandler(db,makeJwtVerifier({issuer,audience:'authenticated',getKey:localKeys}));let token=await signed(actor.subject,sessionId);
 const send=async command=>response(await h(request(token,command)));
 await owner.query('UPDATE candidate_identity.sessions SET active=false WHERE id=$1',[sessionId]);
 assert.equal((await q.flush(actor.subject,'fictional-a',send))[0].status,'needs_auth');
 await owner.query("UPDATE candidate_identity.sessions SET active=true,expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1",[sessionId]);
 assert.equal((await q.flush(actor.subject,'fictional-a',send))[0].status,'needs_auth');
 const renewed=randomUUID();await owner.query("INSERT INTO candidate_identity.sessions VALUES($1,$2,true,clock_timestamp()+interval '1 hour')",[renewed,actor.subject]);token=await signed(actor.subject,renewed);
 const applied=(await q.flush(actor.subject,'fictional-a',send))[0];assert.equal(applied.status,'applied');assert.equal(applied.result.requestId,c.requestId);
 assert.equal((await response(await h(request(token,c)))).body.replayed,true);
});
test('permission denial remains blocked after login and returns to delivery only after explicit retry',async t=>{
 const actor=await member([]),sessionId=randomUUID();await owner.query("INSERT INTO candidate_identity.sessions VALUES($1,$2,true,clock_timestamp()+interval '1 hour')",[sessionId,actor.subject]);
 const task=await executeTask(db,creator,'fictional-a',{requestId:randomUUID(),locationId:'fictional-a',action:'task.create',input:{title:'Fictional restored-access task',detail:'Review current access',kind:'task',ownerId:actor.membershipId,due:'2031-06-01T18:00:00-04:00'}});
 const c={...ready(),recordId:task.recordId,expectedRevision:task.revision},{q}=queue(t,{maxAgeMs:86400000});await q.enqueue(actor.subject,'fictional-a',c);
 const h=createTaskHandler(db,async()=>({subject:actor.subject,sessionId})),send=async command=>response(await h(request('fictional',command)));
 await owner.query('UPDATE candidate_identity.memberships SET active=false WHERE id=$1',[actor.membershipId]);
 assert.equal((await q.flush(actor.subject,'fictional-a',send))[0].status,'blocked');
 await owner.query('UPDATE candidate_identity.memberships SET active=true WHERE id=$1',[actor.membershipId]);
 assert.equal((await q.flush(actor.subject,'fictional-a',send))[0].status,'blocked');
 await q.retry(actor.subject,'fictional-a',c.requestId);assert.equal((await q.flush(actor.subject,'fictional-a',send))[0].status,'applied');
});
test('temporary key and database failures leave exact queued intent pending, then deliver',async t=>{
 const {q}=queue(t),c=ready();await q.enqueue('employee','fictional-a',c);
 for(const status of [503,429,408]){const result=await q.flush('employee','fictional-a',async sent=>{assert.deepEqual(sent,c);return {status};});assert.equal(result[0].status,'pending');assert.equal(result[0].requestId,c.requestId);}
 await q.flush('employee','fictional-a',async()=>{throw Object.assign(Error('Login provider'),{status:401});});assert.equal((await q.list('employee','fictional-a'))[0].status,'needs_auth');
});
test('database unavailable stays service failure; only resolver session_denied is login-required',async()=>{
 for(const failure of [{code:'08006',message:'Private database hostname'},{code:'42501',message:'actor_denied'},{code:'42501',message:'session_denied'}]){
  const h=createTaskHandler({transaction:async operation=>operation({query:async sql=>{if(sql.startsWith('SET TRANSACTION'))return {rows:[]};throw failure;}})},async()=>({subject:'fictional',sessionId:randomUUID()}));
  const result=await response(await h(request('fictional')));assert.equal(result.status,failure.code==='08006'?503:failure.message==='session_denied'?401:403);assert.ok(!JSON.stringify(result.body).includes('Private'));
 }
});
test('reviewed aged intent retains original payload and date; automatic replay still stops on changed work',async t=>{
 let now=1000;const {q}=queue(t,{now:()=>now,maxAgeMs:10}),c=ready();await q.enqueue('employee','fictional-a',c);now=1011;
 assert.equal((await q.flush('employee','fictional-a',()=>{throw Error('Must not send');}))[0].status,'needs_review');
 await q.retry('employee','fictional-a',c.requestId);
 const result=await q.flush('employee','fictional-a',async sent=>{assert.deepEqual(sent,c);return {status:409,body:{error:{code:'revision_conflict'}}};});
 assert.equal(result[0].status,'needs_review');assert.equal(result[0].createdAt,1000);assert.equal(result[0].reviewedAt,1011);assert.deepEqual(result[0].command,c);
 let calls=0;await q.flush('employee','fictional-a',()=>{calls++;});assert.equal(calls,0);
});
test('discard and shared-device clearing are isolated to selected subject and include all locations',async t=>{
 const {q}=queue(t),a=ready(),b={...ready(),locationId:'fictional-b'},other=ready();
 await q.enqueue('employee','fictional-a',a);await q.enqueue('employee','fictional-b',b);await q.enqueue('other','fictional-a',other);
 await q.discard('other','fictional-a',a.requestId);assert.equal((await q.list('employee','fictional-a')).length,1);
 await q.clearSubject('employee');assert.deepEqual(await q.list('employee','fictional-a'),[]);assert.deepEqual(await q.list('employee','fictional-b'),[]);assert.equal((await q.list('other','fictional-a')).length,1);
});
test('active delivery cannot be retried, discarded or cleared; atomic clear preserves other entries on refusal',async t=>{
 let now=1000;const {q}=queue(t,{now:()=>now}),c=ready();await q.enqueue('employee','fictional-a',c);now++;await q.enqueue('employee','fictional-a',ready());
 let release,started;const begun=new Promise(r=>started=r),held=new Promise(r=>release=r);
 const flushing=q.flush('employee','fictional-a',async()=>{started();await held;return {status:503};});await begun;
 try{for(const operation of [()=>q.retry('employee','fictional-a',c.requestId),()=>q.discard('employee','fictional-a',c.requestId),()=>q.clearSubject('employee')])await assert.rejects(operation,/submission_in_progress/);
 assert.equal((await q.list('employee','fictional-a')).length,2);}finally{release();await flushing;}
});
test('device assignment cleanup removes selected employee snapshots from earlier fixture runs only',()=>{
 const values=new Map([['p:records:old:employee:close',1],['p:records:new:employee:dish:selected',2],['p:records:new:other:close',3],['p:fixture',4],['unrelated',5]]);
 const storage={get length(){return values.size;},key:index=>[...values.keys()][index],removeItem:key=>values.delete(key)};
 clearCachedEmployee(storage,'p:','employee');assert.deepEqual([...values.keys()],['p:records:new:other:close','p:fixture','unrelated']);
});
test('signing-key and database outages recover with one real queued task effect',async t=>{
 const actor=await member([]),sessionId=randomUUID();await owner.query("INSERT INTO candidate_identity.sessions VALUES($1,$2,true,clock_timestamp()+interval '1 hour')",[sessionId,actor.subject]);
 const task=await executeTask(db,creator,'fictional-a',{requestId:randomUUID(),locationId:'fictional-a',action:'task.create',input:{title:'Fictional transient-service recovery',detail:'Same intent after service recovery',kind:'task',ownerId:actor.membershipId,due:'2031-06-01T18:00:00-04:00'}});
 const c={...ready(),recordId:task.recordId,expectedRevision:task.revision},{q}=queue(t,{maxAgeMs:86400000});await q.enqueue(actor.subject,'fictional-a',c);
 let keysDown=true,databaseDown=false;
 const verifier=makeJwtVerifier({issuer,audience:'authenticated',getKey:async(...args)=>{if(keysDown)throw new errors.JWKSTimeout();return localKeys(...args);}});
 const h=createTaskHandler({transaction:operation=>{if(databaseDown)throw Object.assign(Error('fictional outage'),{code:'08006'});return db.transaction(operation);}},verifier),token=await signed(actor.subject,sessionId),send=async command=>response(await h(request(token,command)));
 assert.equal((await q.flush(actor.subject,'fictional-a',send))[0].status,'pending');keysDown=false;databaseDown=true;
 assert.equal((await q.flush(actor.subject,'fictional-a',send))[0].status,'pending');databaseDown=false;
 assert.equal((await q.flush(actor.subject,'fictional-a',send))[0].status,'applied');
 assert.equal((await send(c)).body.replayed,true);
 const state=await db.transaction(async conn=>(await conn.query('SELECT candidate_operations.read_task($1,$2,$3,$4) AS result',[actor.subject,actor.membershipId,'fictional-a',task.recordId])).rows[0].result);
 assert.equal(state.data.history.filter(event=>event.action==='ready').length,1);
});
test('expired crash lease can be recovered after storage reopen without changing the intent',async t=>{
 let now=1000;const {q,storage}=queue(t,{now:()=>now,maxAgeMs:86400000}),c=ready();await q.enqueue('employee','fictional-a',c);
 const [entry]=await q.list('employee','fictional-a');await storage.mutate(entry.key,current=>({entry:{...current,status:'sending',lease:{id:randomUUID(),until:1010}},value:null}));
 await storage.close();now=1011;await q.retry('employee','fictional-a',c.requestId);
 const [recovered]=await q.list('employee','fictional-a');assert.equal(recovered.status,'pending');assert.deepEqual(recovered.command,c);assert.equal(recovered.createdAt,1000);
 await q.discard('employee','fictional-a',c.requestId);assert.deepEqual(await q.list('employee','fictional-a'),[]);
});
