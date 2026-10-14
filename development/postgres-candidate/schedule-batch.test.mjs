import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import pg from 'pg';
import {connection} from './test-config.mjs';import {fictionalStoreInsert} from './store-fixture.mjs';import {PostgresDatabase} from './postgres-driver.ts';
import {executeTask,parseBatchSelection,parseCommand} from './task-adapter.ts';import {createTaskHandler} from './task-http.ts';
import {ScheduleScreenSender} from './schedule-screen-client.mjs';
const admin=new pg.Pool({...connection,user:'candidate_owner',max:5}),db=new PostgresDatabase({...connection,user:'candidate_runtime',max:5});
after(async()=>{await db.close();await admin.end();});
async function fixture(){
 const scope='fictional-batch-'+randomUUID(),manager={subject:'fictional-batch-manager-'+randomUUID(),membershipId:randomUUID(),sessionId:randomUUID()},worker=randomUUID(),other=randomUUID();
 await admin.query(fictionalStoreInsert,[scope,'Fictional batch store']);
 for(const [member,subject] of [[manager.membershipId,manager.subject],[worker,'fictional-batch-worker-'+randomUUID()],[other,'fictional-batch-other-'+randomUUID()]]){
  const person=randomUUID();await admin.query('INSERT INTO candidate_identity.people VALUES($1,$2)',[person,'Fictional batch person']);await admin.query('INSERT INTO candidate_identity.auth_links VALUES($1,$2)',[subject,person]);
  await admin.query("INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position) VALUES($1,$2,$3,'BOH','Cook')",[member,person,scope]);await admin.query("INSERT INTO candidate_identity.schedule_eligibility VALUES($1,'Cook','schedule-job',true)",[member]);
 }
 for(const cap of ['schedule.manage','schedule.publish','location.manage'])await admin.query('INSERT INTO candidate_identity.membership_capabilities VALUES($1,$2,true)',[manager.membershipId,cap]);
 await admin.query("INSERT INTO candidate_identity.sessions(id,subject,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",[manager.sessionId,manager.subject]);
 const f={scope,manager,worker,other};await complete(f);return f;
}
const complete=f=>admin.query('INSERT INTO candidate_operations.schedule_input_reviews(restaurant_id,time_off_complete,reviewed_at) VALUES($1,true,clock_timestamp()) ON CONFLICT(restaurant_id) DO UPDATE SET time_off_complete=true,reviewed_at=clock_timestamp()',[f.scope]);
const run=(f,c)=>executeTask(db,f.manager,f.scope,c);
const create=(f,person=f.worker,start='2035-10-23T16:00Z',end='2035-10-23T17:00Z')=>run(f,{requestId:randomUUID(),locationId:f.scope,action:'shift.save',input:{personId:person,position:'Cook',start,end,note:'Fictional source draft'}});
const proposal=(s,person,startLocal='2035-10-23T13:00',endLocal='2035-10-23T14:00',position='Cook',extra={})=>({id:s.recordId,revision:s.revision,input:{personId:person,position,startLocal,endLocal,...extra}});
const selection=(drafts,weekStart='2035-10-22')=>({weekStart,drafts});
const review=(f,s)=>db.transaction(async c=>(await c.query('SELECT candidate_operations.read_schedule_batch_review($1,$2,$3,$4::jsonb) result',[f.manager.subject,f.manager.membershipId,f.scope,JSON.stringify(s)])).rows[0].result);
const command=(f,s,r)=>({requestId:randomUUID(),locationId:f.scope,action:'shift.save-batch',input:{...s,reviewToken:r.reviewToken,confirmed:true,note:'Fictional reviewed batch'}});
const row=(r,id)=>r.items.find(r=>r.id===id);
const state=async f=>(await admin.query(`SELECT jsonb_build_object('store',(SELECT to_jsonb(r) FROM candidate_identity.restaurants r WHERE id=$1),'scope',(SELECT to_jsonb(r) FROM candidate_operations.scope_coordination r WHERE restaurant_id=$1),
 'shifts',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM candidate_operations.shift_references s WHERE restaurant_id=$1),
 'events',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.shift_id,e.revision),'[]') FROM candidate_operations.schedule_draft_events e JOIN candidate_operations.shift_references s ON s.id=e.shift_id WHERE s.restaurant_id=$1),
 'bookings',(SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY shift_id),'[]') FROM candidate_operations.person_shift_bookings b JOIN candidate_operations.shift_references s ON s.id=b.shift_id WHERE s.restaurant_id=$1),
 'receipts',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY request_id),'[]') FROM candidate_operations.command_receipts r WHERE restaurant_id=$1),
 'notices',(SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY id),'[]') FROM candidate_operations.shift_notification_outbox n WHERE restaurant_id=$1)) result`,[f.scope])).rows[0].result;
async function peer(f,member=f.worker){const scope='fictional-batch-peer-'+randomUUID(),id=randomUUID();await admin.query(fictionalStoreInsert,[scope,'Fictional peer store']);await admin.query("INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position) SELECT $1,person_id,$2,'BOH','Cook' FROM candidate_identity.memberships WHERE id=$3",[id,scope,member]);await complete(f);return {scope,id};}
async function hundred(f){const ids=Array.from({length:100},()=>randomUUID());await admin.query("INSERT INTO candidate_operations.shift_references(id,restaurant_id,member_id,department,position,starts_at,ends_at,revision,published) SELECT id,$2,$3,'BOH','Cook','2035-10-22T04:00Z'::timestamptz+make_interval(hours=>(ord-1)::integer),'2035-10-22T04:00Z'::timestamptz+make_interval(hours=>ord::integer),1,false FROM unnest($1::uuid[]) WITH ORDINALITY x(id,ord)",[ids,f.scope,f.worker]);await admin.query("INSERT INTO candidate_operations.schedule_draft_events SELECT id,1,$2,jsonb_build_object('personId',member_id,'position',position,'start',starts_at,'end',ends_at,'published',false),clock_timestamp() FROM candidate_operations.shift_references WHERE restaurant_id=$1",[f.scope,f.manager.membershipId]);return ids.map(id=>({recordId:id,revision:1}));}
const localHour=n=>new Date(Date.parse('2035-10-22T00:00:00Z')+n*3600000).toISOString().slice(0,19);

