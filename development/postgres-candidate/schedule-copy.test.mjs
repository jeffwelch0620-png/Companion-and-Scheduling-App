import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import pg from 'pg';
import {connection} from './test-config.mjs';import {fictionalStoreInsert} from './store-fixture.mjs';import {PostgresDatabase} from './postgres-driver.ts';
import {executeTask,parseCopySelection,parseCommand} from './task-adapter.ts';import {createTaskHandler} from './task-http.ts';
const admin=new pg.Pool({...connection,user:'candidate_owner',max:5}),db=new PostgresDatabase({...connection,user:'candidate_runtime',max:5});
after(async()=>{await db.close();await admin.end();});
async function fixture(){
 const scope='fictional-copy-'+randomUUID(),manager={subject:'fictional-copy-manager-'+randomUUID(),membershipId:randomUUID(),sessionId:randomUUID()},worker=randomUUID(),other=randomUUID();
 await admin.query(fictionalStoreInsert,[scope,'Fictional copy store']);
 for(const [member,subject] of [[manager.membershipId,manager.subject],[worker,'fictional-copy-worker-'+randomUUID()],[other,'fictional-copy-other-'+randomUUID()]]){
  const person=randomUUID();await admin.query('INSERT INTO candidate_identity.people VALUES($1,$2)',[person,'Fictional copy person']);await admin.query('INSERT INTO candidate_identity.auth_links VALUES($1,$2)',[subject,person]);
  await admin.query("INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position) VALUES($1,$2,$3,'BOH','Cook')",[member,person,scope]);await admin.query("INSERT INTO candidate_identity.schedule_eligibility VALUES($1,'Cook','schedule-job',true)",[member]);
 }
 for(const cap of ['schedule.manage','schedule.publish','location.manage'])await admin.query('INSERT INTO candidate_identity.membership_capabilities VALUES($1,$2,true)',[manager.membershipId,cap]);
 await admin.query("INSERT INTO candidate_identity.sessions(id,subject,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",[manager.sessionId,manager.subject]);
 const f={scope,manager,worker,other};await complete(f);return f;
}
const complete=f=>admin.query('INSERT INTO candidate_operations.schedule_input_reviews(restaurant_id,time_off_complete,reviewed_at) VALUES($1,true,clock_timestamp()) ON CONFLICT(restaurant_id) DO UPDATE SET time_off_complete=true,reviewed_at=clock_timestamp()',[f.scope]);
const run=(f,c)=>executeTask(db,f.manager,f.scope,c);
const create=async(f,member=f.worker,start='2035-10-23T16:00:00Z',end='2035-10-23T20:00:00Z')=>run(f,{requestId:randomUUID(),locationId:f.scope,action:'shift.save',input:{personId:member,position:'Cook',start,end,note:'Fictional source draft'}});
function selection(shifts,staffing=[],sourceWeek='2035-10-22',targetWeek='2035-10-29'){return {sourceWeek,targetWeek,shifts:shifts.map(r=>({id:r.recordId,revision:r.revision})),staffing:staffing.map(r=>({id:r.recordId,revision:r.revision}))};}
const review=(f,s)=>db.transaction(async c=>(await c.query('SELECT candidate_operations.read_schedule_copy_review($1,$2,$3,$4::jsonb) result',[f.manager.subject,f.manager.membershipId,f.scope,JSON.stringify(s)])).rows[0].result);
const command=(f,s,r)=>({requestId:randomUUID(),locationId:f.scope,action:'shift.copy-week',input:{...s,reviewToken:r.reviewToken,confirmed:true,note:'Fictional reviewed copy'}});
async function staffing(f){const id=randomUUID();await admin.query("INSERT INTO candidate_operations.staffing_needs(id,restaurant_id,department,owner_id,title,position,starts_at,ends_at,minimum,source,status) VALUES($1,$2,'BOH',$3,'Fictional staffing','Cook','2035-10-23T16:00Z','2035-10-23T20:00Z',1,'Fictional reviewed need','approved')",[id,f.scope,f.manager.membershipId]);await complete(f);return {recordId:id,revision:1};}
const row=(r,id)=>r.items.find(r=>r.id===id);
const state=async f=>(await admin.query(`SELECT jsonb_build_object('store',(SELECT to_jsonb(r) FROM candidate_identity.restaurants r WHERE id=$1),'scope',(SELECT to_jsonb(r) FROM candidate_operations.scope_coordination r WHERE restaurant_id=$1),
 'shifts',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM candidate_operations.shift_references s WHERE restaurant_id=$1),
 'staffing',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM candidate_operations.staffing_needs s WHERE restaurant_id=$1),
 'origins',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY target_id),'[]') FROM candidate_operations.schedule_copy_origins s WHERE restaurant_id=$1),
 'receipts',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY request_id),'[]') FROM candidate_operations.command_receipts s WHERE restaurant_id=$1),
 'events',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.shift_id,e.revision),'[]') FROM candidate_operations.schedule_draft_events e JOIN candidate_operations.shift_references s ON s.id=e.shift_id WHERE s.restaurant_id=$1),
 'staffingEvents',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.staffing_id,e.revision),'[]') FROM candidate_operations.staffing_events e JOIN candidate_operations.staffing_needs s ON s.id=e.staffing_id WHERE s.restaurant_id=$1),
 'bookings',(SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY shift_id),'[]') FROM candidate_operations.person_shift_bookings b JOIN candidate_operations.shift_references s ON s.id=b.shift_id WHERE s.restaurant_id=$1)) result`,[f.scope])).rows[0].result;

