// Runs the staged migration unchanged in real, disposable PostgreSQL (PGlite).
// No external database, application dependency change, or live identity is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {handleSharedStore} from '../.sites-runtime/shared/shared-store-service.mjs';

const migrationUrl=new URL('../supabase/migrations/202609300001_shared_manager_log.sql',import.meta.url);
const accessUpgradeUrl=new URL('../supabase/restaurant-access-upgrade.sql',import.meta.url);
const validationRoot=path.resolve(process.env.PGLITE_RUNTIME_ROOT??fileURLToPath(new URL('../.sites-runtime/shared-store-validation/',import.meta.url)));
const {PGlite}=await import(pathToFileURL(path.join(validationRoot,'node_modules/@electric-sql/pglite/dist/index.js')).href);
const at='2026-09-30T12:00:00.000Z';
const persons={
 alice:{person:'10000000-0000-4000-8000-000000000001',auth:'20000000-0000-4000-8000-000000000001',member:'fictional-alice',store:'berts',area:'BOH',role:'manager',caps:['tasks.manage']},
 bob:{person:'10000000-0000-4000-8000-000000000002',auth:'20000000-0000-4000-8000-000000000002',member:'fictional-bob',store:'berts',area:'BOH',role:'manager',caps:['tasks.manage']},
 foh:{person:'10000000-0000-4000-8000-000000000003',auth:'20000000-0000-4000-8000-000000000003',member:'fictional-foh',store:'berts',area:'FOH',role:'manager',caps:['tasks.manage']},
 foreign:{person:'10000000-0000-4000-8000-000000000004',auth:'20000000-0000-4000-8000-000000000004',member:'fictional-foreign',store:'papa',area:'BOH',role:'manager',caps:['tasks.manage']},
 staff:{person:'10000000-0000-4000-8000-000000000005',auth:'20000000-0000-4000-8000-000000000005',member:'fictional-staff',store:'berts',area:'BOH',role:'staff',caps:[]},
 owner:{person:'10000000-0000-4000-8000-000000000006',auth:'20000000-0000-4000-8000-000000000006',member:'fictional-owner',store:'berts',area:'combined',role:'owner',caps:['location.manage']},
 unmapped:{person:'10000000-0000-4000-8000-000000000007',auth:'20000000-0000-4000-8000-000000000007',member:null,store:'berts',area:'BOH',role:'manager',caps:[]}
};
const preservedTables=['jmax_app.restaurant_access','jmax_app.locations','jmax_app.memberships','jmax_app.records','jmax_app.record_history','jmax_app.command_receipts','jmax_app.audit_events','public.stores','public.people','public.store_roles'];
const rpcSql={
 memberships:'select public.jmax_shared_memberships($1::uuid) as result',
 workspace:'select public.jmax_shared_workspace($1::uuid,$2::text) as result',
 receipt:'select public.jmax_shared_receipt($1::uuid,$2::text,$3::text,$4::text) as result',
 commit:'select public.jmax_shared_commit($1::uuid,$2::text,$3::text,$4::integer,$5::integer,$6::text,$7::text,$8::text,$9::text,$10::jsonb,$11::timestamptz) as result'
};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function fixture(t,{persistent=false}={}){
 let dataDir;
 if(persistent){await fs.mkdir(validationRoot,{recursive:true});dataDir=await fs.mkdtemp(path.join(validationRoot,'pgdata-acceptance-'));}
 let db=new PGlite(dataDir);
 t.after(async()=>{await db.close();});
 await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create table auth.users(id uuid primary key);
  create table public.stores(id text primary key,name text not null,active boolean not null default true);
  create table public.people(id uuid primary key,full_name text not null,auth_user_id uuid unique references auth.users(id),active boolean not null default true);
  create table public.store_roles(person_id uuid references public.people(id),store_id text references public.stores(id),role text not null,primary key(person_id,store_id,role));
  insert into public.stores(id,name) values('berts','Fictional Bert fixture'),('papa','Fictional Papa fixture');
 `);
 const migration=await fs.readFile(migrationUrl,'utf8');
 try{await db.exec(migration)}catch(error){const compact=new Error(`Migration SQL ${error.code}: ${error.message}; position ${error.position??'unknown'}`);compact.code=error.code;throw compact;}
 await db.exec(await fs.readFile(accessUpgradeUrl,'utf8'));
 await db.exec("insert into jmax_app.locations(location_id,timezone) values('berts','America/New_York'),('papa','America/New_York')");
 for(const [name,p] of Object.entries(persons)){
  await db.query('insert into auth.users(id) values($1)',[p.auth]);
  await db.query('insert into public.people(id,full_name,auth_user_id) values($1,$2,$3)',[p.person,'Fictional '+name,p.auth]);
  await db.query('insert into public.store_roles(person_id,store_id,role) values($1,$2,$3)',[p.person,p.store,p.role]);
  if(p.member)await db.query('insert into jmax_app.memberships(id,person_id,location_id,role,area,position,capabilities) values($1,$2,$3,$4,$5,$6,$7)',[p.member,p.person,p.store,p.role,p.area,name==='staff'?'Cook':'Manager',p.caps]);
 }
 async function rpc(name,args,role='service_role'){
  assert.ok(['service_role','authenticated','anon'].includes(role));
  await db.exec('set role '+role);
  try{return (await db.query(rpcSql[name],args)).rows[0].result;}
  catch(error){delete error.query;delete error.params;throw error;}
  finally{await db.exec('reset role');}
 }
 const view=(actor='alice',store=persons[actor].store)=>rpc('workspace',[persons[actor].auth,store]);
 async function snapshot(){const state={};for(const table of preservedTables)state[table]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as rows from ${table} t`)).rows[0].rows;return state;}
 const commit=c=>rpc('commit',[c.auth,c.locationId,c.actorId,c.membershipRevision,c.workspaceRevision,c.requestId,c.fingerprint,c.action,c.recordId,JSON.stringify(c.records),c.at]);
 async function createCommand(actor='alice',{id='fictional-record-'+randomUUID(),area=persons[actor].area,store=persons[actor].store}={}){
  const state=await view(actor,store),p=persons[actor],history=[{actorId:p.member,action:'created',note:'Independent fictional entry',at}];
  const record={id,locationId:store,ownerId:p.member,area,kind:'managerlog',revision:1,updatedAt:at,data:{title:'Fictional shared prep handoff',detail:'Test record only',category:'Food and prep',priority:'routine',due:'2026-10-02T12:00:00.000Z',status:'open',acceptedBy:'',resolution:'',history}};
  const command={auth:p.auth,locationId:store,actorId:p.member,membershipRevision:state.membershipRevision,workspaceRevision:state.workspace.location.revision,requestId:randomUUID(),action:'managerlog.create',recordId:id,records:[record],at};
  return {...command,fingerprint:digest(command)};
 }
 async function noteCommand(actor,recordId,note='Independent peer note'){
  const state=await view(actor),record=structuredClone(state.workspace.records.find(r=>r.id===recordId));assert.ok(record,'Visible source record required for a note');
  const p=persons[actor],noteAt='2026-09-30T12:01:00.000Z';record.revision++;record.updatedAt=noteAt;record.data.history.push({actorId:p.member,action:'note',note,at:noteAt});
  const command={auth:p.auth,locationId:p.store,actorId:p.member,membershipRevision:state.membershipRevision,workspaceRevision:state.workspace.location.revision,requestId:randomUUID(),action:'managerlog.note',recordId,records:[record],at:noteAt};return {...command,fingerprint:digest(command)};
 }
 async function deniedUnchanged(action,code){const before=await snapshot();await assert.rejects(action,e=>{assert.equal(e.code,code,e.message);return true});assert.deepEqual(await snapshot(),before);}
 return {get db(){return db},rpc,view,snapshot,commit,createCommand,noteCommand,deniedUnchanged,migrationHash:createHash('sha256').update(migration).digest('hex'),dataDir,reopen:async()=>{await db.close();db=new PGlite(dataDir);await db.waitReady;}};
}

