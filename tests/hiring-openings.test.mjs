import test from 'node:test';import assert from 'node:assert/strict';
import {fixture,ok} from './maintenance-meter-fixture.mjs';
import {applyCommand,publicWorkspace} from '../.sites-runtime/shared/domain.mjs';
import {availableModules} from '../.sites-runtime/shared/operations-home.mjs';
export const facts={title:'Fictional evening cook',department:'BOH',positions:2,neededOn:'2026-10-15',shiftPlan:'Fictional Thu–Sun 4–10pm, 24 hours per week',reason:'Fictional coverage gap',sourceRef:'Fictional staffing plan, September 30',managerId:'manager'};
const review={note:'Fictional checked staffing request',checked:true},approval={note:'Fictional exact owner review',approved:true};
const draft=async f=>ok(await f.call('manager','opening.create',facts));
const submitted=async f=>ok(await f.call('manager','opening.submit',review,await draft(f)));
test('internal openings require exact owner approval and retain private restaurant and manager scope',async t=>{
 const f=await fixture(t);let r=await draft(f);assert.equal((await f.saved(r)).data.status,'draft');
 for(const who of ['othermanager','worker','dish','schedule']){assert.equal((await f.view(who)).records.some(x=>x.id===r.recordId),false);assert.notEqual((await f.call(who,'opening.approve',approval,r)).status,200);}
 assert.notEqual((await f.call('owner','opening.approve',approval,r)).status,200);r=ok(await f.call('manager','opening.submit',review,r));assert.equal((await f.call('manager','opening.approve',approval,r)).status,403);
 assert.notEqual((await f.call('owner','opening.approve',{...approval,approved:false},r)).status,200);r=ok(await f.call('owner','opening.approve',approval,r));const d=(await f.saved(r)).data;assert.equal(d.status,'open');assert.deepEqual(d.approval,{by:'owner',at:d.approval.at,revision:r.revision});
 assert.equal((await f.view('manager')).records.find(x=>x.id===r.recordId).data.positions,2);assert.equal((await f.view('worker')).records.some(x=>x.id===r.recordId),false);assert.equal((await f.view()).records.filter(x=>x.kind==='message').length,0);
});
test('editing an approved opening requires deliberate reset and preserves the approved version',async t=>{
 const f=await fixture(t);let r=ok(await f.call('owner','opening.approve',approval,await submitted(f)));const before=await f.saved(r);
 const change={...facts,positions:1,neededOn:'2026-11-01',note:'Fictional changed requirement'};assert.notEqual((await f.call('manager','opening.revise',change,r)).status,200);
 r=ok(await f.call('manager','opening.revise',{...change,resetApproval:true},r));let d=(await f.saved(r)).data;assert.equal(d.status,'draft');assert.equal(d.approval,null);assert.equal(d.positions,1);assert.equal(d.versions[0].facts.positions,2);assert.equal(d.versions[0].facts.neededOn,facts.neededOn);assert.deepEqual(d.versions[0].approval,before.data.approval);
 assert.equal((await f.call('owner','opening.approve',approval,before)).status,409);assert.notEqual((await f.call('owner','opening.approve',approval,r)).status,200);r=ok(await f.call('manager','opening.submit',review,r));r=ok(await f.call('owner','opening.approve',approval,r));assert.equal((await f.saved(r)).data.approval.revision,r.revision);
});
test('return, closure and reopening cannot silently reuse approval or edit a closed request',async t=>{
 const f=await fixture(t);let r=await submitted(f);r=ok(await f.call('owner','opening.return',{note:'Fictional adjust dates'},r));assert.equal((await f.saved(r)).data.status,'draft');r=ok(await f.call('manager','opening.submit',review,r));r=ok(await f.call('owner','opening.approve',approval,r));
 assert.notEqual((await f.call('manager','opening.close',{note:'Filled'},r)).status,200);r=ok(await f.call('manager','opening.close',{note:'Fictional need ended',confirmed:true},r));assert.ok((await f.saved(r)).data.approval);
 assert.notEqual((await f.call('owner','opening.revise',{...facts,note:'Change closed'},r)).status,200);assert.equal((await f.call('manager','opening.reopen',{note:'Again',confirmed:true},r)).status,403);
 r=ok(await f.call('owner','opening.reopen',{note:'Fictional new need',confirmed:true},r));const d=(await f.saved(r)).data;assert.equal(d.status,'draft');assert.equal(d.approval,null);assert.equal(d.versions.at(-1).status,'closed');assert.ok(d.versions.at(-1).approval);
});
test('input limits and assignments reject fractions, impossible dates, wrong stores and restricted actors',async t=>{
 const f=await fixture(t);for(const patch of [{positions:0},{positions:51},{positions:1.5},{positions:'2'},{positions:null},{neededOn:'2026-02-30'},{department:'Executive'},{title:''},{reason:'x'.repeat(3001)},{sourceRef:''},{managerId:'foreign'},{managerId:'schedule'},{managerId:'dish'}])assert.notEqual((await f.call('owner','opening.create',{...facts,...patch})).status,200,JSON.stringify(patch));
 assert.equal((await f.call('manager','opening.create',{...facts,managerId:'othermanager'})).status,403);for(const who of ['worker','dish','schedule'])assert.equal((await f.call(who,'opening.create',facts)).status,403);
 const r=await draft(f);assert.notEqual((await f.call('manager','opening.submit',{...review,checked:false},r)).status,200);assert.notEqual((await f.call('owner','opening.unknown',{note:'No'},r)).status,200);
});
test('owner reassignment removes previous manager access and preserves original responsibility',async t=>{
 const f=await fixture(t);let r=await submitted(f);r=ok(await f.call('owner','opening.revise',{...facts,managerId:'othermanager',note:'Fictional responsibility transfer'},r));const d=(await f.saved(r)).data;
 assert.equal(d.status,'draft');assert.equal(d.versions[0].facts.managerId,'manager');assert.equal((await f.view('manager')).records.some(x=>x.id===r.recordId),false);assert.equal((await f.call('manager','opening.submit',review,r)).status,404);ok(await f.call('othermanager','opening.submit',review,r));
});
test('all three restaurant contexts isolate opening records and reject cross-store command identifiers',async t=>{
 const f=await fixture(t);const a=await draft(f);for(const [actor,loc] of [['foreign','b'],['third','c']]){let r=ok(await f.call(actor,'opening.create',{...facts,managerId:actor},undefined,{locationId:loc}));r=ok(await f.call(actor,'opening.submit',review,r,{locationId:loc}));r=ok(await f.call(actor,'opening.approve',approval,r,{locationId:loc}));assert.equal((await f.view(actor,loc)).records.filter(x=>x.kind==='opening').length,1);assert.equal((await f.call(actor,'opening.close',{note:'Wrong store',confirmed:true},a,{locationId:loc})).status,404);}assert.equal((await f.view()).records.filter(x=>x.kind==='opening').length,1);
});
test('revoked managers cannot receive approval and racing membership updates prevent all writes',async t=>{
 const f=await fixture(t),r=await submitted(f);let batches=0;const binding={withSession:()=>({prepare:(...a)=>f.db.prepare(...a),batch:async statements=>{if(++batches===2)await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='manager'").run();return f.db.batch(statements)}})};
 if(!f.compiled){assert.equal((await f.call('owner','opening.approve',approval,r,{},binding)).status,409);assert.equal((await f.saved(r)).data.status,'review');}else await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='manager'").run();
 assert.notEqual((await f.call('owner','opening.approve',approval,r)).status,200);const revised=ok(await f.call('owner','opening.revise',{...facts,managerId:'othermanager',note:'Current manager required'},r));assert.equal((await f.saved(revised)).data.managerId,'othermanager');
});
test('identical retries, stale revisions and transaction failures do not duplicate or partially approve',async t=>{
 const f=await fixture(t),extra={requestId:'opening-once'};let r=ok(await f.call('manager','opening.create',facts,undefined,extra));assert.deepEqual(ok(await f.call('manager','opening.create',facts,undefined,extra)),r);assert.equal((await f.call('manager','opening.create',{...facts,title:'Changed'},undefined,extra)).status,409);
 r=ok(await f.call('manager','opening.submit',review,r));await f.db.prepare("CREATE TRIGGER fail_opening BEFORE INSERT ON command_receipts WHEN NEW.request_id='opening-fail' BEGIN SELECT RAISE(ABORT,'fixture rollback'); END").run();assert.equal((await f.call('owner','opening.approve',approval,r,{requestId:'opening-fail'})).status,503);assert.equal((await f.saved(r)).data.status,'review');
 const before=r;r=ok(await f.call('owner','opening.approve',approval,r,{requestId:'approve-once'}));assert.deepEqual(ok(await f.call('owner','opening.approve',approval,before,{requestId:'approve-once'})),r);assert.equal((await f.saved(r)).data.history.filter(h=>h.action==='approve').length,1);
});
test('closed openings are privately filed and restored with previous approval intact',async t=>{
 const f=await fixture(t);let r=ok(await f.call('owner','opening.approve',approval,await submitted(f)));r=ok(await f.call('manager','opening.close',{note:'Fictional end',confirmed:true},r));await f.db.prepare("UPDATE records SET updated_at='2026-01-01T00:00:00Z' WHERE id=?").bind(r.recordId).run();const preview=ok(await f.request('owner','/api/history?locationId=a&preview=1&before=2026-08-01'));
 ok(await f.request('owner','/api/history',{locationId:'a',requestId:'file-opening',action:'archive',confirmed:true,before:'2026-08-01',workspaceRevision:preview.workspaceRevision,records:preview.records.map(({id,revision})=>({id,revision}))}));
 assert.equal(ok(await f.request('manager','/api/history?locationId=a&kind=opening')).items.length,1);for(const who of ['othermanager','worker','dish','schedule'])assert.equal(ok(await f.request(who,'/api/history?locationId=a&kind=opening')).items.length,0);assert.equal((await f.request('othermanager','/api/history?locationId=a&recordId='+r.recordId)).status,404);
 const restore=ok(await f.request('owner','/api/history?locationId=a&restore='+r.recordId));ok(await f.request('owner','/api/history',{locationId:'a',requestId:'restore-opening',action:'restore',confirmed:true,recordId:r.recordId,workspaceRevision:restore.workspaceRevision,records:restore.records.map(({id,revision})=>({id,revision}))}));assert.equal((await f.saved(r)).data.status,'closed');assert.ok((await f.saved(r)).data.approval);
});
test('navigation, role revocation, retained reviewer names and update bounds follow current access',async t=>{
 const f=await fixture(t);let r=ok(await f.call('owner','opening.approve',approval,await submitted(f)));await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='owner'").run();const w=await f.view('manager');assert.ok(w.formerMembers.some(m=>m.id==='owner'));assert.equal(availableModules(w.me).find(m=>m.id==='hiring').tab,'Hiring and open positions');
 for(const patch of [{scheduleOnly:true},{position:'Dishwasher'},{capabilities:[]}]){const me={...w.me,...patch};assert.equal(availableModules(me).some(m=>m.id==='hiring'),false);assert.equal(publicWorkspace({...w,me}).records.some(x=>x.kind==='opening'),false);}
 w.records.find(x=>x.id===r.recordId).data.history=Array.from({length:100},()=>({actorId:'manager',action:'fixture',note:'Fixture',at:'2026-09-01T12:00:00Z'}));assert.throws(()=>applyCommand(w,{locationId:'a',requestId:'limit',recordId:r.recordId,expectedRevision:r.revision,action:'opening.close',input:{note:'More',confirmed:true}},'2026-09-30T12:00:00Z'),/update limit/);
});