test('copy saves only valid shifts plus independent unapproved staffing, with provenance and one replayable receipt',async()=>{
 const f=await fixture(),a=await create(f),b=await create(f,f.other),n=await staffing(f);
 await admin.query('UPDATE candidate_identity.schedule_eligibility SET active=false WHERE member_id=$1',[f.other]);await complete(f);
 const s=selection([a,b],[n]),r=await review(f,s);assert.equal(row(r,b.recordId).issues[0].code,'schedule_job_denied');assert.equal(row(r,a.recordId).status,'ready');
 assert.equal(row(r,n.recordId).title,'Fictional staffing');assert.equal(row(r,n.recordId).minimum,1);assert.equal(Date.parse(row(r,a.recordId).sourceStart),Date.parse('2035-10-23T16:00Z'));
 const c=command(f,s,r),result=await run(f,c);assert.equal(result.savedCount,2);assert.equal(result.rejectedCount,1);assert.equal(row(result,b.recordId).status,'rejected');
 const snap=await state(f),shift=snap.shifts.find(s=>s.id===row(result,a.recordId).recordId),need=snap.staffing.find(s=>s.id===row(result,n.recordId).recordId);
 assert.equal(shift.published,false);assert.equal(shift.member_id,f.worker);assert.equal(Date.parse(shift.starts_at),Date.parse('2035-10-30T16:00:00Z'));assert.equal(need.status,'draft');assert.equal(need.copied_from.id,n.recordId);assert.equal(snap.origins.length,2);assert.equal(snap.receipts.filter(r=>r.request_id===c.requestId).length,1);
 const events=snap.events.filter(e=>e.shift_id===shift.id);assert.equal(events.length,1);assert.equal(events[0].data.copiedFrom.id,a.recordId);
 for(const table of ['closes','attendance_entries','schedule_offers']){const count=await admin.query(`SELECT count(*)::integer n FROM candidate_operations.${table} WHERE ${table==='closes'?'shift_id':table==='schedule_offers'?'shift_id':'shift_id'}=$1`,[shift.id]);assert.equal(count.rows[0].n,0);}
 const replay=await run(f,c);assert.equal(replay.replayed,true);assert.deepEqual({...replay,replayed:false},result);assert.deepEqual(await state(f),snap);
 await assert.rejects(run(f,{...c,input:{...c.input,note:'Changed payload'}}),e=>e.code==='request_payload_conflict');
});

test('concurrent same-ID replay applies once; another frozen request cannot create a duplicate active copy',async()=>{
 const f=await fixture(),a=await create(f),s=selection([a]),r=await review(f,s),c=command(f,s,r),other=command(f,s,r);
 const results=await Promise.all([run(f,c),run(f,c)]);assert.deepEqual(results.map(r=>r.replayed).sort(),[false,true]);
 await assert.rejects(run(f,other),e=>e.code==='copy_review_changed');const duplicate=await review(f,s);assert.equal(row(duplicate,a.recordId).issues[0].code,'copy_duplicate');
 const result=await run(f,command(f,s,duplicate));assert.equal(result.savedCount,0);assert.equal(result.rejectedCount,1);assert.equal((await state(f)).origins.length,1);
});

