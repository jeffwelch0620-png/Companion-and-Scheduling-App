import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import pg from 'pg';
import {fictionalStoreInsert} from './store-fixture.mjs';import {connection} from './test-config.mjs';import {PostgresDatabase} from './postgres-driver.ts';import {executeTask} from './task-adapter.ts';import {createTaskHandler} from './task-http.ts';
import {loadScheduleScreen} from './schedule-screen-client.mjs';import {loadWeeklyPublicationReview,publicationInput} from './weekly-publication-client.mjs';
const admin=new pg.Pool({...connection,user:'candidate_owner'}),db=new PostgresDatabase({...connection,user:'candidate_runtime'});after(async()=>{await admin.end();await db.close();});
async function fixture() {
 const scope='publication-ui-'+randomUUID(),actors=[];await admin.query(fictionalStoreInsert,[scope,'Fictional publication UI']);
 for(const [area,caps] of [['BOH',[]],['BOH',['schedule.manage','schedule.publish','tasks.manage','close.confirm','location.manage']],['BOH',['schedule.publish']],['FOH',['schedule.publish']]]) {
  const person=randomUUID(),membershipId=randomUUID(),subject='fictional-'+randomUUID(),sessionId=randomUUID();
  await admin.query('INSERT INTO candidate_identity.people VALUES($1,$2)',[person,'Fictional person']);await admin.query('INSERT INTO candidate_identity.auth_links VALUES($1,$2)',[subject,person]);await admin.query("INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position) VALUES($1,$2,$3,$4,'Cook')",[membershipId,person,scope,area]);await admin.query("INSERT INTO candidate_identity.schedule_eligibility VALUES($1,'Cook','schedule-job',true)",[membershipId]);for(const cap of caps)await admin.query('INSERT INTO candidate_identity.membership_capabilities VALUES($1,$2,true)',[membershipId,cap]);await admin.query("INSERT INTO candidate_identity.sessions(id,subject,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",[sessionId,subject]);actors.push({subject,membershipId,sessionId});
 }
 await admin.query('INSERT INTO candidate_operations.schedule_input_reviews(restaurant_id,time_off_complete,reviewed_at) VALUES($1,true,clock_timestamp())',[scope]);
 const f={scope,worker:actors[0],manager:actors[1],publisher:actors[2],foreign:actors[3]};
 f.draft=await run(f,{action:'shift.save',input:{personId:f.worker.membershipId,position:'Cook',start:'2031-05-01T13:00:00Z',end:'2031-05-01T15:00:00Z'}});
 const standard=randomUUID();await admin.query("INSERT INTO candidate_operations.standard_references VALUES($1,$2,'BOH','Fictional close','Grill','Cook',1,1,'manager','approved','[\"Clean\"]')",[standard,scope]);await admin.query('INSERT INTO candidate_operations.shift_standard_links(shift_id,standard_id,restaurant_id) VALUES($1,$2,$3)',[f.draft.recordId,standard,scope]);await admin.query("INSERT INTO candidate_identity.station_clearances VALUES($1,$2,'Cook',true)",[f.worker.membershipId,scope]);
 f.close=await run(f,{action:'close.assign',input:{shiftId:f.draft.recordId,standardId:standard,managerId:f.manager.membershipId,due:'2031-05-01T14:30:00Z',note:'Fictional independent closing'}});
 return f;
}
const run=(f,c,a=f.manager)=>executeTask(db,a,f.scope,{requestId:randomUUID(),locationId:f.scope,...c});
const read=(f,a=f.publisher)=>db.transaction(async c=>(await c.query('SELECT candidate_operations.read_publication_review($1,$2,$3,$4) result',[a.subject,a.membershipId,f.scope,f.draft.recordId])).rows[0].result);
const certify=f=>admin.query("INSERT INTO candidate_operations.weekly_scope_reviews(restaurant_id,workspace_revision,evidence) SELECT id,revision,'Complete fictional UI fixture only' FROM candidate_identity.restaurants WHERE id=$1 ON CONFLICT(restaurant_id) DO UPDATE SET workspace_revision=excluded.workspace_revision",[f.scope]);
test('publication-only reader gets exact active closing snapshots without gaining raw closing access',async()=>{
 const f=await fixture(),r=await read(f);assert.deepEqual(r.closing.map(c=>({id:c.id,revision:c.revision})),[{id:f.close.recordId,revision:f.close.revision}]);assert.equal(r.closing[0].managerId,f.manager.membershipId);assert.equal(r.closing[0].standard.title,'Fictional close');assert.deepEqual(r.closingIssues,[]);
 await assert.rejects(db.transaction(c=>c.query('SELECT * FROM candidate_operations.closes',[])),e=>e.code==='42501');await assert.rejects(read(f,f.worker),e=>e.code==='42501');await assert.rejects(read(f,f.foreign),e=>e.code==='42501');
 await admin.query("UPDATE candidate_operations.closes SET phase='cancelled',revision=revision+1 WHERE id=$1",[f.close.recordId]);assert.deepEqual((await read(f)).closing,[]);
});
test('review shows source attestation at the current scope revision and never creates or renews it',async()=>{
 const f=await fixture();assert.equal((await read(f)).sourceReviewComplete,false);await certify(f);assert.equal((await read(f)).sourceReviewComplete,true);
 await run(f,{action:'shift.save',input:{personId:f.worker.membershipId,position:'Cook',start:'2031-05-02T13:00:00Z',end:'2031-05-02T15:00:00Z'}});assert.equal((await read(f)).sourceReviewComplete,false);
 const evidence=(await admin.query('SELECT workspace_revision FROM candidate_operations.weekly_scope_reviews WHERE restaurant_id=$1',[f.scope])).rows[0];assert.notEqual(evidence.workspace_revision,(await read(f)).workspaceRevision);
});
test('HTTP screen review publishes only selected drafts with exact closing revisions and replayable receipts',async()=>{
 const f=await fixture(),other=await run(f,{action:'shift.save',input:{personId:f.worker.membershipId,position:'Cook',start:'2031-05-02T13:00:00Z',end:'2031-05-02T15:00:00Z'}});await certify(f);
 const handler=createTaskHandler(db,async()=>({subject:f.publisher.subject,sessionId:f.publisher.sessionId}));
 const call=async(path,input)=>{const response=await handler(new Request('http://candidate.invalid/api/operations/'+f.scope+path,{method:input?'POST':'GET',headers:{Authorization:'Bearer fictional',...(input?{'Content-Type':'application/json'}:{})},...(input?{body:JSON.stringify(input)}:{})}));return {status:response.status,body:await response.json()};};
 const w=await loadScheduleScreen(call),r=await loadWeeklyPublicationReview(call,w,'2031-04-28',[f.draft.recordId],'2031-04-28T12:00:00Z');
 const command={requestId:randomUUID(),locationId:f.scope,action:'shift.publish-batch',input:publicationInput(r,{confirmed:true,note:'Fictional selected closing review'})};assert.equal((await call('/commands',command)).status,200);const replay=await call('/commands',command);assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);
 assert.equal((await admin.query('SELECT published FROM candidate_operations.shift_references WHERE id=$1',[other.recordId])).rows[0].published,false);
 assert.equal((await admin.query('SELECT shift_revision FROM candidate_operations.closes WHERE id=$1',[f.close.recordId])).rows[0].shift_revision,f.draft.revision+1);
});
test('publication review remains stable/read-only and notices publisher revocation through signed HTTP sessions',async()=>{
 const f=await fixture();const meta=(await admin.query("SELECT p.provolatile,p.proconfig,p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='candidate_operations' AND p.proname='read_publication_review'")).rows[0];assert.equal(meta.provolatile,'s');assert.deepEqual(meta.proconfig,['search_path=pg_catalog']);assert.doesNotMatch(meta.prosrc,/FOR\s+(?:UPDATE|SHARE)/i);
 const handler=createTaskHandler(db,async()=>({subject:f.publisher.subject,sessionId:f.publisher.sessionId})),url='http://candidate.invalid/api/operations/'+f.scope+'/publication-review/'+f.draft.recordId,request=()=>new Request(url,{headers:{Authorization:'Bearer fictional'}});assert.equal((await handler(request())).status,200);await admin.query("UPDATE candidate_identity.membership_capabilities SET active=false WHERE membership_id=$1 AND capability='schedule.publish'",[f.publisher.membershipId]);assert.equal((await handler(request())).status,403);await admin.query('UPDATE candidate_identity.sessions SET active=false WHERE id=$1',[f.publisher.sessionId]);assert.equal((await handler(request())).status,401);
});
