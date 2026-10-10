import {fictionalStoreInsert} from './store-fixture.mjs';
import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import pg from 'pg';
import {connection} from './test-config.mjs';import {PostgresDatabase} from './postgres-driver.ts';import {executeTask} from './task-adapter.ts';import {createTaskHandler} from './task-http.ts';
const admin=new pg.Pool({...connection,user:'candidate_owner',max:2}),db=new PostgresDatabase({...connection,user:'candidate_runtime',max:3});after(async()=>{await admin.end();await db.close();});
async function fixture(){
 const scope=`timeoff-${randomUUID()}`;await admin.query(fictionalStoreInsert,[scope,'Fictional time-off store']);const actors=[];
 for(const department of ['BOH','BOH','FOH']){
  const person=randomUUID(),membershipId=randomUUID(),subject=`timeoff-${randomUUID()}`;
  await admin.query('INSERT INTO candidate_identity.people(id,name) VALUES($1,$2)',[person,'Fictional employee']);await admin.query('INSERT INTO candidate_identity.auth_links(subject,person_id) VALUES($1,$2)',[subject,person]);await admin.query('INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department) VALUES($1,$2,$3,$4)',[membershipId,person,scope,department]);actors.push({subject,membershipId});
  await admin.query("INSERT INTO candidate_identity.schedule_eligibility VALUES($1,'Cook','schedule-job',true)",[membershipId]);
 }
 for(const a of actors.slice(1))await admin.query("INSERT INTO candidate_identity.membership_capabilities VALUES($1,'schedule.manage',true)",[a.membershipId]);await admin.query('INSERT INTO candidate_operations.schedule_input_reviews VALUES($1,true,clock_timestamp())',[scope]);
 return {scope,worker:actors[0],manager:actors[1],foreign:actors[2]};
}
const create=(f,changes={})=>({requestId:randomUUID(),locationId:f.scope,action:'request.create',input:{type:'time-off',start:'2031-11-02T05:00:00Z',end:'2031-11-02T08:00:00Z',note:'Fictional private request',...changes}});
const review=(f,r,changes={})=>({requestId:randomUUID(),locationId:f.scope,action:'request.review',recordId:r.recordId,expectedRevision:r.revision,input:{approve:true,note:'Fictional decision',affectedShifts:[],...changes}});
const draft=(f)=>({requestId:randomUUID(),locationId:f.scope,action:'shift.save',input:{personId:f.worker.membershipId,start:'2031-11-02T05:30:00Z',end:'2031-11-02T07:30:00Z',position:'Cook'}});
const run=(f,a,c)=>executeTask(db,a,f.scope,c);const denied=status=>e=>e.status===status;
const read=async id=>(await admin.query('SELECT * FROM candidate_operations.time_off_references WHERE id=$1',[id])).rows[0];
const list=(f,a,after=null,limit=50)=>db.transaction(async c=>(await c.query('SELECT candidate_operations.list_time_off($1,$2,$3,$4,$5) AS result',[a.subject,a.membershipId,f.scope,after,limit])).rows[0].result);
test('own request and independent approval write audit, receipt and notifications without certifying source completeness',async()=>{
 const f=await fixture(),c=create(f),r=await run(f,f.worker,c);assert.equal((await read(r.recordId)).status,'pending');const approved=await run(f,f.manager,review(f,r));assert.equal(approved.revision,2);assert.equal((await read(r.recordId)).status,'approved');
 assert.equal((await admin.query('SELECT count(*)::int n FROM candidate_operations.time_off_events WHERE request_id=$1',[r.recordId])).rows[0].n,2);assert.equal((await admin.query('SELECT count(*)::int n FROM candidate_operations.time_off_outbox WHERE request_id=$1',[r.recordId])).rows[0].n,2);
 await assert.rejects(run(f,f.manager,draft(f)),e=>e.code==='approved_time_off_conflict');
});
test('self review, foreign department, titles and location administration alone cannot approve',async()=>{
 const f=await fixture(),r=await run(f,f.worker,create(f));await admin.query("INSERT INTO candidate_identity.membership_capabilities VALUES($1,'schedule.manage',true)",[f.worker.membershipId]);await assert.rejects(run(f,f.worker,review(f,r)),denied(403));await assert.rejects(run(f,f.foreign,review(f,r)),denied(403));
 await admin.query("UPDATE candidate_identity.memberships SET position='GM' WHERE id=$1",[f.foreign.membershipId]);await assert.rejects(run(f,f.foreign,review(f,r)),denied(403));await admin.query("INSERT INTO candidate_identity.membership_capabilities VALUES($1,'location.manage',true)",[f.foreign.membershipId]);await run(f,f.foreign,review(f,r));
 const second=await run(f,f.worker,create(f));await admin.query("UPDATE candidate_identity.membership_capabilities SET active=false WHERE membership_id=$1 AND capability='schedule.manage'",[f.foreign.membershipId]);await assert.rejects(run(f,f.foreign,review(f,second)),denied(403));
});
test('approval atomically cancels exactly reviewed candidate drafts and exposes impact versions',async()=>{
 const f=await fixture(),s=await run(f,f.manager,draft(f)),r=await run(f,f.worker,create(f));assert.deepEqual((await list(f,f.manager)).items[0].affectedShifts,[{id:s.recordId,revision:1}]);
 await assert.rejects(run(f,f.manager,review(f,r)),e=>e.code==='time_off_impact_conflict');await assert.rejects(run(f,f.manager,review(f,r,{affectedShifts:[{id:s.recordId,revision:2}]})),denied(409));
 await run(f,f.manager,review(f,r,{affectedShifts:[{id:s.recordId,revision:1}]}));const shift=(await admin.query('SELECT cancelled,revision FROM candidate_operations.shift_references WHERE id=$1',[s.recordId])).rows[0];assert.deepEqual(shift,{cancelled:true,revision:2});assert.equal((await admin.query('SELECT data FROM candidate_operations.schedule_draft_events WHERE shift_id=$1 AND revision=2',[s.recordId])).rows[0].data.action,'time-off-approved');
});
test('published, released, linked and imported shifts block approval without partial cancellation',async()=>{
 for(const state of ['published','released','linked','reference']){
  const f=await fixture(),s=await run(f,f.manager,draft(f)),r=await run(f,f.worker,create(f));
  if(state==='published')await admin.query('UPDATE candidate_operations.shift_references SET published=true WHERE id=$1',[s.recordId]);
  if(state==='released')await admin.query('UPDATE candidate_operations.shift_references SET released_at=clock_timestamp() WHERE id=$1',[s.recordId]);
  if(state==='reference')await admin.query('DELETE FROM candidate_operations.schedule_draft_events WHERE shift_id=$1',[s.recordId]);
  if(state==='linked')await admin.query("INSERT INTO candidate_operations.tasks(id,restaurant_id,assignee_id,department,title,detail,due,phase,revision,shift_id,shift_revision) VALUES($1,$2,$3,'BOH','Fictional','Fictional','2031-11-02T06:00:00Z','open',1,$4,1)",[randomUUID(),f.scope,f.worker.membershipId,s.recordId]);
  await assert.rejects(run(f,f.manager,review(f,r,{affectedShifts:[{id:s.recordId,revision:1}]})),e=>e.code==='time_off_cancellation_not_migrated');assert.equal((await read(r.recordId)).status,'pending');assert.equal((await admin.query('SELECT cancelled FROM candidate_operations.shift_references WHERE id=$1',[s.recordId])).rows[0].cancelled,false);
 }
});
test('decline never cancels shifts and reviewed requests cannot be reviewed again',async()=>{
 const f=await fixture(),s=await run(f,f.manager,draft(f)),r=await run(f,f.worker,create(f)),result=await run(f,f.manager,review(f,r,{approve:false}));assert.equal((await read(r.recordId)).status,'declined');assert.equal((await admin.query('SELECT cancelled FROM candidate_operations.shift_references WHERE id=$1',[s.recordId])).rows[0].cancelled,false);await assert.rejects(run(f,f.manager,review(f,result,{approve:true})),denied(409));
});
test('simultaneous approve/decline and retries allow one application per revision',async()=>{
 const f=await fixture(),c=create(f),results=await Promise.all([run(f,f.worker,c),run(f,f.worker,c)]);assert.deepEqual(results.map(r=>r.replayed).sort(),[false,true]);await assert.rejects(run(f,f.worker,{...c,input:{...c.input,note:'Changed'}}),denied(409));
 const attempts=await Promise.allSettled([run(f,f.manager,review(f,results[0])),run(f,f.manager,review(f,results[0],{approve:false}))]);assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal(attempts.find(r=>r.status==='rejected').reason.status,409);
});
test('concurrent draft creation and approval cannot leave an approved request over an active shift',async()=>{
 const f=await fixture(),r=await run(f,f.worker,create(f)),attempts=await Promise.allSettled([run(f,f.manager,draft(f)),run(f,f.manager,review(f,r))]);assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.ok(['time_off_impact_conflict','approved_time_off_conflict'].includes(attempts.find(r=>r.status==='rejected').reason.code));
});
test('read visibility, note redaction and pagination match scoped request rules',async()=>{
 const f=await fixture(),first=await run(f,f.worker,create(f)),second=await run(f,f.worker,create(f));assert.equal((await list(f,f.foreign)).items.length,0);assert.equal((await list(f,f.worker)).items[0].data.note,'');assert.equal((await list(f,f.manager)).items[0].data.note,'');
 await admin.query("INSERT INTO candidate_identity.membership_capabilities VALUES($1,'schedule.change',true)",[f.manager.membershipId]);assert.equal((await list(f,f.manager)).items[0].data.note,'Fictional private request');const page=await list(f,f.manager,null,1),next=await list(f,f.manager,page.nextCursor,1);assert.equal(page.items.length,1);assert.equal(next.items.length,1);assert.notEqual(page.items[0].id,next.items[0].id);assert.equal(next.nextCursor,null);
});
test('inactive/schedule-only actors and missing independent reviewer fail; revoked manager cannot replay',async()=>{
 const f=await fixture(),r=await run(f,f.worker,create(f)),c=review(f,r);await run(f,f.manager,c);await admin.query('UPDATE candidate_identity.membership_capabilities SET active=false WHERE membership_id=$1',[f.manager.membershipId]);await assert.rejects(run(f,f.manager,c),denied(403));await assert.rejects(run(f,f.worker,create(f)),denied(403));
 await admin.query('UPDATE candidate_identity.memberships SET schedule_only=true WHERE id=$1',[f.worker.membershipId]);await assert.rejects(run(f,f.worker,create(f)),denied(403));
});
test('invalid durations, dates, swaps and client-owned identity/state fail at boundaries',async()=>{
 const f=await fixture();for(const changes of [{type:'swap'},{personId:f.manager.membershipId},{status:'approved'},{start:'2031-02-30T01:00:00Z'},{end:'2032-01-10T08:00:00Z'},{end:'2031-11-02T04:00:00Z'},{note:''}])await assert.rejects(run(f,f.worker,create(f,changes)),denied(400));
 await assert.rejects(db.transaction(c=>c.query('SELECT candidate_operations.time_off_command($1,$2,$3,$4,$5)',[f.worker.subject,f.worker.membershipId,f.scope,randomUUID(),JSON.stringify({action:'request.create',input:create(f,{start:'2031-02-30T01:00:00Z'}).input})])),e=>e.code.startsWith('22'));
});
test('notification failure rolls back approval, shift cancellation, audit and receipt',async()=>{
 const f=await fixture(),s=await run(f,f.manager,draft(f)),r=await run(f,f.worker,create(f)),c=review(f,r,{affectedShifts:[{id:s.recordId,revision:1}]});await admin.query(`CREATE FUNCTION candidate_operations.fail_time_off_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fictional_time_off_failure'; END; $$`);await admin.query('CREATE TRIGGER fail_time_off_notice BEFORE INSERT ON candidate_operations.time_off_outbox FOR EACH ROW EXECUTE FUNCTION candidate_operations.fail_time_off_notice()');
 try{await assert.rejects(run(f,f.manager,c),e=>e.message==='fictional_time_off_failure');assert.equal((await read(r.recordId)).status,'pending');assert.equal((await admin.query('SELECT cancelled FROM candidate_operations.shift_references WHERE id=$1',[s.recordId])).rows[0].cancelled,false);assert.equal((await admin.query('SELECT count(*)::int n FROM candidate_operations.schedule_draft_events WHERE shift_id=$1',[s.recordId])).rows[0].n,1);assert.equal((await admin.query('SELECT count(*)::int n FROM candidate_operations.command_receipts WHERE request_id=$1',[c.requestId])).rows[0].n,0);}finally{await admin.query('DROP TRIGGER fail_time_off_notice ON candidate_operations.time_off_outbox');await admin.query('DROP FUNCTION candidate_operations.fail_time_off_notice()');}
});
test('HTTP request commands/reads use scoped sessions; ambiguous pagination and raw writes are denied',async()=>{
 const f=await fixture(),sessionId=randomUUID();await admin.query("INSERT INTO candidate_identity.sessions(id,subject,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",[sessionId,f.worker.subject]);const handler=createTaskHandler(db,async()=>({subject:f.worker.subject,sessionId}));const headers={Authorization:'Bearer fictional','Content-Type':'application/json'};
 assert.equal((await handler(new Request(`http://candidate.invalid/api/operations/${f.scope}/commands`,{method:'POST',headers,body:JSON.stringify(create(f))}))).status,200);const url=`http://candidate.invalid/api/operations/${f.scope}/schedule-requests`;assert.equal((await handler(new Request(url,{headers}))).status,200);assert.equal((await handler(new Request(url+'?limit=1&limit=2',{headers}))).status,400);
 await admin.query('UPDATE candidate_identity.sessions SET active=false WHERE id=$1',[sessionId]);assert.equal((await handler(new Request(url,{headers}))).status,401);await assert.rejects(db.transaction(c=>c.query("UPDATE candidate_operations.time_off_references SET status='approved'",[])),e=>e.code==='42501');
});
