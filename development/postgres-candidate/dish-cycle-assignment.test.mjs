import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {owner,db,member,creator,denied} from './closing-test-fixture.mjs';
import {executeTask} from './task-adapter.ts';
import {createTaskHandler} from './task-http.ts';
async function fixture(){const people=await Promise.all([member([],'Dishwasher'),member([],'Dishwasher'),member([],'Dishwasher')]);const date=(await owner.query("SELECT to_char(coalesce(max(business_date),DATE '2027-01-01')+1,'YYYY-MM-DD') d FROM candidate_operations.dish_cycles")).rows[0].d;return {people,command:{requestId:randomUUID(),locationId:'fictional-a',action:'task.dish-cycle',input:{amOwnerId:people[0].membershipId,pmOwnerIds:people.slice(1).map(p=>p.membershipId),businessDate:date,title:'Fictional dish checkout',detail:'Reviewed checkout requirements',due:date+'T23:00:00-04:00'}}};}
const run=(f,actor=creator,c=f.command)=>executeTask(db,actor,'fictional-a',c);
const read=(actor,r)=>db.transaction(async c=>(await c.query('SELECT candidate_operations.read_dish_cycle($1,$2,$3,$4) AS result',[actor.subject,actor.membershipId,'fictional-a',r.recordId])).rows[0].result);
test('cycle creates exactly one AM and two PM tasks, events and notifications; participant reads stay personal',async()=>{
 const f=await fixture(),r=await run(f),view=await read(creator,r);assert.equal(view.checkouts.length,3);assert.deepEqual(view.checkouts.map(t=>t.shift),['AM','PM','PM']);assert.deepEqual(view.participantIds,[f.command.input.amOwnerId,...f.command.input.pmOwnerIds]);assert.equal(view.executionSupported,true);
 for(const person of f.people){const personal=await read(person,r);assert.equal(personal.checkouts.length,1);assert.equal(personal.checkouts[0].ownerId,person.membershipId);}
 const counts=(await owner.query('SELECT count(*)::int n FROM candidate_operations.notification_outbox WHERE task_id IN (SELECT task_id FROM candidate_operations.dish_participants WHERE cycle_id=$1)',[r.recordId])).rows[0].n;assert.equal(counts,3);await assert.rejects(read(await member(),r),e=>e.code==='42501');
});
test('operations permission follows BOH task management, location authority or store task authority; titles alone do not grant it',async()=>{
 for(const [caps,department,position,expected] of [[[],'BOH','GM',false],[['tasks.manage'],'BOH','Cook',true],[['tasks.manage'],'FOH','Cook',false],[['location.manage'],'FOH','Cook',true],[['operations.store'],'FOH','Cook',false],[['tasks.manage','operations.store'],'FOH','Cook',true],[['location.manage','tasks.manage'],'BOH','Dishwasher',false]]){
  const actor=await member(caps,position);await owner.query('UPDATE candidate_identity.memberships SET department=$2 WHERE id=$1',[actor.membershipId,department]);const actual=(await owner.query('SELECT candidate_operations.dish_manager($1,$2) ok',[actor.membershipId,'fictional-a'])).rows[0].ok;assert.equal(actual,expected);
 }
});
test('unauthorized manager and dishwasher cannot assign a cycle; authorized location manager can',async()=>{
 const f=await fixture();await assert.rejects(run(f,await member()),denied(403));await assert.rejects(run(f,f.people[0]),denied(403));assert.equal((await run(f,await member(['location.manage']))).revision,1);
});
test('three distinct eligible BOH dishwashers with sign-in access are required',async()=>{
 for(const change of ["department='FOH'",'active=false','schedule_only=true',"position='Cook'"]){const f=await fixture();await owner.query('UPDATE candidate_identity.memberships SET '+change+' WHERE id=$1',[f.people[2].membershipId]);await assert.rejects(run(f),denied(403));}
 const f=await fixture();await owner.query('DELETE FROM candidate_identity.auth_links WHERE subject=$1',[f.people[2].subject]);await assert.rejects(run(f),denied(403));
 const g=await fixture();await assert.rejects(run(g,creator,{...g.command,input:{...g.command.input,pmOwnerIds:[g.people[0].membershipId,g.people[2].membershipId]}}),denied(400));await assert.rejects(run(g,creator,{...g.command,input:{...g.command.input,pmOwnerIds:[]}}),denied(400));
});
test('invalid business dates are rejected and cycle date is preserved independently from due-time timezone',async()=>{
 const f=await fixture();await assert.rejects(run(f,creator,{...f.command,input:{...f.command.input,businessDate:'2027-02-30'}}),denied(400));const r=await run(f);assert.equal((await read(creator,r)).businessDate,f.command.input.businessDate);
});
test('one cycle per restaurant date, identical concurrent retries apply once and changed requests conflict',async()=>{
 const f=await fixture();const [a,b]=await Promise.all([run(f),run(f)]);assert.equal(a.recordId,b.recordId);assert.equal(Number(a.replayed)+Number(b.replayed),1);await assert.rejects(run(f,creator,{...f.command,requestId:randomUUID()}),denied(409));await assert.rejects(run(f,creator,{...f.command,input:{...f.command.input,title:'Changed'}}),denied(409));assert.equal((await read(creator,a)).checkouts.length,3);
});
test('revoked management authority cannot replay or inspect a cycle through manager scope',async()=>{
 const f=await fixture(),actor=await member(['tasks.manage']),r=await run(f,actor);await owner.query('UPDATE candidate_identity.membership_capabilities SET active=false WHERE membership_id=$1',[actor.membershipId]);await assert.rejects(run(f,actor),denied(403));await assert.rejects(read(actor,r),e=>e.code==='42501');
});
test('dedicated tasks use specialty execution and cannot be reassigned or bypass the command boundary',async()=>{
 const f=await fixture(),r=await run(f),t=(await read(f.people[0],r)).checkouts[0];await assert.rejects(executeTask(db,f.people[0],'fictional-a',{requestId:randomUUID(),locationId:'fictional-a',action:'task.transition',recordId:t.id,expectedRevision:1,input:{step:'verify',note:'Bypass'}}),denied(403));await assert.rejects(executeTask(db,creator,'fictional-a',{requestId:randomUUID(),locationId:'fictional-a',action:'task.reassign',recordId:t.id,expectedRevision:1,input:{ownerId:f.people[1].membershipId,note:'Bypass'}}),denied(400));
 await assert.rejects(db.transaction(c=>c.query('SELECT candidate_operations.command_before_dish($1,$2,$3,$4,$5)',[creator.subject,creator.membershipId,'fictional-a',randomUUID(),'{}'])),e=>e.code==='42501');
});
test('notification failure rolls back cycle, all three tasks, events, participants, receipt and scope revision',async()=>{
 const f=await fixture(),before=(await owner.query("SELECT revision FROM candidate_identity.restaurants WHERE id='fictional-a'")).rows[0].revision;await owner.query(`CREATE FUNCTION candidate_operations.test_cycle_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fictional cycle failure'; END; $$; CREATE TRIGGER test_cycle_failure BEFORE INSERT ON candidate_operations.notification_outbox FOR EACH ROW EXECUTE FUNCTION candidate_operations.test_cycle_failure();`);
 try{await assert.rejects(run(f),e=>e.message==='fictional cycle failure');assert.equal((await owner.query('SELECT count(*)::int n FROM candidate_operations.dish_cycles WHERE restaurant_id=$1 AND business_date=$2',['fictional-a',f.command.input.businessDate])).rows[0].n,0);assert.equal((await owner.query('SELECT count(*)::int n FROM candidate_operations.tasks WHERE assignee_id=ANY($1::uuid[])',[f.people.map(p=>p.membershipId)])).rows[0].n,0);assert.equal((await owner.query('SELECT count(*)::int n FROM candidate_operations.command_receipts WHERE request_id=$1',[f.command.requestId])).rows[0].n,0);assert.equal((await owner.query("SELECT revision FROM candidate_identity.restaurants WHERE id='fictional-a'")).rows[0].revision,before);}finally{await owner.query('DROP TRIGGER test_cycle_failure ON candidate_operations.notification_outbox; DROP FUNCTION candidate_operations.test_cycle_failure();');}
});
test('HTTP dispatch and personal cycle read use database session resolution; direct tables remain inaccessible',async()=>{
 const f=await fixture(),sessionId=randomUUID();await owner.query("INSERT INTO candidate_identity.sessions(id,subject,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",[sessionId,creator.subject]);const handler=createTaskHandler(db,async()=>({subject:creator.subject,sessionId}));const response=await handler(new Request('https://candidate.invalid/api/operations/fictional-a/commands',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify(f.command)}));assert.equal(response.status,200);const r=await response.json();const detail=await handler(new Request('https://candidate.invalid/api/operations/fictional-a/dish-cycles/'+r.recordId,{headers:{Authorization:'Bearer fixture'}}));assert.equal(detail.status,200);assert.equal((await detail.json()).checkouts.length,3);
 await assert.rejects(db.transaction(c=>c.query('SELECT * FROM candidate_operations.dish_participants',[])),e=>e.code==='42501');
});
