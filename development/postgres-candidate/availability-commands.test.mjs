import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import pg from 'pg';
import {connection} from './test-config.mjs';import {PostgresDatabase} from './postgres-driver.ts';import {executeTask} from './task-adapter.ts';import {createTaskHandler} from './task-http.ts';
import {availabilityConflict} from './runtime/closing-reference/schedule-policy.mjs';
const admin=new pg.Pool({...connection,user:'candidate_owner',max:2}),db=new PostgresDatabase({...connection,user:'candidate_runtime',max:3});after(async()=>{await admin.end();await db.close();});
async function fixture(){
 const scope=`availability-${randomUUID()}`;await admin.query('INSERT INTO candidate_identity.restaurants(id,name) VALUES($1,$2)',[scope,'Fictional availability']);const actors=[];
 for(const area of ['BOH','BOH','FOH']){
  const person=randomUUID(),membershipId=randomUUID(),subject=`availability-${randomUUID()}`;
  await admin.query('INSERT INTO candidate_identity.people(id,name) VALUES($1,$2)',[person,'Fictional availability employee']);await admin.query('INSERT INTO candidate_identity.auth_links(subject,person_id) VALUES($1,$2)',[subject,person]);
  await admin.query("INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position) VALUES($1,$2,$3,$4,'Cook')",[membershipId,person,scope,area]);actors.push({subject,membershipId});
 }
 for(const a of actors.slice(1))await admin.query("INSERT INTO candidate_identity.membership_capabilities(membership_id,capability) VALUES($1,'schedule.manage')",[a.membershipId]);
 return {scope,worker:actors[0],manager:actors[1],foreign:actors[2]};
}
const input=()=>({startDate:'2031-11-01',endDate:'2031-11-03',days:[0],startMinute:60,endMinute:120,beforeMinutes:30,afterMinutes:20,excludedDates:[],title:'Fictional school hours',kind:'school'});
const save=(f,data=input(),record)=>({requestId:randomUUID(),locationId:f.scope,action:'availability.save',input:data,...(record?{recordId:record.recordId,expectedRevision:record.revision}:{})});
const review=(f,r,approve=true)=>({requestId:randomUUID(),locationId:f.scope,action:'availability.review',recordId:r.recordId,expectedRevision:r.revision,input:{approve,note:'Fictional independent review'}});
const run=(f,a,c)=>executeTask(db,a,f.scope,c);
const read=async(f,id)=>(await admin.query('SELECT * FROM candidate_operations.availability_references WHERE id=$1 AND restaurant_id=$2',[id,f.scope])).rows[0];
const denied=status=>e=>e.status===status;
test('save and independent review retain normalized restrictions, events, receipts and outbox',async()=>{
 const f=await fixture(),c=save(f,{...input(),days:[0,0]}),created=await run(f,f.worker,c);
 assert.equal((await read(f,created.recordId)).status,'pending');assert.deepEqual((await read(f,created.recordId)).data.days,[0]);
 await assert.rejects(run(f,f.worker,review(f,created)),denied(403));const approved=await run(f,f.manager,review(f,created));assert.equal(approved.revision,2);assert.equal((await read(f,created.recordId)).status,'approved');
 assert.equal((await admin.query('SELECT count(*)::int n FROM candidate_operations.availability_events WHERE availability_id=$1',[created.recordId])).rows[0].n,2);
 assert.equal((await admin.query('SELECT count(*)::int n FROM candidate_operations.availability_outbox WHERE availability_id=$1',[created.recordId])).rows[0].n,2);
 await assert.rejects(run(f,f.worker,save(f,input(),approved)),denied(409));
});
test('pending edits require current revision and original owner; reviewer scope cannot be inferred from title',async()=>{
 const f=await fixture(),r=await run(f,f.worker,save(f));
 await assert.rejects(run(f,f.foreign,review(f,r)),denied(403));await assert.rejects(run(f,f.worker,save(f,{...input(),personId:f.manager.membershipId},r)),denied(403));
 const updated=await run(f,f.worker,save(f,{...input(),title:'Edited draft'},r));assert.equal(updated.revision,2);
 await assert.rejects(run(f,f.worker,save(f,input(),r)),denied(409));
 await admin.query("UPDATE candidate_identity.memberships SET position='GM' WHERE id=$1",[f.foreign.membershipId]);await assert.rejects(run(f,f.foreign,review(f,updated)),denied(403));
 const declined=await run(f,f.manager,review(f,updated,false));assert.equal((await read(f,declined.recordId)).status,'declined');
});
test('replacement approval supersedes prior rule atomically and stale replacement references conflict',async()=>{
 const f=await fixture(),first=await run(f,f.worker,save(f));await run(f,f.manager,review(f,first));
 const second=await run(f,f.worker,save(f,{...input(),title:'Replacement',replacesId:first.recordId}));await run(f,f.manager,review(f,second));
 assert.equal((await read(f,first.recordId)).status,'superseded');assert.equal((await read(f,first.recordId)).revision,3);assert.equal((await read(f,second.recordId)).status,'approved');
 await assert.rejects(run(f,f.worker,save(f,{...input(),replacesId:first.recordId})),denied(409));
});
test('approval blocks conflicting draft shifts and preserves pending data until conflict is corrected',async()=>{
 const f=await fixture(),r=await run(f,f.worker,save(f)),shift=randomUUID();
 await admin.query("INSERT INTO candidate_operations.shift_references(id,restaurant_id,member_id,department,position,starts_at,ends_at,revision,published) VALUES($1,$2,$3,'BOH','Cook','2031-11-02T01:30:00-05:00','2031-11-02T02:00:00-05:00',1,false)",[shift,f.scope,f.worker.membershipId]);
 await assert.rejects(run(f,f.manager,review(f,r)),denied(409));assert.equal((await read(f,r.recordId)).status,'pending');assert.equal((await read(f,r.recordId)).revision,1);
 await admin.query('UPDATE candidate_operations.shift_references SET cancelled=true WHERE id=$1',[shift]);await run(f,f.manager,review(f,r));assert.equal((await read(f,r.recordId)).status,'approved');
});
test('PostgreSQL minute matching agrees with original availability rules through DST, buffers and exceptions',async()=>{
 const f=await fixture();
 for(const [start,end,data] of [
  ['2031-11-02T00:20:00-04:00','2031-11-02T00:29:00-04:00',input()],
  ['2031-11-02T00:30:00-04:00','2031-11-02T00:40:00-04:00',input()],
  ['2031-11-02T01:30:00-04:00','2031-11-02T01:40:00-04:00',input()],
  ['2031-11-02T01:30:00-05:00','2031-11-02T01:40:00-05:00',input()],
  ['2031-11-02T01:30:00-05:00','2031-11-02T01:40:00-05:00',{...input(),excludedDates:['2031-11-02']}],
  ['2031-11-02T02:20:00-05:00','2031-11-02T02:30:00-05:00',input()],
  ['2031-11-01T23:50:00-04:00','2031-11-02T00:10:00-04:00',{...input(),startMinute:0,endMinute:30}],
 ]) {
  const d={...data,status:'approved'},w={location:{timezone:'America/New_York'},records:[{kind:'availability',ownerId:f.worker.membershipId,data:d}]};
  const actual=(await admin.query("SELECT candidate_operations.availability_period_conflict($1,$2,$3,'America/New_York') AS conflict",[JSON.stringify(d),start,end])).rows[0].conflict;
  assert.equal(actual,!!availabilityConflict(w,f.worker.membershipId,{start,end}));
 }
});
test('concurrent retries apply once, changed payload conflicts and revoked reviewer cannot replay',async()=>{
 const f=await fixture(),c=save(f),results=await Promise.all([run(f,f.worker,c),run(f,f.worker,c)]);assert.deepEqual(results.map(r=>r.replayed).sort(),[false,true]);
 await assert.rejects(run(f,f.worker,{...c,input:{...c.input,title:'Changed'}}),denied(409));const command=review(f,results[0]);await run(f,f.manager,command);
 await admin.query('UPDATE candidate_identity.membership_capabilities SET active=false WHERE membership_id=$1',[f.manager.membershipId]);await assert.rejects(run(f,f.manager,command),denied(403));
});
test('invalid dates, minutes, exceptions and caller status are rejected at command and database boundaries',async()=>{
 const f=await fixture();for(const change of [{startDate:'2031-02-30'},{days:[]},{days:['0']},{startMinute:120,endMinute:60},{beforeMinutes:181},{excludedDates:['2031-12-01']},{status:'approved'}]) await assert.rejects(run(f,f.worker,save(f,{...input(),...change})),denied(400));
 const raw={action:'availability.save',input:{...input(),endMinute:'120'}};
 await assert.rejects(db.transaction(c=>c.query('SELECT candidate_operations.availability_command($1,$2,$3,$4,$5)',[f.worker.subject,f.worker.membershipId,f.scope,randomUUID(),JSON.stringify(raw)])),e=>e.code==='22023');
});
test('outbox failure rolls back availability, audit, receipt and scope revision',async()=>{
 const f=await fixture(),command=save(f);await admin.query(`CREATE FUNCTION candidate_operations.fail_availability_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fictional_availability_failure'; END; $$`);await admin.query('CREATE TRIGGER fail_availability_outbox BEFORE INSERT ON candidate_operations.availability_outbox FOR EACH ROW EXECUTE FUNCTION candidate_operations.fail_availability_outbox()');
 try {await assert.rejects(run(f,f.worker,command),e=>e.message==='fictional_availability_failure');assert.equal((await admin.query('SELECT count(*)::int n FROM candidate_operations.availability_references WHERE restaurant_id=$1',[f.scope])).rows[0].n,0);assert.equal((await admin.query('SELECT revision FROM candidate_identity.restaurants WHERE id=$1',[f.scope])).rows[0].revision,0);assert.equal((await admin.query('SELECT count(*)::int n FROM candidate_operations.command_receipts WHERE request_id=$1',[command.requestId])).rows[0].n,0);
 }finally{await admin.query('DROP TRIGGER fail_availability_outbox ON candidate_operations.availability_outbox');await admin.query('DROP FUNCTION candidate_operations.fail_availability_outbox()');}
});
test('HTTP save and review resolve sessions; runtime cannot edit availability or execute private conflict helper',async()=>{
 const f=await fixture(),session=randomUUID();await admin.query("INSERT INTO candidate_identity.sessions(id,subject,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",[session,f.worker.subject]);const handler=createTaskHandler(db,async()=>({subject:f.worker.subject,sessionId:session}));
 const response=await handler(new Request(`https://candidate.invalid/api/operations/${f.scope}/commands`,{method:'POST',headers:{Authorization:'Bearer fictional-verified-session','Content-Type':'application/json'},body:JSON.stringify(save(f))}));assert.equal(response.status,200);
 const created=await response.json(),managerSession=randomUUID();await admin.query("INSERT INTO candidate_identity.sessions(id,subject,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",[managerSession,f.manager.subject]);
 const reviewer=createTaskHandler(db,async()=>({subject:f.manager.subject,sessionId:managerSession}));
 const approved=await reviewer(new Request(`https://candidate.invalid/api/operations/${f.scope}/commands`,{method:'POST',headers:{Authorization:'Bearer fictional-reviewed-session','Content-Type':'application/json'},body:JSON.stringify(review(f,created))}));assert.equal(approved.status,200);
 await assert.rejects(db.transaction(c=>c.query('SELECT candidate_operations.availability_period_conflict($1,$2,$3,$4)',[JSON.stringify(input()),'2031-11-02T05:00:00Z','2031-11-02T06:00:00Z','America/New_York'])),e=>e.code==='42501');
});
test('concurrent edit and review of one revision cannot both apply',async()=>{
 const f=await fixture(),r=await run(f,f.worker,save(f));
 const results=await Promise.allSettled([run(f,f.worker,save(f,{...input(),title:'Concurrent edit'},r)),run(f,f.manager,review(f,r))]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.status,409);assert.equal((await read(f,r.recordId)).revision,2);
});
test('inactive and schedule-only writers are denied and saving requires an independent scoped reviewer',async()=>{
 const f=await fixture();await admin.query('UPDATE candidate_identity.membership_capabilities SET active=false WHERE membership_id=$1',[f.manager.membershipId]);
 await assert.rejects(run(f,f.worker,save(f)),denied(403));
 await admin.query('UPDATE candidate_identity.memberships SET schedule_only=true WHERE id=$1',[f.worker.membershipId]);await assert.rejects(run(f,f.worker,save(f)),denied(403));
 await admin.query('UPDATE candidate_identity.memberships SET schedule_only=false,active=false WHERE id=$1',[f.worker.membershipId]);await assert.rejects(run(f,f.worker,save(f)),denied(403));
});
