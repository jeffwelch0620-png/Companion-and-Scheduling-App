import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import pg from 'pg';
import {connection} from './test-config.mjs';import {PostgresDatabase} from './postgres-driver.ts';import {executeTask} from './task-adapter.ts';
const admin=new pg.Pool({...connection,user:'candidate_owner'}),db=new PostgresDatabase({...connection,user:'candidate_runtime'});
after(async()=>{await admin.end();await db.close();});
const sql=`INSERT INTO candidate_identity.restaurants(id,name,timezone,operating_departments,dish_department,dish_position,dish_aliases)
 VALUES($1,'Fictional configured store',$2,ARRAY['Service','Kitchen'],'Kitchen','Steward',ARRAY['Steward','Steward PM'])`;
async function store(timezone='America/Chicago'){const scope='config-'+randomUUID();await admin.query(sql,[scope,timezone]);return scope;}
async function member(scope,department,position,caps=[]){const person=randomUUID(),membershipId=randomUUID(),subject='fictional-'+membershipId;
 await admin.query('INSERT INTO candidate_identity.people VALUES($1,$2)',[person,'Fictional configured person']);await admin.query('INSERT INTO candidate_identity.auth_links VALUES($1,$2)',[subject,person]);
 await admin.query('INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position) VALUES($1,$2,$3,$4,$5)',[membershipId,person,scope,department,position]);
 for(const cap of caps)await admin.query('INSERT INTO candidate_identity.membership_capabilities VALUES($1,$2,true)',[membershipId,cap]);
 return {subject,membershipId};}
