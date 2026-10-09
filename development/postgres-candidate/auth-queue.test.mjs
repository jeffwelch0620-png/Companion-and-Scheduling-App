import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {generateKeyPair,exportJWK,createLocalJWKSet,SignJWT} from 'jose';
import {indexedDB} from 'fake-indexeddb';
import {PostgresDatabase} from './postgres-driver.ts';
import {createTaskHandler,makeJwtVerifier} from './task-http.ts';
import {IndexedDbQueueStorage,OfflineTaskQueue} from './offline-task-queue.mjs';

import {connection} from './test-config.mjs';
const db=new PostgresDatabase({...connection,user:'candidate_runtime',max:4});
const owner=new pg.Pool({...connection,user:'candidate_owner',max:1});
after(async()=>{await db.close();await owner.end();});
const {privateKey,publicKey}=await generateKeyPair('ES256');
const jwk=await exportJWK(publicKey);jwk.kid='fictional-test-key';
const verifier=makeJwtVerifier({issuer:'https://fictional.invalid/auth/v1',audience:'authenticated',
 getKey:createLocalJWKSet({keys:[jwk]})});
const handler=createTaskHandler(db,verifier);
const ids={manager:'10000000-0000-0000-0000-000000000001',employee:'10000000-0000-0000-0000-000000000002',
 peer:'10000000-0000-0000-0000-000000000003',foreign:'10000000-0000-0000-0000-000000000004'};
const sessions={manager:'20000000-0000-0000-0000-000000000001',employee:'20000000-0000-0000-0000-000000000002',
 peer:'20000000-0000-0000-0000-000000000003',foreign:'20000000-0000-0000-0000-000000000004'};
async function token(actor='employee',extra={},key=privateKey){
 return new SignJWT({role:'authenticated',session_id:sessions[actor],...extra})
  .setProtectedHeader({alg:'ES256',kid:'fictional-test-key'}).setSubject(actor)
  .setIssuedAt().setIssuer(extra.iss??'https://fictional.invalid/auth/v1')
  .setAudience(extra.aud??'authenticated').setExpirationTime(extra.exp??'2m').sign(key);
}
async function call(actor,path='/tasks',command,authOverride){
 const headers={Authorization:'Bearer '+(authOverride??await token(actor))};
 if(command!==undefined)headers['Content-Type']='application/json';
 const response=await handler(new Request('https://candidate.invalid/api/operations/fictional-a'+path,{
  method:command===undefined?'GET':'POST',headers,body:command===undefined?undefined:JSON.stringify(command)
 }));
 return {status:response.status,body:await response.json(),headers:response.headers};
}
async function create(title='Fictional HTTP task'){
 const command={requestId:randomUUID(),locationId:'fictional-a',action:'task.create',
  input:{title,detail:'Fictional task evidence.',kind:'task',ownerId:ids.employee,due:'2026-10-10T12:00:00-04:00'}};
 const result=await call('manager','/commands',command);assert.equal(result.status,200);
 return {command,...result.body};
}
const ready=task=>({requestId:randomUUID(),locationId:'fictional-a',action:'task.transition',
 recordId:task.recordId,expectedRevision:task.revision,input:{step:'ready',note:'Fictional ready evidence.'}});