test('PostgreSQL applies staged SQL and access upgrade with all seven tables under RLS and only service RPC grants',async t=>{
 const f=await fixture(t);
 const tables=(await f.db.query("select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='jmax_app' and c.relkind='r' order by relname")).rows;
 assert.equal(tables.length,7);assert.ok(tables.every(r=>r.relrowsecurity));
 for(const role of ['anon','authenticated']){
  await assert.rejects(()=>f.rpc('workspace',[persons.alice.auth,'berts'],role),e=>e.code==='42501');
  await assert.rejects(()=>f.rpc('memberships',[persons.alice.auth],role),e=>e.code==='42501');
  for(const signature of ['public.jmax_shared_memberships(uuid)','public.jmax_shared_workspace(uuid,text)','public.jmax_shared_receipt(uuid,text,text,text)','public.jmax_shared_commit(uuid,text,text,integer,integer,text,text,text,text,jsonb,timestamptz)']){
   assert.equal((await f.db.query('select has_function_privilege($1,$2,\'EXECUTE\') as allowed',[role,signature])).rows[0].allowed,false);
   assert.equal((await f.db.query('select has_function_privilege(\'service_role\',$1,\'EXECUTE\') as allowed',[signature])).rows[0].allowed,true);
  }
 }
 for(const role of ['anon','authenticated','service_role']){
  const result=(await f.db.query("select has_schema_privilege($1,'jmax_app','USAGE') as schema_access,has_table_privilege($1,'jmax_app.records','SELECT') as table_read,has_function_privilege($1,'jmax_app.require_member(uuid,text)','EXECUTE') as helper_execute",[role])).rows[0];
  assert.deepEqual(result,{schema_access:false,table_read:false,helper_execute:false});
 }
 t.diagnostic(JSON.stringify({engine:(await f.db.query('select version() as version')).rows[0].version,migrationHash:f.migrationHash}));
});

