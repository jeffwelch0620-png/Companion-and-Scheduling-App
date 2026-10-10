import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import pg from 'pg';
import {connection} from './test-config.mjs';import {PostgresDatabase} from './postgres-driver.ts';import {executeTask} from './task-adapter.ts';import {createTaskHandler} from './task-http.ts';
import {loadScheduleScreen,ScheduleScreenSender} from './schedule-screen-client.mjs';import {offerCommandInput,replacementInput} from './coverage-swap-client.mjs';
const admin=new pg.Pool({...connection,user:'candidate_owner'}),db=new PostgresDatabase({...connection,user:'candidate_runtime'});after(async()=>{await admin.end();await db.close();});
const now='2031-05-01T12:00:00Z',start='2031-05-01T13:00:00Z',end='2031-05-01T15:00:00Z';
async function fixture(close=true) {
 const scope='coverage-ui-'+randomUUID(),actors=[];
 await admin.query("INSERT INTO candidate_identity.restaurants(id,name,timezone,operating_departments,dish_department,dish_position,dish_aliases) VALUES($1,'Fictional coverage UI','America/Chicago',ARRAY['Kitchen','Service'],'Kitchen','Steward',ARRAY['Steward'])",[scope]);
 for(const [name,area,caps] of [['worker','Kitchen',[]],['second','Kitchen',[]],['manager','Kitchen',['schedule.manage','schedule.publish','schedule.change','location.manage','people.manage','close.confirm','tasks.manage']],['foreign','Service',[]]]) {
  const person=randomUUID(),membershipId=randomUUID(),subject='fictional-'+randomUUID(),sessionId=randomUUID();
  await admin.query('INSERT INTO candidate_identity.people VALUES($1,$2)',[person,'Fictional '+name]);await admin.query('INSERT INTO candidate_identity.auth_links VALUES($1,$2)',[subject,person]);await admin.query("INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position) VALUES($1,$2,$3,$4,'Cook')",[membershipId,person,scope,area]);await admin.query("INSERT INTO candidate_identity.schedule_eligibility VALUES($1,'Cook','schedule-job',true)",[membershipId]);for(const cap of caps)await admin.query('INSERT INTO candidate_identity.membership_capabilities VALUES($1,$2,true)',[membershipId,cap]);await admin.query("INSERT INTO candidate_identity.sessions(id,subject,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",[sessionId,subject]);actors.push({subject,membershipId,sessionId});
 }
 const f={scope,worker:actors[0],second:actors[1],manager:actors[2],foreign:actors[3]};
 await admin.query('INSERT INTO candidate_operations.schedule_input_reviews(restaurant_id,time_off_complete,reviewed_at) VALUES($1,true,clock_timestamp())',[scope]);
 let shift=await executeTask(db,f.manager,scope,{requestId:randomUUID(),locationId:scope,action:'shift.save',input:{personId:f.worker.membershipId,position:'Cook',start,end}});
 if(close) {
  const standard=randomUUID();await admin.query("INSERT INTO candidate_operations.standard_references VALUES($1,$2,'Kitchen','Fictional clean grill','Grill','Cook',1,1,'manager','approved','[\"Clean\",\"Sanitize\"]')",[standard,scope]);await admin.query('INSERT INTO candidate_operations.shift_standard_links(shift_id,standard_id,restaurant_id) VALUES($1,$2,$3)',[shift.recordId,standard,scope]);for(const a of [f.worker,f.second])await admin.query("INSERT INTO candidate_identity.station_clearances VALUES($1,$2,'Cook',true)",[a.membershipId,scope]);f.close=await executeTask(db,f.manager,scope,{requestId:randomUUID(),locationId:scope,action:'close.assign',input:{shiftId:shift.recordId,standardId:standard,managerId:f.manager.membershipId,due:'2031-05-01T14:30:00Z',note:'Independent fictional closing'}});
 }
 await admin.query("INSERT INTO candidate_operations.publication_reviews(shift_id,shift_revision,workspace_revision,no_staffing,no_closing,evidence) SELECT $1,$2,revision,true,$3,'Complete fictional fixture only' FROM candidate_identity.restaurants WHERE id=$4",[shift.recordId,shift.revision,!close,scope]);
 shift=await executeTask(db,f.manager,scope,{requestId:randomUUID(),locationId:scope,action:'shift.publish',recordId:shift.recordId,expectedRevision:shift.revision,input:{note:'Fictional publication'}});f.shift=shift;return f;
}
function http(f,a) {
 const h=createTaskHandler(db,async()=>({subject:a.subject,sessionId:a.sessionId}));return async(path,command)=>{const response=await h(new Request('http://candidate.invalid/api/operations/'+f.scope+path,{method:command?'POST':'GET',headers:{Authorization:'Bearer fictional','Content-Type':'application/json'},...(command?{body:JSON.stringify(command)}:{})}));return {status:response.status,body:await response.json()};};
}
const row=async(f)=>(await admin.query('SELECT member_id,department FROM candidate_operations.shift_references WHERE id=$1',[f.shift.recordId])).rows[0];
async function request(f,type='coverage',target=f.second) {
 const call=http(f,f.worker),w=await loadScheduleScreen(call),shift=w.records.find(r=>r.id===f.shift.recordId),input=replacementInput(w,shift,type,{note:'Private fictional note',replacementId:target.membershipId},now);return new ScheduleScreenSender().send(call,f.scope,type==='coverage'?'coverage.create':'request.create',input);
}
async function respond(f,actor,offerId,action,fields,customCall) {
 const call=http(f,actor),w=await loadScheduleScreen(call),r=w.records.find(r=>r.id===offerId),input=offerCommandInput(w,r,action,fields,now),sender=new ScheduleScreenSender();return {sender,call,result:await sender.send(customCall??call,f.scope,action,input,r),w,r};
}
test('HTTP coverage screen keeps assignment until consent and independent approval, then transfers captured closing duties',async()=>{
 const f=await fixture(),offer=await request(f);let w=await loadScheduleScreen(http(f,f.second)),r=w.records.find(r=>r.id===offer.recordId);assert.equal(r.data.note,'');assert.deepEqual(r.data.history,[]);assert.equal(r.data.duties[0].title,'Fictional clean grill');assert.equal(r.data.eligible,true);
 const volunteer=await respond(f,f.second,offer.recordId,'coverage.volunteer',{confirmed:true});assert.equal((await row(f)).member_id,f.worker.membershipId);
 const approved=await respond(f,f.manager,offer.recordId,'coverage.approve',{personId:f.second.membershipId,confirmed:true,note:'Reviewed inherited closing duties'});assert.equal((await row(f)).member_id,f.second.membershipId);assert.ok(approved.result.shift);
 assert.equal((await admin.query('SELECT owner_id FROM candidate_operations.closes WHERE id=$1',[f.close.recordId])).rows[0].owner_id,f.second.membershipId);assert.ok(volunteer.result.revision>offer.revision);
});
test('HTTP named replacement needs explicit acceptance and separately authorized department-change approval',async()=>{
 const f=await fixture(false),offer=await request(f,'swap',f.foreign);assert.equal((await row(f)).member_id,f.worker.membershipId);await respond(f,f.foreign,offer.recordId,'request.consent',{accept:true,confirmed:true});assert.equal((await row(f)).member_id,f.worker.membershipId);
 const w=await loadScheduleScreen(http(f,f.manager)),r=w.records.find(r=>r.id===offer.recordId);assert.throws(()=>offerCommandInput(w,r,'request.review',{approve:true,confirmed:true,note:'Reviewed'},now),/department change/);
 await respond(f,f.manager,offer.recordId,'request.review',{approve:true,confirmed:true,departmentConfirmed:true,note:'Approved department change and staffing review'});assert.deepEqual(await row(f),{member_id:f.foreign.membershipId,department:'Service'});
});
test('HTTP uncertainty retries the original acceptance receipt without duplicate events or premature ownership change',async()=>{
 const f=await fixture(false),offer=await request(f,'swap'),call=http(f,f.second),w=await loadScheduleScreen(call),r=w.records.find(r=>r.id===offer.recordId),sender=new ScheduleScreenSender(),input=offerCommandInput(w,r,'request.consent',{accept:true,confirmed:true},now);let original;
 await assert.rejects(sender.send(async(path,command)=>{original=structuredClone(command);const response=await call(path,command);assert.equal(response.status,200);throw Error('Fictional lost response');},f.scope,'request.consent',input,r),/lost response/);const retry=await sender.retry(async(path,command)=>{assert.deepEqual(command,original);return call(path,command);});assert.equal(retry.replayed,true);assert.equal((await row(f)).member_id,f.worker.membershipId);
 assert.equal((await admin.query("SELECT count(*)::integer count FROM candidate_operations.schedule_offer_events WHERE offer_id=$1 AND action='request.consent'",[offer.recordId])).rows[0].count,1);
});
test('current restrictions, changed duties and revoked sessions fail closed through the coverage screen',async()=>{
 const f=await fixture(),offer=await request(f);await respond(f,f.second,offer.recordId,'coverage.volunteer',{confirmed:true});const call=http(f,f.manager),w=await loadScheduleScreen(call),r=w.records.find(r=>r.id===offer.recordId),sender=new ScheduleScreenSender(),input=offerCommandInput(w,r,'coverage.approve',{personId:f.second.membershipId,confirmed:true,note:'Reviewed'},now);
 await admin.query('UPDATE candidate_identity.station_clearances SET active=false WHERE member_id=$1',[f.second.membershipId]);await assert.rejects(sender.send(call,f.scope,'coverage.approve',input,r),e=>e.status===409);assert.equal(sender.pending,null);assert.equal((await row(f)).member_id,f.worker.membershipId);
 await admin.query("UPDATE candidate_operations.closes SET due=due+interval '1 minute' WHERE id=$1",[f.close.recordId]);const changed=(await loadScheduleScreen(call)).records.find(x=>x.id===r.id);assert.equal(changed.data.status,'invalidated');assert.throws(()=>offerCommandInput(w,changed,'coverage.approve',{...input,confirmed:true},now));
 await admin.query('UPDATE candidate_identity.sessions SET active=false WHERE id=$1',[f.manager.sessionId]);await assert.rejects(loadScheduleScreen(call),/access is unavailable/);
});
