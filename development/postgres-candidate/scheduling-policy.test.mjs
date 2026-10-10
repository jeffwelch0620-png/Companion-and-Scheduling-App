import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {connection} from './test-config.mjs';
import {PostgresDatabase} from './postgres-driver.ts';
import {executeTask} from './task-adapter.ts';
import {createTaskHandler} from './task-http.ts';
const admin=new pg.Pool({...connection,user:'candidate_owner',max:4}),db=new PostgresDatabase({...connection,user:'candidate_runtime',max:3});
after(async()=>{await admin.end();await db.close();});
async function fixture(){
 const scope='policy-'+randomUUID(),actors=[];
 await admin.query('INSERT INTO candidate_identity.restaurants(id,name) VALUES($1,$2)',[scope,'Fictional policy store']);
 for(const department of ['BOH','BOH','BOH','FOH']){
  const person=randomUUID(),membershipId=randomUUID(),subject='fictional-'+randomUUID();
  await admin.query('INSERT INTO candidate_identity.people VALUES($1,$2)',[person,'Fictional policy employee']);
  await admin.query('INSERT INTO candidate_identity.auth_links VALUES($1,$2)',[subject,person]);
  await admin.query("INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position) VALUES($1,$2,$3,$4,'Cook')",[membershipId,person,scope,department]);
  await admin.query("INSERT INTO candidate_identity.schedule_eligibility VALUES($1,'Cook','schedule-job',true)",[membershipId]);
  actors.push({subject,membershipId,department});
 }
 const f={scope,worker:actors[0],second:actors[1],manager:actors[2],foreign:actors[3]};
 for(const cap of ['schedule.manage','schedule.publish','schedule.change','location.manage'])await admin.query('INSERT INTO candidate_identity.membership_capabilities VALUES($1,$2,true)',[f.manager.membershipId,cap]);
 await admin.query('INSERT INTO candidate_operations.schedule_input_reviews(restaurant_id,time_off_complete,reviewed_at) VALUES($1,true,clock_timestamp())',[scope]);
 const now=(await admin.query('SELECT clock_timestamp() now')).rows[0].now.getTime();
 return {...f,start:new Date(now-3600000).toISOString(),end:new Date(now+3600000).toISOString()};
}
const run=(f,c,a=f.manager)=>executeTask(db,a,f.scope,c);
const draft=(f,extra={})=>run(f,{requestId:randomUUID(),locationId:f.scope,action:'shift.save',input:{personId:f.worker.membershipId,start:f.start,end:f.end,position:'Cook',...extra}});
const row=async r=>(await admin.query('SELECT * FROM candidate_operations.shift_references WHERE id=$1',[r.recordId])).rows[0];
async function publish(f,r){
 await admin.query("INSERT INTO candidate_operations.publication_reviews(shift_id,shift_revision,workspace_revision,no_staffing,no_closing,evidence) SELECT $1,$2,revision,true,true,'Fictional complete publication evidence' FROM candidate_identity.restaurants WHERE id=$3",[r.recordId,r.revision,f.scope]);
 return run(f,{requestId:randomUUID(),locationId:f.scope,action:'shift.publish',recordId:r.recordId,expectedRevision:r.revision,input:{note:'Fictional publish'}});
}
const edit=(f,r,extra={})=>({requestId:randomUUID(),locationId:f.scope,action:'shift.save',recordId:r.recordId,expectedRevision:r.revision,input:{personId:f.worker.membershipId,start:f.start,end:f.end,position:'Cook',note:'Fictional authorized active-shift correction',...extra}});
const action=(f,r,verb,input)=>({requestId:randomUUID(),locationId:f.scope,action:verb,recordId:r.recordId,expectedRevision:r.revision,input});
const swap=(f,r,target=f.foreign)=>({requestId:randomUUID(),locationId:f.scope,action:'request.create',input:{type:'swap',shiftId:r.recordId,replacementId:target.membershipId,start:f.start,end:f.end,note:'Fictional replacement request'}});
const ended=e=>e.status===409&&e.code==='shift_ended';

test('eligible publisher self-assigns leadership without gaining capabilities; current permissions still govern replay',async()=>{
 const f=await fixture(),caps=async()=>(await admin.query('SELECT * FROM candidate_identity.membership_capabilities WHERE membership_id=$1 ORDER BY capability',[f.manager.membershipId])).rows,before=await caps();
 const command={requestId:randomUUID(),locationId:f.scope,action:'leadership.assign',input:{personId:f.manager.membershipId,area:'BOH',start:f.start,end:f.end,note:'Fictional publisher takes duty'}};
 const result=await run(f,command);assert.equal((await run(f,command)).replayed,true);assert.deepEqual(await caps(),before);
 assert.equal((await admin.query('SELECT member_id FROM candidate_operations.leadership_references WHERE id=$1',[result.recordId])).rows[0].member_id,f.manager.membershipId);
 await admin.query("UPDATE candidate_identity.membership_capabilities SET active=false WHERE membership_id=$1 AND capability='schedule.publish'",[f.manager.membershipId]);
 await assert.rejects(run(f,command),e=>e.status===403);
 await assert.rejects(run(f,{...command,requestId:randomUUID(),input:{...command.input,personId:f.worker.membershipId}},f.worker),e=>e.status===403);
});