test('PostgreSQL identity mapping lists only mapped permitted restaurant memberships',async t=>{
 const f=await fixture(t);
 assert.deepEqual((await f.rpc('memberships',[persons.alice.auth])).memberships.map(x=>x.locationId),['berts']);
 assert.deepEqual((await f.rpc('memberships',[persons.foreign.auth])).memberships.map(x=>x.locationId),['papa']);
 for(const actor of ['staff','unmapped']){assert.deepEqual((await f.rpc('memberships',[persons[actor].auth])).memberships,[]);await f.deniedUnchanged(()=>f.view(actor),'PT403');}
 await f.deniedUnchanged(()=>f.view('foreign','berts'),'PT403');
});

test('PostgreSQL extra store memberships do not grant group access; only two verified owner seats do',async t=>{
 const f=await fixture(t),p=persons.owner;
 await f.db.exec("insert into public.stores(id,name) values('rudds','Fictional Rudd fixture'),('comm','Fictional Commissary fixture'); insert into jmax_app.locations(location_id,timezone) values('rudds','America/New_York'),('comm','America/New_York')");
 for(const store of ['rudds','papa','comm']){
  await f.db.query('insert into public.store_roles(person_id,store_id,role) values($1,$2,\'owner\')',[p.person,store]);
  await f.db.query('insert into jmax_app.memberships(id,person_id,location_id,role,area,position,capabilities) values($1,$2,$3,\'owner\',\'combined\',\'Owner\',ARRAY[\'location.manage\'])',['owner-'+store,p.person,store]);
 }
 await f.deniedUnchanged(()=>f.rpc('memberships',[p.auth]),'PT403');
 for(const store of ['berts','rudds','papa','comm'])await f.deniedUnchanged(()=>f.view('owner',store),'PT403');
 await f.db.query("insert into jmax_app.restaurant_access(auth_user_id,kind,home_location_id) values($1,'restaurant','berts')",[p.auth]);
 assert.deepEqual((await f.rpc('memberships',[p.auth])).memberships.map(m=>m.locationId),['berts']);
 await f.view('owner','berts');await f.deniedUnchanged(()=>f.view('owner','papa'),'PT403');
 await f.db.query("update jmax_app.restaurant_access set kind='jay',revision=revision+1 where auth_user_id=$1",[p.auth]);
 assert.deepEqual(new Set((await f.rpc('memberships',[p.auth])).memberships.map(m=>m.locationId)),new Set(['berts','rudds','papa','comm']));
 for(const store of ['berts','rudds','papa','comm'])await f.view('owner',store);
 const savedCommand=await f.createCommand('owner'),saved=await f.commit(savedCommand),pending=await f.createCommand('owner');
 assert.equal(saved.recordId,savedCommand.recordId);
 await f.db.query("insert into jmax_app.restaurant_access(auth_user_id,kind,home_location_id) values($1,'rudd','berts')",[persons.alice.auth]);
 await assert.rejects(()=>f.db.query("insert into jmax_app.restaurant_access(auth_user_id,kind,home_location_id) values($1,'jay','berts')",[persons.bob.auth]),e=>e.code==='23505');
 await assert.rejects(()=>f.db.query("insert into jmax_app.restaurant_access(auth_user_id,kind,home_location_id) values($1,'rudd','berts')",[persons.foh.auth]),e=>e.code==='23505');
 await f.db.query("update jmax_app.restaurant_access set kind='commissary',home_location_id='comm',revision=revision+1 where auth_user_id=$1",[p.auth]);
 assert.deepEqual((await f.rpc('memberships',[p.auth])).memberships.map(m=>m.locationId),['comm']);
 await f.view('owner','comm');
 for(const store of ['berts','rudds','papa'])await f.deniedUnchanged(()=>f.view('owner',store),'PT403');
 await f.deniedUnchanged(()=>f.commit(pending),'PT403');
 await f.deniedUnchanged(()=>f.rpc('receipt',[p.auth,'berts',savedCommand.requestId,savedCommand.fingerprint]),'PT403');
});

