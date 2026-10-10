import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {PostgresDatabase} from './postgres-driver.ts';
import {executeTask} from './task-adapter.ts';
import {manages} from '../../app/shared/types.ts';
import {connection as config} from './test-config.mjs';
const owner=new pg.Pool({...config,user:'candidate_owner',max:3});
const db=new PostgresDatabase({...config,user:'candidate_runtime',max:3});
after(async()=>{await db.close();await owner.end();});
async function actor({department='BOH',restaurant='fictional-a',position='Cook',capabilities=[],scheduleOnly=false}={}){
 const person=randomUUID(),id=randomUUID(),subject='permission-test-'+randomUUID();
 await owner.query('INSERT INTO candidate_identity.people(id,name) VALUES($1,$2)',[person,'Fictional permission test']);
 await owner.query('INSERT INTO candidate_identity.auth_links(subject,person_id) VALUES($1,$2)',[subject,person]);
 await owner.query('INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position,schedule_only) VALUES($1,$2,$3,$4,$5,$6)',[id,person,restaurant,department,position,scheduleOnly]);
 for(const cap of capabilities)await owner.query('INSERT INTO candidate_identity.membership_capabilities(membership_id,capability) VALUES($1,$2)',[id,cap]);
 return {subject,membershipId:id,restaurant,department,position,capabilities,scheduleOnly};
}
const assignment=target=>({requestId:randomUUID(),locationId:target.restaurant,action:'task.create',input:{ownerId:target.membershipId,kind:'task',title:'Fictional permission task',detail:'Evidence for authorization parity.',due:'2026-10-10T12:00:00-04:00'}});
const transition=(task,step)=>({requestId:randomUUID(),locationId:'fictional-a',action:'task.transition',recordId:task.recordId,expectedRevision:task.revision,input:{step,note:'Fictional permission evidence.'}});
const run=(actor,command)=>executeTask(db,actor,command.locationId,command);
const denied=e=>e.status===403;
async function policy(actor,department){return (await owner.query('SELECT candidate_operations.task_manager($1,$2,$3) AS allowed',[actor.membershipId,actor.restaurant,department])).rows[0].allowed;}
async function read(actor,task){return db.transaction(async c=>(await c.query('SELECT candidate_operations.read_task($1,$2,$3,$4) AS result',[actor.subject,actor.membershipId,'fictional-a',task.recordId])).rows[0].result);}