test('a legal slot exchange saves original drafts, complete before/after audits and final bookings without employee notices',async()=>{
 const f=await fixture(),a=await create(f),b=await create(f,f.worker,'2035-10-23T17:00Z','2035-10-23T18:00Z'),s=selection([proposal(a,f.worker),proposal(b,f.worker,'2035-10-23T12:00','2035-10-23T13:00')]),r=await review(f,s),before=await state(f);
 assert.equal(r.readyCount,2);assert.equal(r.rejectedCount,0);const result=await run(f,command(f,s,r));assert.equal(result.savedCount,2);assert.equal(result.rejectedCount,0);
 const after=await state(f);assert.equal(after.shifts.length,before.shifts.length);assert.deepEqual(after.notices,before.notices);assert.equal(after.store.revision,before.store.revision+1);
 for(const p of s.drafts){assert.equal(row(result,p.id).recordId,p.id);assert.equal(row(result,p.id).revision,2);const shift=after.shifts.find(s=>s.id===p.id);assert.equal(shift.published,false);assert.equal(shift.cancelled,false);const event=after.events.find(e=>e.shift_id===p.id&&e.revision===2);assert.deepEqual(event.data.before,row(r,p.id).before);assert.deepEqual(event.data.after,row(r,p.id).after);assert.equal(event.data.batch.requestId,result.requestId);assert.equal(event.data.note,'Fictional reviewed batch');}
 assert.equal(after.bookings.length,before.bookings.length);assert.notDeepEqual(after.bookings,before.bookings);
 const guard=(await admin.query("SELECT condeferrable,convalidated FROM pg_constraint WHERE conname='person_shift_no_overlap'")).rows[0];assert.deepEqual(guard,{condeferrable:false,convalidated:true});
});

test('A to B to C rejection propagates restored old slots in simultaneous rounds and leaves independent D saved',async()=>{
 const f=await fixture(),a=await create(f),b=await create(f,f.worker,'2035-10-23T17:00Z','2035-10-23T18:00Z'),c=await create(f,f.worker,'2035-10-23T18:00Z','2035-10-23T19:00Z'),d=await create(f,f.other);
 const s=selection([proposal(a,f.worker),proposal(b,f.worker,'2035-10-23T14:00','2035-10-23T15:00'),proposal(c,f.worker,'2035-10-23T15:00','2035-10-23T16:00','Unknown job'),proposal(d,f.other)]),r=await review(f,s);assert.deepEqual(await review(f,{...s,drafts:[...s.drafts].reverse()}),r);
 assert.equal(row(r,c.recordId).issues[0].code,'schedule_job_denied');assert.deepEqual(row(r,b.recordId).issues[0].sourceIds,[c.recordId]);assert.deepEqual(row(r,a.recordId).issues[0].sourceIds,[b.recordId]);assert.ok(row(r,a.recordId).issues[0].round>row(r,b.recordId).issues[0].round);
 const before=await state(f),result=await run(f,command(f,s,r));assert.equal(result.savedCount,1);assert.equal(row(result,d.recordId).status,'saved');const after=await state(f);for(const item of [a,b,c])assert.deepEqual(after.shifts.find(s=>s.id===item.recordId),before.shifts.find(s=>s.id===item.recordId));
});

test('a two-way exchange with one individually rejected side rejects its dependent without changing either source',async()=>{
 const f=await fixture(),a=await create(f),b=await create(f,f.worker,'2035-10-23T17:00Z','2035-10-23T18:00Z'),s=selection([proposal(a,f.worker),proposal(b,f.worker,'2035-10-23T12:00','2035-10-23T13:00','Unknown job')]),r=await review(f,s),before=await state(f);
 assert.equal(row(r,a.recordId).issues[0].code,'depends_on_rejected_row');assert.deepEqual(row(r,a.recordId).issues[0].sourceIds,[b.recordId]);assert.equal((await run(f,command(f,s,r))).savedCount,0);const after=await state(f);assert.deepEqual(after.shifts,before.shifts);assert.deepEqual(after.bookings,before.bookings);assert.deepEqual(after.scope,before.scope);assert.deepEqual(after.store,before.store);
});

test('both ready proposed conflicts reject together and their restored old slots reject dependents, independent of input order',async()=>{
 const f=await fixture(),a=await create(f),b=await create(f,f.worker,'2035-10-23T17:00Z','2035-10-23T18:00Z'),c=await create(f,f.worker,'2035-10-23T18:00Z','2035-10-23T19:00Z'),d=await create(f,f.other);
 const s=selection([proposal(a,f.worker,'2035-10-23T15:00','2035-10-23T16:00'),proposal(b,f.worker,'2035-10-23T15:00','2035-10-23T16:00'),proposal(c,f.worker,'2035-10-23T12:00','2035-10-23T13:00'),proposal(d,f.other)]),r=await review(f,s);assert.deepEqual(await review(f,{...s,drafts:[...s.drafts].reverse()}),r);
 for(const item of [a,b])assert.equal(row(r,item.recordId).issues[0].code,'proposed_shift_overlap');assert.equal(row(r,c.recordId).issues[0].code,'depends_on_rejected_row');assert.equal((await run(f,command(f,s,r))).savedCount,1);
});

