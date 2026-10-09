import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {PostgresDatabase} from './postgres-driver.ts';
import {executeTask,parseCommand} from './task-adapter.ts';
import {connection as config} from './test-config.mjs';
const db=new PostgresDatabase({...config,user:'candidate_runtime',max:4}),owner=new pg.Pool({...config,user:'candidate_owner',max:2});
after(async()=>{await db.close();await owner.end();});
const actor=name=>({subject:name,membershipId:{manager:'10000000-0000-0000-0000-000000000001',employee:'10000000-0000-0000-0000-000000000002',peer:'10000000-0000-0000-0000-000000000003'}[name]});
const manager=actor('manager'),employee=actor('employee'),peer=actor('peer');
const command=(incoming=peer,target=employee)=>({requestId:randomUUID(),locationId:'fictional-a',action:'task.create',input:{kind:'handoff',ownerId:target.membershipId,incomingId:incoming.membershipId,title:'Fictional station handoff '+randomUUID(),detail:'Fictional station condition and remaining work.',due:'2026-10-10T12:00:00-04:00'}});
const step=(task,verb)=>({requestId:randomUUID(),locationId:'fictional-a',action:'task.transition',recordId:task.recordId,expectedRevision:task.revision,input:{step:verb,note:'Fictional handoff '+verb+' evidence.'}});
const run=(actor,command)=>executeTask(db,actor,'fictional-a',command);
const denied=status=>e=>e.status===status;
const read=(actor,task)=>db.transaction(async c=>(await c.query('SELECT candidate_operations.read_task($1,$2,$3,$4) AS result',[actor.subject,actor.membershipId,'fictional-a',task.recordId])).rows[0].result);
async function acceptance(){let task=await run(manager,command());task=await run(employee,step(task,'ready'));return run(manager,step(task,'verify'));}
async function extra({department='BOH',restaurant='fictional-a',position='Cook',active=true,scheduleOnly=false,wide=false}={}){
 const person=randomUUID(),membershipId=randomUUID(),subject='handoff-fixture-'+randomUUID();
 await owner.query('INSERT INTO candidate_identity.people(id,name) VALUES($1,$2)',[person,'Fictional handoff fixture']);
 await owner.query('INSERT INTO candidate_identity.auth_links(subject,person_id) VALUES($1,$2)',[subject,person]);
 await owner.query('INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position,active,schedule_only) VALUES($1,$2,$3,$4,$5,$6,$7)',[membershipId,person,restaurant,department,position,active,scheduleOnly]);
 if(wide)for(const cap of ['tasks.manage','location.manage'])await owner.query('INSERT INTO candidate_identity.membership_capabilities(membership_id,capability) VALUES($1,$2)',[membershipId,cap]);
 return {subject,membershipId};
}
test('station handoff requires verification before incoming acceptance; outgoing owner is retained',async()=>{
 let task=await run(manager,command());assert.equal((await read(peer,task)).data.incomingId,peer.membershipId);
 task=await run(employee,step(task,'ready'));task=await run(manager,step(task,'verify'));assert.equal((await read(peer,task)).data.phase,'acceptance');
 task=await run(peer,step(task,'accept'));const record=await read(employee,task);
 assert.equal(record.ownerId,employee.membershipId);assert.equal(record.data.phase,'closed');assert.deepEqual(record.data.history.map(h=>h.action),['assigned','ready','verify','accept']);
});
test('incoming dispute returns work to correction and requires another independent verification',async()=>{
 let task=await acceptance();task=await run(peer,step(task,'dispute'));assert.equal((await read(employee,task)).data.phase,'correction');
 await assert.rejects(run(peer,step(task,'accept')),denied(409));task=await run(employee,step(task,'ready'));task=await run(manager,step(task,'verify'));task=await run(peer,step(task,'accept'));
 assert.equal((await read(peer,task)).data.history.length,7);
});
test('only the named incoming employee can accept or dispute, and only at acceptance phase',async()=>{
 const task=await run(manager,command());await assert.rejects(run(peer,step(task,'accept')),denied(409));
 await assert.rejects(run(peer,step(task,'ready')),denied(403));await assert.rejects(run(peer,step(task,'verify')),denied(403));
 const checked=await run(manager,step(await run(employee,step(task,'ready')),'verify'));
 for(const wrong of [employee,manager])for(const verb of ['accept','dispute'])await assert.rejects(run(wrong,step(checked,verb)),denied(403));
});
test('creation rejects same-person, foreign, inactive, schedule-only and dishwasher incoming employees',async()=>{
 await assert.rejects(run(manager,command(employee)),denied(403));
 for(const options of [{restaurant:'fictional-b'},{active:false},{scheduleOnly:true},{position:'Dishwasher'}])await assert.rejects(run(manager,command(await extra(options))),denied(403));
 await assert.rejects(run(manager,command(peer,await extra({position:'Dishwasher'}))),denied(403));
});
test('creator must manage both departments; location-wide grants enable cross-department incoming employee',async()=>{
 const incoming=await extra({department:'FOH'});await assert.rejects(run(manager,command(incoming)),denied(403));
 const wide=await extra({wide:true});let task=await run(wide,command(incoming));task=await run(employee,step(task,'ready'));task=await run(wide,step(task,'verify'));assert.equal((await run(incoming,step(task,'accept'))).revision,4);
});
test('reassignment cannot collapse outgoing and incoming identities and preserves incoming link',async()=>{
 const task=await run(manager,command());
 const change=target=>({requestId:randomUUID(),locationId:'fictional-a',action:'task.reassign',recordId:task.recordId,expectedRevision:1,input:{ownerId:target.membershipId,note:'Fictional remaining work reassignment.'}});
 await assert.rejects(run(manager,change(peer)),denied(403));const changed=await run(manager,change(manager));
 const record=await read(peer,changed);assert.equal(record.data.incomingId,peer.membershipId);assert.equal(record.data.phase,'open');
});
test('incoming detail and paginated list visibility does not expose unrelated tasks',async()=>{
 const incoming=await extra(),task=await run(manager,command(incoming));
 const result=await db.transaction(async c=>(await c.query('SELECT candidate_operations.list_tasks($1,$2,$3,NULL,100) AS result',[incoming.subject,incoming.membershipId,'fictional-a'])).rows[0].result);
 assert.equal(result.items.length,1);assert.equal(result.items[0].id,task.recordId);
 await assert.rejects(read(await extra(),task),e=>e.code==='42501');
});
test('acceptance replay produces one event and changed request payload conflicts',async()=>{
 const task=await acceptance(),accept=step(task,'accept');const first=await run(peer,accept),retry=await run(peer,accept);
 assert.equal(retry.replayed,true);assert.equal(retry.revision,first.revision);assert.equal((await read(peer,task)).data.history.length,4);
 await assert.rejects(run(peer,{...accept,input:{...accept.input,note:'Different acceptance evidence'}}),denied(409));
});
test('verification notifies incoming employee; dispute notifies outgoing employee',async()=>{
 const task=await acceptance();
 const recipients=revision=>owner.query('SELECT recipient_id FROM candidate_operations.notification_outbox WHERE task_id=$1 AND revision=$2',[task.recordId,revision]);
 assert.deepEqual((await recipients(3)).rows.map(r=>r.recipient_id),[peer.membershipId]);await run(peer,step(task,'dispute'));
 assert.deepEqual((await recipients(4)).rows.map(r=>r.recipient_id),[employee.membershipId]);
});
test('concurrent acceptance and dispute produce only one next revision',async()=>{
 const task=await acceptance(),results=await Promise.allSettled([run(peer,step(task,'accept')),run(peer,step(task,'dispute'))]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);assert.equal((await read(peer,task)).revision,4);
});
test('revocation and changed dishwasher eligibility deny incoming responses and receipt replay',async()=>{
 const incoming=await extra();let task=await run(manager,command(incoming));task=await run(employee,step(task,'ready'));task=await run(manager,step(task,'verify'));const accept=step(task,'accept');await run(incoming,accept);
 await owner.query("UPDATE candidate_identity.memberships SET position='Dishwasher' WHERE id=$1",[incoming.membershipId]);await assert.rejects(run(incoming,accept),denied(403));
 await owner.query('UPDATE candidate_identity.memberships SET active=false WHERE id=$1',[incoming.membershipId]);await assert.rejects(read(incoming,task),e=>e.code==='42501');
});
test('handoff parser requires exact incoming identity and rejects client-provided acceptance metadata',()=>{
 for(const value of [{...command(),input:{...command().input,incomingId:null}},{...command(),input:{...command().input,kind:'issue'}},{...command(),input:{...command().input,closingHandoff:{}}}])assert.throws(()=>parseCommand(value,'fictional-a'),denied(400));
});
test('failed acceptance notification rolls back phase, history and receipt',async()=>{
 const task=await acceptance(),accept=step(task,'accept');
 await owner.query(`CREATE FUNCTION candidate_operations.test_accept_failure() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN IF NEW.task_id='${task.recordId}'::uuid AND NEW.revision=4 THEN RAISE EXCEPTION 'fictional acceptance notification failure'; END IF; RETURN NEW; END; $$;
 CREATE TRIGGER test_accept_failure BEFORE INSERT ON candidate_operations.notification_outbox FOR EACH ROW EXECUTE FUNCTION candidate_operations.test_accept_failure();`);
 try{
  await assert.rejects(run(peer,accept),e=>e.message==='fictional acceptance notification failure');const record=await read(peer,task);assert.equal(record.data.phase,'acceptance');assert.equal(record.revision,3);assert.equal(record.data.history.length,3);
  assert.equal((await owner.query('SELECT count(*)::int AS n FROM candidate_operations.command_receipts WHERE request_id=$1',[accept.requestId])).rows[0].n,0);
 }finally{await owner.query('DROP TRIGGER test_accept_failure ON candidate_operations.notification_outbox; DROP FUNCTION candidate_operations.test_accept_failure();');}
});
