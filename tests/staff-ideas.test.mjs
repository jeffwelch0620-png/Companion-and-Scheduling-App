import test from 'node:test';import assert from 'node:assert/strict';
import {fixture,ok} from './maintenance-meter-fixture.mjs';
import {applyCommand,publicWorkspace} from '../.sites-runtime/shared/domain.mjs';
import {completedBefore} from '../.sites-runtime/shared/record-history.mjs';
import {availableModules} from '../.sites-runtime/shared/operations-home.mjs';
const idea={title:'Fictional label location',idea:'DEMO PRIVATE IDEA — place labels near the test station',benefit:'Fictional time saved',shareConfirmed:true};
const assignment={managerId:'manager',dueDate:'2099-01-01',note:'Fictional review assignment',accepted:true};
const response={outcome:'implemented',note:'Fictional label holder checked in test station',evidence:'DEMO source TEST-IDEA-1',confirmed:true};
const submit=async f=>ok(await f.call('worker','staffidea.submit',idea));
const assigned=async f=>{const r=await submit(f);return ok(await f.call('manager','staffidea.assign',assignment,r));};

test('named ideas retain immutable author and restaurant; peers and other departments cannot read or mutate',async t=>{
 const f=await fixture(t);await f.db.prepare("INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES('peer','peer@example.test','peer-identity','a','Peer','BOH','Cook','[]','[]'),('foh','foh@example.test','foh-identity','a','FOH manager','FOH','Manager','[\"tasks.manage\"]','[]')").run();
 const r=await submit(f);for(const who of ['worker','manager','othermanager','owner'])assert.ok((await f.view(who)).records.some(x=>x.id===r.recordId));
 for(const who of ['peer','foh','dish','schedule']){assert.equal((await f.view(who)).records.some(x=>x.id===r.recordId),false);assert.notEqual((await f.call(who,'staffidea.note',{note:'Attempt'},r)).status,200);}
 assert.equal((await f.request('foreign','/api/workspace?locationId=a')).status,403);
 const d=await f.saved(r);assert.equal(d.ownerId,'worker');assert.equal(d.locationId,'a');assert.equal(d.data.employeeName,'worker');assert.equal(d.data.idea,idea.idea);assert.equal((await f.view()).records.some(x=>x.kind==='message'),false);
});
test('submission requires deliberate named sharing and rejects malformed or oversized content',async t=>{
 const f=await fixture(t);for(const patch of [{shareConfirmed:false},{title:''},{idea:''},{idea:'x'.repeat(4001)},{benefit:3}])assert.equal((await f.call('worker','staffidea.submit',{...idea,...patch})).status,400);
 for(const who of ['dish','schedule'])assert.equal((await f.call(who,'staffidea.submit',idea)).status,403);
 const r=await submit(f);assert.equal((await f.call('worker','staffidea.submit',idea,r)).status,400);assert.equal((await f.call('worker','staffidea.correct',{title:'New'},r)).status,400);
});
test('independent assignment requires current department reviewer, explicit date and self-claim or owner routing',async t=>{
 const f=await fixture(t);let r=await submit(f);
 for(const who of ['worker','dish','schedule'])assert.equal((await f.call(who,'staffidea.assign',assignment,r)).status,403);
 assert.equal((await f.call('manager','staffidea.assign',{...assignment,managerId:'othermanager'},r)).status,403);
 for(const patch of [{managerId:'worker'},{managerId:'foreign'},{dueDate:'2026-02-30'},{dueDate:'2000-01-01'},{accepted:false}])assert.notEqual((await f.call('owner','staffidea.assign',{...assignment,...patch},r)).status,200);
 r=ok(await f.call('manager','staffidea.assign',assignment,r));assert.equal((await f.saved(r)).data.status,'reviewing');assert.equal((await f.saved(r)).ownerId,'worker');
 r=ok(await f.call('owner','staffidea.assign',{...assignment,managerId:'othermanager'},r));assert.equal((await f.saved(r)).data.managerId,'othermanager');
 const own=ok(await f.call('owner','staffidea.submit',idea));assert.equal((await f.call('owner','staffidea.assign',assignment,own)).status,403);
});
test('responses need current assigned reviewer and evidence; follow-up remains open and does not claim delivered notifications',async t=>{
 const f=await fixture(t);let r=await assigned(f);
 for(const who of ['worker','owner','othermanager'])assert.equal((await f.call(who,'staffidea.respond',response,r)).status,403);
 for(const patch of [{evidence:''},{confirmed:false},{outcome:'approved'},{note:''},{outcome:'follow-up',dueDate:''}])assert.equal((await f.call('manager','staffidea.respond',{...response,...patch},r)).status,400);
 r=ok(await f.call('manager','staffidea.respond',{...response,outcome:'follow-up',evidence:'',dueDate:'2099-01-02'},r));let d=await f.saved(r);assert.equal(d.data.status,'reviewing');assert.equal(d.data.responses[0].readAt,null);
 r=ok(await f.call('manager','staffidea.respond',response,r));d=await f.saved(r);assert.equal(d.data.status,'closed');assert.equal(d.data.responses.length,2);assert.equal(d.data.idea,idea.idea);assert.equal((await f.view()).records.some(x=>x.kind==='message'),false);
});
test('read receipt is only the author and exact latest response, separate from approval or agreement',async t=>{
 const f=await fixture(t);let r=await assigned(f);r=ok(await f.call('manager','staffidea.respond',response,r));let d=await f.saved(r),input={responseId:d.data.responses[0].id,confirmed:true};
 for(const who of ['manager','owner'])assert.equal((await f.call(who,'staffidea.read',input,r)).status,403);
 assert.equal((await f.call('worker','staffidea.read',{...input,responseId:'stale'},r)).status,409);assert.equal((await f.call('worker','staffidea.read',{...input,confirmed:false},r)).status,400);
 assert.equal(completedBefore({...d,updatedAt:'2026-01-01T00:00:00Z'},'2026-08-01'),false);
 r=ok(await f.call('worker','staffidea.read',input,r));d=await f.saved(r);assert.ok(d.data.responses[0].readAt);assert.match(d.data.history.at(-1).note,/not agreement/);assert.equal(completedBefore({...d,updatedAt:'2026-01-01T00:00:00Z'},'2026-08-01'),true);
 assert.equal((await f.call('worker','staffidea.read',input,r)).status,409);
});
test('clarification and reopen preserve original submission and previous response/read receipts',async t=>{
 const f=await fixture(t);let r=await assigned(f);assert.equal((await f.call('othermanager','staffidea.note',{note:'Not my assignment'},r)).status,403);
 r=ok(await f.call('worker','staffidea.note',{note:'Fictional clarification'},r));r=ok(await f.call('manager','staffidea.respond',{...response,outcome:'deferred',evidence:''},r));let d=await f.saved(r);
 r=ok(await f.call('worker','staffidea.read',{responseId:d.data.responses[0].id,confirmed:true},r));assert.equal((await f.call('manager','staffidea.reopen',{note:'Again'},r)).status,403);
 r=ok(await f.call('worker','staffidea.reopen',{note:'Fictional new information'},r));d=await f.saved(r);assert.equal(d.data.status,'submitted');assert.equal(d.data.managerId,'');assert.ok(d.data.responses[0].readAt);assert.equal(d.data.idea,idea.idea);assert.equal(d.data.history.some(x=>x.note==='Fictional clarification'),true);
});
test('assignment revocation races and stale record saves reject without retaining wrong reviewer',async t=>{
 const f=await fixture(t);let r=await submit(f);let batches=0;
 const binding={withSession:()=>({prepare:(...a)=>f.db.prepare(...a),batch:async statements=>{if(++batches===2)await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='manager'").run();return f.db.batch(statements);}})};
 assert.equal((await f.call('owner','staffidea.assign',assignment,r,{},binding)).status,409);assert.equal((await f.saved(r)).data.managerId,'');
 r=ok(await f.call('owner','staffidea.assign',{...assignment,managerId:'othermanager'},r));await f.db.prepare("UPDATE memberships SET capabilities='[]',revision=revision+1 WHERE id='othermanager'").run();assert.notEqual((await f.call('othermanager','staffidea.respond',response,r)).status,200);
 r=ok(await f.call('owner','staffidea.assign',{...assignment,managerId:'owner'},r));assert.equal((await f.saved(r)).data.managerId,'owner');
});
test('idempotent submission/response and rollback preserve one response and reasoned history',async t=>{
 const f=await fixture(t),extra={requestId:'idea-once'};let r=ok(await f.call('worker','staffidea.submit',idea,undefined,extra));assert.deepEqual(ok(await f.call('worker','staffidea.submit',idea,undefined,extra)),r);assert.equal((await f.call('worker','staffidea.submit',{...idea,title:'Different'},undefined,extra)).status,409);
 r=ok(await f.call('manager','staffidea.assign',assignment,r));await f.db.prepare("CREATE TRIGGER fail_idea BEFORE INSERT ON command_receipts WHEN NEW.request_id='idea-fail' BEGIN SELECT RAISE(ABORT,'fixture rollback'); END").run();assert.equal((await f.call('manager','staffidea.respond',response,r,{requestId:'idea-fail'})).status,503);assert.equal((await f.saved(r)).data.responses.length,0);
 const old=r;r=ok(await f.call('manager','staffidea.respond',response,r,{requestId:'response-once'}));assert.deepEqual(ok(await f.call('manager','staffidea.respond',response,old,{requestId:'response-once'})),r);assert.equal((await f.saved(r)).data.responses.length,1);
});
test('filed acknowledged ideas preserve scope and original outcomes; employees can read but owner restores',async t=>{
 const f=await fixture(t);let r=await assigned(f);r=ok(await f.call('manager','staffidea.respond',response,r));let d=await f.saved(r);r=ok(await f.call('worker','staffidea.read',{responseId:d.data.responses[0].id,confirmed:true},r));
 await f.db.prepare("UPDATE records SET updated_at='2026-01-01T00:00:00Z' WHERE id=?").bind(r.recordId).run();const preview=ok(await f.request('owner','/api/history?locationId=a&preview=1&before=2026-08-01'));
 ok(await f.request('owner','/api/history',{locationId:'a',requestId:'file-idea',action:'archive',confirmed:true,before:'2026-08-01',workspaceRevision:preview.workspaceRevision,records:preview.records.map(({id,revision})=>({id,revision}))}));
 assert.equal(ok(await f.request('worker','/api/history?locationId=a&kind=staffidea')).items.length,1);assert.equal((await f.request('foreign','/api/history?locationId=a&recordId='+r.recordId)).status,403);
 assert.match(JSON.stringify(ok(await f.request('worker','/api/history?locationId=a&recordId='+r.recordId))),/TEST-IDEA-1/);assert.equal((await f.request('worker','/api/history?locationId=a&restore='+r.recordId)).status,403);
 const restore=ok(await f.request('owner','/api/history?locationId=a&restore='+r.recordId));ok(await f.request('owner','/api/history',{locationId:'a',requestId:'restore-idea',action:'restore',confirmed:true,recordId:r.recordId,workspaceRevision:restore.workspaceRevision,records:restore.records.map(({id,revision})=>({id,revision}))}));assert.equal((await f.saved(r)).data.status,'closed');
});
test('navigation, restaurant-local due dates, former actor labels and bounded history keep explicit evidence',async t=>{
 const f=await fixture(t);let r=await assigned(f),w=await f.view('owner');assert.ok(availableModules((await f.view('worker')).me).some(m=>m.tab==='Staff ideas'));assert.equal(availableModules((await f.view('schedule')).me).some(m=>m.tab==='Staff ideas'),false);
 const cmd={locationId:'a',requestId:'local-day',action:'staffidea.assign',recordId:r.recordId,expectedRevision:r.revision,input:{...assignment,dueDate:'2026-09-29'}};assert.doesNotThrow(()=>applyCommand(w,cmd,'2026-09-30T02:00:00Z'));assert.throws(()=>applyCommand(w,cmd,'2026-09-30T12:00:00Z'),/future restaurant date/);
 const row=w.records.find(x=>x.id===r.recordId);row.data.history=Array.from({length:100},()=>({actorId:'manager',action:'note',at:'2026-01-01T00:00:00Z',note:'Fixture'}));assert.throws(()=>applyCommand(w,{...cmd,action:'staffidea.note',input:{note:'New'}},'2026-09-30T12:00:00Z'),/history limit/);
 r=ok(await f.call('manager','staffidea.respond',response,r));await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='manager'").run();w=await f.view('worker');assert.ok(w.formerMembers.some(m=>m.id==='manager'));assert.equal(publicWorkspace({...w,me:{...w.me,scheduleOnly:true}}).records.some(x=>x.kind==='staffidea'),false);
});
