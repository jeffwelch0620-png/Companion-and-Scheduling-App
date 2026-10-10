import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {connection} from './test-config.mjs';
import {isConfigurationLabel,isConfigurationTimezone} from './configuration-label.mjs';
import whitespace from './configuration-whitespace.json' with {type:'json'};
import timezones from './store-timezones.json' with {type:'json'};
import {verifyMigrationManifest} from './migration-manifest.mjs';
const admin=new pg.Pool({...connection,user:'candidate_owner'});
after(()=>admin.end());
const storeSql=`INSERT INTO candidate_identity.restaurants(id,name,timezone,operating_departments,dish_department,dish_position,dish_aliases)
 VALUES($1,'Fictional guard store','UTC',ARRAY['Service','Kitchen','Patio'],'Kitchen','Steward',ARRAY['Steward','Steward PM'])`;
async function store(client=admin){const scope='guard-'+randomUUID();await client.query(storeSql,[scope]);return scope;}
async function member(scope,position='Cook',department='Kitchen',client=admin){
 const id=randomUUID(),person=randomUUID();await client.query('INSERT INTO candidate_identity.people VALUES($1,$2)',[person,'Fictional guard person']);
 await client.query('INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position) VALUES($1,$2,$3,$4,$5)',[id,person,scope,department,position]);return id;
}
const error=message=>e=>e.message===message;
const remove=(scope)=>admin.query("UPDATE candidate_identity.restaurants SET operating_departments=ARRAY['Kitchen','Patio'] WHERE id=$1",[scope]);
const changeZone=scope=>admin.query("UPDATE candidate_identity.restaurants SET timezone='Europe/London' WHERE id=$1",[scope]);
const read=scope=>admin.query('SELECT timezone,operating_departments,revision FROM candidate_identity.restaurants WHERE id=$1',[scope]).then(r=>r.rows[0]);
const values=(scope,owner,manager)=>[randomUUID(),scope,owner,manager];
const inserts={
 memberships:(s)=>member(s,'Cook','Service'),
 job_assignments:(s,m)=>admin.query("INSERT INTO candidate_identity.job_assignments(membership_id,department,job) VALUES($1,'Service','Cook')",[m]),
 shift_references:(s,m)=>admin.query("INSERT INTO candidate_operations.shift_references(id,restaurant_id,member_id,department,position,starts_at,ends_at,revision,published) VALUES($1,$2,$3,'Service','Cook','2050-01-01 12:00Z','2050-01-01 13:00Z',1,false)",[randomUUID(),s,m]),
 staffing_needs:(s,m)=>admin.query("INSERT INTO candidate_operations.staffing_needs(id,restaurant_id,owner_id,department,title,position,starts_at,ends_at,minimum,source,status) VALUES($1,$2,$3,'Service','Fictional need','Cook','2050-01-01 12:00Z','2050-01-01 13:00Z',1,'Fictional','draft')",[randomUUID(),s,m]),
 station_references:(s)=>admin.query("INSERT INTO candidate_operations.station_references(id,restaurant_id,department,title,revision,status,configured,all_job_members) VALUES($1,$2,'Service','Fictional station',1,'active',true,true)",[randomUUID(),s]),
 employee_goals:(s,m,n)=>admin.query("INSERT INTO candidate_operations.employee_goals(id,restaurant_id,owner_id,manager_id,department,title,definition,type,due,phase) VALUES($1,$2,$3,$4,'Service','Fictional goal','Fictional definition','development','2050-01-01 13:00Z','active')",values(s,m,n)),
 tasks:(s,m)=>admin.query("INSERT INTO candidate_operations.tasks(id,restaurant_id,assignee_id,department,title,detail,due,phase,revision) VALUES($1,$2,$3,'Service','Fictional task','Fictional detail','2050-01-01 13:00Z','open',1)",[randomUUID(),s,m]),
 standard_references:(s)=>admin.query(`INSERT INTO candidate_operations.standard_references(id,restaurant_id,department,title,zone,position,revision,version,verification,status,criteria) VALUES($1,$2,'Service','Fictional standard','Fictional zone','Cook',1,1,'manager','approved','["Fictional check"]')`,[randomUUID(),s]),
 leadership_references:(s,m)=>admin.query("INSERT INTO candidate_operations.leadership_references(id,restaurant_id,member_id,department,starts_at,ends_at) VALUES($1,$2,$3,'Service','2050-01-01 12:00Z','2050-01-01 13:00Z')",[randomUUID(),s,m]),
 availability_references:(s,m)=>admin.query(`INSERT INTO candidate_operations.availability_references(id,restaurant_id,member_id,department,revision,updated_at,status,data) VALUES($1,$2,$3,'Service',1,clock_timestamp(),'approved','{"status":"approved"}')`,[randomUUID(),s,m]),
 closes:async(s,m,n)=>{
  await inserts.shift_references(s,m);await inserts.standard_references(s);
  await admin.query("UPDATE candidate_operations.shift_references SET department='Kitchen' WHERE restaurant_id=$1",[s]);
  await admin.query("UPDATE candidate_operations.standard_references SET department='Kitchen' WHERE restaurant_id=$1",[s]);
  await admin.query(`INSERT INTO candidate_operations.closes(restaurant_id,shift_id,shift_revision,owner_id,department,standard_id,standard_revision,standard_snapshot,zone,manager_id,due)
   SELECT $1,s.id,1,$2,'Service',r.id,1,'{}','Fictional zone',$3,'2050-01-01 13:00Z' FROM candidate_operations.shift_references s JOIN candidate_operations.standard_references r ON r.restaurant_id=s.restaurant_id WHERE s.restaurant_id=$1`,[s,m,n]);
 },
 schedule_offers:async(s,m)=>{
  await inserts.shift_references(s,m);await admin.query("UPDATE candidate_operations.shift_references SET department='Kitchen' WHERE restaurant_id=$1",[s]);
  await admin.query(`INSERT INTO candidate_operations.schedule_offers(id,restaurant_id,owner_id,department,mode,shift_id,shift_revision,position,starts_at,ends_at,duties,note,status,revision,updated_at)
   SELECT $1,$2,$3,'Service','coverage',id,1,'Cook',starts_at,ends_at,'[]','Fictional offer','open',1,clock_timestamp() FROM candidate_operations.shift_references WHERE restaurant_id=$2`,[randomUUID(),s,m]);
 }
};
for(const [name,insert] of Object.entries(inserts))test(`department removal is blocked by ${name} in that store`,async()=>{
 const scope=await store(),owner=await member(scope),manager=await member(scope);await insert(scope,owner,manager);const before=await read(scope);
 await assert.rejects(remove(scope),error('store_department_in_use'));assert.deepEqual(await read(scope),before);
 const empty=await store();await remove(empty);assert.deepEqual((await read(empty)).operating_departments,['Kitchen','Patio']);
});
const dated={...Object.fromEntries(['shift_references','staffing_needs','employee_goals','tasks','leadership_references','availability_references'].map(k=>[k,inserts[k]])),
 dish_cycles:(s,m)=>admin.query("INSERT INTO candidate_operations.dish_cycles(id,restaurant_id,business_date,title,detail,due,created_by) VALUES($1,$2,'2050-01-01','Fictional cycle','Fictional detail','2050-01-01 13:00Z',$3)",[randomUUID(),s,m]),
 time_off_references:(s,m)=>admin.query("INSERT INTO candidate_operations.time_off_references(id,restaurant_id,member_id,department,starts_at,ends_at,status) VALUES($1,$2,$3,'Kitchen','2000-01-01 12:00Z','2000-01-01 13:00Z','declined')",[randomUUID(),s,m])
};
for(const [name,insert] of Object.entries(dated))test(`timezone changes are blocked by ${name}, including retained history`,async()=>{
 const scope=await store(),owner=await member(scope),manager=await member(scope);await insert(scope,owner,manager);const before=await read(scope);
 await assert.rejects(changeZone(scope),error('store_timezone_in_use'));assert.deepEqual(await read(scope),before);
});
test('empty-store timezone changes and unused-department removal remain available',async()=>{
 const scope=await store();await member(scope);await changeZone(scope);await remove(scope);
 assert.deepEqual(await read(scope),{timezone:'Europe/London',operating_departments:['Kitchen','Patio'],revision:2});
});
test('refused policy changes preserve scheduling review evidence as well as configuration',async()=>{
 const scope=await store(),m=await member(scope,'Cook','Service');await inserts.shift_references(scope,m);
 await admin.query('INSERT INTO candidate_operations.schedule_input_reviews(restaurant_id,time_off_complete,reviewed_at) VALUES($1,true,clock_timestamp())',[scope]);
 const review=()=>admin.query('SELECT * FROM candidate_operations.schedule_input_reviews WHERE restaurant_id=$1',[scope]).then(r=>r.rows[0]);const before=await review();
 await assert.rejects(remove(scope),error('store_department_in_use'));await assert.rejects(changeZone(scope),error('store_timezone_in_use'));
 assert.deepEqual(await review(),before);assert.equal((await read(scope)).revision,0);
});
test('primary checkout aliases are rejected on inserts and updates, while exact and unrelated titles remain valid',async()=>{
 const scope=await store();for(const label of ['steward','Steward PM','steward   PM',' Steward ','Steward\tPM'])await assert.rejects(member(scope,label),error('checkout_position_not_canonical'));
 const canonical=await member(scope,'Steward'),ordinary=await member(scope,'Dishwasher');assert.ok(canonical&&ordinary);
 await assert.rejects(admin.query("UPDATE candidate_identity.memberships SET position='steward' WHERE id=$1",[ordinary]),error('checkout_position_not_canonical'));
 assert.equal((await admin.query('SELECT position FROM candidate_identity.memberships WHERE id=$1',[ordinary])).rows[0].position,'Dishwasher');
 for(const label of ['dishwasher','Dish PM','  Dishwasher  '])await assert.rejects(member('fictional-a',label,'BOH'),error('checkout_position_not_canonical'));
 assert.ok(await member('fictional-a','Dishwasher','BOH'));
});
test('membership transfers validate the destination mapping atomically',async()=>{
 const source=await store(),destination=await store(),m=await member(source,'Dishwasher');
 await admin.query("UPDATE candidate_identity.restaurants SET dish_position='Dishwasher',dish_aliases=ARRAY['Dishwasher','Dish PM'] WHERE id=$1",[destination]);
 await admin.query("UPDATE candidate_identity.memberships SET position='dishwasher' WHERE id=$1",[m]);
 await assert.rejects(admin.query('UPDATE candidate_identity.memberships SET restaurant_id=$1 WHERE id=$2',[destination,m]),error('checkout_position_not_canonical'));
 assert.equal((await admin.query('SELECT restaurant_id FROM candidate_identity.memberships WHERE id=$1',[m])).rows[0].restaurant_id,source);
});
test('label contract agrees with PostgreSQL for every forbidden whitespace codepoint and Unicode lengths',async()=>{
 const labels=['Cook','Line Cook',' Line Cook','Line Cook ','','x'.repeat(100),'x'.repeat(101),'😀'.repeat(100),'😀'.repeat(101),...whitespace.flatMap(c=>['Cook'+String.fromCodePoint(c), 'Line'+String.fromCodePoint(c)+'Cook'])];
 for(const label of labels){const actual=(await admin.query('SELECT candidate_operations.configuration_label_valid($1) ok',[label])).rows[0].ok;assert.equal(actual,isConfigurationLabel(label),JSON.stringify(label));}
 const scope=await store();for(const fragment of ["dish_aliases=ARRAY['Steward',E'Extra\\t']","operating_departments=ARRAY['Kitchen',E'Service\\t']","dish_position=E'Steward\\t',dish_aliases=ARRAY[E'Steward\\t']"])
  await assert.rejects(admin.query('UPDATE candidate_identity.restaurants SET '+fragment+' WHERE id=$1',[scope]),error('invalid_store_configuration'));
 assert.equal((await read(scope)).revision,0);
});
test('reviewed timezone vocabulary is accepted by both PostgreSQL and the preview runtime',async()=>{
 assert.ok(timezones.length>500);assert.deepEqual(timezones,[...new Set(timezones)].sort());
 const source=(await admin.query("SELECT prosrc FROM pg_proc WHERE oid='candidate_operations.configuration_timezone_valid(text)'::regprocedure")).rows[0].prosrc;
 const sqlZones=[...source.match(/ANY\(ARRAY\[(.*?)\]\)/s)[1].matchAll(/'([^']+)'/g)].map(m=>m[1]);assert.deepEqual(sqlZones,timezones);
 const catalogue=new Set((await admin.query('SELECT name FROM pg_timezone_names')).rows.map(r=>r.name));
 for(const zone of timezones){assert.equal(catalogue.has(zone),true,zone);assert.equal(isConfigurationTimezone(zone),true,zone);}
 for(const zone of ['UTC','America/Chicago','Europe/London','Asia/Kolkata'])assert.equal((await admin.query('SELECT candidate_operations.configuration_timezone_valid($1) ok',[zone])).rows[0].ok,true);
 for(const zone of ['Invalid/Place',' UTC','UTC\t','posix/America/New_York']){assert.equal(isConfigurationTimezone(zone),false);await assert.rejects(admin.query(storeSql.replace("'UTC'",'$2'),['guard-'+randomUUID(),zone]),error('invalid_store_timezone'));}
});
test('new private validators are inaccessible to candidate_runtime',async()=>{
 for(const signature of ['configuration_label_valid(text)','configuration_timezone_valid(text)','configuration_department_in_use(text,text)','configuration_timezone_in_use(text)','validate_checkout_membership()'])
  assert.equal((await admin.query("SELECT has_function_privilege('candidate_runtime',$1,'EXECUTE') ok",['candidate_operations.'+signature])).rows[0].ok,false,signature);
});
test('041 to 042 upgrade rejects ambiguous historical roles and whitespace without partially installing guards',async()=>{
 const database=connection.database+'_cfg_'+randomUUID().slice(0,8),root=new pg.Client({...connection,database:'postgres',user:'candidate_owner'});await root.connect();
 try{assert.match(database,/^companion_candidate_[a-z0-9_]+$/);assert.ok(database.length<64);await root.query(`CREATE DATABASE "${database}" OWNER candidate_owner`);}finally{await root.end();}
 const client=new pg.Client({...connection,database,user:'candidate_owner'});await client.connect();
 try{
  await client.query(`GRANT CREATE ON DATABASE "${database}" TO candidate_schema_owner`);await client.query('GRANT USAGE,CREATE ON SCHEMA public TO candidate_schema_owner');
  for(const file of (await verifyMigrationManifest()).slice(0,41)){await client.query('SET ROLE candidate_schema_owner');await client.query(await readFile(new URL(file,import.meta.url),'utf8'));if(file.startsWith('001_'))await client.query(await readFile(new URL('test-fixture.sql',import.meta.url),'utf8'));}
  const scope=await store(client),m=await member(scope,'steward','Kitchen',client),migration=await readFile(new URL('042_store_configuration_safeguards.sql',import.meta.url),'utf8');
  await assert.rejects(client.query(migration),error('checkout_position_not_canonical'));await client.query('ROLLBACK');
  assert.equal((await client.query("SELECT to_regprocedure('candidate_operations.validate_checkout_membership()') guard")).rows[0].guard,null);
  await client.query("UPDATE candidate_identity.memberships SET position='Steward' WHERE id=$1",[m]);
  const whitespaceScope=await store(client);
  await client.query("UPDATE candidate_identity.restaurants SET dish_aliases=ARRAY['Steward',E'Extra\\t'] WHERE id=$1",[whitespaceScope]);
  await assert.rejects(client.query(migration),error('invalid_store_configuration'));await client.query('ROLLBACK');
  assert.equal((await client.query("SELECT to_regprocedure('candidate_operations.configuration_label_valid(text)') helper")).rows[0].helper,null);
  await client.query("UPDATE candidate_identity.restaurants SET dish_aliases=ARRAY['Steward','Steward PM'] WHERE id=$1",[whitespaceScope]);
  await client.query(migration);await assert.rejects(client.query("UPDATE candidate_identity.memberships SET position='Steward PM' WHERE id=$1",[m]),error('checkout_position_not_canonical'));
 }finally{await client.query('ROLLBACK');await client.end();}
});