test('PostgreSQL shared record reopens for a second BOH account and remains outside FOH and other restaurant views',async t=>{
 const f=await fixture(t),command=await f.createCommand(),saved=await f.commit(command);
 assert.deepEqual(saved,{recordId:command.recordId,revision:1,workspaceRevision:2});
 const bob=await f.view('bob');assert.equal(bob.workspace.records.length,1);assert.deepEqual(bob.workspace.records[0],command.records[0]);assert.equal(bob.workspace.me.id,persons.bob.member);
 assert.equal((await f.view('foh')).workspace.records.length,0);assert.equal((await f.view('foreign')).workspace.records.length,0);
 const wrongDepartment={...command,auth:persons.foh.auth,actorId:persons.foh.member,requestId:randomUUID(),workspaceRevision:2};await f.deniedUnchanged(()=>f.commit(wrongDepartment),'PT403');
 const wrongRestaurant={...command,auth:persons.foreign.auth,actorId:persons.foreign.member,requestId:randomUUID(),workspaceRevision:2};await f.deniedUnchanged(()=>f.commit(wrongRestaurant),'PT403');
});

test('PostgreSQL second manager appends a note and exact retries preserve one history receipt and audit result',async t=>{
 const f=await fixture(t),created=await f.createCommand();await f.commit(created);const note=await f.noteCommand('bob',created.recordId),saved=await f.commit(note),before=await f.snapshot();
 assert.deepEqual(await f.commit(note),saved);assert.deepEqual(await f.snapshot(),before);
 assert.deepEqual(await f.rpc('receipt',[persons.bob.auth,'berts',note.requestId,note.fingerprint]),saved);
 const record=(await f.view()).workspace.records[0];assert.equal(record.revision,2);assert.equal(record.data.history.length,2);assert.equal(record.data.history[1].actorId,persons.bob.member);
 assert.equal(before['jmax_app.record_history'].length,2);assert.equal(before['jmax_app.command_receipts'].length,2);assert.equal(before['jmax_app.audit_events'].length,2);
 await f.deniedUnchanged(()=>f.commit({...note,fingerprint:'a'.repeat(64)}),'PT409');
});

test('PostgreSQL stale workspace and record revisions fail with every saved row unchanged',async t=>{
 const f=await fixture(t),first=await f.createCommand(),stale=await f.createCommand('bob');await f.commit(first);
 await f.deniedUnchanged(()=>f.commit(stale),'PT409');
 const note=await f.noteCommand('bob',first.recordId);note.records[0].revision=1;
 await f.deniedUnchanged(()=>f.commit(note),'PT409');
});