test('cancelled destination permits recopy while retaining old provenance and changed source revisions cannot bypass an active duplicate',async()=>{
 const f=await fixture(),a=await create(f),s=selection([a]),first=await run(f,command(f,s,await review(f,s))),target=row(first,a.recordId).recordId;
 await admin.query('UPDATE candidate_operations.shift_references SET revision=revision+1 WHERE id=$1',[a.recordId]);s.shifts[0].revision++;
 assert.equal(row(await review(f,s),a.recordId).issues[0].code,'copy_duplicate');await admin.query('UPDATE candidate_operations.shift_references SET cancelled=true WHERE id=$1',[target]);
 const r=await review(f,s);assert.equal(row(r,a.recordId).status,'ready');const copied=await run(f,command(f,s,r));assert.notEqual(row(copied,a.recordId).recordId,target);assert.equal((await state(f)).origins.length,2);
});

test('review digest ignores workspace churn but rejects changed source, eligibility, configuration or destination booking context',async()=>{
 const f=await fixture(),a=await create(f),s=selection([a]),r=await review(f,s);await admin.query('UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=$1',[f.scope]);assert.equal((await review(f,s)).reviewToken,r.reviewToken);
 await create(f,f.worker,'2035-10-30T17:00Z','2035-10-30T18:00Z');const before=await state(f);await assert.rejects(run(f,command(f,s,r)),e=>e.code==='copy_review_changed');assert.deepEqual(await state(f),before);
 const conflict=await review(f,s);assert.equal(row(conflict,a.recordId).issues[0].code,'shift_overlap');
 await admin.query('UPDATE candidate_identity.schedule_eligibility SET active=false WHERE member_id=$1',[f.worker]);await complete(f);assert.notEqual((await review(f,s)).reviewToken,conflict.reviewToken);
});

test('person-wide foreign-store approved leave rejects a shift without exposing private leave, while staffing still saves',async()=>{
 const f=await fixture(),a=await create(f),n=await staffing(f),peer='fictional-copy-peer-'+randomUUID(),member=randomUUID();await admin.query(fictionalStoreInsert,[peer,'Fictional peer']);
 await admin.query("INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position) SELECT $1,person_id,$2,'BOH','Cook' FROM candidate_identity.memberships WHERE id=$3",[member,peer,f.worker]);
 const leave=randomUUID();await admin.query("INSERT INTO candidate_operations.time_off_references(id,restaurant_id,member_id,department,starts_at,ends_at,status) VALUES($1,$2,$3,'BOH','2035-10-30T15:00Z','2035-10-30T21:00Z','approved')",[leave,peer,member]);await complete(f);
 const s=selection([a],[n]),r=await review(f,s);assert.equal(row(r,a.recordId).issues[0].code,'approved_time_off_conflict');assert.equal(JSON.stringify(r).includes(peer),false);assert.equal(JSON.stringify(r).includes(leave),false);
 const result=await run(f,command(f,s,r));assert.equal(result.savedCount,1);assert.equal(row(result,n.recordId).status,'saved');
});

test('new proposals collapsing onto the same destination slot reject both, independent of order, while other shifts save',async()=>{
 const f=await fixture(),a=await create(f,f.worker,'2035-11-04T05:10Z','2035-11-04T05:50Z'),b=await create(f,f.worker,'2035-11-04T06:10Z','2035-11-04T06:50Z'),c=await create(f,f.other,'2035-11-05T17:00Z','2035-11-05T20:00Z');
 const s=selection([a,b,c],[],'2035-11-04','2035-11-11'),r=await review(f,s),reversed=await review(f,{...s,shifts:[...s.shifts].reverse()});assert.deepEqual(reversed,r);
 for(const item of [a,b])assert.equal(row(r,item.recordId).issues[0].code,'proposed_shift_overlap');assert.deepEqual(row(r,a.recordId).issues[0].sourceIds,[b.recordId]);
 const result=await run(f,command(f,s,r));assert.equal(result.savedCount,1);assert.equal(result.rejectedCount,2);assert.equal(row(result,c.recordId).status,'saved');
});

