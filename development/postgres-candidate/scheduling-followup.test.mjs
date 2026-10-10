import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {connection} from './test-config.mjs';
import {PostgresDatabase} from './postgres-driver.ts';
import {executeTask,parseCommand} from './task-adapter.ts';
import {verifyMigrationManifest} from './migration-manifest.mjs';
import {functionSnapshot} from './schema-snapshot.mjs';
const admin=new pg.Pool({...connection,user:'candidate_owner',max:5});
const db=new PostgresDatabase({...connection,user:'candidate_runtime',max:3});
after(async()=>{await admin.end();await db.close();});
const start='2035-11-04T13:00:00Z',end='2035-11-04T15:00:00Z';
async function fixture(){
 const person=randomUUID(),subject='fictional-shared-'+randomUUID(),stores=[];
 await admin.query('INSERT INTO candidate_identity.people VALUES($1,$2)',[person,'Fictional multi-store employee']);
 await admin.query('INSERT INTO candidate_identity.auth_links VALUES($1,$2)',[subject,person]);
 for(let i=0;i<2;i++){
  const scope='followup-'+randomUUID(),worker={subject,membershipId:randomUUID()},manager={subject:'fictional-manager-'+randomUUID(),membershipId:randomUUID()},managerPerson=randomUUID();
  await admin.query('INSERT INTO candidate_identity.restaurants(id,name) VALUES($1,$2)',[scope,'Fictional follow-up store']);
  await admin.query('INSERT INTO candidate_identity.people VALUES($1,$2)',[managerPerson,'Fictional manager']);
  await admin.query('INSERT INTO candidate_identity.auth_links VALUES($1,$2)',[manager.subject,managerPerson]);
  for(const [a,p] of [[worker,person],[manager,managerPerson]]){
   await admin.query("INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position) VALUES($1,$2,$3,'BOH','Cook')",[a.membershipId,p,scope]);
   await admin.query("INSERT INTO candidate_identity.schedule_eligibility VALUES($1,'Cook','schedule-job',true)",[a.membershipId]);
  }
  for(const cap of ['schedule.manage','schedule.publish','schedule.change','location.manage'])await admin.query('INSERT INTO candidate_identity.membership_capabilities VALUES($1,$2,true)',[manager.membershipId,cap]);
  await admin.query('INSERT INTO candidate_operations.schedule_input_reviews(restaurant_id,time_off_complete,reviewed_at) VALUES($1,true,clock_timestamp())',[scope]);
  stores.push({scope,worker,manager});
 }
 return stores;
}
const run=(f,c,a=f.manager)=>executeTask(db,a,f.scope,c);
const draft=(f,extra={},r)=>({requestId:randomUUID(),locationId:f.scope,action:'shift.save',...(r?{recordId:r.recordId,expectedRevision:r.revision}:{}),input:{personId:f.worker.membershipId,start,end,position:'Cook',note:'Fictional manager reason',...extra}});
async function publication(f,r){
 await admin.query("INSERT INTO candidate_operations.publication_reviews(shift_id,shift_revision,workspace_revision,no_staffing,no_closing,evidence) SELECT $1,$2,revision,true,true,'Fictional complete publication review' FROM candidate_identity.restaurants WHERE id=$3 ON CONFLICT(shift_id) DO UPDATE SET shift_revision=excluded.shift_revision,workspace_revision=excluded.workspace_revision",[r.recordId,r.revision,f.scope]);
 return {requestId:randomUUID(),locationId:f.scope,action:'shift.publish',recordId:r.recordId,expectedRevision:r.revision,input:{note:'Fictional publish'}};
}
async function leave(f,from=start,to=end){return run(f,{requestId:randomUUID(),locationId:f.scope,action:'request.create',input:{type:'time-off',start:from,end:to,note:'Private fictional leave reason'}},f.worker);}
const approval=(f,r,affected=[])=>({requestId:randomUUID(),locationId:f.scope,action:'request.review',recordId:r.recordId,expectedRevision:r.revision,input:{approve:true,note:'Private fictional decision',affectedShifts:affected}});
const review=(f,r)=>db.transaction(async c=>(await c.query('SELECT candidate_operations.weekly_review($1,$2,$3,$4,$5::jsonb) result',[f.manager.subject,f.manager.membershipId,f.scope,'2035-11-01',JSON.stringify([r.recordId])])).rows[0].result);

