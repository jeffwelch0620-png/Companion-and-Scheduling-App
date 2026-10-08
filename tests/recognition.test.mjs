import test from 'node:test';import assert from 'node:assert/strict';
import {fixture,ok} from './maintenance-meter-fixture.mjs';
import {applyCommand,publicWorkspace} from '../.sites-runtime/shared/domain.mjs';
import {availableModules} from '../.sites-runtime/shared/operations-home.mjs';
export const facts={title:'Fictional teamwork',message:'Fictional thank-you for helping with the test.',recipientId:'manager',occurredOn:'2026-09-01',shareConfirmed:true};
const approval={note:'Private fictional owner check',confirmed:true};
const submit=async f=>ok(await f.call('worker','recognition.submit',facts));
test('recognition keeps submissions private, requires independent owner review and redacts the published board',async t=>{
 const f=await fixture(t);let r=await submit(f);
 for(const who of ['manager','othermanager','dish','schedule'])assert.equal((await f.view(who)).records.some(x=>x.id===r.recordId),false);
 assert.equal((await f.call('manager','recognition.publish',approval,r)).status,404);
 r=ok(await f.call('owner','recognition.publish',approval,r));const peer=(await f.view('othermanager')).records.find(x=>x.id===r.recordId);
 assert.equal(peer.data.message,facts.message);assert.equal(peer.data.internal,undefined);assert.doesNotMatch(JSON.stringify(peer),/Private fictional owner check/);
 assert.equal((await f.saved(r)).data.internal.history.at(-1).note,approval.note);
 assert.equal((await f.call('manager','recognition.withdraw',approval,r)).status,403);
 assert.equal((await f.view('worker')).records.find(x=>x.id===r.recordId).data.internal.history.length,2);
 for(const who of ['dish','schedule'])assert.equal((await f.view(who)).records.some(x=>x.id===r.recordId),false);
 assert.equal((await f.view()).records.filter(x=>x.kind==='message').length,0);
});
test('return and author corrections preserve original text, recipient and private review history',async t=>{
 const f=await fixture(t);let r=await submit(f);r=ok(await f.call('owner','recognition.return',{note:'Fictional private correction request'},r));
 assert.equal((await f.call('owner','recognition.correct',{...facts,note:'Owner rewrite'},r)).status,403);
 r=ok(await f.call('worker','recognition.correct',{...facts,title:'Corrected title',message:'Checked thank-you',recipientId:'othermanager',note:'Fictional recipient correction'},r));
 const d=(await f.saved(r)).data;assert.equal(d.status,'submitted');assert.equal(d.internal.versions[0].facts.recipientId,'manager');assert.equal(d.internal.versions[0].facts.message,facts.message);
 r=ok(await f.call('owner','recognition.publish',approval,r));assert.notEqual((await f.call('worker','recognition.correct',{...facts,note:'Silently rewrite'},r)).status,200);
 const peer=(await f.view('manager')).records.find(x=>x.id===r.recordId);assert.equal(peer.data.message,'Checked thank-you');assert.equal(peer.data.internal,undefined);
 r=ok(await f.call('worker','recognition.withdraw',{note:'Fictional board correction',confirmed:true},r));assert.equal((await f.saved(r)).data.status,'withdrawn');assert.ok((await f.saved(r)).data.publication);assert.equal((await f.view('manager')).records.some(x=>x.id===r.recordId),false);
 assert.notEqual((await f.call('owner','recognition.publish',approval,r)).status,200);
});
test('authors and recipients cannot approve their own recognition even with owner capabilities',async t=>{
 const f=await fixture(t);const author=ok(await f.call('owner','recognition.submit',{...facts,recipientId:'worker'}));assert.equal((await f.call('owner','recognition.publish',approval,author)).status,403);
 const recipient=ok(await f.call('worker','recognition.submit',{...facts,recipientId:'owner'}));assert.equal((await f.call('owner','recognition.publish',approval,recipient)).status,403);
 await f.db.prepare("UPDATE memberships SET capabilities='[\"location.manage\"]',revision=revision+1 WHERE id='othermanager'").run();ok(await f.call('othermanager','recognition.publish',approval,recipient));
});
test('recipient eligibility, sharing confirmation, bounded text and restaurant-local dates are validated',async t=>{
 const f=await fixture(t);
 for(const patch of [{recipientId:'worker'},{recipientId:'foreign'},{recipientId:'dish'},{recipientId:'schedule'},{shareConfirmed:false},{occurredOn:'2026-02-30'},{occurredOn:'2099-01-01'},{message:'x'.repeat(2001)},{title:''}])assert.notEqual((await f.call('worker','recognition.submit',{...facts,...patch})).status,200);
 for(const who of ['dish','schedule'])assert.equal((await f.call(who,'recognition.submit',facts)).status,403);
 const w=await f.view('worker'),cmd={locationId:'a',requestId:'date',action:'recognition.submit',input:{...facts,occurredOn:'2026-09-30'}};
 assert.throws(()=>applyCommand(w,cmd,'2026-09-30T02:00:00Z'),/future/);assert.doesNotThrow(()=>applyCommand(w,cmd,'2026-09-30T12:00:00Z'));
 assert.equal(availableModules(w.me).find(m=>m.id==='shout').tab,'Recognition');assert.equal(availableModules({...w.me,scheduleOnly:true}).some(m=>m.id==='shout'),false);
});
test('inactive recipients cannot be published and membership races roll back the entire command',async t=>{
 const f=await fixture(t);const r=await submit(f);let batches=0;
 const binding={withSession:()=>({prepare:(...a)=>f.db.prepare(...a),batch:async statements=>{if(++batches===2)await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='manager'").run();return f.db.batch(statements)}})};
 assert.equal((await f.call('owner','recognition.publish',approval,r,{},binding)).status,409);assert.equal((await f.saved(r)).data.status,'submitted');
 assert.notEqual((await f.call('owner','recognition.publish',approval,r)).status,200);ok(await f.call('owner','recognition.return',{note:'Recipient unavailable'},r));
});
test('retry, stale reviews and transaction failure preserve exactly one publication and unchanged evidence',async t=>{
 const f=await fixture(t),extra={requestId:'recognition-once'};let r=ok(await f.call('worker','recognition.submit',facts,undefined,extra));assert.deepEqual(ok(await f.call('worker','recognition.submit',facts,undefined,extra)),r);assert.equal((await f.call('worker','recognition.submit',{...facts,title:'Different'},undefined,extra)).status,409);
 const old=r;r=ok(await f.call('worker','recognition.correct',{...facts,note:'New evidence',message:'Corrected'},r));assert.equal((await f.call('owner','recognition.publish',approval,old)).status,409);
 await f.db.prepare("CREATE TRIGGER fail_recognition BEFORE INSERT ON command_receipts WHEN NEW.request_id='recognition-fail' BEGIN SELECT RAISE(ABORT,'fixture rollback'); END").run();assert.equal((await f.call('owner','recognition.publish',approval,r,{requestId:'recognition-fail'})).status,503);assert.equal((await f.saved(r)).data.status,'submitted');
 const pre=r;r=ok(await f.call('owner','recognition.publish',approval,r,{requestId:'publish-once'}));assert.deepEqual(ok(await f.call('owner','recognition.publish',approval,pre,{requestId:'publish-once'})),r);assert.equal((await f.saved(r)).data.internal.history.filter(h=>h.action==='publish').length,1);
});
test('withdrawn recognition can be filed and restored by an owner with author-only or owner history access',async t=>{
 const f=await fixture(t);let r=await submit(f);r=ok(await f.call('owner','recognition.publish',approval,r));r=ok(await f.call('owner','recognition.withdraw',{note:'Fixture withdrawal',confirmed:true},r));
 await f.db.prepare("UPDATE records SET updated_at='2026-01-01T00:00:00Z' WHERE id=?").bind(r.recordId).run();const preview=ok(await f.request('owner','/api/history?locationId=a&preview=1&before=2026-08-01'));
 ok(await f.request('owner','/api/history',{locationId:'a',requestId:'file-recognition',action:'archive',confirmed:true,before:'2026-08-01',workspaceRevision:preview.workspaceRevision,records:preview.records.map(({id,revision})=>({id,revision}))}));
 assert.equal(ok(await f.request('worker','/api/history?locationId=a&kind=recognition')).items.length,1);assert.equal(ok(await f.request('manager','/api/history?locationId=a&kind=recognition')).items.length,0);assert.equal((await f.request('manager','/api/history?locationId=a&recordId='+r.recordId)).status,404);assert.equal((await f.request('worker','/api/history?locationId=a&restore='+r.recordId)).status,403);
 const restore=ok(await f.request('owner','/api/history?locationId=a&restore='+r.recordId));ok(await f.request('owner','/api/history',{locationId:'a',requestId:'restore-recognition',action:'restore',confirmed:true,recordId:r.recordId,workspaceRevision:restore.workspaceRevision,records:restore.records.map(({id,revision})=>({id,revision}))}));assert.equal((await f.saved(r)).data.status,'withdrawn');assert.equal((await f.view('manager')).records.some(x=>x.id===r.recordId),false);
});
test('role revocation, former reviewer names and history limits preserve scoped records',async t=>{
 const f=await fixture(t);let r=await submit(f);r=ok(await f.call('owner','recognition.publish',approval,r));await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='owner'").run();const w=await f.view('worker');assert.ok(w.formerMembers.some(m=>m.id==='owner'));assert.equal(publicWorkspace({...w,me:{...w.me,scheduleOnly:true}}).records.some(x=>x.kind==='recognition'),false);
 const row=w.records.find(x=>x.id===r.recordId);row.data.internal.history=Array.from({length:100},()=>({actorId:'worker',action:'fixture',note:'Fixture',at:'2026-09-01T12:00:00Z'}));assert.throws(()=>applyCommand(w,{locationId:'a',requestId:'limit',recordId:r.recordId,expectedRevision:r.revision,action:'recognition.withdraw',input:{note:'More',confirmed:true}},'2026-09-30T12:00:00Z'),/update limit/);
});