test('PostgreSQL mapping revisions and inactive membership revoke a previously prepared save',async t=>{
 const f=await fixture(t),command=await f.createCommand();
 await f.db.query("update jmax_app.memberships set qualifications=array['changed'] where id=$1",[persons.alice.member]);
 assert.equal((await f.view()).membershipRevision,2);await f.deniedUnchanged(()=>f.commit(command),'PT409');
 const fresh=await f.createCommand();await f.db.query('update jmax_app.memberships set active=false where id=$1',[persons.alice.member]);
 await f.deniedUnchanged(()=>f.commit(fresh),'PT403');await f.deniedUnchanged(()=>f.view(),'PT403');
});

test('PostgreSQL canonical person or store revocation and removed role immediately deny access',async t=>{
 const f=await fixture(t),command=await f.createCommand();await f.commit(command);
 await f.db.query('update public.people set active=false where id=$1',[persons.bob.person]);await f.deniedUnchanged(()=>f.view('bob'),'PT403');
 await f.db.query('update public.people set active=true where id=$1',[persons.bob.person]);
 await f.db.query('delete from public.store_roles where person_id=$1 and store_id=$2',[persons.bob.person,'berts']);await f.deniedUnchanged(()=>f.view('bob'),'PT403');
 await f.db.exec("update public.stores set active=false where id='berts'");await f.deniedUnchanged(()=>f.view(),'PT403');
});

test('PostgreSQL owner role removal revokes access while retaining the already saved record history',async t=>{
 const f=await fixture(t),command=await f.createCommand();await f.commit(command);
 const before=(await f.snapshot())['jmax_app.record_history'];
 await f.db.query('delete from public.store_roles where person_id=$1 and store_id=$2',[persons.alice.person,'berts']);
 await f.deniedUnchanged(()=>f.view(),'PT403');assert.deepEqual((await f.snapshot())['jmax_app.record_history'],before);assert.equal((await f.view('bob')).workspace.records[0].id,command.recordId);
});

test('PostgreSQL timezone changes invalidate prepared saves and invalid timezone configuration is rejected',async t=>{
 const f=await fixture(t),command=await f.createCommand();
 await f.db.exec("update jmax_app.locations set timezone='America/Chicago' where location_id='berts'");assert.equal((await f.view()).workspace.location.revision,2);
 await f.deniedUnchanged(()=>f.commit(command),'PT409');
 await f.deniedUnchanged(()=>f.db.exec("update jmax_app.locations set timezone='Invalid/Fictional' where location_id='berts'"),'PT400');
});

test('PostgreSQL forged actor, altered history, and replacing entry fields through a note are denied atomically',async t=>{
 const f=await fixture(t),command=await f.createCommand();await f.deniedUnchanged(()=>f.commit({...command,actorId:persons.bob.member}),'PT403');await f.commit(command);
 const note=await f.noteCommand('bob',command.recordId),altered=structuredClone(note);altered.records[0].data.title='Changed without supported action';
 await f.deniedUnchanged(()=>f.commit(altered),'PT400');
 const history=structuredClone(note);history.records[0].data.history[0].note='Rewrote original evidence';await f.deniedUnchanged(()=>f.commit(history),'PT400');
 const actor=structuredClone(note);actor.records[0].data.history.at(-1).actorId=persons.alice.member;await f.deniedUnchanged(()=>f.commit(actor),'PT400');
});

test('PostgreSQL malformed save payloads receive bounded client errors without persisted effects',async t=>{
 const f=await fixture(t),base=await f.createCommand();
 for(const patch of [{records:[]},{records:{}},{requestId:null},{fingerprint:'bad'},{at:null}])await f.deniedUnchanged(()=>f.commit({...base,...patch}),'PT400');
 const badRevision=structuredClone(base);badRevision.records[0].revision='not-a-number';await f.deniedUnchanged(()=>f.commit(badRevision),'PT400');
 const missingId=structuredClone(base);missingId.recordId=null;missingId.records[0].id=null;await f.deniedUnchanged(()=>f.commit(missingId),'PT400');
});