test('person-wide leave blocks drafts and publication, invalidates weekly tokens and flags foreign work privately',async()=>{
 const [a,b]=await fixture(),r=await run(b,draft(b)),before=await review(b,r),pub=await publication(b,r),request=await leave(a);
 const result=await run(a,approval(a,request));assert.deepEqual(result.flaggedShifts,[]);
 assert.equal(JSON.stringify(result).includes(b.scope),false);assert.equal(JSON.stringify(result).includes(r.recordId),false);
 const after=await review(b,r);assert.notEqual(after.planningReview,before.planningReview);
 await assert.rejects(run(b,pub),e=>e.code==='approved_time_off_conflict');
 const flag=(await admin.query('SELECT * FROM candidate_operations.time_off_shift_flags WHERE request_id=$1',[request.recordId])).rows[0];
 assert.equal(flag.shift_id,r.recordId);assert.equal(flag.reason,'cross_store_review');assert.equal(flag.review_status,'pending');
 assert.equal((await admin.query('SELECT cancelled,revision FROM candidate_operations.shift_references WHERE id=$1',[r.recordId])).rows[0].revision,r.revision);
 const managerBoard=await db.transaction(async c=>(await c.query('SELECT candidate_operations.list_schedule_shifts($1,$2,$3) result',[b.manager.subject,b.manager.membershipId,b.scope])).rows[0].result);
 assert.deepEqual(managerBoard.items.find(i=>i.id===r.recordId).data.reviewFlags,[{reason:'cross_store_review',reviewStatus:'pending'}]);
 assert.equal(JSON.stringify(managerBoard).includes(request.recordId),false);
 await admin.query('UPDATE candidate_operations.shift_references SET cancelled=true WHERE id=$1',[r.recordId]);await assert.rejects(run(b,draft(b)),e=>e.code==='approved_time_off_conflict');
 const notifications=(await admin.query('SELECT * FROM candidate_operations.time_off_conflict_outbox WHERE request_id=$1',[request.recordId])).rows;
 assert.ok(notifications.some(n=>n.recipient_id===b.manager.membershipId));assert.ok(notifications.every(n=>!n.message.includes('Private')));
 for(const sql of ['SELECT * FROM candidate_operations.time_off_shift_flags','SELECT * FROM candidate_operations.time_off_conflict_outbox','SELECT candidate_operations.person_time_off_conflict($1,$2,$3)'])await assert.rejects(db.transaction(c=>c.query(sql,sql.includes('$1')?[b.worker.membershipId,start,end]:[])),e=>e.code==='42501');
 const privateRead=await db.transaction(async c=>(await c.query('SELECT candidate_operations.list_time_off($1,$2,$3) result',[b.manager.subject,b.manager.membershipId,b.scope])).rows[0].result);
 assert.deepEqual(privateRead.items,[]);
});

