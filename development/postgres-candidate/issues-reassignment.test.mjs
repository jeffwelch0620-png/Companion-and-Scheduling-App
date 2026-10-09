import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {indexedDB} from 'fake-indexeddb';
import {PostgresDatabase} from './postgres-driver.ts';
import {executeTask,parseCommand} from './task-adapter.ts';
import {IndexedDbQueueStorage,OfflineTaskQueue} from './offline-task-queue.mjs';
import {connection as config} from './test-config.mjs';
const db=new PostgresDatabase({...config,user:'candidate_runtime',max:4}),owner=new pg.Pool({...config,user:'candidate_owner',max:2});
after(async()=>{await db.close();await owner.end();});
const identity=actor=>({subject:actor,membershipId:{manager:'10000000-0000-0000-0000-000000000001',employee:'10000000-0000-0000-0000-000000000002',peer:'10000000-0000-0000-0000-000000000003'}[actor]});
const manager=identity('manager'),employee=identity('employee'),peer=identity('peer');
const create=(kind='issue',target=employee)=>({requestId:randomUUID(),locationId:'fictional-a',action:'task.create',input:{kind,ownerId:target.membershipId,title:'Fictional reassignment '+randomUUID(),detail:'Resolve the fictional operational condition.',due:'2026-10-10T12:00:00-04:00'}});
const step=(task,verb)=>({requestId:randomUUID(),locationId:'fictional-a',action:'task.transition',recordId:task.recordId,expectedRevision:task.revision,input:{step:verb,note:'Fictional workflow evidence.'}});
const reassign=(task,target=peer)=>({requestId:randomUUID(),locationId:'fictional-a',action:'task.reassign',recordId:task.recordId,expectedRevision:task.revision,input:{ownerId:target.membershipId,note:'Move the remaining work to the next employee.'}});
const run=(actor,command)=>executeTask(db,actor,'fictional-a',command);
const denied=status=>e=>e.status===status;
const read=(actor,task)=>db.transaction(async c=>(await c.query('SELECT candidate_operations.read_task($1,$2,$3,$4) AS result',[actor.subject,actor.membershipId,'fictional-a',task.recordId])).rows[0].result);
async function extra({department='BOH',restaurant='fictional-a',position='Cook',active=true,scheduleOnly=false,grant=false}={}){
 const person=randomUUID(),membershipId=randomUUID(),subject='issue-fixture-'+randomUUID();
 await owner.query('INSERT INTO candidate_identity.people(id,name) VALUES($1,$2)',[person,'Fictional issue fixture']);
 await owner.query('INSERT INTO candidate_identity.auth_links(subject,person_id) VALUES($1,$2)',[subject,person]);
 await owner.query('INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position,active,schedule_only) VALUES($1,$2,$3,$4,$5,$6,$7)',[membershipId,person,restaurant,department,position,active,scheduleOnly]);
 if(grant)await owner.query("INSERT INTO candidate_identity.membership_capabilities(membership_id,capability) VALUES($1,'tasks.manage')",[membershipId]);
 return {subject,membershipId};
}
test('operational issue retains its kind through correction, submission and independent verification',async()=>{
 let task=await run(manager,create());assert.equal((await read(employee,task)).data.kind,'issue');
 task=await run(employee,step(task,'ready'));task=await run(manager,step(task,'fix'));task=await run(employee,step(task,'ready'));task=await run(manager,step(task,'verify'));
 const record=await read(manager,task);assert.equal(record.data.phase,'closed');assert.equal(record.data.kind,'issue');assert.deepEqual(record.data.history.map(h=>h.action),['assigned','ready','fix','ready','verify']);
});
test('reassignment resets verification to open, preserves issue details and records both responsible employees',async()=>{
 const task=await run(manager,create()),oldReady=step(task,'ready'),ready=await run(employee,oldReady),changed=await run(manager,reassign(ready));
 const record=await read(peer,changed);assert.equal(record.ownerId,peer.membershipId);assert.equal(record.data.phase,'open');assert.equal(record.data.kind,'issue');assert.equal(record.data.history.length,3);
 const event=record.data.history.at(-1);assert.equal(event.previousOwnerId,employee.membershipId);assert.equal(event.ownerId,peer.membershipId);assert.match(event.note,/Move the remaining work/);
 assert.equal(record.data.due,(await read(manager,task)).data.due);
 await assert.rejects(read(employee,changed),e=>e.code==='42501');await assert.rejects(run(employee,oldReady),denied(403));
 const next=await run(peer,step(changed,'ready'));assert.equal((await run(manager,step(next,'verify'))).revision,5);
});
test('dishwasher cannot receive issues but may receive reassigned ordinary tasks',async()=>{
 const dish=await extra({position:'Dishwasher'});await assert.rejects(run(manager,create('issue',dish)),denied(403));
 const issue=await run(manager,create());await assert.rejects(run(manager,reassign(issue,dish)),denied(403));
 const task=await run(manager,create('task')),changed=await run(manager,reassign(task,dish));assert.equal((await run(dish,step(changed,'ready'))).revision,3);
});
test('reassignment rejects different departments, restaurants, inactive and schedule-only targets',async()=>{
 const task=await run(manager,create());
 for(const options of [{department:'FOH'},{restaurant:'fictional-b'},{active:false},{scheduleOnly:true}])await assert.rejects(run(manager,reassign(task,await extra(options))),denied(403));
 assert.equal((await read(manager,task)).revision,1);
});
test('employee and dishwasher with grants cannot reassign work',async()=>{
 const task=await run(manager,create('task'));await assert.rejects(run(employee,reassign(task)),denied(403));
 const dish=await extra({position:'Dishwasher',grant:true});await assert.rejects(run(dish,reassign(task)),denied(403));
});
test('stale revisions and closed tasks reject reassignment without effects',async()=>{
 const task=await run(manager,create()),ready=await run(employee,step(task,'ready'));
 await assert.rejects(run(manager,reassign(task)),denied(409));const closed=await run(manager,step(ready,'verify'));
 await assert.rejects(run(manager,reassign(closed)),denied(409));assert.equal((await read(manager,task)).data.history.length,3);
});
test('uncertain reassignment replays one receipt and changed payload conflicts',async()=>{
 const task=await run(manager,create()),command=reassign(task),first=await run(manager,command),retry=await run(manager,command);
 assert.equal(retry.replayed,true);assert.equal(first.revision,retry.revision);assert.equal((await read(manager,task)).data.history.length,2);
 await assert.rejects(run(manager,{...command,input:{...command.input,note:'Changed reason'}}),denied(409));
 const recipients=(await owner.query('SELECT recipient_id FROM candidate_operations.notification_outbox WHERE task_id=$1 AND revision=2',[task.recordId])).rows.map(r=>r.recipient_id).sort();
 assert.deepEqual(recipients,[employee.membershipId,peer.membershipId].sort());
});
test('same-person reassignment preserves source behavior and emits one recipient notification',async()=>{
 const task=await run(manager,create()),changed=await run(manager,reassign(task,employee));assert.equal((await read(employee,changed)).data.phase,'open');
 assert.equal((await owner.query('SELECT count(*)::int AS n FROM candidate_operations.notification_outbox WHERE task_id=$1 AND revision=2',[task.recordId])).rows[0].n,1);
});
test('concurrent ready and reassignment from same version produce only one next revision',async()=>{
 const task=await run(manager,create('task')),results=await Promise.allSettled([run(employee,step(task,'ready')),run(manager,reassign(task))]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const rejected=results.find(r=>r.status==='rejected').reason;assert.ok([403,409].includes(rejected.status));
 assert.equal((await read(manager,task)).revision,2);assert.equal((await read(manager,task)).data.history.length,2);
});
test('queued submission by former responsible employee is held after reassignment',async()=>{
 const task=await run(manager,create('task')),storage=new IndexedDbQueueStorage('issue-queue-'+randomUUID(),indexedDB),queue=new OfflineTaskQueue(storage,{maxAgeMs:86400000});
 try{
  await queue.enqueue('employee','fictional-a',step(task,'ready'));await run(manager,reassign(task));
  const result=await queue.flush('employee','fictional-a',async command=>{try{return {status:200,body:await run(employee,command)};}catch(e){return {status:e.status,body:{error:{code:e.code}}};}});
  assert.equal(result[0].status,'blocked');assert.equal((await read(peer,task)).data.phase,'open');assert.equal((await read(peer,task)).data.history.length,2);
 }finally{await storage.close();}
});
test('unsupported checkout/handoff and malformed reassignment inputs remain rejected',()=>{
 const task={recordId:randomUUID(),revision:1},command=reassign(task);
 for(const raw of [{...command,input:{...command.input,shiftId:randomUUID()}},{...command,expectedRevision:0},{...command,input:{ownerId:peer.membershipId,note:' '}},{...create('handoff')},{...create(['issue'])},{...create(),input:{...create().input,closingHandoff:{}}}])assert.throws(()=>parseCommand(raw,'fictional-a'),denied(400));
});
test('reassignment notification failure rolls back owner, history, receipt and workspace revision',async()=>{
 const command=create('task');command.input.title='Fictional reassignment rollback';const task=await run(manager,command),change=reassign(task);
 const before=(await owner.query("SELECT revision FROM candidate_identity.restaurants WHERE id='fictional-a'")).rows[0].revision;
 await owner.query(`CREATE FUNCTION candidate_operations.test_reassign_failure() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN IF NEW.task_id='${task.recordId}'::uuid AND NEW.revision=2 THEN RAISE EXCEPTION 'fictional reassignment notification failure'; END IF; RETURN NEW; END; $$;
 CREATE TRIGGER test_reassign_failure BEFORE INSERT ON candidate_operations.notification_outbox FOR EACH ROW EXECUTE FUNCTION candidate_operations.test_reassign_failure();`);
 try{
  await assert.rejects(run(manager,change),e=>e.message==='fictional reassignment notification failure');
  const record=await read(manager,task);assert.equal(record.ownerId,employee.membershipId);assert.equal(record.revision,1);assert.equal(record.data.history.length,1);
  assert.equal((await owner.query('SELECT count(*)::int AS n FROM candidate_operations.command_receipts WHERE request_id=$1',[change.requestId])).rows[0].n,0);
  assert.equal((await owner.query("SELECT revision FROM candidate_identity.restaurants WHERE id='fictional-a'")).rows[0].revision,before);
 }finally{await owner.query('DROP TRIGGER test_reassign_failure ON candidate_operations.notification_outbox; DROP FUNCTION candidate_operations.test_reassign_failure();');}
});