test('PostgreSQL a failure at final audit insert rolls back record history receipt and workspace revision together',async t=>{
 const f=await fixture(t),command=await f.createCommand();
 await f.db.exec("create function jmax_app.test_fail_audit() returns trigger language plpgsql as $$begin raise exception 'Fictional audit write failure' using errcode='P0001'; end$$; create trigger test_fail_audit before insert on jmax_app.audit_events for each row execute function jmax_app.test_fail_audit();");
 await f.deniedUnchanged(()=>f.commit(command),'P0001');
 await f.db.exec('drop trigger test_fail_audit on jmax_app.audit_events; drop function jmax_app.test_fail_audit()');
 const saved=await f.commit(command);assert.equal(saved.revision,1);assert.equal((await f.snapshot())['jmax_app.record_history'].length,1);
});

test('PostgreSQL filesystem persistence retains the shared record and receipt across engine close and reopen',async t=>{
 const f=await fixture(t,{persistent:true}),command=await f.createCommand(),saved=await f.commit(command),before=await f.snapshot();
 await f.reopen();assert.deepEqual(await f.snapshot(),before);assert.equal((await f.view('bob')).workspace.records[0].id,command.recordId);
 assert.deepEqual(await f.commit(command),saved);assert.deepEqual(await f.snapshot(),before);
 t.diagnostic('Disposable filesystem database reopened successfully: '+f.dataDir);
});