test('person-wide leave removes staffing credit and blocks edits and coverage or swap replacements',async()=>{
 const [a,b]=await fixture(),r=await run(b,draft(b)),published=await run(b,await publication(b,r));
 const pending=await leave(a);await run(a,approval(a,pending));
 await assert.rejects(run(b,draft(b,{},published)),e=>e.code==='approved_time_off_conflict');
 const workerBoard=await db.transaction(async c=>(await c.query('SELECT candidate_operations.list_schedule_shifts($1,$2,$3) result',[b.worker.subject,b.worker.membershipId,b.scope])).rows[0].result);
 assert.equal(workerBoard.items.find(i=>i.id===r.recordId).data.reviewFlags,undefined);
 const selected=await run(b,draft(b,{personId:b.manager.membershipId,start:'2035-11-05T13:00:00Z',end:'2035-11-05T15:00:00Z'}));
 const staffing=await run(b,{requestId:randomUUID(),locationId:b.scope,action:'staffing.save',input:{area:'BOH',title:'Fictional staffing need',position:'Cook',start,end,minimum:1,source:'Fictional staffing'}});
 await run(b,{requestId:randomUUID(),locationId:b.scope,action:'staffing.approve',recordId:staffing.recordId,expectedRevision:staffing.revision,input:{confirmed:true,note:'Fictional approval'}});
 const v=await review(b,selected);assert.equal(v.plannedGapCount,1);assert.equal(v.staffing[0].gaps[0].scheduled,0);
 await admin.query('UPDATE candidate_operations.shift_references SET cancelled=true WHERE id=$1',[r.recordId]);
 for(const mode of ['coverage','swap']){
  const shift=randomUUID(),offer=randomUUID();
  await admin.query("INSERT INTO candidate_operations.shift_references(id,restaurant_id,member_id,department,position,starts_at,ends_at,revision,published) VALUES($1,$2,$3,'BOH','Cook',$4,$5,1,true)",[shift,b.scope,b.manager.membershipId,start,end]);
  await admin.query("INSERT INTO candidate_operations.schedule_offers(id,restaurant_id,owner_id,department,mode,shift_id,shift_revision,position,starts_at,ends_at,duties,note,status,replacement_id) VALUES($1,$2,$3,'BOH',$4,$5,1,'Cook',$6,$7,'[]','Fictional offer',CASE WHEN $4='swap' THEN 'pending' ELSE 'open' END,CASE WHEN $4='swap' THEN $8::uuid END)",[offer,b.scope,b.manager.membershipId,mode,shift,start,end,b.worker.membershipId]);
  assert.equal((await admin.query('SELECT candidate_operations.offer_eligible(o,$2) eligible FROM candidate_operations.schedule_offers o WHERE id=$1',[offer,b.worker.membershipId])).rows[0].eligible,false);
  await admin.query('UPDATE candidate_operations.shift_references SET cancelled=true WHERE id=$1',[shift]);
 }
});

test('approved availability remains store-local and pending or declined leave does not block another store',async()=>{
 const [a,b]=await fixture(),request=await leave(a);
 // Fictional fixture uses the same interval as a store-specific availability block.
 await admin.query("INSERT INTO candidate_operations.availability_references VALUES($1,$2,$3,'BOH',1,clock_timestamp(),'approved',$4::jsonb)",[randomUUID(),a.scope,a.worker.membershipId,JSON.stringify({status:'approved',startDate:'2035-11-04',endDate:'2035-11-04',days:[0,1,2,3,4,5,6],startMinute:0,endMinute:1440,beforeMinutes:0,afterMinutes:0,excludedDates:[]})]);
 await assert.rejects(run(a,draft(a)),e=>e.code==='availability_shift_conflict');await run(b,draft(b));
 await run(a,{...approval(a,request),input:{approve:false,note:'Fictional declined leave'}});
 await run(b,draft(b,{start:'2035-11-05T13:00:00Z',end:'2035-11-05T15:00:00Z'}));
});

test('active published and draft periods cannot move their start later or their end into the past',async()=>{
 for(const published of [false,true]){
  const [f]=await fixture(),now=Date.now(),from=new Date(now-3600000).toISOString(),to=new Date(now+3600000).toISOString();
  let r=await run(f,draft(f,{start:from,end:to}));if(published)r=await run(f,await publication(f,r));
  for(const extra of [{start:new Date(now-1800000).toISOString(),end:to},{start:from,end:new Date(now-1000).toISOString()}])await assert.rejects(run(f,draft(f,extra,r)),e=>e.status===409&&e.code==='active_shift_time_conflict');
  const earlier=new Date(now-7200000).toISOString(),changed=await run(f,draft(f,{start:earlier,end:to},r));
  assert.equal((await admin.query('SELECT starts_at FROM candidate_operations.shift_references WHERE id=$1',[r.recordId])).rows[0].starts_at.toISOString(),earlier);
  assert.equal(changed.revision,r.revision+1);
 }
});