test('an external rejection does not poison a ready proposal whose new slot overlaps only the rejected proposal',async()=>{
 const f=await fixture(),a=await create(f,f.worker,'2035-10-23T12:00Z','2035-10-23T13:00Z'),b=await create(f,f.worker,'2035-10-23T13:00Z','2035-10-23T14:00Z');await create(f,f.worker,'2035-10-23T19:00Z','2035-10-23T19:15Z');
 const s=selection([proposal(a,f.worker,'2035-10-23T15:30','2035-10-23T16:00'),proposal(b,f.worker,'2035-10-23T15:10','2035-10-23T15:40')]),r=await review(f,s);assert.equal(row(r,a.recordId).status,'ready');assert.equal(row(r,b.recordId).issues[0].code,'shift_overlap');assert.deepEqual(await review(f,{...s,drafts:[...s.drafts].reverse()}),r);assert.equal((await run(f,command(f,s,r))).savedCount,1);
});

test('an unavailable foreign selected ID never removes a fixed other-store person booking from conflict checks',async()=>{
 const f=await fixture(),a=await create(f),p=await peer(f),secret=randomUUID();await admin.query("INSERT INTO candidate_operations.shift_references(id,restaurant_id,member_id,department,position,starts_at,ends_at,revision,published) VALUES($1,$2,$3,'BOH','Cook','2035-10-23T17:00Z','2035-10-23T18:00Z',1,true)",[secret,p.scope,p.id]);
 const s=selection([proposal(a,f.worker),proposal({recordId:secret,revision:1},f.worker)]),r=await review(f,s);assert.equal(row(r,a.recordId).issues[0].code,'shift_overlap');assert.deepEqual(Object.keys(row(r,secret)).sort(),['id','issues','kind','sourceRevision','status']);assert.equal(JSON.stringify(r).includes(p.scope),false);assert.equal((await run(f,command(f,s,r))).savedCount,0);
});

test('an unauthorized local dependency reveals no source details or dependency identity beyond the unavailable selection',async()=>{
 const f=await fixture(),a=await create(f),b=await create(f,f.worker,'2035-10-23T17:00Z','2035-10-23T18:00Z');await admin.query("UPDATE candidate_operations.shift_references SET department='FOH' WHERE id=$1",[b.recordId]);await admin.query("UPDATE candidate_identity.membership_capabilities SET active=false WHERE membership_id=$1 AND capability='location.manage'",[f.manager.membershipId]);
 const s=selection([proposal(a,f.worker),proposal(b,f.worker)]),r=await review(f,s);assert.equal(row(r,a.recordId).issues[0].code,'shift_overlap');assert.equal(row(r,a.recordId).issues[0].sourceIds,undefined);assert.deepEqual(Object.keys(row(r,b.recordId)).sort(),['id','issues','kind','sourceRevision','status']);
});

test('phase-ineligible sources reveal no duties or assignment details to a scheduling manager without published-change authority',async()=>{
 const f=await fixture(),a=await create(f),b=await create(f,f.other),privateTask=randomUUID();await admin.query('UPDATE candidate_operations.shift_references SET published=true WHERE id=$1',[a.recordId]);
 await admin.query("INSERT INTO candidate_operations.tasks(id,restaurant_id,assignee_id,department,title,detail,due,phase,revision,shift_id,shift_revision) VALUES($1,$2,$3,'BOH','Private published duty','Private published details','2035-10-23T17:00Z','open',1,$4,1)",[privateTask,f.scope,f.worker,a.recordId]);
 const s=selection([proposal(a,f.worker),proposal(b,f.other)]),r=await review(f,s),bad=row(r,a.recordId);assert.deepEqual(Object.keys(bad).sort(),['area','currentSourceRevision','id','issues','kind','sourceRevision','status']);assert.equal(bad.issues[0].code,'batch_source_ineligible');assert.equal(JSON.stringify(r).includes(privateTask),false);assert.equal(JSON.stringify(r).includes('Private published'),false);
 const c=command(f,s,r),saved=await run(f,c);assert.equal(saved.savedCount,1);assert.deepEqual(row(saved,a.recordId),bad);assert.deepEqual(row(await run(f,c),a.recordId),bad);
});

test('a reviewed revision mismatch rejects only its row, while a later source change invalidates the whole old review',async()=>{
 const f=await fixture(),a=await create(f),b=await create(f,f.other),s=selection([proposal({...a,revision:2},f.worker),proposal(b,f.other)]),r=await review(f,s);assert.equal(row(r,a.recordId).issues[0].code,'revision_conflict');assert.equal((await run(f,command(f,s,r))).savedCount,1);
 const fresh=selection([proposal(a,f.worker)]),old=await review(f,fresh);await admin.query('UPDATE candidate_operations.shift_references SET revision=revision+1 WHERE id=$1',[a.recordId]);const before=await state(f);await assert.rejects(run(f,command(f,fresh,old)),e=>e.status===409&&e.code==='batch_review_changed');assert.deepEqual(await state(f),before);
});