test('an externally rejected proposal does not seed rejection of a ready overlapping proposal, independent of order',async()=>{
 const f=await fixture(),a=await create(f,f.worker,'2035-11-04T05:10Z','2035-11-04T05:40Z'),b=await create(f,f.worker,'2035-11-04T06:30Z','2035-11-04T06:50Z');
 await create(f,f.worker,'2035-11-11T06:05Z','2035-11-11T06:15Z');const s=selection([a,b],[],'2035-11-04','2035-11-11'),r=await review(f,s);
 assert.deepEqual(row(r,a.recordId).issues,[{code:'shift_overlap'}]);assert.equal(row(r,b.recordId).status,'ready');assert.deepEqual(row(r,b.recordId).issues,[]);assert.deepEqual(await review(f,{...s,shifts:[...s.shifts].reverse()}),r);
 const saved=await run(f,command(f,s,r));assert.equal(saved.savedCount,1);assert.equal(saved.rejectedCount,1);assert.equal(row(saved,a.recordId).status,'rejected');assert.equal(row(saved,b.recordId).status,'saved');
});

test('retained station is copied with current metadata, or rejected for individual review without being cleared',async()=>{
 const f=await fixture(),station=randomUUID();await admin.query("INSERT INTO candidate_operations.station_references(id,restaurant_id,department,title,revision,status,configured,all_job_members) VALUES($1,$2,'BOH','Fictional grill',1,'active',true,true)",[station,f.scope]);await admin.query("INSERT INTO candidate_operations.station_jobs VALUES($1,'Cook')",[station]);await complete(f);
 const a=await run(f,{requestId:randomUUID(),locationId:f.scope,action:'shift.save',input:{personId:f.worker,position:'Cook',start:'2035-10-23T16:00Z',end:'2035-10-23T20:00Z',stationId:station,note:'Fictional station'}}),s=selection([a]);
 const copied=await run(f,command(f,s,await review(f,s))),target=row(copied,a.recordId).recordId;assert.equal((await state(f)).shifts.find(s=>s.id===target).station_id,station);
 await admin.query("UPDATE candidate_operations.station_references SET status='archived' WHERE id=$1",[station]);await complete(f);
 const later={...s,targetWeek:'2035-11-05'},r=await review(f,later);assert.equal(row(r,a.recordId).issues[0].code,'station_needs_individual_review');const before=await state(f),result=await run(f,command(f,later,r));assert.equal(result.savedCount,0);assert.deepEqual((await state(f)).shifts,before.shifts);
});

test('rejected staffing is independent of valid shifts, and all rows have explicit outcomes',async()=>{
 const f=await fixture(),a=await create(f),n=await staffing(f);await admin.query("UPDATE candidate_operations.staffing_needs SET status='retired',revision=revision+1 WHERE id=$1",[n.recordId]);n.revision++;await complete(f);
 const s=selection([a],[n]),r=await review(f,s),result=await run(f,command(f,s,r));assert.equal(row(result,a.recordId).status,'saved');assert.equal(row(result,n.recordId).status,'rejected');assert.equal(result.items.length,2);
});

test('staffing copy preserves the existing active-department guard, without blocking independent valid shifts',async()=>{
 const f=await fixture(),a=await create(f),member=randomUUID(),person=randomUUID(),id=randomUUID();
 await admin.query('INSERT INTO candidate_identity.people VALUES($1,$2)',[person,'Fictional FOH person']);await admin.query("INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position) VALUES($1,$2,$3,'FOH','Server')",[member,person,f.scope]);
 await admin.query("INSERT INTO candidate_operations.staffing_needs(id,restaurant_id,department,owner_id,title,position,starts_at,ends_at,minimum,source,status) VALUES($1,$2,'FOH',$3,'Fictional FOH need','Server','2035-10-23T16:00Z','2035-10-23T20:00Z',2,'Fictional source','approved')",[id,f.scope,f.manager.membershipId]);await complete(f);
 const s=selection([a],[{recordId:id,revision:1}]),r=await review(f,s);assert.equal(row(r,id).status,'ready');assert.equal(row(r,id).minimum,2);
 await admin.query('UPDATE candidate_identity.memberships SET active=false WHERE id=$1',[member]);await complete(f);await assert.rejects(run(f,command(f,s,r)),e=>e.code==='copy_review_changed');
 const fresh=await review(f,s);assert.equal(row(fresh,id).issues[0].code,'invalid_staffing_department');const saved=await run(f,command(f,s,fresh));assert.equal(saved.savedCount,1);assert.equal(row(saved,a.recordId).status,'saved');
});