test('ended unpublished drafts leave live lists and cannot enter weekly or individual publication',async()=>{
 const [f]=await fixture(),now=Date.now(),r=await run(f,draft(f,{start:new Date(now-7200000).toISOString(),end:new Date(now-3600000).toISOString()}));
 const list=await db.transaction(async c=>(await c.query('SELECT candidate_operations.list_schedule_shifts($1,$2,$3) result',[f.manager.subject,f.manager.membershipId,f.scope])).rows[0].result);
 assert.ok(!list.items.some(s=>s.id===r.recordId));assert.equal((await admin.query('SELECT count(*)::int n FROM candidate_operations.shift_references WHERE id=$1',[r.recordId])).rows[0].n,1);
 await assert.rejects(run(f,await publication(f,r)),e=>e.code==='shift_ended');
 const week=new Date(now-7200000).toISOString().slice(0,10);
 await assert.rejects(db.transaction(c=>c.query('SELECT candidate_operations.weekly_review($1,$2,$3,$4,$5::jsonb)',[f.manager.subject,f.manager.membershipId,f.scope,week,JSON.stringify([r.recordId])])),e=>e.message==='week_selection_denied');
});

test('time-off writers retry the whole transaction while another store is scheduling',async()=>{
 const [a,b]=await fixture(),r=await leave(a),command=approval(a,r),lock=await admin.connect();
 try{
  await lock.query('BEGIN');await lock.query('SELECT candidate_operations.lock_scope($1)',[b.scope]);
  await assert.rejects(run(a,command),e=>e.code==='40001'&&e.message==='scope_coordination_retry');
  assert.equal((await admin.query('SELECT status FROM candidate_operations.time_off_references WHERE id=$1',[r.recordId])).rows[0].status,'pending');
  assert.equal((await admin.query('SELECT count(*)::int n FROM candidate_operations.command_receipts WHERE request_id=$1',[command.requestId])).rows[0].n,0);
  await lock.query('COMMIT');await run(a,command);assert.equal((await run(a,command)).replayed,true);
 }finally{await lock.query('ROLLBACK');lock.release();}
});

