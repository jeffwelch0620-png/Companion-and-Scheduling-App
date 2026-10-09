import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {owner,db,member,creator,denied} from './closing-test-fixture.mjs';
import {executeTask} from './task-adapter.ts';
import {createTaskHandler} from './task-http.ts';
const read=(f,actor=f.manager)=>db.transaction(async c=>(await c.query('SELECT candidate_operations.read_dish_cycle($1,$2,$3,$4) result',[actor.subject,actor.membershipId,'fictional-a',f.cycle.recordId])).rows[0].result);
const cmd=(task,action,input)=>({requestId:randomUUID(),locationId:'fictional-a',action,recordId:task.recordId??task.id,expectedRevision:task.revision,input:{note:'Fictional observed work',...input}});
const step=(actor,t,step)=>executeTask(db,actor,'fictional-a',cmd(t,'task.transition',{step}));
const pass=(f,t=f.tasks[0],incoming=f.people[1])=>executeTask(db,f.people[0],'fictional-a',cmd(t,'task.dish-pass',{incomingId:incoming.membershipId,due:f.date+'T23:00:00-04:00'}));
const release=(f,i)=>executeTask(db,f.manager,'fictional-a',cmd({id:f.shifts[i],revision:1},'shift.release',{}));
async function fixture(){
 const people=await Promise.all([member([],'Dishwasher'),member([],'Dishwasher'),member([],'Dishwasher')]),manager=await member(['location.manage','close.confirm']);
 const date=(await owner.query("SELECT to_char(coalesce(max(business_date),DATE '2027-01-01')+1,'YYYY-MM-DD') d FROM candidate_operations.dish_cycles")).rows[0].d;
 const cycle=await executeTask(db,creator,'fictional-a',{requestId:randomUUID(),locationId:'fictional-a',action:'task.dish-cycle',input:{amOwnerId:people[0].membershipId,pmOwnerIds:people.slice(1).map(p=>p.membershipId),businessDate:date,title:'Fictional Dish Cycle',detail:'Checkout conditions',due:date+'T23:00:00-04:00'}});
 const f={people,manager,date,cycle,shifts:[]};f.tasks=(await read(f)).checkouts;
 for(const person of people){const id=randomUUID();await owner.query("INSERT INTO candidate_operations.shift_references(id,restaurant_id,member_id,department,position,starts_at,ends_at,revision,published,checkout_profile) VALUES($1,'fictional-a',$2,'BOH','Dishwasher',$3,$4,1,true,'dishwasher')",[id,person.membershipId,date+'T08:00:00-04:00',date+'T20:00:00-04:00']);f.shifts.push(id);}return f;
}
async function complete(f,i,t=f.tasks[i]){return step(f.manager,await step(f.people[i],t,'ready'),'verify');}
test('AM passing creates linked PM work, source history and personal acceptance receipts',async()=>{
 const f=await fixture(),child=await pass(f);const am=await read(f,f.people[0]);assert.equal(am.handoffs.length,0);assert.equal(am.outgoingReceipts[0].acceptedBy,null);assert.equal(am.checkouts[0].revision,2);
 const pm=await read(f,f.people[1]);assert.equal(pm.handoffs[0].id,child.recordId);assert.equal((await read(f,f.people[2])).handoffs.length,0);const accepted=await step(f.people[1],child,'accept');assert.equal(accepted.revision,2);assert.equal((await read(f,f.people[0])).outgoingReceipts[0].acceptedBy,f.people[1].membershipId);
});
test('incoming work needs explicit current-owner acceptance; unrelated PM and managers cannot accept',async()=>{
 const f=await fixture(),child=await pass(f);await assert.rejects(step(f.people[1],child,'ready'),denied(403));await assert.rejects(step(f.people[2],child,'accept'),denied(403));await assert.rejects(step(f.manager,child,'accept'),denied(403));const a=await step(f.people[1],child,'accept');await assert.rejects(step(f.people[1],a,'accept'),denied(409));
});
test('only AM owner may pass to a same-cycle PM checkout still awaiting work',async()=>{
 const f=await fixture();await assert.rejects(pass(f,f.tasks[0],await member([],'Dishwasher')),denied(403));await assert.rejects(executeTask(db,f.people[1],'fictional-a',cmd(f.tasks[1],'task.dish-pass',{incomingId:f.people[2].membershipId,due:f.date+'T23:00:00-04:00'})),denied(409));await complete(f,1);await assert.rejects(pass(f),denied(403));
});
test('AM release waits for incoming acceptance but does not wait for PM completion',async()=>{
 const f=await fixture(),child=await pass(f);const am=(await read(f,f.people[0])).checkouts[0];await complete(f,0,am);await assert.rejects(release(f,0),denied(409));await step(f.people[1],child,'accept');assert.equal((await release(f,0)).revision,2);assert.equal((await read(f,f.people[1])).handoffs[0].phase,'open');
});
test('PM checkout waits for own incoming work verification; other PM checkout is independent',async()=>{
 const f=await fixture(),child=await pass(f),a=await step(f.people[1],child,'accept');await assert.rejects(step(f.people[1],f.tasks[1],'ready'),denied(409));await complete(f,2);assert.equal((await release(f,2)).revision,2);const r=await step(f.people[1],a,'ready');await assert.rejects(step(f.people[1],f.tasks[1],'ready'),denied(409));await step(f.manager,r,'verify');await complete(f,1);assert.equal((await release(f,1)).revision,2);
});
test('returned incoming work retains acceptance, requires resubmission and independent verification',async()=>{
 const f=await fixture(),a=await step(f.people[1],await pass(f),'accept'),r=await step(f.people[1],a,'ready'),fix=await step(f.manager,r,'fix');assert.equal((await read(f,f.people[1])).handoffs[0].acceptedBy,f.people[1].membershipId);await assert.rejects(step(f.people[1],fix,'verify'),denied(403));await step(f.manager,await step(f.people[1],fix,'ready'),'verify');
});
test('missing participant and tampered handoff owner fail closed for checkout and release',async()=>{
 const f=await fixture(),child=await pass(f);await owner.query('UPDATE candidate_operations.tasks SET assignee_id=$2 WHERE id=$1',[child.recordId,f.people[0].membershipId]);await assert.rejects(step(f.people[0],child,'accept'),denied(409));await assert.rejects(release(f,0),denied(409));
 const g=await fixture();await owner.query('DELETE FROM candidate_operations.dish_participants WHERE cycle_id=$1 AND slot=2',[g.cycle.recordId]);await assert.rejects(step(g.people[1],g.tasks[1],'ready'),denied(409));await assert.rejects(release(g,1),denied(409));
});
test('business date comes from restaurant-local shift start and missing date cycle blocks release',async()=>{
 const f=await fixture();await complete(f,0);const next=(await owner.query("SELECT to_char($1::date+1,'YYYY-MM-DD') d",[f.date])).rows[0].d;await owner.query('UPDATE candidate_operations.shift_references SET starts_at=$2,ends_at=$3 WHERE id=$1',[f.shifts[0],next+'T01:00:00Z',next+'T07:00:00Z']);assert.equal((await release(f,0)).revision,2);
 const g=await fixture();await complete(g,0);await owner.query("UPDATE candidate_operations.shift_references SET starts_at=starts_at+interval '2 days',ends_at=ends_at+interval '2 days' WHERE id=$1",[g.shifts[0]]);await assert.rejects(release(g,0),denied(409));
});
test('stable acceptance and pass retries do not duplicate tasks, source events or cycle revisions',async()=>{
 const f=await fixture(),c=cmd(f.tasks[0],'task.dish-pass',{incomingId:f.people[1].membershipId,due:f.date+'T23:00:00-04:00'});const [x,y]=await Promise.all([executeTask(db,f.people[0],'fictional-a',c),executeTask(db,f.people[0],'fictional-a',c)]);assert.equal(x.recordId,y.recordId);assert.equal(Number(x.replayed)+Number(y.replayed),1);
 const ac=cmd(x,'task.transition',{step:'accept'});const [a,b]=await Promise.all([executeTask(db,f.people[1],'fictional-a',ac),executeTask(db,f.people[1],'fictional-a',ac)]);assert.equal(Number(a.replayed)+Number(b.replayed),1);const view=await read(f);assert.equal(view.handoffs.length,1);assert.equal(view.revision,3);assert.equal(view.checkouts[0].revision,3);
});
test('revoked operations verifier cannot replay and inactive incoming owner cannot accept',async()=>{
 const f=await fixture(),r=await step(f.people[0],f.tasks[0],'ready'),c=cmd(r,'task.transition',{step:'verify'});await executeTask(db,f.manager,'fictional-a',c);await owner.query("UPDATE candidate_identity.membership_capabilities SET active=false WHERE membership_id=$1 AND capability='location.manage'",[f.manager.membershipId]);await assert.rejects(executeTask(db,f.manager,'fictional-a',c),denied(403));const g=await fixture(),child=await pass(g);await owner.query('UPDATE candidate_identity.memberships SET active=false WHERE id=$1',[g.people[1].membershipId]);await assert.rejects(step(g.people[1],child,'accept'),denied(403));
});
test('failed acceptance notification rolls back child, source, receipt and cycle revision',async()=>{
 const f=await fixture(),child=await pass(f),c=cmd(child,'task.transition',{step:'accept'});await owner.query(`CREATE FUNCTION candidate_operations.test_dish_execution_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fictional dish failure'; END; $$; CREATE TRIGGER test_dish_execution_failure BEFORE INSERT ON candidate_operations.notification_outbox FOR EACH ROW EXECUTE FUNCTION candidate_operations.test_dish_execution_failure();`);
 try{await assert.rejects(executeTask(db,f.people[1],'fictional-a',c),e=>e.message==='fictional dish failure');const view=await read(f);assert.equal(view.revision,2);assert.equal(view.checkouts[0].revision,2);assert.equal(view.handoffs[0].acceptedBy,null);assert.equal(view.handoffs[0].revision,1);assert.equal((await owner.query('SELECT count(*)::int n FROM candidate_operations.command_receipts WHERE request_id=$1',[c.requestId])).rows[0].n,0);}finally{await owner.query('DROP TRIGGER test_dish_execution_failure ON candidate_operations.notification_outbox; DROP FUNCTION candidate_operations.test_dish_execution_failure();');}
});
test('HTTP dispatch and scoped cycle detail show completed acceptance; direct link edits are forbidden',async()=>{
 const f=await fixture(),child=await pass(f),sessionId=randomUUID();await owner.query("INSERT INTO candidate_identity.sessions(id,subject,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",[sessionId,f.people[1].subject]);const handler=createTaskHandler(db,async()=>({subject:f.people[1].subject,sessionId}));const response=await handler(new Request('https://candidate.invalid/api/operations/fictional-a/commands',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify(cmd(child,'task.transition',{step:'accept'}))}));assert.equal(response.status,200);const detail=await handler(new Request('https://candidate.invalid/api/operations/fictional-a/dish-cycles/'+f.cycle.recordId,{headers:{Authorization:'Bearer fixture'}}));assert.equal((await detail.json()).handoffs[0].acceptedBy,f.people[1].membershipId);await assert.rejects(db.transaction(c=>c.query('UPDATE candidate_operations.dish_handoffs SET accepted_by=NULL,accepted_at=NULL',[])),e=>e.code==='42501');
});
test('incoming pass racing PM readiness cannot leave ready checkout with newly pending incoming work',async()=>{
 for(let attempt=0;attempt<3;attempt++){const f=await fixture(),[passed,ready]=await Promise.allSettled([pass(f),step(f.people[1],f.tasks[1],'ready')]);assert.equal(Number(passed.status==='fulfilled')+Number(ready.status==='fulfilled'),1);if(passed.status==='fulfilled')assert.equal(ready.reason.status,409);else assert.equal(passed.reason.status,403);}
});
test('failed AM pass rolls back new task, source history, handoff link and receipt',async()=>{
 const f=await fixture(),c=cmd(f.tasks[0],'task.dish-pass',{incomingId:f.people[1].membershipId,due:f.date+'T23:00:00-04:00'});await owner.query(`CREATE FUNCTION candidate_operations.test_pass_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fictional pass failure'; END; $$; CREATE TRIGGER test_pass_failure BEFORE INSERT ON candidate_operations.notification_outbox FOR EACH ROW EXECUTE FUNCTION candidate_operations.test_pass_failure();`);
 try{await assert.rejects(executeTask(db,f.people[0],'fictional-a',c),e=>e.message==='fictional pass failure');const view=await read(f);assert.equal(view.revision,1);assert.equal(view.handoffs.length,0);assert.equal(view.checkouts[0].revision,1);assert.equal((await owner.query('SELECT count(*)::int n FROM candidate_operations.tasks WHERE assignee_id=ANY($1::uuid[])',[f.people.map(p=>p.membershipId)])).rows[0].n,3);}finally{await owner.query('DROP TRIGGER test_pass_failure ON candidate_operations.notification_outbox; DROP FUNCTION candidate_operations.test_pass_failure();');}
});