test('published, cancelled, released, imported, active and ended sources cannot be batch edited',async()=>{
 for(const mode of ['published','cancelled','released','imported','active','ended']){
  const f=await fixture(),a=await create(f),s=selection([proposal(a,f.worker)]);
  if(mode==='published'||mode==='cancelled')await admin.query(`UPDATE candidate_operations.shift_references SET ${mode}=true WHERE id=$1`,[a.recordId]);
  else if(mode==='released')await admin.query('UPDATE candidate_operations.shift_references SET released_at=clock_timestamp() WHERE id=$1',[a.recordId]);
  else if(mode==='imported')await admin.query('DELETE FROM candidate_operations.schedule_draft_events WHERE shift_id=$1',[a.recordId]);
  else await admin.query("UPDATE candidate_operations.shift_references SET starts_at=clock_timestamp()-interval '2 hours',ends_at=clock_timestamp()+CASE WHEN $2='active' THEN interval '1 hour' ELSE interval '-1 hour' END WHERE id=$1",[a.recordId,mode]);
  const r=await review(f,s),before=await state(f);assert.equal(row(r,a.recordId).status,'rejected',mode);assert.equal((await run(f,command(f,s,r))).savedCount,0);assert.deepEqual((await state(f)).shifts,before.shifts,mode);
 }
});

test('source and replacement starts must be in the selected local week, but an overnight end can extend beyond it',async()=>{
 const f=await fixture(),a=await create(f);for(const s of [selection([proposal(a,f.worker)],'2035-10-29'),selection([proposal(a,f.worker,'2035-10-29T12:00','2035-10-29T13:00')])])assert.equal(row(await review(f,s),a.recordId).issues[0].code,'batch_week_conflict');
 const s=selection([proposal(a,f.worker,'2035-10-28T23:00','2035-10-29T02:00')]),r=await review(f,s);assert.equal(row(r,a.recordId).status,'ready');const saved=await run(f,command(f,s,r));assert.equal(saved.savedCount,1);assert.equal(Date.parse(row(saved,a.recordId).after.end)-Date.parse(row(saved,a.recordId).after.start),3*3600000);
});

test('each linked-work kind requires individual review without exposing linked content or changing it',async()=>{
 for(const kind of ['tasks','closes','standardLinks']){
  const f=await fixture(),a=await create(f),s=selection([proposal(a,f.worker)]),id=randomUUID();
  if(kind==='tasks')await admin.query("INSERT INTO candidate_operations.tasks(id,restaurant_id,assignee_id,department,title,detail,due,phase,revision,shift_id,shift_revision) VALUES($1,$2,$3,'BOH','Private linked title','Private linked details','2035-10-23T17:00Z','open',1,$4,1)",[id,f.scope,f.worker,a.recordId]);
  else{await admin.query("INSERT INTO candidate_operations.standard_references(id,restaurant_id,department,title,zone,position,revision,version,verification,status,criteria) VALUES($1,$2,'BOH','Private standard title','Fictional zone','Cook',1,1,'manager','approved','[\"Fictional criterion\"]')",[id,f.scope]);
   if(kind==='standardLinks')await admin.query('INSERT INTO candidate_operations.shift_standard_links VALUES($1,$2,$3,true)',[a.recordId,id,f.scope]);
   else await admin.query("INSERT INTO candidate_operations.closes(restaurant_id,shift_id,shift_revision,owner_id,department,standard_id,standard_revision,standard_snapshot,zone,manager_id,due) VALUES($1,$2,1,$3,'BOH',$4,1,'{}','Fictional zone',$5,'2035-10-23T17:00Z')",[f.scope,a.recordId,f.worker,id,f.manager.membershipId]);
  }
  const r=await review(f,s),before=await state(f);assert.equal(row(r,a.recordId).issues[0].code,'linked_shift_protected');assert.deepEqual(row(r,a.recordId).linkedKinds,[kind]);assert.equal(JSON.stringify(r).includes('Private'),false);assert.equal((await run(f,command(f,s,r))).savedCount,0);assert.deepEqual((await state(f)).shifts,before.shifts);
 }
});

test('employee or job changes must retain a valid station; invalid proposals never silently clear it',async()=>{
 const f=await fixture(),station=randomUUID();await admin.query("INSERT INTO candidate_operations.station_references(id,restaurant_id,department,title,revision,status,configured,all_job_members) VALUES($1,$2,'BOH','Fictional retained station',1,'active',true,false)",[station,f.scope]);await admin.query("INSERT INTO candidate_operations.station_jobs VALUES($1,'Cook')",[station]);await admin.query('INSERT INTO candidate_operations.station_members VALUES($1,$2,$3)',[station,f.worker,f.scope]);await admin.query("INSERT INTO candidate_identity.schedule_eligibility VALUES($1,'Fry','schedule-job',true)",[f.worker]);await complete(f);
 const a=await run(f,{requestId:randomUUID(),locationId:f.scope,action:'shift.save',input:{personId:f.worker,position:'Cook',start:'2035-10-23T16:00Z',end:'2035-10-23T17:00Z',stationId:station,note:'Fictional source'}});
 for(const p of [proposal(a,f.other),proposal(a,f.worker,'2035-10-23T13:00','2035-10-23T14:00','Fry')]){const s=selection([p]),r=await review(f,s);assert.equal(row(r,a.recordId).issues[0].code,'station_needs_individual_review');assert.equal((await run(f,command(f,s,r))).savedCount,0);assert.equal((await state(f)).shifts[0].station_id,station);}
 const s=selection([proposal(a,f.worker)]),r=await review(f,s);await admin.query("UPDATE candidate_operations.station_references SET title='Fictional revised station',revision=revision+1 WHERE id=$1",[station]);const before=await state(f);await assert.rejects(run(f,command(f,s,r)),e=>e.code==='batch_review_changed');assert.deepEqual(await state(f),before);assert.equal((await run(f,command(f,s,await review(f,s)))).savedCount,1);
});

