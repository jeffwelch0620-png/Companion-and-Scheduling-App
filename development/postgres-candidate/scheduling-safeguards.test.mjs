import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {connection} from './test-config.mjs';
import {PostgresDatabase} from './postgres-driver.ts';
import {executeTask,parseCommand} from './task-adapter.ts';
import {createTaskHandler} from './task-http.ts';
import {rehearseScheduleReconciliation} from './schedule-reconciliation.mjs';
import {verifyMigrationManifest} from './migration-manifest.mjs';

const admin=new pg.Pool({...connection,user:'candidate_owner'});
const db=new PostgresDatabase({...connection,user:'candidate_runtime'});
after(async()=>{await admin.end();await db.close();});
const start='2035-11-04T05:00:00Z',end='2035-11-04T07:00:00Z';
async function fixture(){
 const personId=randomUUID(),subject='fictional-person-'+randomUUID(),stores=[];
 await admin.query('INSERT INTO candidate_identity.people VALUES($1,$2)',[personId,'Fictional employee']);
 await admin.query('INSERT INTO candidate_identity.auth_links VALUES($1,$2)',[subject,personId]);
 for(let i=0;i<2;i++){
  const scope='safeguard-'+randomUUID(),worker={personId,subject,membershipId:randomUUID()},manager={personId:randomUUID(),subject:'fictional-manager-'+randomUUID(),membershipId:randomUUID()},spare={personId:randomUUID(),membershipId:randomUUID()};
  await admin.query('INSERT INTO candidate_identity.restaurants(id,name) VALUES($1,$2)',[scope,'Fictional safeguard store']);
  for(const actor of [manager,spare])await admin.query('INSERT INTO candidate_identity.people VALUES($1,$2)',[actor.personId,'Fictional employee']);
  await admin.query('INSERT INTO candidate_identity.auth_links VALUES($1,$2)',[manager.subject,manager.personId]);
  for(const actor of [worker,manager,spare])await admin.query("INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position) VALUES($1,$2,$3,'BOH','Cook')",[actor.membershipId,actor.personId,scope]);
  for(const actor of [worker,manager])await admin.query("INSERT INTO candidate_identity.schedule_eligibility VALUES($1,'Cook','schedule-job',true)",[actor.membershipId]);
  for(const cap of ['schedule.manage','schedule.publish','schedule.change','location.manage'])await admin.query('INSERT INTO candidate_identity.membership_capabilities VALUES($1,$2,true)',[manager.membershipId,cap]);
  await admin.query('INSERT INTO candidate_operations.schedule_input_reviews(restaurant_id,time_off_complete,reviewed_at) VALUES($1,true,clock_timestamp())',[scope]);
  stores.push({scope,worker,manager,spare});
 }
 return stores;
}
const draft=(f,change={},prior)=>({requestId:randomUUID(),locationId:f.scope,action:'shift.save',input:{personId:f.worker.membershipId,start,end,position:'Cook',note:'Fictional scheduling review',...change},...(prior?{recordId:prior.recordId,expectedRevision:prior.revision}:{})});
const run=(f,command)=>executeTask(db,f.manager,f.scope,command);
async function raw(f,{actor=f.worker,start:from=start,end:to=end,cancelled=false,published=false}={}){
 const id=randomUUID();await admin.query('INSERT INTO candidate_operations.shift_references(id,restaurant_id,member_id,department,position,starts_at,ends_at,revision,published,cancelled) VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$9)',[id,f.scope,actor.membershipId,'BOH','Cook',from,to,published,cancelled]);return id;
}
const gate=async f=>(await admin.query('SELECT * FROM candidate_operations.schedule_input_reviews WHERE restaurant_id=$1',[f.scope])).rows[0];
async function certify(f){
 const rows=(await admin.query('SELECT m.*,p.name FROM candidate_identity.memberships m JOIN candidate_identity.people p ON p.id=m.person_id WHERE m.restaurant_id=$1 ORDER BY m.id',[f.scope])).rows;
 const snapshot={restaurantId:f.scope,timezone:'America/New_York',completeRoster:true,completeTimeOff:true,timeOff:[],members:rows.map(m=>({sourceId:m.id,sourceRevision:1,id:m.id,personId:m.person_id,name:m.name,department:m.department,position:m.position,active:m.active,scheduleOnly:m.schedule_only,qualifications:[],scheduleJobs:m.id===f.spare.membershipId?[]:['Cook']}))};
 const revision=(await admin.query('SELECT revision FROM candidate_identity.restaurants WHERE id=$1',[f.scope])).rows[0].revision;
 const review={snapshot,batchId:randomUUID(),expectedScopeRevision:revision,reviewNote:'Fictional complete source review',allow:'fictional-local-only'};
 return {...await rehearseScheduleReconciliation(review),review};
}
async function client(){const c=new pg.Client({...connection,user:'candidate_runtime'});await c.connect();await c.query("SET statement_timeout='8s'");return c;}
const sqlCommand=(c,f,command)=>c.query('SELECT candidate_operations.save_shift($1,$2,$3,$4,$5)',[f.manager.subject,f.manager.membershipId,f.scope,command.requestId,parseCommand(command,f.scope).payload]);
async function waiting(pid){const deadline=Date.now()+3000;while(Date.now()<deadline){if((await admin.query("SELECT wait_event_type='Lock' waiting FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0]?.waiting)return;await new Promise(r=>setTimeout(r,10));}throw Error('Expected competing booking to wait');}

test('one person across locations conflicts without exposing the other store; equal names do not merge people',async()=>{
 const [a,b]=await fixture();await run(a,draft(a));
 const sessionId=randomUUID();await admin.query("INSERT INTO candidate_identity.sessions(id,subject,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",[sessionId,b.manager.subject]);
 const h=createTaskHandler(db,async()=>({subject:b.manager.subject,sessionId}));
 const response=await h(new Request(`http://candidate.invalid/api/operations/${b.scope}/commands`,{method:'POST',headers:{Authorization:'Bearer fictional','Content-Type':'application/json'},body:JSON.stringify(draft(b))}));
 assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:{code:'shift_overlap'}});
 await run(b,draft(b,{personId:b.manager.membershipId}));
 assert.equal((await admin.query('SELECT count(*)::int n FROM candidate_operations.shift_references WHERE restaurant_id=$1',[b.scope])).rows[0].n,1);
});

test('simultaneous cross-location runtime submissions commit exactly one shift and receipt',async()=>{
 const [a,b]=await fixture(),commands=[draft(a),draft(b)];
 const results=await Promise.allSettled([run(a,commands[0]),run(b,commands[1])]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'shift_overlap');
 assert.equal((await admin.query('SELECT count(*)::int n FROM candidate_operations.command_receipts WHERE request_id=ANY($1::uuid[])',[commands.map(c=>c.requestId)])).rows[0].n,1);
 assert.equal((await admin.query('SELECT count(*)::int n FROM candidate_operations.person_shift_bookings WHERE person_id=$1',[a.worker.personId])).rows[0].n,1);
});

test('exclusion constraint arbitrates an invisible in-flight command; rollback frees the competing intent',async()=>{
 for(const commit of [true,false]){
  const [a,b]=await fixture(),first=await client(),second=await client(),ca=draft(a),cb=draft(b);let pending;
  try{
   await first.query('BEGIN');await sqlCommand(first,a,ca);await second.query('BEGIN');
   pending=sqlCommand(second,b,cb);pending.catch(()=>{});await waiting(second.processID);
   await first.query(commit?'COMMIT':'ROLLBACK');
   if(commit){await assert.rejects(pending,e=>e.code==='P0001'&&e.message==='shift_overlap'&&e.where.includes('sync_person_shift_booking'));await second.query('ROLLBACK');}
   else {await pending;await second.query('COMMIT');}
   const receipts=(await admin.query('SELECT request_id FROM candidate_operations.command_receipts WHERE request_id=ANY($1::uuid[])',[[ca.requestId,cb.requestId]])).rows;
   assert.deepEqual(receipts.map(r=>r.request_id),[commit?ca.requestId:cb.requestId]);
   assert.equal((await admin.query('SELECT count(*)::int n FROM candidate_operations.shift_references WHERE restaurant_id=$1',[commit?b.scope:a.scope])).rows[0].n,0);
  }finally{await first.query('ROLLBACK');await second.query('ROLLBACK');await first.end();await second.end();}
 }
});

test('adjacent real instants, cancelled shifts and different people remain schedulable across offsets',async()=>{
 const [a,b]=await fixture();const r=await run(a,draft(a,{start:'2035-11-04T01:00:00-04:00',end:'2035-11-04T02:00:00-05:00'}));
 await run(b,draft(b,{start:'2035-11-04T07:00:00Z',end:'2035-11-04T08:00:00Z'}));
 await run(a,{requestId:randomUUID(),locationId:a.scope,action:'shift.cancel',recordId:r.recordId,expectedRevision:r.revision,input:{note:'Fictional cancellation',closeTransfers:[]}});
 await run(b,draft(b));
 const cancelled=await raw(a,{cancelled:true});await assert.rejects(admin.query('UPDATE candidate_operations.shift_references SET cancelled=false WHERE id=$1',[cancelled]),e=>e.message==='shift_overlap');
});

test('imports, released history, edits and membership identity corrections cannot bypass person booking',async()=>{
 const [a,b]=await fixture(),first=await raw(a);await admin.query('UPDATE candidate_operations.shift_references SET released_at=clock_timestamp() WHERE id=$1',[first]);
 await assert.rejects(raw(b),e=>e.message==='shift_overlap');
 const future=await run(b,draft(b,{start:'2035-11-05T05:00:00Z',end:'2035-11-05T07:00:00Z'}));await assert.rejects(run(b,draft(b,{},future)),e=>e.code==='shift_overlap');
 const other=await raw(b,{actor:b.manager});
 await assert.rejects(admin.query('UPDATE candidate_identity.memberships SET person_id=$2 WHERE id=$1',[b.manager.membershipId,a.worker.personId]),e=>e.code==='23505');
 // Move an existing membership to a new identity with a booking at another store.
 const target=randomUUID(),member=randomUUID();await admin.query('INSERT INTO candidate_identity.people VALUES($1,$2)',[target,'Fictional correction target']);
 await admin.query("INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position) VALUES($1,$2,$3,'BOH','Cook')",[member,target,a.scope]);await raw(a,{actor:{membershipId:member}});
 await assert.rejects(admin.query('UPDATE candidate_identity.memberships SET person_id=$2 WHERE id=$1',[b.manager.membershipId,target]),e=>e.code==='23P01');
 assert.equal((await admin.query('SELECT person_id FROM candidate_operations.person_shift_bookings WHERE shift_id=$1',[other])).rows[0].person_id,b.manager.personId);
 const unused=randomUUID();await admin.query('INSERT INTO candidate_identity.people VALUES($1,$2)',[unused,'Fictional corrected identity']);await admin.query('UPDATE candidate_identity.memberships SET person_id=$2 WHERE id=$1',[b.manager.membershipId,unused]);
 assert.equal((await admin.query('SELECT person_id FROM candidate_operations.person_shift_bookings WHERE shift_id=$1',[other])).rows[0].person_id,unused);
});

test('database exclusion remains effective without the friendly preflight; runtime cannot inspect private bookings',async()=>{
 const [a,b]=await fixture();await raw(a);const c=await admin.connect();
 try{await c.query('BEGIN');await c.query('ALTER TABLE candidate_operations.shift_references DISABLE TRIGGER ab_check_person_shift');await assert.rejects(c.query("INSERT INTO candidate_operations.shift_references(id,restaurant_id,member_id,department,position,starts_at,ends_at,revision,published) VALUES($1,$2,$3,'BOH','Cook',$4,$5,1,false)",[randomUUID(),b.scope,b.worker.membershipId,start,end]),e=>e.message==='shift_overlap'&&e.where.includes('sync_person_shift_booking'));}finally{await c.query('ROLLBACK');c.release();}
 for(const sql of ['SELECT * FROM candidate_operations.person_shift_bookings','DELETE FROM candidate_operations.person_shift_bookings',"SELECT candidate_operations.person_shift_conflict('10000000-0000-0000-0000-000000000001',now(),now(),NULL)"])await assert.rejects(db.transaction(c=>c.query(sql,[])),e=>e.code==='42501');
});

test('coverage eligibility rechecks cross-location work before accepting a volunteer',async()=>{
 const [a,b]=await fixture();await raw(a);const shift=await raw(b,{actor:b.manager,published:true});
 const offer=randomUUID();await admin.query("INSERT INTO candidate_operations.schedule_offers(id,restaurant_id,owner_id,department,mode,shift_id,shift_revision,position,starts_at,ends_at,duties,note,status) VALUES($1,$2,$3,'BOH','coverage',$4,1,'Cook',$5,$6,'[]','Fictional coverage','open')",[offer,b.scope,b.manager.membershipId,shift,start,end]);
 assert.equal((await admin.query('SELECT candidate_operations.offer_eligible(o,$2) eligible FROM candidate_operations.schedule_offers o WHERE id=$1',[offer,b.worker.membershipId])).rows[0].eligible,false);
 const command={requestId:randomUUID(),locationId:b.scope,action:'coverage.volunteer',recordId:offer,expectedRevision:1,input:{confirmed:true}};
 await assert.rejects(executeTask(db,b.worker,b.scope,command),e=>e.code==='replacement_no_longer_eligible'||e.status===403);
 assert.deepEqual((await admin.query('SELECT volunteers FROM candidate_operations.schedule_offers WHERE id=$1',[offer])).rows[0].volunteers,[]);
});

test('all membership writes invalidate the whole store review; failed writes preserve it and other stores',async()=>{
 for(const operation of ['insert','update','delete','noop']){
  const [a,b]=await fixture();const reviewed=await certify(a);await certify(b);
  if(operation==='insert'){const person=randomUUID();await admin.query('INSERT INTO candidate_identity.people VALUES($1,$2)',[person,'Fictional new hire']);await admin.query("INSERT INTO candidate_identity.memberships(person_id,restaurant_id,department) VALUES($1,$2,'FOH')",[person,a.scope]);}
  if(operation==='update')await admin.query("UPDATE candidate_identity.memberships SET position='Fictional changed job',department='FOH',active=false,schedule_only=true WHERE id=$1",[a.spare.membershipId]);
  if(operation==='delete')await admin.query('DELETE FROM candidate_identity.memberships WHERE id=$1',[a.spare.membershipId]);
  if(operation==='noop')await admin.query('UPDATE candidate_identity.memberships SET position=position WHERE id=$1',[a.spare.membershipId]);
  const invalidated=await gate(a);assert.deepEqual([invalidated.time_off_complete,invalidated.reviewed_at,invalidated.evidence_batch_id],[false,null,null]);
  assert.equal((await gate(b)).time_off_complete,true);
  await assert.rejects(run(a,draft(a)),e=>e.code==='schedule_inputs_incomplete');
  assert.ok(reviewed.batchId);
 }
 const [a]=await fixture();await certify(a);const before=await gate(a);await assert.rejects(admin.query('UPDATE candidate_identity.memberships SET person_id=$2 WHERE id=$1',[a.spare.membershipId,a.worker.personId]),e=>e.code==='23505');assert.deepEqual(await gate(a),before);
});

test('eligibility insert, edit, delete and parent moves invalidate old and new whole-store reviews',async()=>{
 for(const operation of ['insert','update','delete','move']){
  const [a,b]=await fixture();await certify(a);await certify(b);
  if(operation==='insert')await admin.query("INSERT INTO candidate_identity.schedule_eligibility VALUES($1,'Cook','qualification',true)",[a.worker.membershipId]);
  if(operation==='update')await admin.query('UPDATE candidate_identity.schedule_eligibility SET active=active WHERE member_id=$1',[a.worker.membershipId]);
  if(operation==='delete')await admin.query('DELETE FROM candidate_identity.schedule_eligibility WHERE member_id=$1',[a.worker.membershipId]);
  if(operation==='move')await admin.query('UPDATE candidate_identity.schedule_eligibility SET member_id=$2 WHERE member_id=$1',[a.worker.membershipId,b.spare.membershipId]);
  assert.equal((await gate(a)).time_off_complete,false);assert.equal((await gate(a)).evidence_batch_id,null);
  assert.equal((await gate(b)).time_off_complete,operation!=='move');
 }
 const [a,b]=await fixture();await certify(a);await certify(b);
 await admin.query('UPDATE candidate_identity.memberships SET restaurant_id=$2 WHERE id=$1',[a.spare.membershipId,b.scope]);
 assert.equal((await gate(a)).time_off_complete,false);assert.equal((await gate(b)).time_off_complete,false);
});

test('roster changes block publication; receipt replay stays incomplete and new reviewed evidence restores scheduling',async()=>{
 const [a]=await fixture();const original=await certify(a);const r=await run(a,draft(a));
 await admin.query("INSERT INTO candidate_operations.publication_reviews(shift_id,shift_revision,workspace_revision,no_staffing,no_closing,evidence) SELECT $1,$2,revision,true,true,'Fictional full publication review' FROM candidate_identity.restaurants WHERE id=$3",[r.recordId,r.revision,a.scope]);
 await admin.query('UPDATE candidate_identity.memberships SET position=position WHERE id=$1',[a.spare.membershipId]);
 await assert.rejects(run(a,{requestId:randomUUID(),locationId:a.scope,action:'shift.publish',recordId:r.recordId,expectedRevision:r.revision,input:{note:'Fictional publish'}}),e=>e.code==='schedule_inputs_incomplete');
 assert.equal((await rehearseScheduleReconciliation(original.review)).replayed,true);assert.equal((await gate(a)).time_off_complete,false);
 await certify(a);assert.equal((await gate(a)).time_off_complete,true);
 await run(a,draft(a,{start:'2035-11-05T05:00:00Z',end:'2035-11-05T07:00:00Z'}));
});

test('migration 037 backfills the accepted baseline and rolls back entirely for existing overlaps',async()=>{
 const migrations=await verifyMigrationManifest(),safeguardIndex=migrations.indexOf('037_person_schedule_safeguards.sql');assert.ok(safeguardIndex>0);
 for(const overlapping of [false,true]){
  const name=connection.database+(overlapping?'_bad_upgrade':'_upgrade');assert.ok(name.length<=63);
  const server=new pg.Client({...connection,database:'postgres',user:'candidate_owner'});await server.connect();
  try{assert.equal((await server.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount,0,'Use a fresh fictional test database');await server.query(`CREATE DATABASE "${name}" OWNER candidate_owner`);}finally{await server.end();}
  const c=new pg.Client({...connection,database:name,user:'candidate_owner'});await c.connect();
  try{
   await c.query(`GRANT CREATE ON DATABASE "${name}" TO candidate_schema_owner`);await c.query('GRANT USAGE,CREATE ON SCHEMA public TO candidate_schema_owner');await c.query('SET ROLE candidate_schema_owner');
   for(const file of migrations.slice(0,safeguardIndex))await c.query(await readFile(new URL(file,import.meta.url),'utf8'));
   const person=randomUUID(),member=randomUUID(),scope='fictional-upgrade';await c.query('INSERT INTO candidate_identity.restaurants(id,name) VALUES($1,$2)',[scope,'Fictional upgrade']);await c.query('INSERT INTO candidate_identity.people VALUES($1,$2)',[person,'Fictional upgrade worker']);await c.query("INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department) VALUES($1,$2,$3,'BOH')",[member,person,scope]);
   for(const cancelled of [false,!overlapping])await c.query("INSERT INTO candidate_operations.shift_references(id,restaurant_id,member_id,department,position,starts_at,ends_at,revision,published,cancelled) VALUES($1,$2,$3,'BOH','Cook',$4,$5,1,true,$6)",[randomUUID(),scope,member,start,end,cancelled]);
   const sql=await readFile(new URL(migrations[safeguardIndex],import.meta.url),'utf8');
   if(overlapping){await assert.rejects(c.query(sql),e=>e.code==='23P01');await c.query('ROLLBACK');assert.equal((await c.query("SELECT to_regclass('candidate_operations.person_shift_bookings') relation")).rows[0].relation,null);}
   else{await c.query(sql);assert.equal((await c.query('SELECT count(*)::int n FROM candidate_operations.person_shift_bookings')).rows[0].n,1);}
   assert.equal((await c.query('SELECT count(*)::int n FROM candidate_operations.shift_references')).rows[0].n,2);
  }finally{await c.query('ROLLBACK');await c.end();}
 }
});