const policy=(name,values)=>admin.query(`SELECT candidate_operations.${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) value`,values).then(r=>r.rows[0].value);
test('new stores require explicit valid timezone and complete operational mappings',async()=>{
 await assert.rejects(admin.query("INSERT INTO candidate_identity.restaurants(id,name) VALUES($1,'Missing timezone')",['config-'+randomUUID()]),e=>e.message==='invalid_store_timezone');
 await assert.rejects(admin.query("INSERT INTO candidate_identity.restaurants(id,name,timezone) VALUES($1,'Missing mappings','UTC')",['config-'+randomUUID()]),e=>e.message==='invalid_store_configuration');
 for(const zone of ['Invalid/Place',' America/Chicago',''])await assert.rejects(store(zone),e=>e.message==='invalid_store_timezone');
 for(const zone of ['UTC','America/Chicago','Europe/London','Asia/Kolkata'])assert.ok(await store(zone));
});
test('invalid or ambiguous role configuration is rejected without changing stored values',async()=>{
 const scope=await store();for(const fragment of ["operating_departments=ARRAY[]::text[]","operating_departments=ARRAY['Kitchen','Kitchen']","dish_department='Elsewhere'","dish_position=''","dish_aliases=ARRAY['Other']","dish_aliases=ARRAY['Steward','steward']","dish_aliases=ARRAY['Steward',NULL]","operating_departments=ARRAY[['Kitchen','Service']]","dish_aliases=ARRAY[]::text[]"]){
  await assert.rejects(admin.query('UPDATE candidate_identity.restaurants SET '+fragment+' WHERE id=$1',[scope]),e=>e.message==='invalid_store_configuration');
 }assert.equal((await admin.query('SELECT revision FROM candidate_identity.restaurants WHERE id=$1',[scope])).rows[0].revision,0);
});
test('configured labels are store scoped; names never infer the dish role or store-wide authority',async()=>{
 const scope=await store(),manager=await member(scope,'Kitchen','Supervisor',['tasks.manage','operations.store']),dish=await member(scope,'Kitchen','Steward',['tasks.manage','location.manage']),ordinary=await member(scope,'Kitchen','Dishwasher',['tasks.manage']);
 assert.equal(await policy('closing_manager',[manager.membershipId,scope,'Service','tasks.manage']),true);
 for(const area of ['FOH','BOH','Warehouse'])assert.equal(await policy('closing_manager',[manager.membershipId,scope,area,'tasks.manage']),false);
 assert.equal(await policy('task_manager',[dish.membershipId,scope,'Kitchen']),false);
 assert.equal(await policy('task_manager',[ordinary.membershipId,scope,'Kitchen']),true);
 assert.equal(await policy('dish_only_label',[scope,'steward   PM']),true);assert.equal(await policy('dish_only_label',[scope,'Dishwasher']),false);
 assert.equal(await policy('dish_only_label',['fictional-a','Steward']),false);assert.equal(await policy('dish_only_label',['fictional-a','Dish Washer (PM)']),true);
 const local=await member(scope,'Kitchen','Supervisor',['tasks.manage']);assert.equal(await policy('closing_manager',[local.membershipId,scope,'Service','tasks.manage']),false);
});
test('custom dish role creates and completes its three-person checkout in the configured department',async()=>{
 const scope=await store(),manager=await member(scope,'Kitchen','Supervisor',['tasks.manage']),actors=[];for(let i=0;i<3;i++)actors.push(await member(scope,'Kitchen','Steward'));
 const day='2035-01-02',result=await executeTask(db,manager,scope,{requestId:randomUUID(),locationId:scope,action:'task.dish-cycle',input:{amOwnerId:actors[0].membershipId,pmOwnerIds:actors.slice(1).map(m=>m.membershipId),businessDate:day,title:'Configured checkout',detail:'Fictional independent checks',due:day+'T23:00:00-06:00'}});
 const tasks=(await admin.query('SELECT t.* FROM candidate_operations.tasks t JOIN candidate_operations.dish_participants p ON p.task_id=t.id WHERE p.cycle_id=$1 ORDER BY p.slot',[result.recordId])).rows;
 assert.equal(tasks.length,3);assert.ok(tasks.every(t=>t.department==='Kitchen'));assert.equal(await policy('dish_shape',[result.recordId]),true);
 for(const [i,actor] of actors.entries()){
  const ready=await executeTask(db,actor,scope,{requestId:randomUUID(),locationId:scope,action:'task.transition',recordId:tasks[i].id,expectedRevision:1,input:{step:'ready',note:'Fictional ready'}});
  await executeTask(db,manager,scope,{requestId:randomUUID(),locationId:scope,action:'task.transition',recordId:ready.recordId,expectedRevision:ready.revision,input:{step:'verify',note:'Fictional independent check'}});
 }assert.ok((await admin.query('SELECT phase FROM candidate_operations.tasks WHERE restaurant_id=$1',[scope])).rows.every(t=>t.phase==='closed'));
});
test('viewer exposes explicit store configuration and custom timezone without leaking identity links',async()=>{
 const scope=await store('Asia/Kolkata'),actor=await member(scope,'Kitchen','Cook');
 const viewer=await db.transaction(async c=>(await c.query('SELECT candidate_operations.schedule_viewer($1,$2,$3) value',[actor.subject,actor.membershipId,scope])).rows[0].value);
 assert.equal(viewer.location.timezone,'Asia/Kolkata');assert.deepEqual(viewer.location.configuration,{operatingDepartments:['Service','Kitchen'],dishDepartment:'Kitchen',dishPosition:'Steward',dishAliases:['Steward','Steward PM']});
 assert.equal(Object.hasOwn(viewer.me,'personId'),false);
});
test('station job constraint follows its own store mapping without rejecting ordinary legacy names',async()=>{
 const scope=await store(),station=randomUUID();await admin.query("INSERT INTO candidate_operations.station_references(id,restaurant_id,department,title,revision,status,configured,all_job_members) VALUES($1,$2,'Kitchen','Fictional station',1,'active',true,true)",[station,scope]);
 for(const job of ['Dishwasher','Dish','Cook'])await admin.query('INSERT INTO candidate_operations.station_jobs(station_id,job) VALUES($1,$2)',[station,job]);
 for(const job of ['Steward','steward   PM'])await assert.rejects(admin.query('INSERT INTO candidate_operations.station_jobs(station_id,job) VALUES($1,$2)',[station,job]),e=>e.code==='23514'&&e.message==='station_job_role_denied');
 assert.equal((await admin.query('SELECT count(*)::int n FROM candidate_operations.station_jobs WHERE station_id=$1',[station])).rows[0].n,3);
 await assert.rejects(admin.query("UPDATE candidate_operations.station_references SET restaurant_id='fictional-a' WHERE id=$1",[station]),e=>e.code==='23514'&&e.message==='station_job_role_denied');
 assert.equal((await admin.query('SELECT restaurant_id FROM candidate_operations.station_references WHERE id=$1',[station])).rows[0].restaurant_id,scope);
});
test('timezone and department policy changes advance revisions and invalidate review; no-ops do neither',async()=>{
 const scope=await store();await admin.query('INSERT INTO candidate_operations.schedule_input_reviews(restaurant_id,time_off_complete,reviewed_at) VALUES($1,true,clock_timestamp())',[scope]);
 const read=()=>admin.query('SELECT r.revision,s.time_off_complete FROM candidate_identity.restaurants r JOIN candidate_operations.schedule_input_reviews s ON s.restaurant_id=r.id WHERE r.id=$1',[scope]).then(r=>r.rows[0]);
 await admin.query('UPDATE candidate_identity.restaurants SET timezone=timezone,operating_departments=operating_departments WHERE id=$1',[scope]);assert.deepEqual(await read(),{revision:0,time_off_complete:true});
 await admin.query("UPDATE candidate_identity.restaurants SET timezone='Europe/London' WHERE id=$1",[scope]);assert.deepEqual(await read(),{revision:1,time_off_complete:false});
 await admin.query('UPDATE candidate_operations.schedule_input_reviews SET time_off_complete=true,reviewed_at=clock_timestamp() WHERE restaurant_id=$1',[scope]);
 await admin.query("UPDATE candidate_identity.restaurants SET operating_departments=ARRAY['Kitchen','Service','Patio'] WHERE id=$1",[scope]);assert.deepEqual(await read(),{revision:2,time_off_complete:false});
});
test('role remapping under existing people is held for an explicit migration',async()=>{
 const scope=await store();await member(scope,'Kitchen','Steward');await assert.rejects(admin.query("UPDATE candidate_identity.restaurants SET dish_position='Utility',dish_aliases=ARRAY['Utility'] WHERE id=$1",[scope]),e=>e.message==='store_role_configuration_in_use');
 assert.equal((await admin.query('SELECT dish_position FROM candidate_identity.restaurants WHERE id=$1',[scope])).rows[0].dish_position,'Steward');
});
test('configuration writes conflict with in-flight commands and succeed on whole-transaction retry',async()=>{
 const scope=await store(),first=new pg.Client({...connection,user:'candidate_owner'}),second=new pg.Client({...connection,user:'candidate_owner'});await first.connect();await second.connect();
 try{await first.query('BEGIN');await first.query('SELECT candidate_operations.lock_scope($1)',[scope]);await second.query('BEGIN');await assert.rejects(second.query("UPDATE candidate_identity.restaurants SET timezone='UTC' WHERE id=$1",[scope]),e=>e.code==='40001');await second.query('ROLLBACK');await first.query('COMMIT');
  await second.query('BEGIN');await second.query("UPDATE candidate_identity.restaurants SET timezone='UTC' WHERE id=$1",[scope]);await second.query('COMMIT');
  assert.equal((await admin.query('SELECT timezone FROM candidate_identity.restaurants WHERE id=$1',[scope])).rows[0].timezone,'UTC');
 }finally{await first.query('ROLLBACK');await second.query('ROLLBACK');await first.end();await second.end();}
});
test('runtime cannot read/write provisioning or call private label helpers',async()=>{
 for(const query of ['SELECT * FROM candidate_identity.restaurants',"SELECT candidate_operations.dish_only_label('fictional-a','Dishwasher')","UPDATE candidate_identity.restaurants SET timezone='UTC'"])
  await assert.rejects(db.transaction(c=>c.query(query,[])),e=>e.code==='42501');
});
test('effective candidate definitions contain no legacy policy labels and retain write coordination',async()=>{
 const functions=(await admin.query("SELECT p.proname,p.prosrc,p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='candidate_operations'")).rows;
 for(const f of functions){assert.doesNotMatch(f.prosrc,/'Dishwasher'|'BOH'|'FOH'|America\/New_York/,f.proname);assert.doesNotMatch(f.prosrc,/restaurants[^;]*FOR UPDATE/,f.proname);}
 assert.equal((await admin.query("SELECT to_regprocedure('candidate_operations.dish_only_label(text)') old")).rows[0].old,null);
});
