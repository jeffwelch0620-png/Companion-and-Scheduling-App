import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import pg from 'pg';
import {connection} from './test-config.mjs';import {PostgresDatabase} from './postgres-driver.ts';import {executeTask} from './task-adapter.ts';import {createTaskHandler} from './task-http.ts';
const admin=new pg.Pool({...connection,user:'candidate_owner',max:2}),db=new PostgresDatabase({...connection,user:'candidate_runtime',max:3});after(async()=>{await admin.end();await db.close();});
async function fixture(ready=true){
 const scope=`draft-${randomUUID()}`;await admin.query('INSERT INTO candidate_identity.restaurants(id,name) VALUES($1,$2)',[scope,'Fictional draft store']);const actors=[];
 for(const department of ['BOH','BOH','FOH']){
  const person=randomUUID(),membershipId=randomUUID(),subject=`draft-${randomUUID()}`;
  await admin.query('INSERT INTO candidate_identity.people(id,name) VALUES($1,$2)',[person,'Fictional draft employee']);await admin.query('INSERT INTO candidate_identity.auth_links(subject,person_id) VALUES($1,$2)',[subject,person]);
  await admin.query("INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position) VALUES($1,$2,$3,$4,'Cook')",[membershipId,person,scope,department]);actors.push({subject,membershipId});
  await admin.query("INSERT INTO candidate_identity.schedule_eligibility(member_id,job,source) VALUES($1,'Cook','schedule-job')",[membershipId]);
 }
 for(const a of actors.slice(1))await admin.query("INSERT INTO candidate_identity.membership_capabilities(membership_id,capability) VALUES($1,'schedule.manage')",[a.membershipId]);
 if(ready)await admin.query('INSERT INTO candidate_operations.schedule_input_reviews VALUES($1,true,clock_timestamp())',[scope]);
 return {scope,worker:actors[0],manager:actors[1],foreign:actors[2]};
}
const command=(f,change={},r)=>({requestId:randomUUID(),locationId:f.scope,action:'shift.save',input:{personId:f.worker.membershipId,start:'2031-11-02T01:00:00-04:00',end:'2031-11-02T02:00:00-05:00',position:'Cook',note:'Fictional draft',...change},...(r?{recordId:r.recordId,expectedRevision:r.revision}:{})});
const run=(f,a,c)=>executeTask(db,a,f.scope,c);const denied=status=>e=>e.status===status;
const read=async id=>(await admin.query('SELECT * FROM candidate_operations.shift_references WHERE id=$1',[id])).rows[0];
test('create and edit retain unpublished shifts, notes, atomic audit and schedule read visibility',async()=>{
 const f=await fixture(),r=await run(f,f.manager,command(f)),s=await read(r.recordId);assert.equal(s.published,false);assert.equal(s.ends_at-s.starts_at,2*3600000);
 const edited=await run(f,f.manager,command(f,{note:'Edited reason',end:'2031-11-02T03:00:00-05:00'},r));assert.equal(edited.revision,2);
 assert.deepEqual((await admin.query('SELECT revision,data FROM candidate_operations.schedule_draft_events WHERE shift_id=$1 ORDER BY revision',[r.recordId])).rows.map(e=>[e.revision,e.data.note]),[[1,'Fictional draft'],[2,'Edited reason']]);
 const projection=await db.transaction(c=>c.query('SELECT candidate_operations.list_schedule_shifts($1,$2,$3) AS result',[f.manager.subject,f.manager.membershipId,f.scope]));assert.equal(projection.rows[0].result.items[0].id,r.recordId);
 await assert.rejects(run(f,f.manager,command(f,{},r)),denied(409));
});
test('scope and capabilities protect old and new department; titles alone give no authority',async()=>{
 const f=await fixture();await assert.rejects(run(f,f.worker,command(f)),denied(403));await assert.rejects(run(f,f.foreign,command(f)),denied(403));
 const r=await run(f,f.manager,command(f));await assert.rejects(run(f,f.manager,command(f,{personId:f.foreign.membershipId},r)),denied(403));
 await assert.rejects(run(f,f.foreign,command(f,{personId:f.foreign.membershipId},r)),denied(403));
 await admin.query("INSERT INTO candidate_identity.membership_capabilities VALUES($1,'location.manage',true)",[f.manager.membershipId]);await run(f,f.manager,command(f,{personId:f.foreign.membershipId},r));
});
test('job eligibility is explicit; inactive schedule-only members are schedulable but cannot act',async()=>{
 const f=await fixture();await admin.query('UPDATE candidate_identity.schedule_eligibility SET active=false WHERE member_id=$1',[f.worker.membershipId]);await assert.rejects(run(f,f.manager,command(f)),denied(403));
 await admin.query("INSERT INTO candidate_identity.schedule_eligibility VALUES($1,'Cook','qualification',true)",[f.worker.membershipId]);await admin.query('UPDATE candidate_identity.memberships SET active=false,schedule_only=true WHERE id=$1',[f.worker.membershipId]);await run(f,f.manager,command(f));await assert.rejects(run(f,f.worker,command(f)),denied(403));
});
test('time-off completeness defaults blocked and cannot be self-certified by runtime',async()=>{
 const f=await fixture(false);await assert.rejects(run(f,f.manager,command(f)),e=>e.code==='schedule_inputs_incomplete');
 await assert.rejects(db.transaction(c=>c.query('INSERT INTO candidate_operations.schedule_input_reviews VALUES($1,true,clock_timestamp())',[f.scope])),e=>e.code==='42501');
 await admin.query('INSERT INTO candidate_operations.schedule_input_reviews VALUES($1,true,clock_timestamp())',[f.scope]);await run(f,f.manager,command(f));
});
test('approved time off and approved availability block drafts; pending restrictions do not',async()=>{
 const f=await fixture(),id=randomUUID();await admin.query("INSERT INTO candidate_operations.time_off_references VALUES($1,$2,$3,'2031-11-02T05:30:00Z','2031-11-02T06:30:00Z','approved')",[id,f.scope,f.worker.membershipId]);await assert.rejects(run(f,f.manager,command(f)),e=>e.code==='approved_time_off_conflict');
 await admin.query("UPDATE candidate_operations.time_off_references SET status='pending' WHERE id=$1",[id]);
 const data={startDate:'2031-11-02',endDate:'2031-11-02',days:[0],startMinute:60,endMinute:120,beforeMinutes:0,afterMinutes:0,excludedDates:[],status:'approved'};
 await admin.query("INSERT INTO candidate_operations.availability_references VALUES($1,$2,$3,'BOH',1,clock_timestamp(),'approved',$4)",[randomUUID(),f.scope,f.worker.membershipId,JSON.stringify(data)]);await assert.rejects(run(f,f.manager,command(f)),e=>e.code==='availability_shift_conflict');
 await admin.query("UPDATE candidate_operations.availability_references SET status='pending',data=data||'{\"status\":\"pending\"}' WHERE restaurant_id=$1",[f.scope]);await run(f,f.manager,command(f));
});
test('overlapping concurrent writes serialize and adjacent shifts remain valid',async()=>{
 const f=await fixture(),results=await Promise.allSettled([run(f,f.manager,command(f)),run(f,f.manager,command(f))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'shift_overlap');
 await run(f,f.manager,command(f,{start:'2031-11-02T02:00:00-05:00',end:'2031-11-02T03:00:00-05:00'}));
});
test('concurrent retries apply once, payload changes conflict and revoked managers cannot replay',async()=>{
 const f=await fixture(),c=command(f),results=await Promise.all([run(f,f.manager,c),run(f,f.manager,c)]);assert.deepEqual(results.map(r=>r.replayed).sort(),[false,true]);await assert.rejects(run(f,f.manager,{...c,input:{...c.input,note:'Changed'}}),denied(409));
 await admin.query('UPDATE candidate_identity.membership_capabilities SET active=false WHERE membership_id=$1',[f.manager.membershipId]);await assert.rejects(run(f,f.manager,c),denied(403));
});
test('availability approval and conflicting draft creation cannot both succeed concurrently',async()=>{
 const f=await fixture(),restriction=await run(f,f.worker,{requestId:randomUUID(),locationId:f.scope,action:'availability.save',input:{startDate:'2031-11-02',endDate:'2031-11-02',days:[0],startMinute:60,endMinute:120,title:'Fictional unavailable period',kind:'unavailable'}});
 const review={requestId:randomUUID(),locationId:f.scope,action:'availability.review',recordId:restriction.recordId,expectedRevision:restriction.revision,input:{approve:true,note:'Fictional independent approval'}};
 const results=await Promise.allSettled([run(f,f.manager,command(f)),run(f,f.manager,review)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'availability_shift_conflict');
});
test('any linked task protects draft edits including note-only changes',async()=>{
 const f=await fixture(),r=await run(f,f.manager,command(f));
 await admin.query("INSERT INTO candidate_operations.tasks(id,restaurant_id,assignee_id,department,title,detail,due,phase,revision,shift_id,shift_revision) VALUES($1,$2,$3,'BOH','Fictional task','Fictional detail','2031-11-02T06:00:00Z','open',1,$4,1)",[randomUUID(),f.scope,f.worker.membershipId,r.recordId]);
 await assert.rejects(run(f,f.manager,command(f,{note:'Changed note'},r)),e=>e.code==='linked_shift_protected');assert.equal((await read(r.recordId)).revision,1);
});
test('published, cancelled, released and reference-only drafts cannot be edited',async()=>{
 for(const state of ['published','cancelled','released_at','reference']){
  const f=await fixture(),r=await run(f,f.manager,command(f));
  if(state==='reference')await admin.query('DELETE FROM candidate_operations.schedule_draft_events WHERE shift_id=$1',[r.recordId]);else await admin.query(`UPDATE candidate_operations.shift_references SET ${state}=${state==='released_at'?'clock_timestamp()':'true'} WHERE id=$1`,[r.recordId]);
  await assert.rejects(run(f,f.manager,command(f,{},r)),denied(409));
 }
});
test('station metadata and invalid durations, calendar dates and caller state fail without writes',async()=>{
 const f=await fixture();for(const change of [{stationId:randomUUID()},{end:'2031-11-03T03:00:00-05:00'},{end:'2031-11-02T00:00:00-04:00'},{start:'2031-02-30T01:00:00Z'},{start:'2031-11-02 01:00'},{published:true},{note:33}])await assert.rejects(run(f,f.manager,command(f,change)),e=>[400,409].includes(e.status));
 await assert.rejects(db.transaction(c=>c.query('SELECT candidate_operations.save_schedule_draft($1,$2,$3,$4,$5)',[f.manager.subject,f.manager.membershipId,f.scope,randomUUID(),JSON.stringify({action:'shift.save',input:command(f,{start:'2031-02-30T01:00:00Z'}).input})])),e=>e.code.startsWith('22'));
 assert.equal((await admin.query('SELECT count(*)::int n FROM candidate_operations.shift_references WHERE restaurant_id=$1',[f.scope])).rows[0].n,0);
});
test('audit failure rolls back shift, receipt and workspace revision',async()=>{
 const f=await fixture(),c=command(f);await admin.query(`CREATE FUNCTION candidate_operations.fail_draft_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fictional_draft_failure'; END; $$`);await admin.query('CREATE TRIGGER fail_draft_audit BEFORE INSERT ON candidate_operations.schedule_draft_events FOR EACH ROW EXECUTE FUNCTION candidate_operations.fail_draft_audit()');
 try{await assert.rejects(run(f,f.manager,c),e=>e.message==='fictional_draft_failure');assert.equal((await admin.query('SELECT count(*)::int n FROM candidate_operations.shift_references WHERE restaurant_id=$1',[f.scope])).rows[0].n,0);assert.equal((await admin.query('SELECT revision FROM candidate_identity.restaurants WHERE id=$1',[f.scope])).rows[0].revision,0);assert.equal((await admin.query('SELECT count(*)::int n FROM candidate_operations.command_receipts WHERE request_id=$1',[c.requestId])).rows[0].n,0);}finally{await admin.query('DROP TRIGGER fail_draft_audit ON candidate_operations.schedule_draft_events');await admin.query('DROP FUNCTION candidate_operations.fail_draft_audit()');}
});
test('HTTP draft writes require a valid scoped session and deny raw runtime writes',async()=>{
 const f=await fixture(),sessionId=randomUUID();await admin.query("INSERT INTO candidate_identity.sessions(id,subject,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",[sessionId,f.manager.subject]);
 const handler=createTaskHandler(db,async()=>({subject:f.manager.subject,sessionId}));
 const request=()=>new Request(`http://candidate.invalid/api/operations/${f.scope}/commands`,{method:'POST',headers:{Authorization:'Bearer fictional','Content-Type':'application/json'},body:JSON.stringify(command(f))});
 assert.equal((await handler(request())).status,200);await admin.query('UPDATE candidate_identity.sessions SET active=false WHERE id=$1',[sessionId]);assert.equal((await handler(request())).status,403);
 await assert.rejects(db.transaction(c=>c.query('UPDATE candidate_operations.shift_references SET published=true',[])),e=>e.code==='42501');
});
