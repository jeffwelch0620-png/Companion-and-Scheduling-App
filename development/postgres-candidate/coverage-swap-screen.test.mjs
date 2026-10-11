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

const offerFor=async(f,actor,id)=>(await loadScheduleScreen(http(f,actor))).records.find(r=>r.id===id);

test('server coverage flags match owner, coworker, volunteer and independent approval commands',async()=>{
 const f=await fixture(false),o=await request(f);
 const owner=await offerFor(f,f.worker,o.recordId);assert.equal(owner.data.actions.canWithdraw,true);assert.equal(owner.data.actions.canVolunteer,false);assert.equal(owner.data.actions.canApprove,false);
 const worker=await offerFor(f,f.second,o.recordId);assert.equal(worker.data.actions.canVolunteer,true);assert.deepEqual(worker.data.actions.approvalTargetIds,[]);
 await respond(f,f.second,o.recordId,'coverage.volunteer',{confirmed:true});
 const volunteer=await offerFor(f,f.second,o.recordId);assert.equal(volunteer.data.actions.canWithdrawVolunteer,true);assert.equal(volunteer.data.actions.canVolunteer,false);
 const manager=await offerFor(f,f.manager,o.recordId);assert.equal(manager.data.actions.canApprove,true);assert.deepEqual(manager.data.actions.approvalTargetIds,[f.second.membershipId]);
 await respond(f,f.second,o.recordId,'coverage.withdraw-volunteer',{});assert.equal((await offerFor(f,f.manager,o.recordId)).data.actions.canApprove,false);
 await respond(f,f.worker,o.recordId,'coverage.withdraw',{});assert.equal((await offerFor(f,f.worker,o.recordId)).data.actions.canWithdraw,false);
});

test('leadership-backed and store-wide reviewer flags match approval outcomes; location.manage alone grants nothing',async()=>{
 const f=await fixture(false),o=await request(f);await respond(f,f.second,o.recordId,'coverage.volunteer',{confirmed:true});
 await admin.query("DELETE FROM candidate_identity.membership_capabilities WHERE membership_id=$1 AND capability='location.manage'",[f.manager.membershipId]);
 assert.equal((await offerFor(f,f.manager,o.recordId)).data.actions.canApprove,false);
 const raw=()=>({requestId:randomUUID(),locationId:f.scope,action:'coverage.approve',recordId:o.recordId,expectedRevision:2,input:{personId:f.second.membershipId,confirmed:true,note:'Reviewed'}});
 assert.equal((await http(f,f.manager)('/commands',raw())).status,403);
 await admin.query('INSERT INTO candidate_operations.leadership_references(id,restaurant_id,member_id,department,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),f.scope,f.manager.membershipId,'Kitchen',start,end]);
 assert.equal((await offerFor(f,f.manager,o.recordId)).data.actions.canApprove,true);
 await admin.query("INSERT INTO candidate_identity.membership_capabilities VALUES($1,'location.manage',true)",[f.foreign.membershipId]);
 assert.equal(await offerFor(f,f.foreign,o.recordId),undefined);
 await admin.query("INSERT INTO candidate_identity.membership_capabilities VALUES($1,'schedule.change',true)",[f.foreign.membershipId]);
 assert.equal((await offerFor(f,f.foreign,o.recordId)).data.actions.canApprove,true);
 await respond(f,f.manager,o.recordId,'coverage.approve',{personId:f.second.membershipId,confirmed:true,note:'Dated leader reviewed'});assert.equal((await row(f)).member_id,f.second.membershipId);
});

test('named consent and decline flags preserve independent review before acceptance and current replacement eligibility',async()=>{
 const f=await fixture(false),o=await request(f,'swap');const replacement=await offerFor(f,f.second,o.recordId);assert.equal(replacement.data.actions.canConsent,true);assert.equal(replacement.data.actions.canApprove,false);assert.equal(replacement.data.actions.canDecline,false);
 const pending=await offerFor(f,f.manager,o.recordId);assert.equal(pending.data.actions.canDecline,true);assert.equal(pending.data.actions.canApprove,false);
 await respond(f,f.second,o.recordId,'request.consent',{accept:true,confirmed:true});assert.equal((await offerFor(f,f.manager,o.recordId)).data.actions.canApprove,true);
 await admin.query('UPDATE candidate_identity.schedule_eligibility SET active=false WHERE member_id=$1',[f.second.membershipId]);const changed=await offerFor(f,f.manager,o.recordId);assert.equal(changed.data.actions.canApprove,false);assert.equal(changed.data.actions.canDecline,true);
 await respond(f,f.manager,o.recordId,'request.review',{approve:false,note:'Eligibility changed'});assert.equal((await row(f)).member_id,f.worker.membershipId);
});

test('department acknowledgement is enforced by the server, recorded atomically and retained through receipt replay',async()=>{
 const f=await fixture(false),o=await request(f,'swap',f.foreign);await respond(f,f.foreign,o.recordId,'request.consent',{accept:true,confirmed:true});const r=await offerFor(f,f.manager,o.recordId);assert.equal(r.data.actions.departmentChange,true);assert.equal(r.data.actions.replacementDepartment,'Service');
 const call=http(f,f.manager),base={requestId:randomUUID(),locationId:f.scope,action:'request.review',recordId:o.recordId,expectedRevision:r.revision,input:{approve:true,note:'Reviewed department and staffing'}};
 for(const value of [undefined,false,'true']){const command=structuredClone(base);command.requestId=randomUUID();if(value!==undefined)command.input.departmentConfirmed=value;const refused=await call('/commands',command);assert.equal(refused.status,400);assert.equal((await row(f)).member_id,f.worker.membershipId);assert.equal((await admin.query("SELECT count(*)::int count FROM candidate_operations.schedule_offer_events WHERE offer_id=$1 AND action='request.review'",[o.recordId])).rows[0].count,0);}
 const command={...base,input:{...base.input,departmentConfirmed:true}};assert.equal((await call('/commands',command)).status,200);const replay=await call('/commands',command);assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);
 const events=(await admin.query("SELECT data FROM candidate_operations.schedule_offer_events WHERE offer_id=$1 AND action='request.review'",[o.recordId])).rows;assert.equal(events.length,1);assert.equal(events[0].data.departmentConfirmed,true);assert.equal(events[0].data.fromDepartment,'Kitchen');assert.equal(events[0].data.toDepartment,'Service');
 assert.equal((await admin.query('SELECT payload FROM candidate_operations.command_receipts WHERE restaurant_id=$1 AND request_id=$2',[f.scope,command.requestId])).rows[0].payload.input.departmentConfirmed,true);
});