test('a swap approval waiting past shift end returns shift_ended and leaves no child writes',async()=>{
 const [f]=await fixture(),now=Date.now(),from=new Date(now-3600000).toISOString(),to=new Date(now+3600000).toISOString();
 const r=await run(f,await publication(f,await run(f,draft(f,{start:from,end:to}))));
 // A distinct replacement and independent manager are required.
 const replacement=randomUUID(),person=randomUUID(),subject='fictional-replacement-'+randomUUID();
 await admin.query('INSERT INTO candidate_identity.people VALUES($1,$2)',[person,'Fictional replacement']);await admin.query('INSERT INTO candidate_identity.auth_links VALUES($1,$2)',[subject,person]);
 await admin.query("INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position) VALUES($1,$2,$3,'BOH','Cook')",[replacement,person,f.scope]);await admin.query("INSERT INTO candidate_identity.schedule_eligibility VALUES($1,'Cook','schedule-job',true)",[replacement]);
 await admin.query('UPDATE candidate_operations.schedule_input_reviews SET time_off_complete=true,reviewed_at=clock_timestamp() WHERE restaurant_id=$1',[f.scope]);
 const o=await run(f,{requestId:randomUUID(),locationId:f.scope,action:'request.create',input:{type:'swap',shiftId:r.recordId,replacementId:replacement,start:from,end:to,note:'Fictional swap'}},f.worker);
 const accepted=await run(f,{requestId:randomUUID(),locationId:f.scope,action:'request.consent',recordId:o.recordId,expectedRevision:o.revision,input:{accept:true}},{subject,membershipId:replacement});
 const cutoff=new Date(Date.now()+1600).toISOString();await admin.query('UPDATE candidate_operations.shift_references SET ends_at=$2 WHERE id=$1',[r.recordId,cutoff]);
 // Update the fixture offer too so it is current before waiting.
 await admin.query("UPDATE candidate_operations.schedule_offers SET ends_at=$2,status='accepted-by-replacement' WHERE id=$1",[o.recordId,cutoff]);
 const command={requestId:randomUUID(),locationId:f.scope,action:'request.review',recordId:o.recordId,expectedRevision:(await admin.query('SELECT revision FROM candidate_operations.schedule_offers WHERE id=$1',[o.recordId])).rows[0].revision,input:{approve:true,note:'Fictional independent approval'}};
 const lock=await admin.connect(),runtime=new pg.Client({...connection,user:'candidate_runtime'});await runtime.connect();let pending;
 try{
  await lock.query('BEGIN');await lock.query('SELECT candidate_operations.lock_scope($1)',[f.scope]);
  pending=runtime.query('SELECT candidate_operations.schedule_consent_command($1,$2,$3,$4,$5)',[f.manager.subject,f.manager.membershipId,f.scope,command.requestId,parseCommand(command,f.scope).payload]);pending.catch(()=>{});
  let blocked=false;const deadline=Date.now()+1100;while(Date.now()<deadline){blocked=(await admin.query("SELECT wait_event_type='Lock' blocked FROM pg_stat_activity WHERE pid=$1",[runtime.processID])).rows[0]?.blocked;if(blocked)break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(blocked,true);while((await admin.query('SELECT clock_timestamp()<$1::timestamptz waiting',[cutoff])).rows[0].waiting)await new Promise(r=>setTimeout(r,20));
  await lock.query('COMMIT');await assert.rejects(pending,e=>e.code==='P0001'&&e.message==='shift_ended');
  assert.equal((await admin.query('SELECT count(*)::int n FROM candidate_operations.command_receipts WHERE request_id=$1',[command.requestId])).rows[0].n,0);
  assert.equal((await admin.query('SELECT member_id FROM candidate_operations.shift_references WHERE id=$1',[r.recordId])).rows[0].member_id,f.worker.membershipId);
 }finally{await lock.query('ROLLBACK');lock.release();if(pending)await pending.catch(()=>{});await runtime.end();}
});

test('after-the-fact leave preserves an ended published shift and exposes a local pending review flag',async()=>{
 const [f]=await fixture(),now=Date.now(),from=new Date(now-7200000).toISOString(),future=new Date(now+3600000).toISOString(),past=new Date(now-3600000).toISOString();
 const r=await run(f,await publication(f,await run(f,draft(f,{start:from,end:future}))));
 await admin.query('UPDATE candidate_operations.shift_references SET ends_at=$2 WHERE id=$1',[r.recordId,past]);
 const before=(await admin.query('SELECT * FROM candidate_operations.shift_references WHERE id=$1',[r.recordId])).rows[0];
 const request=await leave(f,from,past),command=approval(f,request,[{id:r.recordId,revision:r.revision}]);
 const result=await run(f,command);assert.equal(result.flaggedShifts[0].reason,'ended_shift');
 assert.deepEqual((await admin.query('SELECT * FROM candidate_operations.shift_references WHERE id=$1',[r.recordId])).rows[0],before);
 assert.equal((await run(f,command)).replayed,true);
 const read=await db.transaction(async c=>(await c.query('SELECT candidate_operations.list_time_off($1,$2,$3) result',[f.manager.subject,f.manager.membershipId,f.scope])).rows[0].result);
 assert.deepEqual(read.items.find(i=>i.id===request.recordId).flaggedShifts,result.flaggedShifts);
 const list=await db.transaction(async c=>(await c.query('SELECT candidate_operations.list_schedule_shifts($1,$2,$3) result',[f.manager.subject,f.manager.membershipId,f.scope])).rows[0].result);
 assert.ok(list.items.some(s=>s.id===r.recordId),'Published history remains visible');
});

test('in-flight cross-store leave approval makes a waiting draft recheck after commit; rollback frees scheduling',async()=>{
 for(const commit of [true,false]){
  const [a,b]=await fixture(),r=await leave(a),first=new pg.Client({...connection,user:'candidate_runtime'}),second=new pg.Client({...connection,user:'candidate_runtime'});
  await first.connect();await second.connect();let pending;
  try{
   await first.query('BEGIN');const command=approval(a,r);
   await first.query('SELECT candidate_operations.time_off_command($1,$2,$3,$4,$5)',[a.manager.subject,a.manager.membershipId,a.scope,command.requestId,parseCommand(command,a.scope).payload]);
   const intent=draft(b);pending=second.query('SELECT candidate_operations.save_shift($1,$2,$3,$4,$5)',[b.manager.subject,b.manager.membershipId,b.scope,intent.requestId,parseCommand(intent,b.scope).payload]);pending.catch(()=>{});
   let blocked=false;const deadline=Date.now()+3000;while(Date.now()<deadline){blocked=(await admin.query("SELECT wait_event_type='Lock' blocked FROM pg_stat_activity WHERE pid=$1",[second.processID])).rows[0]?.blocked;if(blocked)break;await new Promise(r=>setTimeout(r,10));}
   assert.equal(blocked,true);await first.query(commit?'COMMIT':'ROLLBACK');
   if(commit){await assert.rejects(pending,e=>e.message==='approved_time_off_conflict');assert.equal((await admin.query('SELECT count(*)::int n FROM candidate_operations.command_receipts WHERE request_id=$1',[intent.requestId])).rows[0].n,0);}
   else{await pending;assert.equal((await admin.query('SELECT count(*)::int n FROM candidate_operations.shift_references WHERE restaurant_id=$1',[b.scope])).rows[0].n,1);}
  }finally{await first.query('ROLLBACK');if(pending)await pending.catch(()=>{});await first.end();await second.end();}
 }
});

test('PR28 corrective baseline upgrades to PR29 without rewriting or losing its later-numbered safeguards',async()=>{
 const files=await verifyMigrationManifest(),name=connection.database+'_policy_upgrade';assert.ok(name.length<=63);
 const server=new pg.Client({...connection,database:'postgres',user:'candidate_owner'});await server.connect();
 try{assert.equal((await server.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount,0);await server.query(`CREATE DATABASE "${name}" OWNER candidate_owner`);}finally{await server.end();}
 const c=new pg.Client({...connection,database:name,user:'candidate_owner'});await c.connect();
 try{
  await c.query(`GRANT CREATE ON DATABASE "${name}" TO candidate_schema_owner`);await c.query('GRANT USAGE,CREATE ON SCHEMA public TO candidate_schema_owner');await c.query('SET ROLE candidate_schema_owner');
  for(const file of files.filter(f=>!f.startsWith('038_')&&!f.startsWith('040_')))await c.query(await readFile(new URL(file,import.meta.url),'utf8'));
  for(const file of files.filter(f=>f.startsWith('038_')||f.startsWith('040_')))await c.query(await readFile(new URL(file,import.meta.url),'utf8'));
  assert.equal(await functionSnapshot(c),await readFile(new URL('schema-snapshot.sql',import.meta.url),'utf8'));
  assert.equal((await c.query("SELECT count(*)::int n FROM pg_trigger WHERE tgrelid='candidate_operations.shift_references'::regclass AND tgname='ab_check_person_shift_update'")).rows[0].n,1);
 }finally{await c.end();}
});