test('reversed fall-back occurrences reject only their row, and SQL also refuses whitespace-only reasons',async()=>{
 const f=await fixture(),a=await create(f,f.worker,'2035-10-28T05:10Z','2035-10-28T05:40Z'),s=selection([a],[],'2035-10-28','2035-11-04');
 s.shifts[0].startOccurrence='later';s.shifts[0].endOccurrence='earlier';const invalid=await review(f,s);assert.equal(row(invalid,a.recordId).issues[0].code,'invalid_draft_duration');assert.equal((await run(f,command(f,s,invalid))).savedCount,0);
 s.shifts[0].endOccurrence='later';const r=await review(f,s),c=command(f,s,r),payload=parseCommand(c,f.scope).payload;payload.input.note=' \t\n';const before=await state(f);
 await assert.rejects(db.transaction(tx=>tx.query('SELECT candidate_operations.copy_schedule_week($1,$2,$3,$4,$5)',[f.manager.subject,f.manager.membershipId,f.scope,c.requestId,payload])),e=>e.code==='22023');assert.deepEqual(await state(f),before);
});

test('100 real eligible source shifts copy completely under the normal runtime transaction budget',async()=>{
 const f=await fixture(),ids=Array.from({length:100},()=>randomUUID());
 await admin.query("INSERT INTO candidate_operations.shift_references(id,restaurant_id,member_id,department,position,starts_at,ends_at,revision,published) SELECT id,$2,$3,'BOH','Cook','2035-10-22T04:00Z'::timestamptz+make_interval(hours=>(ord-1)::integer),'2035-10-22T04:00Z'::timestamptz+make_interval(hours=>ord::integer),1,false FROM unnest($1::uuid[]) WITH ORDINALITY x(id,ord)",[ids,f.scope,f.worker]);
 const s=selection(ids.map(id=>({recordId:id,revision:1}))),r=await review(f,s);assert.equal(r.items.length,100);assert.ok(r.items.every(row=>row.status==='ready'));const saved=await run(f,command(f,s,r));assert.equal(saved.savedCount,100);assert.equal(saved.rejectedCount,0);assert.equal((await state(f)).origins.length,100);
});

test('person-level foreign bookings reject privately and a fall-back copy longer than 24 elapsed hours is refused',async()=>{
 const f=await fixture(),a=await create(f),peer='fictional-copy-booking-'+randomUUID(),member=randomUUID(),booking=randomUUID();await admin.query(fictionalStoreInsert,[peer,'Fictional booked store']);
 await admin.query("INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position) SELECT $1,person_id,$2,'BOH','Cook' FROM candidate_identity.memberships WHERE id=$3",[member,peer,f.worker]);
 await admin.query("INSERT INTO candidate_operations.shift_references(id,restaurant_id,member_id,department,position,starts_at,ends_at,revision,published) VALUES($1,$2,$3,'BOH','Cook','2035-10-30T17:00Z','2035-10-30T18:00Z',1,true)",[booking,peer,member]);await complete(f);
 const r=await review(f,selection([a]));assert.equal(row(r,a.recordId).issues[0].code,'shift_overlap');assert.equal(JSON.stringify(r).includes(booking),false);assert.equal(JSON.stringify(r).includes(peer),false);
 const long=await create(f,f.other,'2035-10-28T04:00Z','2035-10-29T03:30Z');const lr=await review(f,selection([long],[],'2035-10-28','2035-11-04'));assert.equal(row(lr,long.recordId).issues[0].code,'invalid_draft_duration');
});

test('bounded source selection accepts 100 shifts plus 100 staffing rows, rejects overflow, and never truncates',async()=>{
 const f=await fixture(),s={sourceWeek:'2035-10-22',targetWeek:'2035-10-29',shifts:Array.from({length:100},()=>({id:randomUUID(),revision:1})),staffing:Array.from({length:100},()=>({id:randomUUID(),revision:1}))};
 const r=await review(f,s);assert.equal(r.items.length,200);assert.ok(r.items.every(row=>row.status==='rejected'));const result=await run(f,command(f,s,r));assert.equal(result.savedCount,0);assert.equal(result.rejectedCount,200);
 await assert.rejects(review(f,{...s,shifts:[...s.shifts,{id:randomUUID(),revision:1}]}),e=>e.code==='22023');
});