test('authorized active-shift edits require a reason and preserve audited department changes and person bookings',async()=>{
 const f=await fixture(),r=await publish(f,await draft(f));
 await assert.rejects(run(f,edit(f,r),f.worker),e=>e.status===403);
 await assert.rejects(run(f,edit(f,r,{note:''})),e=>e.status===400);
 const command=edit(f,r,{personId:f.foreign.membershipId}),changed=await run(f,command),s=await row(changed);
 assert.equal(s.department,'FOH');assert.equal(s.member_id,f.foreign.membershipId);
 const event=(await admin.query('SELECT * FROM candidate_operations.schedule_change_events WHERE shift_id=$1 AND revision=$2',[s.id,s.revision])).rows[0];
 assert.equal(event.note,command.input.note);assert.equal(event.data.before.member_id,f.worker.membershipId);assert.equal(event.data.after.member_id,f.foreign.membershipId);
 assert.equal((await admin.query('SELECT member_id FROM candidate_operations.person_shift_bookings WHERE shift_id=$1',[s.id])).rows[0].member_id,f.foreign.membershipId);
 assert.equal((await run(f,command)).replayed,true);
 await admin.query("UPDATE candidate_identity.membership_capabilities SET active=false WHERE membership_id=$1 AND capability='location.manage'",[f.manager.membershipId]);
 await assert.rejects(run(f,command),e=>e.status===403);
});

test('editing a started draft also requires a nonempty audit reason',async()=>{
 const f=await fixture(),r=await draft(f),command=edit(f,r);delete command.input.note;
 await assert.rejects(run(f,command),e=>e.status===400);await assert.rejects(run(f,edit(f,r,{note:'  '})),e=>e.status===400);
 const changed=await run(f,edit(f,r));
 assert.equal((await admin.query('SELECT data FROM candidate_operations.schedule_draft_events WHERE shift_id=$1 AND revision=$2',[r.recordId,changed.revision])).rows[0].data.note,'Fictional authorized active-shift correction');
});

test('active cross-department swaps require replacement consent and manager authority for both departments',async()=>{
 const f=await fixture(),r=await publish(f,await draft(f)),o=await run(f,swap(f,r),f.worker);
 const review=record=>action(f,record,'request.review',{approve:true,note:'Fictional manager-approved department change'});
 await assert.rejects(run(f,review(o)),e=>e.code==='replacement_consent_required');
 const accepted=await run(f,action(f,o,'request.consent',{accept:true}),f.foreign);
 await assert.rejects(run(f,review(accepted),f.foreign),e=>e.status===403);
 await admin.query("UPDATE candidate_identity.membership_capabilities SET active=false WHERE membership_id=$1 AND capability='location.manage'",[f.manager.membershipId]);
 await admin.query("INSERT INTO candidate_operations.leadership_references(id,restaurant_id,member_id,department,starts_at,ends_at) VALUES($1,$2,$3,'BOH',$4,$5)",[randomUUID(),f.scope,f.manager.membershipId,f.start,f.end]);
 await assert.rejects(run(f,review(accepted)),e=>e.status===403);
 assert.equal((await row(r)).member_id,f.worker.membershipId);
 await admin.query("UPDATE candidate_identity.membership_capabilities SET active=true WHERE membership_id=$1 AND capability='location.manage'",[f.manager.membershipId]);
 const result=await run(f,review(accepted));assert.equal(result.shift.revision,3);assert.equal((await row(r)).department,'FOH');
});

test('ended draft and published shifts reject edits and cancellation atomically, including sanitized HTTP',async()=>{
 for(const published of [false,true]){
  const f=await fixture();f.end=new Date(Date.parse(f.start)+1800000).toISOString();let r=await draft(f);if(published)r=await publish(f,r);
  const before=await row(r),command=edit(f,r),cancel=action(f,r,'shift.cancel',{note:'Fictional historical cancellation',closeTransfers:[]});
  await assert.rejects(run(f,command),ended);await assert.rejects(run(f,cancel),ended);
  const sessionId=randomUUID();await admin.query("INSERT INTO candidate_identity.sessions(id,subject,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",[sessionId,f.manager.subject]);
  const h=createTaskHandler(db,async()=>({subject:f.manager.subject,sessionId})),response=await h(new Request(`http://candidate.invalid/api/operations/${f.scope}/commands`,{method:'POST',headers:{Authorization:'Bearer fictional','Content-Type':'application/json'},body:JSON.stringify(command)}));
  assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:{code:'shift_ended'}});assert.deepEqual(await row(r),before);
  assert.equal((await admin.query('SELECT count(*)::int n FROM candidate_operations.command_receipts WHERE request_id=ANY($1::uuid[])',[[command.requestId,cancel.requestId]])).rows[0].n,0);
 }
});