test('flags cannot authorize a command after reviewer authority or replacement eligibility changes',async()=>{
 const f=await fixture(false),o=await request(f);await respond(f,f.second,o.recordId,'coverage.volunteer',{confirmed:true});const w=await loadScheduleScreen(http(f,f.manager)),r=w.records.find(r=>r.id===o.recordId);assert.equal(r.data.actions.canApprove,true);
 const input=offerCommandInput(w,r,'coverage.approve',{personId:f.second.membershipId,confirmed:true,note:'Reviewed'},now);
 await admin.query("UPDATE candidate_identity.membership_capabilities SET active=false WHERE membership_id=$1 AND capability='schedule.change'",[f.manager.membershipId]);await assert.rejects(new ScheduleScreenSender().send(http(f,f.manager),f.scope,'coverage.approve',input,r),e=>e.status===403);assert.equal((await row(f)).member_id,f.worker.membershipId);
 await admin.query("UPDATE candidate_identity.membership_capabilities SET active=true WHERE membership_id=$1 AND capability='schedule.change'",[f.manager.membershipId]);await admin.query('UPDATE candidate_identity.schedule_eligibility SET active=false WHERE member_id=$1',[f.second.membershipId]);assert.equal((await offerFor(f,f.manager,o.recordId)).data.actions.canApprove,false);await assert.rejects(new ScheduleScreenSender().send(http(f,f.manager),f.scope,'coverage.approve',input,r),e=>e.status===409);
});

test('runtime cannot inspect private action helper or write acknowledgement audit data directly',async()=>{
 await assert.rejects(db.pool.query("SELECT candidate_operations.offer_actions(NULL::candidate_operations.schedule_offers,$1::uuid)",[randomUUID()]),e=>e.code==='42501');
 await assert.rejects(db.pool.query("UPDATE candidate_operations.schedule_offer_events SET data='{}'"),e=>e.code==='42501');
});