test('person-wide approved leave at another store rejects the proposed employee without revealing private leave',async()=>{
 const f=await fixture(),a=await create(f),p=await peer(f,f.other),id=randomUUID();await admin.query("INSERT INTO candidate_operations.time_off_references(id,restaurant_id,member_id,department,starts_at,ends_at,status) VALUES($1,$2,$3,'BOH','2035-10-23T17:00Z','2035-10-23T18:00Z','approved')",[id,p.scope,p.id]);await complete(f);
 const s=selection([proposal(a,f.other)]),r=await review(f,s);assert.equal(row(r,a.recordId).issues[0].code,'approved_time_off_conflict');assert.equal(JSON.stringify(r).includes(id),false);assert.equal(JSON.stringify(r).includes(p.scope),false);assert.equal((await run(f,command(f,s,r))).savedCount,0);
});

test('availability remains store-specific and approved restrictions reject the replacement',async()=>{
 const f=await fixture(),a=await create(f),id=randomUUID(),data={status:'approved',startDate:'2035-10-23',endDate:'2035-10-23',days:[0,1,2,3,4,5,6],startMinute:780,endMinute:840,beforeMinutes:0,afterMinutes:0,excludedDates:[]};
 await admin.query("INSERT INTO candidate_operations.availability_references VALUES($1,$2,$3,'BOH',1,clock_timestamp(),'approved',$4::jsonb)",[id,f.scope,f.other,JSON.stringify(data)]);
 const s=selection([proposal(a,f.other)]),r=await review(f,s);assert.equal(row(r,a.recordId).issues[0].code,'availability_shift_conflict');assert.equal((await run(f,command(f,s,r))).savedCount,0);
});

test('review digest ignores unrelated workspace activity but new fixed bookings and links stale the whole selection',async()=>{
 const f=await fixture(),a=await create(f),s=selection([proposal(a,f.worker)]),r=await review(f,s);await admin.query('UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=$1',[f.scope]);assert.equal((await review(f,s)).reviewToken,r.reviewToken);
 await create(f,f.worker,'2035-10-23T17:00Z','2035-10-23T18:00Z');const before=await state(f);await assert.rejects(run(f,command(f,s,r)),e=>e.code==='batch_review_changed');assert.deepEqual(await state(f),before);
});

test('a current source-completeness refusal commits no changes or receipt',async()=>{
 const f=await fixture(),a=await create(f),s=selection([proposal(a,f.worker)]);await admin.query('UPDATE candidate_operations.schedule_input_reviews SET time_off_complete=false WHERE restaurant_id=$1',[f.scope]);const r=await review(f,s),before=await state(f);assert.equal(r.sourceReviewComplete,false);await assert.rejects(run(f,command(f,s,r)),e=>e.code==='schedule_inputs_incomplete');assert.deepEqual(await state(f),before);
});

test('an unrelated future source column does not change the fixed-key batch review digest',async()=>{
 const f=await fixture(),a=await create(f),s=selection([proposal(a,f.worker)]),r=await review(f,s),tx=await admin.connect();
 try{await tx.query('BEGIN');await tx.query('ALTER TABLE candidate_operations.shift_references ADD COLUMN fictional_batch_future_column text');const withColumn=(await tx.query('SELECT candidate_operations.read_schedule_batch_review($1,$2,$3,$4::jsonb) result',[f.manager.subject,f.manager.membershipId,f.scope,JSON.stringify(s)])).rows[0].result;assert.equal(withColumn.reviewToken,r.reviewToken);assert.deepEqual(withColumn.items,r.items);}finally{await tx.query('ROLLBACK');tx.release();}
});

test('receipt replay preserves rejected outcomes after eligibility recovers and does not rereview changed sources',async()=>{
 const f=await fixture(),a=await create(f),b=await create(f,f.other);await admin.query('UPDATE candidate_identity.schedule_eligibility SET active=false WHERE member_id=$1',[f.other]);await complete(f);const s=selection([proposal(a,f.worker),proposal(b,f.other)]),c=command(f,s,await review(f,s)),first=await run(f,c);assert.equal(first.savedCount,1);
 await admin.query('UPDATE candidate_identity.schedule_eligibility SET active=true WHERE member_id=$1',[f.other]);await admin.query('UPDATE candidate_operations.shift_references SET revision=revision+1 WHERE id=$1',[a.recordId]);const before=await state(f),replay=await run(f,c);assert.equal(replay.replayed,true);assert.deepEqual(replay.items,first.items);assert.deepEqual(await state(f),before);
 await assert.rejects(run(f,{...c,input:{...c.input,note:'Changed reason'}}),e=>e.code==='request_payload_conflict');
});

test('concurrent identical frozen requests apply the complete subset once',async()=>{
 const f=await fixture(),a=await create(f),s=selection([proposal(a,f.worker)]),c=command(f,s,await review(f,s)),[one,two]=await Promise.all([run(f,c),run(f,c)]);assert.equal(Number(one.replayed)+Number(two.replayed),1);assert.deepEqual(one.items,two.items);assert.equal((await state(f)).shifts[0].revision,2);
});