test('DST copy refuses missing and ambiguous times, honors separate occurrences and preserves overnight wall-clock dates',async()=>{
 const f=await fixture(),a=await create(f,f.worker,'2035-10-28T05:30Z','2035-10-28T07:00Z'),s=selection([a],[],'2035-10-28','2035-11-04');
 assert.equal(row(await review(f,s),a.recordId).issues[0].code,'copy_occurrence_required');s.shifts[0].startOccurrence='earlier';const early=await review(f,s);s.shifts[0].startOccurrence='later';const late=await review(f,s);
 assert.equal(Date.parse(row(late,a.recordId).start)-Date.parse(row(early,a.recordId).start),3600000);assert.equal(row(late,a.recordId).end,row(early,a.recordId).end);
 const b=await create(f,f.other,'2035-03-04T07:30Z','2035-03-04T08:30Z');assert.equal(row(await review(f,selection([b],[],'2035-03-04','2035-03-11')),b.recordId).issues[0].code,'copy_time_nonexistent');
 const night=await create(f,f.other,'2035-10-24T02:00Z','2035-10-24T06:00Z');const nr=await review(f,selection([night]));assert.equal(Date.parse(row(nr,night.recordId).end)-Date.parse(row(nr,night.recordId).start),14400000);
});

test('authority is enforced before source details, on command and on receipt replay; private tables/helpers remain inaccessible',async()=>{
 const f=await fixture(),other=await fixture(),a=await create(f),secret=await create(other),s=selection([a,secret]),r=await review(f,s);const hidden=row(r,secret.recordId);assert.deepEqual(Object.keys(hidden).sort(),['id','issues','kind','sourceRevision','status']);assert.equal(hidden.issues[0].code,'copy_source_unavailable');
 const c=command(f,s,r);await run(f,c);await admin.query("UPDATE candidate_identity.membership_capabilities SET active=false WHERE membership_id=$1 AND capability='schedule.manage'",[f.manager.membershipId]);await assert.rejects(run(f,c),e=>e.status===403);
 for(const sql of ['SELECT * FROM candidate_operations.schedule_copy_origins',"SELECT candidate_operations.copy_plan($1,$2,$3)"])await assert.rejects(db.transaction(c=>c.query(sql,sql.includes('$1')?[f.manager.membershipId,f.scope,JSON.stringify(s)]:[])),e=>e.code==='42501');
});

test('receipt failure rolls back every accepted row, provenance, audit, booking and revision',async()=>{
 const f=await fixture(),a=await create(f),n=await staffing(f),s=selection([a],[n]),r=await review(f,s),before=await state(f),fn='copy_failure_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE FUNCTION candidate_operations.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.restaurant_id='${f.scope}' AND NEW.payload->>'action'='shift.copy-week' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='fictional_copy_receipt_failure'; END IF; RETURN NEW; END $$`);
 await admin.query(`CREATE TRIGGER ${fn} BEFORE INSERT ON candidate_operations.command_receipts FOR EACH ROW EXECUTE FUNCTION candidate_operations.${fn}()`);
 try{await assert.rejects(run(f,command(f,s,r)),e=>e.code==='fictional_copy_receipt_failure');assert.deepEqual(await state(f),before);}
 finally{await admin.query(`DROP TRIGGER ${fn} ON candidate_operations.command_receipts`);await admin.query(`DROP FUNCTION candidate_operations.${fn}()`);}
});