test('signed HTTP issue assignment and reassignment use scoped identity and current ownership',async()=>{
 const command={requestId:randomUUID(),locationId:'fictional-a',action:'task.create',input:{title:'Fictional HTTP issue reassignment',detail:'Fictional issue to move.',kind:'issue',ownerId:ids.employee,due:'2026-10-10T12:00:00-04:00'}};
 const created=await call('manager','/commands',command);assert.equal(created.status,200);
 const changed={requestId:randomUUID(),locationId:'fictional-a',action:'task.reassign',recordId:created.body.recordId,expectedRevision:1,input:{ownerId:ids.peer,note:'Fictional shift responsibility change.'}};
 assert.equal((await call('employee','/commands',changed)).status,403);
 assert.equal((await call('manager','/commands',changed)).status,200);
 assert.equal((await call('employee','/tasks/'+created.body.recordId)).status,403);
 const read=await call('peer','/tasks/'+created.body.recordId);assert.equal(read.status,200);assert.equal(read.body.data.kind,'issue');assert.equal(read.body.data.phase,'open');
 assert.equal((await call('manager','/commands',changed)).body.replayed,true);
});
test('signed HTTP handoff reads and incoming response require the named active employee',async()=>{
 const command={requestId:randomUUID(),locationId:'fictional-a',action:'task.create',input:{title:'Fictional HTTP station handoff',detail:'Fictional incoming work.',kind:'handoff',ownerId:ids.employee,incomingId:ids.peer,due:'2026-10-10T12:00:00-04:00'}};
 const task=await call('manager','/commands',command);assert.equal(task.status,200);
 assert.equal((await call('peer','/tasks/'+task.body.recordId)).status,200);
 const submitted=await call('employee','/commands',ready(task.body));assert.equal(submitted.status,200);
 const transition=step=>({requestId:randomUUID(),locationId:'fictional-a',action:'task.transition',recordId:task.body.recordId,expectedRevision:3,input:{step,note:'Fictional incoming decision.'}});
 const checked=await call('manager','/commands',{...transition('verify'),expectedRevision:2});assert.equal(checked.status,200);
 assert.equal((await call('employee','/commands',transition('accept'))).status,403);
 assert.equal((await call('peer','/commands',transition('accept'))).status,200);
 assert.equal((await call('peer','/tasks/'+task.body.recordId)).body.data.phase,'closed');
});
test('signed HTTP linked task is checked independently without releasing its shift',async()=>{
 const shiftId=randomUUID();await owner.query("INSERT INTO candidate_operations.shift_references(id,restaurant_id,member_id,department,position,starts_at,ends_at,revision,published) VALUES($1,'fictional-a',$2,'BOH','Cook','2026-10-09T12:00:00-04:00','2026-10-09T20:00:00-04:00',1,true)",[shiftId,ids.employee]);
 const command={requestId:randomUUID(),locationId:'fictional-a',action:'task.create',input:{title:'Fictional HTTP linked task',detail:'Fictional checkout work.',kind:'task',ownerId:ids.employee,shiftId,due:'2026-10-09T18:00:00-04:00'}};
 const task=await call('manager','/commands',command);assert.equal(task.status,200);
 assert.equal((await call('employee','/tasks/'+task.body.recordId)).body.data.shiftId,shiftId);
 const readyResult=await call('employee','/commands',ready(task.body));assert.equal(readyResult.status,200);
 const checked=await call('manager','/commands',{...ready(task.body),expectedRevision:2,input:{step:'verify',note:'Fictional independent check.'}});assert.equal(checked.status,200);
 assert.equal((await owner.query('SELECT released_at FROM candidate_operations.shift_references WHERE id=$1',[shiftId])).rows[0].released_at,null);
});
function queue(name=randomUUID(),options={}){
 const storage=new IndexedDbQueueStorage('candidate-'+name,indexedDB);
 const q=new OfflineTaskQueue(storage,{maxAgeMs:86400000,...options});
 return {storage,q,name};
}