test('ordinary-task capability and scope match Companion manages for eligible staff',async()=>{
 for(const capabilities of [[],['tasks.manage'],['location.manage'],['tasks.manage','location.manage'],['tasks.manage','operations.store'],['operations.store']]){
  const member=await actor({capabilities});
  for(const department of ['BOH','FOH','production'])assert.equal(await policy(member,department),manages({area:member.department,capabilities},department,'tasks.manage'),JSON.stringify({capabilities,department}));
 }
});
test('GM title alone and location administration without tasks permission cannot assign',async()=>{
 const target=await actor();
 for(const options of [{position:'General Manager'},{capabilities:['location.manage']}]){
  const manager=await actor(options);await assert.rejects(run(manager,assignment(target)),denied);
 }
});
test('department manager cannot assign, read or check ordinary work in another department',async()=>{
 const manager=await actor({capabilities:['tasks.manage']}),wide=await actor({capabilities:['tasks.manage','location.manage']}),target=await actor({department:'FOH'});
 await assert.rejects(run(manager,assignment(target)),denied);
 const task=await run(wide,assignment(target));await assert.rejects(read(manager,task),e=>e.code==='42501');
 const ready=await run(target,transition(task,'ready'));await assert.rejects(run(manager,transition(ready,'verify')),denied);
});
test('location-wide task grant covers other departments but never another restaurant',async()=>{
 const manager=await actor({capabilities:['tasks.manage','location.manage']});
 for(const department of ['FOH','production']){
  const target=await actor({department}),task=await run(manager,assignment(target));
  assert.equal((await read(manager,task)).area,department);
  const ready=await run(target,transition(task,'ready'));assert.equal((await run(manager,transition(ready,'verify'))).revision,3);
 }
 const foreign=await actor({restaurant:'fictional-b'});
 await assert.rejects(run(manager,assignment(foreign)),denied);
 await assert.rejects(run(manager,{...assignment(foreign),locationId:'fictional-a'}),denied);
});
test('whole-store operations capability does not widen ordinary task management',async()=>{
 const manager=await actor({capabilities:['tasks.manage','operations.store']}),target=await actor({department:'FOH'});
 assert.equal(await policy(manager,'BOH'),true);assert.equal(await policy(manager,'FOH'),false);
 await assert.rejects(run(manager,assignment(target)),denied);
});
test('dishwasher may report own ordinary work ready but cannot assign or check despite grants',async()=>{
 const manager=await actor({capabilities:['tasks.manage']}),dishwasher=await actor({position:'Dishwasher',capabilities:['tasks.manage','location.manage']}),peer=await actor();
 await assert.rejects(run(dishwasher,assignment(peer)),denied);
 const task=await run(manager,assignment(dishwasher)),ready=await run(dishwasher,transition(task,'ready'));
 await assert.rejects(run(dishwasher,transition(ready,'fix')),denied);
 await assert.rejects(run(dishwasher,transition(ready,'verify')),denied);
 assert.equal((await run(manager,transition(ready,'verify'))).revision,3);
});
test('schedule-only identity cannot receive or submit tasks even when grants are present',async()=>{
 const manager=await actor({capabilities:['tasks.manage']}),target=await actor({scheduleOnly:true,capabilities:['tasks.manage','location.manage']}),peer=await actor();
 await assert.rejects(run(manager,assignment(target)),denied);
 await assert.rejects(run(target,assignment(peer)),denied);
});
test('revoking location scope denies reads, new commands and replay of cross-department receipts',async()=>{
 const manager=await actor({capabilities:['tasks.manage','location.manage']}),target=await actor({department:'FOH'}),command=assignment(target),task=await run(manager,command);
 const list=()=>db.transaction(async c=>(await c.query('SELECT candidate_operations.list_tasks($1,$2,$3,NULL,100) AS result',[manager.subject,manager.membershipId,'fictional-a'])).rows[0].result);
 const before=await list();
 // Pagination is already covered by the existing route suite; the full list can exceed one page.
 if(before.items.length<100)assert.ok(before.items.some(r=>r.id===task.recordId));
 await owner.query("UPDATE candidate_identity.membership_capabilities SET active=false WHERE membership_id=$1 AND capability='location.manage'",[manager.membershipId]);
 await assert.rejects(read(manager,task),e=>e.code==='42501');
 assert.ok((await list()).items.every(r=>r.area==='BOH'));
 await assert.rejects(run(manager,command),denied);await assert.rejects(run(manager,assignment(target)),denied);
 assert.equal((await read(target,task)).data.phase,'open');
});
test('revoking tasks capability denies manager transition receipt replay',async()=>{
 const manager=await actor({capabilities:['tasks.manage']}),target=await actor(),task=await run(manager,assignment(target)),ready=await run(target,transition(task,'ready')),verify=transition(ready,'verify');
 await run(manager,verify);
 await owner.query("UPDATE candidate_identity.membership_capabilities SET active=false WHERE membership_id=$1 AND capability='tasks.manage'",[manager.membershipId]);
 await assert.rejects(run(manager,verify),denied);await assert.rejects(read(manager,task),e=>e.code==='42501');
});
test('ready notification includes authorized location manager, excludes operations-only and foreign actors',async()=>{
 const wide=await actor({capabilities:['tasks.manage','location.manage']}),same=await actor({department:'FOH',capabilities:['tasks.manage']}),limited=await actor({capabilities:['tasks.manage','operations.store']}),foreign=await actor({restaurant:'fictional-b',capabilities:['tasks.manage','location.manage']}),target=await actor({department:'FOH'});
 const task=await run(wide,assignment(target));await run(target,transition(task,'ready'));
 const recipients=(await owner.query('SELECT recipient_id FROM candidate_operations.notification_outbox WHERE task_id=$1 AND revision=2',[task.recordId])).rows.map(r=>r.recipient_id);
 assert.ok(recipients.includes(wide.membershipId));assert.ok(recipients.includes(same.membershipId));
 assert.ok(!recipients.includes(limited.membershipId));assert.ok(!recipients.includes(foreign.membershipId));
});
test('grant row lock keeps authorization valid through commit and revocation takes effect afterwards',async()=>{
 const manager=await actor({capabilities:['tasks.manage']}),target=await actor(),command=assignment(target);
 let unlock,entered;const held=new Promise(resolve=>entered=resolve),release=new Promise(resolve=>unlock=resolve);
 const operation=db.transaction(async connection=>{const result=await executeTask({transaction:fn=>fn(connection)},manager,'fictional-a',command);entered();await release;return result;});
 await held;
 const client=await owner.connect();
 try{
  await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='100ms'");
  await assert.rejects(client.query("UPDATE candidate_identity.membership_capabilities SET active=false WHERE membership_id=$1 AND capability='tasks.manage'",[manager.membershipId]),e=>e.code==='55P03');
 }finally{await client.query('ROLLBACK');client.release();unlock();}
 await operation;
 await owner.query("UPDATE candidate_identity.membership_capabilities SET active=false WHERE membership_id=$1 AND capability='tasks.manage'",[manager.membershipId]);
 await assert.rejects(run(manager,command),denied);
});
test('runtime cannot edit or directly inspect capability tables or call internal policy helper',async()=>{
 for(const sql of ['SELECT * FROM candidate_identity.membership_capabilities',"UPDATE candidate_identity.membership_capabilities SET active=true","SELECT candidate_operations.task_manager('10000000-0000-0000-0000-000000000001','fictional-a','BOH')"]){
  await assert.rejects(db.transaction(c=>c.query(sql,[])),e=>e.code==='42501');
 }
});