test('cross-store contention returns precise retryable HTTP code without writes; identical retry succeeds once',async()=>{
 const f=await fixture(),a=await create(f),peer='fictional-copy-held-'+randomUUID(),member=randomUUID();await admin.query(fictionalStoreInsert,[peer,'Fictional held store']);
 await admin.query("INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position) SELECT $1,person_id,$2,'BOH','Cook' FROM candidate_identity.memberships WHERE id=$3",[member,peer,f.worker]);await complete(f);
 const s=selection([a]),c=command(f,s,await review(f,s)),before=await state(f),lock=await admin.connect(),handler=createTaskHandler(db,async()=>({subject:f.manager.subject,sessionId:f.manager.sessionId}));
 const call=async(resource,payload)=>{const response=await handler(new Request(`http://candidate.invalid/api/operations/${f.scope}/${resource}`,{method:'POST',headers:{Authorization:'Bearer fictional','Content-Type':'application/json'},body:JSON.stringify(payload)}));return {status:response.status,body:await response.json()};};
 try{await lock.query('BEGIN');await lock.query('SELECT candidate_operations.lock_scope($1)',[peer]);const blocked=await call('commands',c);assert.equal(blocked.status,503);assert.equal(blocked.body.error.code,'coordination_retry');assert.deepEqual(await state(f),before);await lock.query('COMMIT');
 const saved=await call('commands',c);assert.equal(saved.status,200);assert.equal(saved.body.savedCount,1);const after=await state(f),replay=await call('commands',c);assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.deepEqual(await state(f),after);
 const parsed=await call('copy-review',s);assert.equal(parsed.status,200);assert.equal(parsed.body.items[0].issues[0].code,'copy_duplicate');const bad=await call('copy-review',{...s,shifts:[...s.shifts,...s.shifts]});assert.equal(bad.status,400);
 }finally{await lock.query('ROLLBACK');lock.release();}
});

test('real outages and unrelated serialization failures remain service_unavailable; copy inputs fail closed',async()=>{
 const unavailable=error=>createTaskHandler({transaction:async()=>{throw error;}},async()=>({subject:'fictional',sessionId:randomUUID()}));
 for(const error of [new Error('offline'),{code:'40001',message:'unrelated_serialization'}]){const response=await unavailable(error)(new Request('http://candidate.invalid/api/operations/fictional-copy/copy-review',{method:'POST',headers:{Authorization:'Bearer fictional','Content-Type':'application/json'},body:'{}'}));assert.equal(response.status,503);assert.equal((await response.json()).error.code,'service_unavailable');}
 const entry={id:randomUUID(),revision:1},s={sourceWeek:'2035-10-22',targetWeek:'2035-10-29',shifts:[entry],staffing:[]};assert.equal(parseCopySelection(s).shifts[0].startOccurrence,'');
 for(const invalid of [{...s,targetWeek:'2035-10-30'},{...s,sourceWeek:'2035-02-30'},{...s,shifts:[]},{...s,shifts:[entry,entry]},{...s,staffing:Array(101).fill(entry)},{...s,shifts:[{...entry,startOccurrence:null}]},{...s,shifts:[{...entry,revision:0}]}])assert.throws(()=>parseCopySelection(invalid));
 assert.throws(()=>parseCommand({requestId:randomUUID(),locationId:'fictional-copy',action:'shift.copy-week',recordId:randomUUID(),input:{...s,note:'Fictional reason',reviewToken:'0'.repeat(64),confirmed:true}},'fictional-copy'));
});

test('successful copy changes weekly publication planning but all-rejected copy and receipt replay do not',async()=>{
 const f=await fixture(),a=await create(f),s=selection([a]),before=(await state(f)).scope.schedule_revision;
 const weekly=()=>db.transaction(async c=>(await c.query('SELECT candidate_operations.weekly_review($1,$2,$3,$4,$5::jsonb) result',[f.manager.subject,f.manager.membershipId,f.scope,s.sourceWeek,JSON.stringify([a.recordId])])).rows[0].result);
 const original=await weekly(),copied=await run(f,command(f,s,await review(f,s))),changed=await weekly();assert.notEqual(original.planningReview,changed.planningReview);assert.ok(Number(copied.scheduleRevision)>Number(before));
 const duplicate=command(f,s,await review(f,s)),rejected=await run(f,duplicate);assert.equal(rejected.savedCount,0);assert.equal((await weekly()).planningReview,changed.planningReview);await run(f,duplicate);assert.equal((await weekly()).planningReview,changed.planningReview);
});