test('completed-command replay remains idempotent after shift end, while new changes and swaps are rejected',async()=>{
 const f=await fixture(),r=await publish(f,await draft(f)),command=edit(f,r),changed=await run(f,command);
 // Privileged historical fixture only: advance the stored period without a runtime correction endpoint.
 const past=new Date(Date.parse(f.start)+1800000).toISOString();await admin.query('UPDATE candidate_operations.shift_references SET ends_at=$2 WHERE id=$1',[r.recordId,past]);
 assert.equal((await run(f,command)).replayed,true);await assert.rejects(run(f,edit(f,changed)),ended);
 await assert.rejects(run(f,swap(f,changed),f.worker),e=>e.status===409&&e.code==='offer_changed');
 const fakeOffer={shift_id:r.recordId,restaurant_id:f.scope,owner_id:f.worker.membershipId,department:'BOH',mode:'swap',status:'pending'};
 assert.equal((await admin.query('SELECT candidate_operations.offer_issue(jsonb_populate_record(NULL::candidate_operations.schedule_offers,$1::jsonb)) reason',[fakeOffer])).rows[0].reason,'offer_shift_ended');
 await admin.query("UPDATE candidate_identity.membership_capabilities SET active=false WHERE membership_id=$1 AND capability='schedule.change'",[f.manager.membershipId]);await assert.rejects(run(f,command),e=>e.status===403);
});

test('time-off review can cancel an active draft with a reason but cannot cancel an ended draft',async()=>{
 for(const complete of [false,true]){
  const f=await fixture();if(complete)f.end=new Date(Date.parse(f.start)+1800000).toISOString();
  const r=await draft(f),request=await run(f,{requestId:randomUUID(),locationId:f.scope,action:'request.create',input:{type:'time-off',start:f.start,end:f.end,note:'Fictional leave request'}},f.worker);
  const command=action(f,request,'request.review',{approve:true,note:'Fictional independently reviewed leave',affectedShifts:[{id:r.recordId,revision:r.revision}]}),before=await row(r);
  if(complete){
   await assert.rejects(run(f,command),ended);assert.deepEqual(await row(r),before);
   assert.equal((await admin.query('SELECT status,revision FROM candidate_operations.time_off_references WHERE id=$1',[request.recordId])).rows[0].status,'pending');
   assert.equal((await admin.query('SELECT count(*)::int n FROM candidate_operations.command_receipts WHERE request_id=$1',[command.requestId])).rows[0].n,0);
  }else{
   await run(f,command);assert.equal((await row(r)).cancelled,true);
   assert.equal((await admin.query('SELECT data FROM candidate_operations.schedule_draft_events WHERE shift_id=$1 AND revision=2',[r.recordId])).rows[0].data.note,command.input.note);
  }
 }
});

test('a command waiting for store coordination rechecks server time after the shift has ended',async()=>{
 const f=await fixture(),r=await publish(f,await draft(f)),end=new Date(Date.now()+1600).toISOString();
 await admin.query('UPDATE candidate_operations.shift_references SET ends_at=$2 WHERE id=$1',[r.recordId,end]);f.end=end;
 const lock=await admin.connect();let pending;
 try{
  await lock.query('BEGIN');await lock.query('SELECT candidate_operations.lock_scope($1)',[f.scope]);
  const command=edit(f,r);pending=run(f,command);pending.catch(()=>{});
  const deadline=Date.now()+1200;let blocked=false;
  while(Date.now()<deadline){blocked=(await admin.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename='candidate_runtime' AND wait_event_type='Lock' AND query LIKE '%save_shift%') blocked")).rows[0].blocked;if(blocked)break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(blocked,true,'Command must start and wait before the end boundary');
  while((await admin.query('SELECT clock_timestamp()<$1::timestamptz waiting',[end])).rows[0].waiting)await new Promise(resolve=>setTimeout(resolve,20));
  await lock.query('COMMIT');await assert.rejects(pending,ended);assert.equal((await row(r)).revision,r.revision);
 }finally{await lock.query('ROLLBACK');lock.release();if(pending)await pending.catch(()=>{});}
});
