import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {PostgresDatabase} from './postgres-driver.ts';
import {executeTask,parseCommand} from './task-adapter.ts';
import {canManageClosing} from './runtime/closing-reference/closing-access.mjs';
import {connection as config} from './test-config.mjs';
const db=new PostgresDatabase({...config,user:'candidate_runtime',max:3}),owner=new pg.Pool({...config,user:'candidate_owner',max:2});
after(async()=>{await db.close();await owner.end();});
const manager={subject:'manager',membershipId:'10000000-0000-0000-0000-000000000001'},employee={subject:'employee',membershipId:'10000000-0000-0000-0000-000000000002'},peer={subject:'peer',membershipId:'10000000-0000-0000-0000-000000000003'};
async function member(capabilities=[],department='BOH',restaurant='fictional-a'){
 const person=randomUUID(),membershipId=randomUUID(),subject='shift-fixture-'+randomUUID();
 await owner.query('INSERT INTO candidate_identity.people(id,name) VALUES($1,$2)',[person,'Fictional shift fixture']);await owner.query('INSERT INTO candidate_identity.auth_links(subject,person_id) VALUES($1,$2)',[subject,person]);
 await owner.query("INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position) VALUES($1,$2,$3,$4,'Cook')",[membershipId,person,restaurant,department]);
 for(const cap of capabilities)await owner.query('INSERT INTO candidate_identity.membership_capabilities(membership_id,capability) VALUES($1,$2)',[membershipId,cap]);
 return {subject,membershipId,capabilities,area:department,position:'Cook'};
}
async function shift(options={}){
 const value={id:randomUUID(),restaurant:'fictional-a',member:employee.membershipId,department:'BOH',position:'Cook',start:'2026-10-09T12:00:00-04:00',end:'2026-10-09T20:00:00-04:00',published:true,cancelled:false,released:null,...options};
 await owner.query('INSERT INTO candidate_operations.shift_references(id,restaurant_id,member_id,department,position,starts_at,ends_at,revision,published,cancelled,released_at) VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10)',[value.id,value.restaurant,value.member,value.department,value.position,value.start,value.end,value.published,value.cancelled,value.released]);return value;
}
const create=(shift,target=employee,due='2026-10-09T16:00:00-04:00')=>({requestId:randomUUID(),locationId:'fictional-a',action:'task.create',input:{kind:'task',ownerId:target.membershipId,title:'Fictional linked work '+randomUUID(),detail:'Complete required work before manager checkout.',due,shiftId:shift.id}});
const step=(task,verb)=>({requestId:randomUUID(),locationId:'fictional-a',action:'task.transition',recordId:task.recordId,expectedRevision:task.revision,input:{step:verb,note:'Fictional linked-work evidence.'}});
const run=(actor,command)=>executeTask(db,actor,'fictional-a',command),denied=status=>e=>e.status===status;
const read=task=>db.transaction(async c=>(await c.query('SELECT candidate_operations.read_task($1,$2,$3,$4) AS result',[manager.subject,manager.membershipId,'fictional-a',task.recordId])).rows[0].result);
test('closing capability scope matches current Companion rules for eligible managers',async()=>{
 for(const capabilities of [[],['tasks.manage'],['location.manage'],['tasks.manage','location.manage'],['tasks.manage','operations.store'],['operations.store'],['close.confirm','operations.store'],['close.confirm','tasks.manage','operations.store']]){
  const actor=await member(capabilities);for(const area of ['BOH','FOH','production'])for(const capability of ['tasks.manage','close.confirm']){
   const actual=(await owner.query('SELECT candidate_operations.closing_manager($1,$2,$3,$4) AS allowed',[actor.membershipId,'fictional-a',area,capability])).rows[0].allowed;assert.equal(actual,canManageClosing(actor,area,capability),JSON.stringify({capabilities,area,capability}));
  }
 }
});
test('published shift links preserve reference revision; task verification does not release shift',async()=>{
 const reference=await shift(),task=await run(manager,create(reference));assert.equal((await read(task)).data.shiftId,reference.id);assert.equal((await read(task)).data.shiftRevision,1);
 const ready=await run(employee,step(task,'ready'));await run(manager,step(ready,'verify'));
 assert.equal((await owner.query('SELECT released_at FROM candidate_operations.shift_references WHERE id=$1',[reference.id])).rows[0].released_at,null);
});
test('due range is inclusive and compared as instants across timezone offsets',async()=>{
 const reference=await shift();for(const due of [reference.start,reference.end,'2026-10-09T20:00:00Z'])assert.equal((await run(manager,create(reference,employee,due))).revision,1);
 for(const due of ['2026-10-09T11:59:59-04:00','2026-10-09T20:00:01-04:00'])await assert.rejects(run(manager,create(reference,employee,due)),denied(403));
});
test('assignment rejects unpublished, cancelled, released, mismatched and dedicated dishwasher shifts',async()=>{
 for(const options of [{published:false},{cancelled:true},{released:'2026-10-09T15:00:00Z'},{member:peer.membershipId},{department:'FOH'},{position:'Dishwasher'}])await assert.rejects(run(manager,create(await shift(options))),denied(403));
 const foreign=await member([],'BOH','fictional-b');await assert.rejects(run(manager,create(await shift({restaurant:'fictional-b',member:foreign.membershipId}))),denied(403));
});
test('operations-store grant covers linked FOH work without widening ordinary FOH tasks',async()=>{
 const actor=await member(['tasks.manage','operations.store']),target=await member([],'FOH'),reference=await shift({member:target.membershipId,department:'FOH'}),command=create(reference,target);
 const ordinary={...command,input:{...command.input}};delete ordinary.input.shiftId;await assert.rejects(run(actor,ordinary),denied(403));
 const task=await run(actor,command);const ready=await run(target,step(task,'ready'));assert.equal((await run(actor,step(ready,'verify'))).revision,3);
});
test('linked reassignment stays on its original employee',async()=>{
 const task=await run(manager,create(await shift()));const change=target=>({requestId:randomUUID(),locationId:'fictional-a',action:'task.reassign',recordId:task.recordId,expectedRevision:1,input:{ownerId:target.membershipId,note:'Fictional assignment review.'}});
 await assert.rejects(run(manager,change(peer)),denied(403));assert.equal((await run(manager,change(employee))).revision,2);
});
test('shift revision changes hold new submissions for review without changing task history',async()=>{
 const reference=await shift(),task=await run(manager,create(reference));await owner.query('UPDATE candidate_operations.shift_references SET revision=2 WHERE id=$1',[reference.id]);
 await assert.rejects(run(employee,step(task,'ready')),e=>e.status===409&&e.code==='shift_conflict');assert.equal((await read(task)).data.history.length,1);
});
test('linked work protects schedule ownership, department, times and deletion',async()=>{
 const reference=await shift();await run(manager,create(reference));
 for(const sql of ["UPDATE candidate_operations.shift_references SET starts_at=starts_at+interval '1 hour' WHERE id=$1","UPDATE candidate_operations.shift_references SET department='FOH' WHERE id=$1",'UPDATE candidate_operations.shift_references SET member_id=$2 WHERE id=$1','DELETE FROM candidate_operations.shift_references WHERE id=$1'])await assert.rejects(owner.query(sql,sql.includes('$2')?[reference.id,peer.membershipId]:[reference.id]),e=>e.code==='P0001'&&e.message==='linked_shift_protected');
});
test('pending linked tasks block cancel, unpublish and release; unrelated issues do not become links',async()=>{
 const reference=await shift(),task=await run(manager,create(reference));for(const assignment of ['cancelled=true','published=false','released_at=clock_timestamp()'])await assert.rejects(owner.query('UPDATE candidate_operations.shift_references SET '+assignment+' WHERE id=$1',[reference.id]),e=>e.code==='P0001'&&e.message==='linked_task_pending');
 const unrelated=create(reference);delete unrelated.input.shiftId;unrelated.input.kind='issue';await run(manager,unrelated);
 const ready=await run(employee,step(task,'ready'));await run(manager,step(ready,'verify'));
 // Privileged fixture update proves only the task trigger gate, not full checkout authorization.
 await owner.query('UPDATE candidate_operations.shift_references SET cancelled=true WHERE id=$1',[reference.id]);assert.equal((await read(task)).data.phase,'closed');
});
test('closing grant revocation blocks linked manager receipt replay',async()=>{
 const actor=await member(['tasks.manage','operations.store']),target=await member([],'FOH'),reference=await shift({member:target.membershipId,department:'FOH'}),command=create(reference,target);await run(actor,command);
 await owner.query("UPDATE candidate_identity.membership_capabilities SET active=false WHERE membership_id=$1 AND capability='operations.store'",[actor.membershipId]);await assert.rejects(run(actor,command),denied(403));
});
test('runtime cannot directly modify schedule projections or release shifts; linked handoffs need a valid shift',async()=>{
 await assert.rejects(db.transaction(c=>c.query('UPDATE candidate_operations.shift_references SET released_at=clock_timestamp()',[])),e=>e.code==='42501');
 assert.throws(()=>parseCommand({requestId:randomUUID(),locationId:'fictional-a',action:'shift.release',input:{note:'Not implemented'}},'fictional-a'),denied(400));
 const command=create({id:randomUUID()});command.input.kind='handoff';command.input.incomingId=peer.membershipId;assert.equal(parseCommand(command,'fictional-a').payload.action,'task.create');await assert.rejects(run(manager,command),denied(403));
});