test('an approved staffing overlap warns without blocking independent drafts, but approval still refuses it and replay preserves the warning',async()=>{
 const f=await fixture(),a=await create(f),n=await staffing(f),approved=randomUUID();
 await admin.query("INSERT INTO candidate_operations.staffing_needs(id,restaurant_id,department,owner_id,title,position,starts_at,ends_at,minimum,source,status) VALUES($1,$2,'BOH',$3,'Private existing title','Cook','2035-10-30T17:00Z','2035-10-30T18:00Z',1,'Private existing source','approved')",[approved,f.scope,f.manager.membershipId]);await complete(f);
 const s=selection([a],[n]),r=await review(f,s),item=row(r,n.recordId);assert.equal(item.status,'ready');assert.deepEqual(item.issues,[]);assert.deepEqual(item.warnings,[{code:'staffing_overlap_at_approval',message:'This staffing draft overlaps an approved need. Resolve the overlap before approval.'}]);
 const serialized=JSON.stringify(r);for(const privateValue of [approved,'Private existing title','Private existing source'])assert.equal(serialized.includes(privateValue),false);
 const c=command(f,s,r),saved=await run(f,c);assert.equal(saved.savedCount,2);assert.equal(row(saved,n.recordId).status,'saved');assert.deepEqual(row(saved,n.recordId).warnings,item.warnings);const before=await state(f);
 const replay=await run(f,c);assert.equal(replay.replayed,true);assert.deepEqual(replay.items,saved.items);assert.deepEqual(await state(f),before);
 await assert.rejects(run(f,{requestId:randomUUID(),locationId:f.scope,action:'staffing.approve',recordId:row(saved,n.recordId).recordId,expectedRevision:1,input:{note:'Fictional review',confirmed:true}}),e=>e.code==='staffing_overlap');assert.deepEqual(await state(f),before);
});

test('changed approved staffing overlap context invalidates the entire old copy review without writes',async()=>{
 const f=await fixture(),a=await create(f),n=await staffing(f),s=selection([a],[n]),r=await review(f,s);assert.deepEqual(row(r,n.recordId).warnings,[]);
 await admin.query("INSERT INTO candidate_operations.staffing_needs(restaurant_id,department,owner_id,title,position,starts_at,ends_at,minimum,source,status) VALUES($1,'BOH',$2,'Fictional changed need','Cook','2035-10-30T17:00Z','2035-10-30T18:00Z',1,'Fictional changed source','approved')",[f.scope,f.manager.membershipId]);await complete(f);
 const before=await state(f);await assert.rejects(run(f,command(f,s,r)),e=>e.code==='copy_review_changed');assert.deepEqual(await state(f),before);
 const fresh=await review(f,s);assert.notEqual(fresh.reviewToken,r.reviewToken);assert.equal(row(fresh,n.recordId).warnings[0].code,'staffing_overlap_at_approval');assert.equal((await run(f,command(f,s,fresh))).savedCount,2);
});

test('staffing warning uses approval department/job overlap rules and excludes touching endpoints and draft needs',async()=>{
 const f=await fixture(),a=await create(f),n=await staffing(f),s=selection([a],[n]),r=await review(f,s);
 for(const [department,job,start,end,status] of [['BOH','Cook','2035-10-30T14:00Z','2035-10-30T16:00Z','approved'],['BOH','Cook','2035-10-30T20:00Z','2035-10-30T21:00Z','approved'],['FOH','Cook','2035-10-30T17:00Z','2035-10-30T18:00Z','approved'],['BOH','Server','2035-10-30T17:00Z','2035-10-30T18:00Z','approved'],['BOH','Cook','2035-10-30T17:00Z','2035-10-30T18:00Z','draft']]){
  await admin.query("INSERT INTO candidate_operations.staffing_needs(restaurant_id,department,owner_id,title,position,starts_at,ends_at,minimum,source,status) VALUES($1,$2,$3,'Fictional non-conflicting need',$4,$5,$6,1,'Fictional source',$7)",[f.scope,department,f.manager.membershipId,job,start,end,status]);
 }await complete(f);
 const fresh=await review(f,s);assert.equal(fresh.reviewToken,r.reviewToken);assert.deepEqual(row(fresh,n.recordId).warnings,[]);const saved=await run(f,command(f,s,r));assert.equal(saved.savedCount,2);
 const approved=await run(f,{requestId:randomUUID(),locationId:f.scope,action:'staffing.approve',recordId:row(saved,n.recordId).recordId,expectedRevision:1,input:{note:'Fictional non-conflicting approval',confirmed:true}});assert.equal(approved.revision,2);
});
