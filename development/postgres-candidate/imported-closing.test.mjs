import {fictionalStoreInsert} from './store-fixture.mjs';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { generateKeyPair, SignJWT } from 'jose';
import { connection } from './test-config.mjs';
import { rehearseReferenceImport } from './reference-import.mjs';
import { PostgresDatabase } from './postgres-driver.ts';
import { createTaskHandler, makeJwtVerifier } from './task-http.ts';
import { formCommand } from './form-command-adapter.mjs';
const admin = new pg.Pool({...connection,user:'candidate_owner',max:2});
const db = new PostgresDatabase({...connection,user:'candidate_runtime',max:3});
after(async()=>{await admin.end();await db.close();});
async function fixture() {
  const scope=`import-close-${randomUUID()}`;
  await admin.query(fictionalStoreInsert,[scope,'Fictional imported closing']);
  const actors=['worker','manager','verifier'].map(name=>({name,id:randomUUID(),person:randomUUID(),subject:`import-${randomUUID()}`,session:randomUUID()}));
  const shift=randomUUID(),standard=randomUUID();
  const snapshot={restaurantId:scope,members:actors.map(a=>({revision:2,active:true,member:{id:a.name,locationId:scope,name:`Fictional ${a.name}`,area:'BOH',position:a.name==='manager'?'Manager':'Cook',capabilities:[],qualifications:[]}})),
    records:[{id:'source-shift',locationId:scope,ownerId:'worker',area:'BOH',kind:'shift',revision:3,data:{personId:'worker',position:'Cook',start:'2031-05-01T09:00:00-04:00',end:'2031-05-01T17:00:00-04:00',published:true,cancelled:false}},
      {id:'source-standard',locationId:scope,ownerId:'manager',area:'BOH',kind:'standard',revision:4,data:{title:'Imported fictional close',zone:'Station',position:'Cook',criteria:['Station clean','Equipment safe'],version:7,status:'approved',verification:'senior-then-manager',history:[],guide:{purpose:'Full source retained'}}}],
    mappings:[...actors.map(a=>({kind:'member',sourceId:a.name,sourceRevision:2,restaurantId:scope,targetId:a.id,personId:a.person})),
      {kind:'shift',sourceId:'source-shift',sourceRevision:3,restaurantId:scope,targetId:shift},
      {kind:'standard',sourceId:'source-standard',sourceRevision:4,restaurantId:scope,targetId:standard}],
    shiftStandardLinks:[{shiftId:'source-shift',shiftRevision:3,standardId:'source-standard',standardRevision:4}]};
  const batch={snapshot,batchId:randomUUID(),expectedScopeRevision:0,reviewNote:'Fictional explicit link review',allow:'fictional-local-only'};
  return {scope,actors,shift,standard,batch};
}
test('imported explicit links are archived and replay once without adding clearance',async()=>{
  const f=await fixture(); assert.equal((await rehearseReferenceImport(f.batch)).shiftStandardLinks,1);
  assert.equal((await rehearseReferenceImport(f.batch)).replayed,true);
  assert.equal((await admin.query('SELECT count(*)::int n FROM candidate_operations.shift_standard_links WHERE restaurant_id=$1',[f.scope])).rows[0].n,1);
  assert.equal((await admin.query('SELECT count(*)::int n FROM candidate_identity.station_clearances WHERE restaurant_id=$1',[f.scope])).rows[0].n,0);
  assert.deepEqual((await admin.query('SELECT source_snapshot FROM candidate_operations.reference_import_receipts WHERE batch_id=$1',[f.batch.batchId])).rows[0].source_snapshot,f.batch.snapshot);
});
test('link insertion failure rolls back all new references and archive receipt',async()=>{
  const f=await fixture();
  await admin.query(`CREATE FUNCTION candidate_operations.fail_import_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fictional_link_failure'; END; $$`);
  await admin.query('CREATE TRIGGER fail_import_link BEFORE INSERT ON candidate_operations.shift_standard_links FOR EACH ROW EXECUTE FUNCTION candidate_operations.fail_import_link()');
  try {
    await assert.rejects(rehearseReferenceImport(f.batch),/fictional_link_failure/);
    const state=(await admin.query(`SELECT revision,
      (SELECT count(*)::int FROM candidate_identity.memberships WHERE restaurant_id=$1) members,
      (SELECT count(*)::int FROM candidate_operations.shift_references WHERE restaurant_id=$1) shifts,
      (SELECT count(*)::int FROM candidate_operations.standard_references WHERE restaurant_id=$1) standards,
      (SELECT count(*)::int FROM candidate_operations.reference_import_receipts WHERE restaurant_id=$1) receipts
      FROM candidate_identity.restaurants WHERE id=$1`,[f.scope])).rows[0];
    assert.deepEqual(state,{revision:0,members:0,shifts:0,standards:0,receipts:0});
    assert.equal((await admin.query('SELECT count(*)::int n FROM candidate_identity.people WHERE id=ANY($1::uuid[])',[f.actors.map(a=>a.person)])).rows[0].n,0);
  } finally {
    await admin.query('DROP TRIGGER fail_import_link ON candidate_operations.shift_standard_links');
    await admin.query('DROP FUNCTION candidate_operations.fail_import_link()');
  }
});
test('imported closing uses signed sessions and original form commands with independent checks and no shift release',async()=>{
  const f=await fixture(); await rehearseReferenceImport(f.batch);
  const keys=await generateKeyPair('ES256'),issuer='https://fictional-import.invalid/auth/v1';
  const handler=createTaskHandler(db,makeJwtVerifier({issuer,audience:'authenticated',getKey:async()=>keys.publicKey}));
  for(const a of f.actors) a.token=await new SignJWT({role:'authenticated',session_id:a.session}).setProtectedHeader({alg:'ES256'}).setSubject(a.subject).setIssuer(issuer).setAudience('authenticated').setIssuedAt().setExpirationTime('1h').sign(keys.privateKey);
  const [worker,manager,verifier]=f.actors;
  async function call(a,path,command) {
    const response=await handler(new Request(`https://candidate.invalid/api/operations/${f.scope}/${path}`,{method:command?'POST':'GET',headers:{Authorization:`Bearer ${a.token}`,...(command?{'Content-Type':'application/json'}:{})},...(command?{body:JSON.stringify(command)}:{})}));
    return {status:response.status,body:await response.json()};
  }
  const assignment=()=>formCommand('close.assign',{shiftId:f.shift,standardId:f.standard,managerId:manager.id,verifierId:verifier.id,due:'2031-05-01T17:00:00-04:00',note:'Fictional imported close'},null,f.scope);
  assert.equal((await call(manager,'commands',assignment())).status,401);
  // Separate fictional access setup; importer has no such authority.
  for(const a of f.actors) {
    await admin.query('INSERT INTO candidate_identity.auth_links(subject,person_id) VALUES($1,$2)',[a.subject,a.person]);
    await admin.query("INSERT INTO candidate_identity.sessions(id,subject,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",[a.session,a.subject]);
  }
  for(const cap of ['tasks.manage','close.confirm','location.manage']) await admin.query('INSERT INTO candidate_identity.membership_capabilities(membership_id,capability) VALUES($1,$2)',[manager.id,cap]);
  await admin.query("INSERT INTO candidate_identity.membership_capabilities(membership_id,capability) VALUES($1,'close.verify')",[verifier.id]);
  assert.equal((await call(manager,'commands',assignment())).status,403);
  for(const a of [worker,verifier]) await admin.query("INSERT INTO candidate_identity.station_clearances(member_id,restaurant_id,position) VALUES($1,$2,'Cook')",[a.id,f.scope]);
  const assigned=await call(manager,'commands',assignment()); assert.equal(assigned.status,200);
  const closeId=assigned.body.recordId;
  const detail=async a=>{const r=await call(a,`closes/${closeId}`);assert.equal(r.status,200);return r.body;};
  async function step(a,record,step) {return call(a,'commands',formCommand('close.transition',{step,note:'Fictional physical check',answers:[0,1]},record,f.scope));}
  const initial=await detail(worker); assert.equal(initial.data.standardRevision,4); assert.equal(initial.data.standard.version,7);
  assert.equal((await step(worker,initial,'ready')).status,200);
  const ready=await detail(worker); assert.equal(ready.data.phase,'verification');
  assert.equal((await step(worker,ready,'verify')).status,403);
  assert.equal((await step(manager,ready,'confirm')).status,409);
  assert.equal((await step(verifier,await detail(verifier),'verify')).status,200);
  const verified=await detail(manager); assert.equal(verified.data.phase,'manager-confirmation');
  assert.equal((await step(manager,verified,'confirm')).status,200);
  const done=await detail(worker); assert.equal(done.data.phase,'closed');
  assert.deepEqual(done.data.history.map(h=>h.action),['assigned','ready','verify','confirm']);
  assert.deepEqual(done.data.history[1].answers,[0,1]);
  const shift=(await admin.query('SELECT released_at,checkout_profile FROM candidate_operations.shift_references WHERE id=$1',[f.shift])).rows[0];
  assert.deepEqual(shift,{released_at:null,checkout_profile:'unreviewed'});
});
