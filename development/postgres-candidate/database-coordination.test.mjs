import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import pg from 'pg';
import {connection} from './test-config.mjs';import {PostgresDatabase} from './postgres-driver.ts';import {executeTask,parseCommand} from './task-adapter.ts';import {createTaskHandler} from './task-http.ts';
import {privilegedScopeTransaction} from './privileged-scope-transaction.mjs';
const admin=new pg.Pool({...connection,user:'candidate_owner'}),db=new PostgresDatabase({...connection,user:'candidate_runtime'});after(async()=>{await admin.end();await db.close();});
async function fixture(){
 const scope='coord-'+randomUUID(),actors=[];await admin.query('INSERT INTO candidate_identity.restaurants(id,name) VALUES($1,$2)',[scope,'Fictional coordination']);
 for(const name of ['manager','employee','peer']){
  const person=randomUUID(),membershipId=randomUUID(),subject='fictional-'+randomUUID(),sessionId=randomUUID();
  await admin.query('INSERT INTO candidate_identity.people VALUES($1,$2)',[person,'Fictional '+name]);await admin.query('INSERT INTO candidate_identity.auth_links VALUES($1,$2)',[subject,person]);
  await admin.query("INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position) VALUES($1,$2,$3,'BOH','Cook')",[membershipId,person,scope]);
  await admin.query("INSERT INTO candidate_identity.schedule_eligibility VALUES($1,'Cook','schedule-job',true)",[membershipId]);
  if(name!=='employee')for(const cap of ['tasks.manage','schedule.manage','schedule.publish','schedule.change','close.confirm','operations.escalation','location.manage'])await admin.query('INSERT INTO candidate_identity.membership_capabilities VALUES($1,$2,true)',[membershipId,cap]);
  await admin.query("INSERT INTO candidate_identity.sessions(id,subject,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",[sessionId,subject]);actors.push({membershipId,subject,sessionId});
 }
 await admin.query('INSERT INTO candidate_operations.schedule_input_reviews(restaurant_id,time_off_complete,reviewed_at) VALUES($1,true,clock_timestamp())',[scope]);
 return {scope,manager:actors[0],employee:actors[1],peer:actors[2]};
}
const command=f=>({requestId:randomUUID(),locationId:f.scope,action:'task.create',input:{ownerId:f.employee.membershipId,title:'Fictional task',detail:'Fictional work',kind:'task',due:'2031-05-01T15:00:00Z'}});
const run=(f,c,a=f.manager)=>executeTask(db,a,f.scope,c);
const handler=(f,a=f.manager,database=db)=>createTaskHandler(database,async()=>({subject:a.subject,sessionId:a.sessionId}));
const request=(f,resource)=>new Request(`http://candidate.invalid/api/operations/${f.scope}/${resource}`,{headers:{Authorization:'Bearer fictional'}});
async function client(user='candidate_owner'){
 const c=new pg.Client({...connection,user});await c.connect();await c.query("SET statement_timeout='3s'");return c;
}
async function cleanup(...clients){for(const c of clients){try{await c.query('ROLLBACK');}finally{await c.end();}}}
async function waitForLock(pid){
 const until=Date.now()+2000;
 while(Date.now()<until){if((await admin.query("SELECT wait_event_type='Lock' waiting FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0]?.waiting)return;await new Promise(r=>setTimeout(r,10));}
 throw Error('Expected database lock wait');
}

// Reviewed dispatchers may read routing metadata, but must not mutate or lock rows.
const dispatchers={'command/5':['manager_handoff_command/5','dish_command/5','command_before_dish/5'],
 'publish_shift/5':['publish_shift_core/6'],'publish_shift_core/6':['publish_shift_core/8'],
 'save_shift/5':['change_schedule/5','save_schedule_draft/5'],
 'schedule_request_command/5':['schedule_consent_command/5','time_off_command/5']};
function assertWriteCoordination(rows){
 const key=row=>row.proname+'/'+row.pronargs,bySignature=new Map(rows.map(row=>[key(row),row]));
 assert.equal(bySignature.size,rows.length,'Review same-arity overloaded routines explicitly');
 function coordinated(row,seen=new Set()){
  assert.ok(row,'Missing coordinated callee');const signature=key(row);assert.ok(!seen.has(signature),'Dispatcher cycle');seen=new Set([...seen,signature]);
  if(!dispatchers[signature]){
   assert.match(row.prosrc,/\bBEGIN\s+PERFORM candidate_operations\.lock_scope\(p_restaurant\);/i,signature);return;
  }
  assert.doesNotMatch(row.prosrc,/\b(INSERT|UPDATE|DELETE)\b|FOR\s+(UPDATE|SHARE|NO KEY UPDATE|KEY SHARE)/i,signature);
  const calls=[...new Set([...row.prosrc.matchAll(/candidate_operations\.(\w+)\s*\(([^()]*)\)/g)].map(m=>m[1]+'/'+m[2].split(',').length))].sort();
  assert.deepEqual(calls,[...dispatchers[signature]].sort(),signature);
  for(const target of calls)coordinated(bySignature.get(target),seen);
 }
 for(const row of rows){
  assert.doesNotMatch(row.prosrc,/restaurants[^;]*FOR\s+UPDATE/i,row.proname);
  if(!row.runtime||row.provolatile!=='v')continue;
  coordinated(row);
 }
}
const coordinationSources=()=>admin.query(`SELECT proname,pronargs,prosrc,provolatile,
 has_function_privilege('candidate_runtime',p.oid,'EXECUTE') runtime
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='candidate_operations' AND p.prokind='f'`);
test('every runtime write path coordinates before policy/record locks, including reviewed dispatchers',async()=>{
 const {rows}=await coordinationSources();assertWriteCoordination(rows);
 assert.ok(rows.filter(r=>r.runtime&&r.provolatile==='v').length>=21);
});
test('coordination contract rejects lost helper locks, direct locks and unexpected dispatcher writes',async()=>{
 const {rows}=await coordinationSources();
 for(const [name,change] of [
  ['command_before_dish',s=>s.replace('PERFORM candidate_operations.lock_scope(p_restaurant);','')],
  ['command',s=>s+' SELECT 1 FROM candidate_identity.restaurants FOR UPDATE;'],
  ['save_shift',s=>s+' DELETE FROM candidate_operations.tasks;']
 ])assert.throws(()=>assertWriteCoordination(rows.map(r=>r.proname===name?{...r,prosrc:change(r.prosrc)}:r)),assert.AssertionError);
});
test('session insertion competing with an in-flight command retries the entire transaction with the same ID',async()=>{
 const f=await fixture(),writing=await client('candidate_runtime'),inserting=await client(),id=randomUUID(),c=command(f);
 try{
  await writing.query('BEGIN');await writing.query('SELECT candidate_operations.command($1,$2,$3,$4,$5)',[f.manager.subject,f.manager.membershipId,f.scope,c.requestId,JSON.stringify(parseCommand(c,f.scope).payload)]);
  await inserting.query('BEGIN');
  await assert.rejects(inserting.query("INSERT INTO candidate_identity.sessions(id,subject,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",[id,f.employee.subject]),e=>e.code==='40001'&&e.message==='scope_coordination_retry');
  await assert.rejects(inserting.query('SELECT 1'),e=>e.code==='25P02');
  await inserting.query('ROLLBACK');await writing.query('COMMIT');
  await inserting.query('BEGIN');await inserting.query("INSERT INTO candidate_identity.sessions(id,subject,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",[id,f.employee.subject]);await inserting.query('COMMIT');
  assert.equal((await admin.query('SELECT id FROM candidate_identity.sessions WHERE id=$1',[id])).rowCount,1);
 }finally{await cleanup(writing,inserting);}
});
test('policy and parent deletes coordinate; membership children restrict rather than silently cascade',async()=>{
 const f=await fixture(),holding=await client();
 const foreignKeys=await admin.query("SELECT confdeltype FROM pg_constraint WHERE contype='f' AND confrelid='candidate_identity.memberships'::regclass");
 assert.ok(foreignKeys.rowCount>0);for(const fk of foreignKeys.rows)assert.notEqual(fk.confdeltype,'c','Review new cascade paths before adoption');
 try{
  await holding.query('BEGIN');await holding.query('SELECT candidate_operations.lock_scope($1)',[f.scope]);
  for(const [table,column,id] of [['membership_capabilities','membership_id',f.manager.membershipId],['schedule_eligibility','member_id',f.employee.membershipId],['memberships','id',f.employee.membershipId]])
   await assert.rejects(admin.query(`DELETE FROM candidate_identity.${table} WHERE ${column}=$1`,[id]),e=>e.code==='40001'&&e.message==='scope_coordination_retry');
  await holding.query('ROLLBACK');
  await assert.rejects(admin.query('DELETE FROM candidate_identity.memberships WHERE id=$1',[f.employee.membershipId]),e=>e.code==='23503');
  await privilegedScopeTransaction(admin,[f.scope],async c=>{
   await c.query('DELETE FROM candidate_identity.schedule_eligibility WHERE member_id=$1',[f.employee.membershipId]);
   await c.query('DELETE FROM candidate_identity.memberships WHERE id=$1',[f.employee.membershipId]);
  });
  assert.equal((await admin.query('SELECT 1 FROM candidate_identity.memberships WHERE id=$1',[f.employee.membershipId])).rowCount,0);
 }finally{await cleanup(holding);}
});
test('HTTP reads do not wait for Companion write coordination and allow a concurrent same-location command',async()=>{
 const f=await fixture(),holding=await client();let writer;
 try{
  await holding.query('BEGIN');await holding.query('SELECT candidate_operations.lock_scope($1)',[f.scope]);
  const reader=handler(f);for(const resource of ['tasks','schedule-viewer','schedule-roster','schedule-availability','schedule-shifts','goals','staffing'])assert.equal((await reader(request(f,resource))).status,200,resource);
  writer=run(f,command(f));writer.catch(()=>{});
  // Coordination protects writes, while reads can complete against their committed snapshot.
  const response=await reader(request(f,'tasks'));assert.equal(response.status,200);assert.equal((await response.json()).items.length,0);
  await holding.query('ROLLBACK');await writer;
 }finally{await cleanup(holding);if(writer)await writer.catch(()=>{});}
});
test('an unrelated location can write and update policy while another location is coordinated',async()=>{
 const a=await fixture(),b=await fixture(),holding=await client();
 try{
  await holding.query('BEGIN');await holding.query('SELECT candidate_operations.lock_scope($1)',[a.scope]);
  const result=await run(b,command(b));assert.equal(result.revision,1);
  await admin.query("UPDATE candidate_identity.memberships SET position='Cook' WHERE id=$1",[b.employee.membershipId]);
  await assert.rejects(admin.query("UPDATE candidate_identity.memberships SET position='Cook' WHERE id=$1",[a.employee.membershipId]),e=>e.code==='40001'&&e.message==='scope_coordination_retry');
  await holding.query('ROLLBACK');await admin.query("UPDATE candidate_identity.memberships SET position='Cook' WHERE id=$1",[a.employee.membershipId]);
 }finally{await cleanup(holding);}
});
test('an Inventory-style foreign-key insert is compatible with an open Companion write transaction',async()=>{
 const f=await fixture(),writing=await client('candidate_runtime'),inventory=await client(),table='coord_inventory_'+randomUUID().replaceAll('-','');
 try{
  await admin.query(`CREATE TABLE public.${table}(id uuid PRIMARY KEY,restaurant_id text REFERENCES candidate_identity.restaurants(id))`);
  await writing.query('BEGIN');const c=command(f);await writing.query('SELECT candidate_operations.command($1,$2,$3,$4,$5)',[f.manager.subject,f.manager.membershipId,f.scope,c.requestId,JSON.stringify(parseCommand(c,f.scope).payload)]);
  await inventory.query(`INSERT INTO public.${table} VALUES($1,$2)`,[randomUUID(),f.scope]);
  await writing.query('COMMIT');
 }finally{await cleanup(writing,inventory);}
});
test('row-first roster changes fail retryably instead of deadlocking a coordinated command',async()=>{
 const f=await fixture(),roster=await client(),writing=await client('candidate_runtime');let pending;
 try{
  await roster.query('BEGIN');await roster.query('SELECT 1 FROM candidate_identity.memberships WHERE id=$1 FOR UPDATE',[f.manager.membershipId]);
  await writing.query('BEGIN');const c=command(f);pending=writing.query('SELECT candidate_operations.command($1,$2,$3,$4,$5)',[f.manager.subject,f.manager.membershipId,f.scope,c.requestId,JSON.stringify(parseCommand(c,f.scope).payload)]);pending.catch(()=>{});
  await waitForLock(writing.processID);
  await assert.rejects(roster.query("UPDATE candidate_identity.memberships SET position='Cook' WHERE id=$1",[f.manager.membershipId]),e=>e.code==='40001'&&e.message==='scope_coordination_retry');
  await roster.query('ROLLBACK');await pending;await writing.query('COMMIT');
  await admin.query("UPDATE candidate_identity.memberships SET position='Cook' WHERE id=$1",[f.manager.membershipId]);
 }finally{await roster.query('ROLLBACK').catch(()=>{});if(pending)await pending.catch(()=>{});await cleanup(roster,writing);}
});
test('permission revocation waits for an authorized command, then denies later commands and receipt replay',async()=>{
 const f=await fixture(),writing=await client('candidate_runtime'),revoking=await client(),c=command(f);let revoked;
 try{
  await writing.query('BEGIN');await writing.query('SELECT candidate_operations.command($1,$2,$3,$4,$5)',[f.manager.subject,f.manager.membershipId,f.scope,c.requestId,JSON.stringify(parseCommand(c,f.scope).payload)]);
  // A command that already owns policy rows may finish; the downgrade then commits.
  revoked=revoking.query("UPDATE candidate_identity.membership_capabilities SET active=false WHERE membership_id=$1 AND capability='tasks.manage'",[f.manager.membershipId]);revoked.catch(()=>{});
  await waitForLock(revoking.processID);await writing.query('COMMIT');await revoked;
  await assert.rejects(run(f,c),e=>e.status===403);await assert.rejects(run(f,command(f)),e=>e.status===403);
 }finally{await writing.query('ROLLBACK').catch(()=>{});if(revoked)await revoked.catch(()=>{});await cleanup(writing,revoking);}
});
test('read-only authorization and data use one snapshot; the next request observes revocation',async()=>{
 const f=await fixture(),reading=await client('candidate_runtime');
 try{
  await reading.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await reading.query('SELECT candidate_operations.resolve_identity_read($1,$2,$3)',[f.manager.subject,f.manager.sessionId,f.scope]);
  await admin.query('UPDATE candidate_identity.sessions SET active=false WHERE id=$1',[f.manager.sessionId]);
  const result=(await reading.query('SELECT candidate_operations.list_tasks($1,$2,$3)',[f.manager.subject,f.manager.membershipId,f.scope])).rows[0].list_tasks;assert.deepEqual(result.items,[]);
  await reading.query('COMMIT');assert.equal((await handler(f)(request(f,'tasks'))).status,401);
 }finally{await cleanup(reading);}
});
test('HTTP read snapshot keeps items and workspace revision consistent across a concurrent staffing update',async()=>{
 const f=await fixture(),input={area:'BOH',title:'Before',position:'Cook',start:'2031-05-01T13:00:00Z',end:'2031-05-01T15:00:00Z',minimum:2,source:'Fictional demand'};
 const saved=await run(f,{requestId:randomUUID(),locationId:f.scope,action:'staffing.save',input});
 let resolveEntered,releaseRead;const entered=new Promise(r=>{resolveEntered=r;}),released=new Promise(r=>{releaseRead=r;});
 const intercepted={transaction:operation=>db.transaction(c=>operation({query:async(sql,args)=>{const result=await c.query(sql,args);if(sql.includes('resolve_identity_read')){resolveEntered();await released;}return result;}}))};
 const pending=handler(f,f.manager,intercepted)(request(f,'staffing'));
 try{
  await entered;const changed=await run(f,{requestId:randomUUID(),locationId:f.scope,action:'staffing.save',recordId:saved.recordId,expectedRevision:1,input:{...input,title:'After'}});releaseRead();
  const response=await pending;assert.equal(response.status,200);const old=await response.json();assert.equal(old.items[0].data.title,'Before');assert.equal(old.workspaceRevision,saved.workspaceRevision);
  const fresh=await (await handler(f)(request(f,'staffing'))).json();assert.equal(fresh.items[0].data.title,'After');assert.equal(fresh.workspaceRevision,changed.workspaceRevision);
 }finally{releaseRead();await pending;}
});
test('all read entry points are stable and use non-locking helpers; coordination stays private',async()=>{
 const reads=await admin.query("SELECT proname,provolatile,prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='candidate_operations' AND (proname LIKE 'read_%' OR proname LIKE 'list_%' OR proname IN ('schedule_viewer','weekly_review','resolve_identity_read'))");
 assert.ok(reads.rowCount>=20);for(const r of reads.rows){assert.equal(r.provolatile,'s',r.proname);assert.equal(/FOR (SHARE|UPDATE)/.test(r.prosrc),false,r.proname);assert.equal(/candidate_operations\.(task_manager|closing_manager|dish_manager|task_reviewer|closing_publication_issues)\(/.test(r.prosrc),false,r.proname);}
 for(const sql of ['SELECT * FROM candidate_operations.scope_coordination',"SELECT candidate_operations.lock_scope('fictional-a')", "SELECT candidate_operations.task_manager_read('10000000-0000-0000-0000-000000000001','fictional-a','BOH')"])await assert.rejects(db.transaction(c=>c.query(sql,[])),e=>e.code==='42501');
});
test('urgent overnight escalation does not lock another location grant row',async()=>{
 const f=await fixture(),other=await fixture(),holding=await client();
 const outgoing=randomUUID(),incoming=randomUUID();
 for(const [id,actor,start,end] of [[outgoing,f.manager,'2031-05-01T12:00:00Z','2031-05-01T20:00:00Z'],[incoming,f.peer,'2031-05-02T12:00:00Z','2031-05-02T20:00:00Z']])await admin.query("INSERT INTO candidate_operations.leadership_references(id,restaurant_id,member_id,department,starts_at,ends_at) VALUES($1,$2,$3,'BOH',$4,$5)",[id,f.scope,actor.membershipId,start,end]);
 try{
  await holding.query('BEGIN');await holding.query("UPDATE candidate_identity.membership_capabilities SET active=active WHERE membership_id=$1 AND capability='tasks.manage'",[other.manager.membershipId]);
  const result=await run(f,{requestId:randomUUID(),locationId:f.scope,action:'handoff.create',input:{title:'Fictional urgent issue',detail:'Fictional safe deferral',outgoingLeadershipId:outgoing,incomingLeadershipId:incoming,incomingId:f.peer.membershipId,priority:'urgent',safeToDefer:true}});assert.equal(result.revision,1);
 }finally{await cleanup(holding);}
});
test('privileged roster batches coordinate before rows, support concurrent callers and roll back partial actors',async()=>{
 const f=await fixture();
 async function createActor(fail=false){
  const person=randomUUID(),member=randomUUID(),subject='fictional-batch-'+randomUUID();
  const operation=privilegedScopeTransaction(admin,[f.scope],async c=>{
   await c.query('INSERT INTO candidate_identity.people VALUES($1,$2)',[person,'Fictional coordinated actor']);await c.query('INSERT INTO candidate_identity.auth_links VALUES($1,$2)',[subject,person]);
   await c.query("INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department) VALUES($1,$2,$3,'BOH')",[member,person,f.scope]);
   await c.query("INSERT INTO candidate_identity.membership_capabilities VALUES($1,'tasks.manage',true)",[member]);
   if(fail)throw Error('fictional_roster_failure');return member;
  });
  if(fail){await assert.rejects(operation,e=>e.message==='fictional_roster_failure');assert.equal((await admin.query('SELECT 1 FROM candidate_identity.people WHERE id=$1',[person])).rowCount,0);assert.equal((await admin.query('SELECT 1 FROM candidate_identity.memberships WHERE id=$1',[member])).rowCount,0);return;}
  return operation;
 }
 const members=await Promise.all([createActor(),createActor()]);assert.equal((await admin.query('SELECT 1 FROM candidate_identity.memberships WHERE id=ANY($1::uuid[])',[members])).rowCount,2);await createActor(true);
});