test('different concurrent reviewed requests cannot both replace the same source revision',async()=>{
 const f=await fixture(),a=await create(f),s=selection([proposal(a,f.worker)]),r=await review(f,s),results=await Promise.allSettled([run(f,command(f,s,r)),run(f,command(f,s,r))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'batch_review_changed');assert.equal((await state(f)).shifts[0].revision,2);
});

test('a later audit failure restores every deleted old booking and rolls back earlier row changes, audits, receipts and revisions',async()=>{
 const f=await fixture(),a=await create(f),b=await create(f,f.worker,'2035-10-23T17:00Z','2035-10-23T18:00Z'),s=selection([proposal(a,f.worker),proposal(b,f.worker,'2035-10-23T12:00','2035-10-23T13:00')]),c=command(f,s,await review(f,s)),before=await state(f),fn='batch_failure_'+randomUUID().replaceAll('-',''),last=[a.recordId,b.recordId].sort().at(-1);
 await admin.query(`CREATE FUNCTION candidate_operations.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.shift_id='${last}' AND NEW.revision>1 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='fictional_batch_audit_failure'; END IF; RETURN NEW; END $$`);await admin.query(`CREATE TRIGGER ${fn} BEFORE INSERT ON candidate_operations.schedule_draft_events FOR EACH ROW EXECUTE FUNCTION candidate_operations.${fn}()`);
 try{await assert.rejects(run(f,c),e=>e.code==='fictional_batch_audit_failure');assert.deepEqual(await state(f),before);}finally{await admin.query(`DROP TRIGGER ${fn} ON candidate_operations.schedule_draft_events`);await admin.query(`DROP FUNCTION candidate_operations.${fn}()`);}assert.equal((await run(f,c)).savedCount,2);
});

test('a receipt failure after final updates restores old slots and all audit/revision state',async()=>{
 const f=await fixture(),a=await create(f),s=selection([proposal(a,f.worker)]),c=command(f,s,await review(f,s)),before=await state(f),fn='batch_receipt_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE FUNCTION candidate_operations.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.restaurant_id='${f.scope}' AND NEW.payload->>'action'='shift.save-batch' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='fictional_batch_receipt_failure'; END IF; RETURN NEW; END $$`);await admin.query(`CREATE TRIGGER ${fn} BEFORE INSERT ON candidate_operations.command_receipts FOR EACH ROW EXECUTE FUNCTION candidate_operations.${fn}()`);
 try{await assert.rejects(run(f,c),e=>e.code==='fictional_batch_receipt_failure');assert.deepEqual(await state(f),before);}finally{await admin.query(`DROP TRIGGER ${fn} ON candidate_operations.command_receipts`);await admin.query(`DROP FUNCTION candidate_operations.${fn}()`);}
});

test('a forced final booking invariant rolls back the batch and returns non-retryable HTTP 500, clearing the frozen submission',async()=>{
 const f=await fixture(),a=await create(f),b=await create(f,f.worker,'2035-10-23T17:00Z','2035-10-23T18:00Z'),s=selection([proposal(a,f.worker),proposal(b,f.worker,'2035-10-23T12:00','2035-10-23T13:00')]),c=command(f,s,await review(f,s)),before=await state(f),fn='zzz_batch_invariant_'+randomUUID().replaceAll('-','');
 // Test-only AFTER trigger runs after the normal booking sync, without changing production SQL or disabling guards.
 await admin.query(`CREATE FUNCTION candidate_operations.${fn}() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN IF NEW.restaurant_id='${f.scope}' AND NEW.revision>1 THEN DELETE FROM candidate_operations.person_shift_bookings WHERE shift_id=NEW.id; END IF; RETURN NEW; END $$`);
 await admin.query(`CREATE TRIGGER ${fn} AFTER UPDATE ON candidate_operations.shift_references FOR EACH ROW EXECUTE FUNCTION candidate_operations.${fn}()`);
 const handler=createTaskHandler(db,async()=>({subject:f.manager.subject,sessionId:f.manager.sessionId})),sender=new ScheduleScreenSender();
 // Supply the backend's frozen envelope directly; batch forms remain a later slice and are not enabled here.
 sender.pending={signature:JSON.stringify(c),command:structuredClone(c)};
 try{
  await assert.rejects(sender.retry(async(path,payload)=>{
   assert.equal(path,'/commands');assert.deepEqual(payload,c);
   const response=await handler(new Request(`http://candidate.invalid/api/operations/${f.scope}/commands`,{method:'POST',headers:{Authorization:'Bearer fictional','Content-Type':'application/json'},body:JSON.stringify(payload)}));
   const body=await response.json();assert.equal(response.status,500);assert.deepEqual(body,{error:{code:'internal_invariant'}});return {status:response.status,body};
  }),e=>e.status===500&&e.code==='internal_invariant'&&e.message==='Reload current drafts and contact an administrator.');
  assert.equal(sender.pending,null);assert.deepEqual(await state(f),before);
 }finally{await admin.query(`DROP TRIGGER ${fn} ON candidate_operations.shift_references`);await admin.query(`DROP FUNCTION candidate_operations.${fn}()`);}
 const saved=await run(f,c);assert.equal(saved.savedCount,2);
});

test('only the exact database invariant maps to a known internal failure; unrelated errors remain uncertain',async()=>{
 const f=await fixture(),a=await create(f),s=selection([proposal(a,f.worker)]),c=command(f,s,await review(f,s));
 for(const [code,message] of [['XX000','different_internal_failure'],['08006','batch_booking_invariant_failure'],['40001','scope_coordination_retry']]){
  const failure=Object.assign(Error(message),{code});await assert.rejects(executeTask({transaction:async()=>{throw failure;}},f.manager,f.scope,c),e=>e===failure);
 }
});

test('both old and proposed people scopes are coordinated; held peer scope returns precise frozen-request retry without writes',async()=>{
 for(const memberKey of ['worker','other']){
  const f=await fixture(),a=await create(f),p=await peer(f,f[memberKey]),s=selection([proposal(a,f.other)]),c=command(f,s,await review(f,s)),before=await state(f),lock=await admin.connect(),handler=createTaskHandler(db,async()=>({subject:f.manager.subject,sessionId:f.manager.sessionId}));
  const call=async()=>{const response=await handler(new Request(`http://candidate.invalid/api/operations/${f.scope}/commands`,{method:'POST',headers:{Authorization:'Bearer fictional','Content-Type':'application/json'},body:JSON.stringify(c)}));return {status:response.status,body:await response.json()};};
  try{await lock.query('BEGIN');await lock.query('SELECT candidate_operations.lock_scope($1)',[p.scope]);const blocked=await call();assert.equal(blocked.status,503);assert.equal(blocked.body.error.code,'coordination_retry');assert.deepEqual(await state(f),before);await lock.query('COMMIT');const saved=await call();assert.equal(saved.status,200);assert.equal(saved.body.savedCount,1);const after=await state(f),replay=await call();assert.equal(replay.body.replayed,true);assert.deepEqual(await state(f),after);}finally{await lock.query('ROLLBACK');lock.release();}
 }
});

test('actor permission is required for review, command and receipt replay; private graph helpers and bookings stay inaccessible',async()=>{
 const f=await fixture(),a=await create(f),s=selection([proposal(a,f.worker)]),c=command(f,s,await review(f,s));await run(f,c);await admin.query("UPDATE candidate_identity.membership_capabilities SET active=false WHERE membership_id=$1 AND capability='schedule.manage'",[f.manager.membershipId]);await assert.rejects(review(f,s),e=>e.code==='42501');await assert.rejects(run(f,c),e=>e.status===403);
 for(const sql of ['SELECT * FROM candidate_operations.person_shift_bookings','SELECT candidate_operations.batch_plan($1,$2,$3::jsonb)','SELECT candidate_operations.batch_selection($1::jsonb)'])await assert.rejects(db.transaction(tx=>tx.query(sql,sql.includes('batch_plan')?[f.manager.membershipId,f.scope,JSON.stringify(s)]:sql.includes('batch_selection')?[JSON.stringify(s)]:[])),e=>e.code==='42501');
});

test('checkout-position, inactive and schedule-only actors cannot review even with scheduling grants',async()=>{
 for(const mode of ['checkout','inactive','scheduleOnly']){const f=await fixture(),a=await create(f),s=selection([proposal(a,f.worker)]);if(mode==='checkout')await admin.query("UPDATE candidate_identity.memberships SET position='Dishwasher' WHERE id=$1",[f.manager.membershipId]);else await admin.query(`UPDATE candidate_identity.memberships SET ${mode==='inactive'?'active=false':'schedule_only=true'} WHERE id=$1`,[f.manager.membershipId]);await assert.rejects(review(f,s),e=>e.code==='42501',mode);}
});

test('HTTP batch review is authenticated, read-only, bounded and excludes query/id variants; stale commands map to 409',async()=>{
 const f=await fixture(),a=await create(f),s=selection([proposal(a,f.worker)]),handler=createTaskHandler(db,async()=>({subject:f.manager.subject,sessionId:f.manager.sessionId}));
 const call=(resource,method='POST',body=s,authorized=true)=>handler(new Request(`http://candidate.invalid/api/operations/${f.scope}/${resource}`,{method,headers:{...(authorized?{Authorization:'Bearer fictional'}:{}),'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})}));
 const before=await state(f),read=await call('batch-review');assert.equal(read.status,200);const r=await read.json();assert.equal(r.readyCount,1);assert.deepEqual(await state(f),before);assert.equal((await call('batch-review','GET')).status,405);assert.equal((await call('batch-review?limit=1')).status,400);assert.equal((await call('batch-review/'+a.recordId)).status,405);assert.equal((await call('batch-review','POST',s,false)).status,401);assert.equal((await call('batch-review','POST',{...s,drafts:[]})).status,400);
 await admin.query('UPDATE candidate_operations.shift_references SET revision=revision+1 WHERE id=$1',[a.recordId]);const changed=await call('commands','POST',command(f,s,r));assert.equal(changed.status,409);assert.equal((await changed.json()).error.code,'batch_review_changed');
});

test('selection envelope canonicalizes order and local fractions; rejects overflow, duplicate IDs, invalid dates and unapproved fields',()=>{
 const a=proposal({recordId:randomUUID(),revision:1},randomUUID()),b=proposal({recordId:randomUUID(),revision:1},randomUUID()),s=selection([a,b]);assert.deepEqual(parseBatchSelection(s),parseBatchSelection({...s,drafts:[b,a]}));assert.equal(parseBatchSelection(s).drafts[0].input.startLocal,'2035-10-23T13:00:00.000000');
 for(const bad of [{...s,drafts:[]},{...s,drafts:Array(101).fill(a)},{...s,drafts:[a,{...a,id:a.id.toUpperCase()}]},{...s,weekStart:'2035-02-30'},{...s,drafts:[{...a,revision:0}]},{...s,drafts:[{...a,input:{...a.input,startLocal:'2035-02-30T12:00'}}]},{...s,drafts:[{...a,input:{...a.input,startLocal:'2035-10-23T24:00'}}]},{...s,drafts:[{...a,input:{...a.input,startLocal:'2035-10-23T12:00Z'}}]},{...s,drafts:[{...a,input:{...a.input,startOccurrence:null}}]},{...s,drafts:[{...a,input:{...a.input,stationId:randomUUID()}}]}])assert.throws(()=>parseBatchSelection(bad));
 const c={requestId:randomUUID(),locationId:'fictional-batch',action:'shift.save-batch',input:{...s,reviewToken:'0'.repeat(64),note:'Fictional review',confirmed:true}};assert.throws(()=>parseCommand({...c,recordId:randomUUID()},c.locationId));assert.throws(()=>parseCommand({...c,input:{...c.input,confirmed:false}},c.locationId));
});

test('newly ambiguous local fields require their own occurrence while unchanged ambiguous originals retain the exact instant',async()=>{
 const f=await fixture(),a=await create(f,f.worker,'2035-11-04T06:30Z','2035-11-04T07:30Z'),s=selection([proposal(a,f.worker,'2035-11-04T01:30','2035-11-04T02:30')],'2035-11-04'),r=await review(f,s);assert.equal(row(r,a.recordId).after.start,'2035-11-04T06:30:00+00:00');assert.equal((await run(f,command(f,s,r))).savedCount,1);
 const b=await create(f,f.other,'2035-11-05T17:00Z','2035-11-05T18:00Z'),changed=selection([proposal(b,f.other,'2035-11-04T01:10','2035-11-04T01:50')],'2035-11-04');assert.equal(row(await review(f,changed),b.recordId).issues[0].code,'batch_occurrence_required');changed.drafts[0].input.startOccurrence='earlier';assert.equal(row(await review(f,changed),b.recordId).issues[0].code,'batch_occurrence_required');changed.drafts[0].input.endOccurrence='later';const chosen=await review(f,changed);assert.equal(Date.parse(row(chosen,b.recordId).after.end)-Date.parse(row(chosen,b.recordId).after.start),100*60000);assert.equal((await run(f,command(f,changed,chosen))).savedCount,1);
});

test('spring gaps, reversed fold choices, nonpositive and over-24-hour durations reject only their rows',async()=>{
 const f=await fixture(),a=await create(f,f.worker,'2035-03-12T16:00Z','2035-03-12T17:00Z'),gap=selection([proposal(a,f.worker,'2035-03-11T02:30','2035-03-11T04:00')],'2035-03-11');assert.equal(row(await review(f,gap),a.recordId).issues[0].code,'batch_time_nonexistent');
 const b=await create(f,f.other,'2035-11-05T17:00Z','2035-11-05T18:00Z');for(const [start,end,extra] of [['2035-11-04T01:10','2035-11-04T01:40',{startOccurrence:'later',endOccurrence:'earlier'}],['2035-11-05T13:00','2035-11-05T12:00',{}],['2035-11-04T00:00','2035-11-05T00:00',{}]]){const s=selection([proposal(b,f.other,start,end,'Cook',extra)],'2035-11-04'),r=await review(f,s);assert.equal(row(r,b.recordId).issues[0].code,'invalid_draft_duration');assert.equal((await run(f,command(f,s,r))).savedCount,0);}
});

test('100-draft cyclic replacement preserves every final booking under the normal runtime statement budget',async()=>{
 const f=await fixture(),drafts=await hundred(f),s=selection(drafts.map((d,i)=>proposal(d,f.worker,localHour((i+1)%100),localHour((i+1)%100+1)))),r=await review(f,s);assert.equal(r.readyCount,100);const saved=await run(f,command(f,s,r));assert.equal(saved.savedCount,100);assert.equal(saved.items.length,100);const after=await state(f);assert.equal(after.bookings.length,100);assert.equal(after.shifts.length,100);assert.ok(after.shifts.every(s=>s.revision===2&&!s.published));
});

test('100-row worst-case dependency chain closes completely without truncation or iteration-order winners',async()=>{
 const f=await fixture(),drafts=await hundred(f),s=selection(drafts.map((d,i)=>proposal(d,f.worker,localHour(i+1),localHour(i+2),i===99?'Unknown job':'Cook'))),r=await review(f,s);assert.equal(r.rejectedCount,100);assert.equal(row(r,drafts[99].recordId).issues[0].code,'schedule_job_denied');for(let i=0;i<99;i++)assert.deepEqual(row(r,drafts[i].recordId).issues[0].sourceIds,[drafts[i+1].recordId]);assert.deepEqual(await review(f,{...s,drafts:[...s.drafts].reverse()}),r);const before=await state(f);assert.equal((await run(f,command(f,s,r))).savedCount,0);const after=await state(f);assert.deepEqual(after.shifts,before.shifts);assert.deepEqual(after.bookings,before.bookings);assert.deepEqual(after.scope,before.scope);
});

test('successful replacement invalidates unrelated-week publication review; all-rejected saves and replay preserve revisions',async()=>{
 const f=await fixture(),a=await create(f),otherWeek=await create(f,f.other,'2035-10-30T16:00Z','2035-10-30T17:00Z'),s=selection([proposal(a,f.worker)]),weekly=()=>db.transaction(async c=>(await c.query('SELECT candidate_operations.weekly_review($1,$2,$3,$4,$5::jsonb) result',[f.manager.subject,f.manager.membershipId,f.scope,'2035-10-29',JSON.stringify([otherWeek.recordId])])).rows[0].result),before=await weekly(),c=command(f,s,await review(f,s));await run(f,c);const after=await weekly();assert.notEqual(after.planningReview,before.planningReview);const stateAfter=await state(f);await run(f,c);assert.deepEqual((await state(f)).scope,stateAfter.scope);
 const rejected=selection([proposal({...a,revision:2},f.worker,'2035-10-23T15:00','2035-10-23T16:00','Unknown job')]);assert.equal((await run(f,command(f,rejected,await review(f,rejected)))).savedCount,0);assert.equal((await weekly()).planningReview,after.planningReview);
});