test('signed tokens require correct signature, issuer, audience, expiry, role and session',async()=>{
 assert.equal((await call('employee')).status,200);
 assert.equal((await handler(new Request('https://candidate.invalid/api/operations/fictional-a/tasks'))).status,401);
 for(const claims of [{iss:'https://wrong.invalid'},{aud:'wrong'},{exp:1},{role:'service_role'},
  {is_anonymous:true},{session_id:randomUUID()}]){
  const result=await call('employee','/tasks',undefined,await token('employee',claims));
  assert.equal(result.status,claims.session_id?403:401,JSON.stringify(claims));
 }
 const other=await generateKeyPair('ES256');
 assert.equal((await call('employee','/tasks',undefined,await token('employee',{},other.privateKey))).status,401);
 const valid=await call('employee');assert.match(valid.headers.get('cache-control'),/no-store/);
});
test('authenticated identity resolves on server; scoped reads and bounded pagination',async()=>{
 const task=await create();
 assert.equal((await call('employee','/tasks/'+task.recordId)).body.data.phase,'open');
 assert.equal((await call('peer','/tasks/'+task.recordId)).status,403);
 assert.equal((await call('foreign')).status,403);
 assert.equal((await call('employee','/tasks?limit=0')).status,400);
 const first=await call('employee','/tasks?limit=1');
 assert.equal(first.body.items.length,1);assert.ok(first.body.nextCursor);
 const second=await call('employee','/tasks?limit=1&after='+first.body.nextCursor);
 assert.equal(second.status,200);assert.notEqual(first.body.items[0].id,second.body.items[0].id);
 const injected={...ready(task),actorId:ids.manager};
 assert.equal((await call('employee','/commands',injected)).status,400);
});
test('database session revocation denies an otherwise valid signed token',async()=>{
 const signed=await token('employee');
 await owner.query('UPDATE candidate_identity.sessions SET active=false WHERE id=$1',[sessions.employee]);
 try{assert.equal((await call('employee','/tasks',undefined,signed)).status,403);}
 finally{await owner.query('UPDATE candidate_identity.sessions SET active=true WHERE id=$1',[sessions.employee]);}
});
test('queue persists through storage reopen, excludes tokens and other actors, then applies',async()=>{
 const task=await create(),command=ready(task),{q,storage,name}=queue();
 await q.enqueue('employee','fictional-a',command);
 assert.equal((await q.list('employee','fictional-a'))[0].status,'pending');
 assert.deepEqual(await q.list('peer','fictional-a'),[]);
 assert.ok(!JSON.stringify(await storage.all()).includes('Bearer'));
 await storage.close();
 const reopened=queue(name);let calls=0;
 await reopened.q.flush('peer','fictional-a',async()=>{calls++;throw new Error('wrong user');});
 assert.equal(calls,0);
 const results=await reopened.q.flush('employee','fictional-a',c=>call('employee','/commands',c));
 assert.equal(results[0].status,'applied');
 assert.equal((await call('employee','/tasks/'+task.recordId)).body.data.phase,'verification');
 await reopened.storage.close();
});
test('response lost after database commit retries same request with one effect',async()=>{
 const task=await create(),command=ready(task),{q,storage}=queue();await q.enqueue('employee','fictional-a',command);
 await q.flush('employee','fictional-a',async c=>{assert.equal((await call('employee','/commands',c)).status,200);throw new Error('lost response');});
 const uncertain=(await q.list('employee','fictional-a'))[0];
 assert.equal(uncertain.status,'pending');assert.equal(uncertain.requestId,command.requestId);
 const result=await q.flush('employee','fictional-a',c=>call('employee','/commands',c));
 assert.equal(result[0].status,'applied');assert.equal(result[0].result.replayed,true);
 const read=await call('employee','/tasks/'+task.recordId);
 assert.equal(read.body.data.history.filter(h=>h.action==='ready').length,1);
 await storage.close();
});
test('stale queued work needs review rather than overwriting changed work',async()=>{
 const task=await create(),command=ready(task),{q,storage}=queue();await q.enqueue('employee','fictional-a',command);
 const correction={...ready(task),input:{step:'fix',note:'Manager changed this task.'}};
 assert.equal((await call('manager','/commands',correction)).status,200);
 const result=await q.flush('employee','fictional-a',c=>call('employee','/commands',c));
 assert.equal(result[0].status,'needs_review');assert.equal(result[0].error,'revision_conflict');
 assert.equal((await call('employee','/tasks/'+task.recordId)).body.data.phase,'correction');
 await storage.close();
});
test('membership revoked while offline blocks queued delivery',async()=>{
 const task=await create(),{q,storage}=queue();await q.enqueue('employee','fictional-a',ready(task));
 await owner.query('UPDATE candidate_identity.memberships SET active=false WHERE id=$1',[ids.employee]);
 try{
  const result=await q.flush('employee','fictional-a',c=>call('employee','/commands',c));
  assert.equal(result[0].status,'blocked');
 }finally{await owner.query('UPDATE candidate_identity.memberships SET active=true WHERE id=$1',[ids.employee]);}
 assert.equal((await call('employee','/tasks/'+task.recordId)).body.data.phase,'open');
 await storage.close();
});
test('expiry requires login; renewed login delivers retained command',async()=>{
 const task=await create(),{q,storage}=queue();await q.enqueue('employee','fictional-a',ready(task));
 const expired=await token('employee',{exp:1});
 const results=await q.flush('employee','fictional-a',c=>call('employee','/commands',c,expired));
 assert.equal(results[0].status,'needs_auth');
 const retried=await q.flush('employee','fictional-a',c=>call('employee','/commands',c));
 assert.equal(retried[0].status,'applied');await storage.close();
});
test('two queue flushers claim one IndexedDB entry; aged work is held',async()=>{
 const task=await create(),{q,storage}=queue();await q.enqueue('employee','fictional-a',ready(task));
 let calls=0;
 const sender=async c=>{calls++;return call('employee','/commands',c);};
 await Promise.all([q.flush('employee','fictional-a',sender),q.flush('employee','fictional-a',sender)]);
 assert.equal(calls,1);await storage.close();
 let now=1000;const aged=queue(randomUUID(),{maxAgeMs:10,now:()=>now});
 await aged.q.enqueue('employee','fictional-a',ready(await create()));now+=11;
 const outcome=await aged.q.flush('employee','fictional-a',()=>{throw new Error('must not send');});
 assert.equal(outcome[0].status,'needs_review');assert.equal(outcome[0].error,'queue_age_exceeded');
 await aged.storage.close();
});
test('offline queue rejects unsupported actions and changed request payloads',async()=>{
 const task=await create(),command=ready(task),{q,storage}=queue();await q.enqueue('employee','fictional-a',command);
 await assert.rejects(q.enqueue('employee','fictional-a',{...command,input:{step:'verify',note:'No'}}));
 await assert.rejects(q.enqueue('employee','fictional-a',{...command,input:{...command.input,note:'Changed'}}));
 await storage.close();
});