// Synthetic transport only replaces Supabase's network hop. Every persistence RPC
// below executes the exact migrated PostgreSQL function under service_role.
async function handlerFixture(t,options={}){
 const f=await fixture(t,options),calls=[],bindings={SUPABASE_URL:'https://shared.example.test',SUPABASE_ANON_KEY:'fictional-public-key',SUPABASE_SERVICE_ROLE_KEY:'fictional-service-key'};
 const tokens=Object.fromEntries(Object.keys(persons).map(actor=>['fictional-token-for-'+actor,actor]));
 let beforeCommit=null;
 const fetcher=async(url,init={})=>{
  const parsed=new URL(url),headers=new Headers(init.headers);assert.equal(parsed.origin,bindings.SUPABASE_URL);calls.push(parsed.pathname);
  if(parsed.pathname==='/auth/v1/user'){
   assert.equal(headers.get('apikey'),bindings.SUPABASE_ANON_KEY);
   const actor=tokens[(headers.get('Authorization')??'').replace(/^Bearer /,'')];
   return actor?Response.json({id:persons[actor].auth,email:actor+'@example.test',is_anonymous:false}):Response.json({message:'Fictional invalid account'},{status:401});
  }
  assert.equal(headers.get('apikey'),bindings.SUPABASE_SERVICE_ROLE_KEY);assert.equal(headers.get('Authorization'),'Bearer '+bindings.SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(init.method,'POST');const args=JSON.parse(init.body),name=parsed.pathname.replace('/rest/v1/rpc/jmax_shared_','');assert.ok(Object.hasOwn(rpcSql,name),'Only known local RPCs are supported');
  const params=name==='memberships'?[args.p_auth_user_id]:name==='workspace'?[args.p_auth_user_id,args.p_location_id]:name==='receipt'?[args.p_auth_user_id,args.p_location_id,args.p_request_id,args.p_fingerprint]:[args.p_auth_user_id,args.p_location_id,args.p_actor_id,args.p_membership_revision,args.p_workspace_revision,args.p_request_id,args.p_fingerprint,args.p_action,args.p_record_id,JSON.stringify(args.p_records),args.p_at];
  if(name==='commit'&&beforeCommit){const hook=beforeCommit;beforeCommit=null;await hook(args);}
  try{return Response.json(await f.rpc(name,params))}catch(error){const status=/^PT[0-9]{3}$/.test(error.code)?Number(error.code.slice(2)):500;return Response.json({code:error.code,message:error.message},{status});}
 };
 async function request(actor,command,store=persons[actor]?.store??'berts'){
  const headers={Authorization:'Bearer fictional-token-for-'+actor,...(command?{Origin:'https://app.example.test','Content-Type':'application/json'}:{})};
  const response=await handleSharedStore(new Request('https://app.example.test/api/shared-store'+(command?'':'?locationId='+store),{headers,...(command?{method:'POST',body:JSON.stringify(command)}:{})}),bindings,fetcher);
  return {status:response.status,body:await response.json()};
 }
 const create=()=>({requestId:randomUUID(),locationId:'berts',action:'managerlog.create',input:{department:'BOH',ownerId:persons.alice.member,category:'Food and prep',priority:'routine',title:'Fictional end to end record',detail:'Independent app handler through actual PostgreSQL',due:'2026-10-02T12:00:00.000Z'}});
 return {...f,request,create,calls,setBeforeCommit:hook=>{beforeCommit=hook}};
}

test('actual app handler plus PostgreSQL saves reopens from second account notes and preserves exact retry',async t=>{
 const f=await handlerFixture(t),command=f.create(),created=await f.request('alice',command);assert.equal(created.status,200,JSON.stringify(created.body));
 const other=await f.request('bob');assert.equal(other.status,200);assert.equal(other.body.records[0].id,created.body.recordId);assert.equal(other.body.me.id,persons.bob.member);
 const note={requestId:randomUUID(),locationId:'berts',action:'managerlog.note',recordId:created.body.recordId,expectedRevision:1,input:{note:'Fictional second account acknowledged the same record'}};
 const saved=await f.request('bob',note);assert.equal(saved.status,200,JSON.stringify(saved.body));const before=await f.snapshot();
 assert.deepEqual(await f.request('bob',note),saved);assert.deepEqual(await f.snapshot(),before);
 const original=await f.request('alice');assert.equal(original.body.records[0].revision,2);assert.equal(original.body.records[0].data.history.at(-1).actorId,persons.bob.member);
 assert.equal((await f.request('foh')).body.records.length,0);assert.equal((await f.request('foreign',undefined,'berts')).status,403);assert.equal((await f.request('staff')).status,403);
 assert.ok(f.calls.includes('/auth/v1/user'));assert.ok(f.calls.includes('/rest/v1/rpc/jmax_shared_commit'));
});

test('actual app handler plus PostgreSQL stale revision and midrequest membership revocation leave no new saved evidence',async t=>{
 const f=await handlerFixture(t),created=await f.request('alice',f.create());assert.equal(created.status,200,JSON.stringify(created.body));
 const note={requestId:randomUUID(),locationId:'berts',action:'managerlog.note',recordId:created.body.recordId,expectedRevision:1,input:{note:'First valid note'}};
 assert.equal((await f.request('bob',note)).status,200);let before=await f.snapshot();
 const stale=await f.request('alice',{...note,requestId:randomUUID()});assert.equal(stale.status,409);assert.deepEqual(await f.snapshot(),before);
 let afterRevocation;
 f.setBeforeCommit(async()=>{await f.db.query('update jmax_app.memberships set active=false where id=$1',[persons.bob.member]);afterRevocation=await f.snapshot();});
 const revoked=await f.request('bob',{...note,requestId:randomUUID(),expectedRevision:2});assert.equal(revoked.status,403,JSON.stringify(revoked.body));assert.deepEqual(await f.snapshot(),afterRevocation);
});

test('actual app handler plus PostgreSQL final audit failure gives uncertain-save response and same request succeeds once after repair',async t=>{
 const f=await handlerFixture(t),command=f.create();
 await f.db.exec("create function jmax_app.test_handler_fail_audit() returns trigger language plpgsql as $$begin raise exception 'Fictional audit failure' using errcode='P0001'; end$$; create trigger test_handler_fail_audit before insert on jmax_app.audit_events for each row execute function jmax_app.test_handler_fail_audit();");
 const before=await f.snapshot(),failed=await f.request('alice',command);assert.equal(failed.status,503);assert.deepEqual(await f.snapshot(),before);
 await f.db.exec('drop trigger test_handler_fail_audit on jmax_app.audit_events; drop function jmax_app.test_handler_fail_audit()');
 const saved=await f.request('alice',command);assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal((await f.snapshot())['jmax_app.command_receipts'].length,1);
});
