import test from 'node:test';import assert from 'node:assert/strict';
import {openingFixture,openingFacts,ok} from './opening-onboarding-fixture.mjs';
import {openingHireProgress} from '../.sites-runtime/shared/hiring-openings.mjs';
import {historyPlan} from '../.sites-runtime/shared/record-history.mjs';
const progress=async(f,o)=>{const w=await f.view(),r=w.records.find(x=>x.id===o.recordId);return openingHireProgress(w,r,r.data.onboarding.links.at(-1))};
test('owner links existing onboarding without enabling access and nonowners never receive private association notes',async t=>{
 const f=await openingFixture(t),{h,person}=await f.hire();let o=await f.opening();const before=await f.db.prepare('SELECT * FROM memberships WHERE id=?').bind(person.id).first();
 assert.equal((await f.call('manager','opening.link-handoff',await f.linkInput(h),o)).status,403);o=await f.link(o,h);const row=await f.saved(o);assert.equal(row.data.onboarding.links.length,1);assert.equal((await progress(f,o)).state,'awaiting');
 const manager=(await f.view('manager')).records.find(x=>x.id===o.recordId);assert.equal(manager.data.onboarding,undefined);assert.doesNotMatch(JSON.stringify(manager),/PRIVATE-LINK-REASON|Fictional hire/);assert.equal((await f.view('worker')).records.some(x=>x.id===o.recordId),false);
 assert.deepEqual(await f.db.prepare('SELECT * FROM memberships WHERE id=?').bind(person.id).first(),before);assert.equal((await f.saved(h)).revision,h.revision);assert.equal((await f.view()).records.filter(x=>x.kind==='message').length,0);
});
test('linking requires an approved matching department, current handoff and employee revisions, and explicit review',async t=>{
 const f=await openingFixture(t),{h}=await f.hire(),input=await f.linkInput(h);const draft=ok(await f.call('owner','opening.create',openingFacts));assert.notEqual((await f.call('owner','opening.link-handoff',input,draft)).status,200);
 const o=await f.opening();for(const patch of [{checked:false},{note:''},{handoffRevision:99},{employeeRevision:99},{handoffId:'missing'}])assert.notEqual((await f.call('owner','opening.link-handoff',{...input,...patch},o)).status,200);
 const wrong=await f.opening({department:'FOH'});assert.notEqual((await f.call('owner','opening.link-handoff',input,wrong)).status,200);assert.equal((await f.call('foreign','opening.link-handoff',input,o,{locationId:'b'})).status,404);
 const cancelled=ok(await f.call('owner','hirehandoff.cancel',{note:'Fictional cancelled handoff'},h));assert.notEqual((await f.call('owner','opening.link-handoff',await f.linkInput(cancelled),o)).status,200);
});
test('scheduling progress updates from existing evidence without claiming started or changing the linked request',async t=>{
 const f=await openingFixture(t);let {h,person}=await f.hire();const o=await f.link(await f.opening(),h),snapshot=await f.saved(o);
 h=ok(await f.call('manager','hirehandoff.accept',{note:'Fictional acceptance',accepted:true},h));assert.equal((await progress(f,o)).state,'accepted');
 await f.db.prepare("UPDATE memberships SET active=1,employment=json_set(employment,'$.status','active'),revision=revision+1 WHERE id=?").bind(person.id).run();
 await f.db.prepare("INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) VALUES('first','a','shift',?,'BOH',1,?,'2026-09-30T12:00:00Z')").bind(person.id,JSON.stringify({start:'2026-10-01T16:00:00Z',end:'2026-10-01T22:00:00Z',position:'Line Cook',published:true})).run();
 h=ok(await f.call('manager','hirehandoff.confirm',{note:'Fictional checked shift',checked:true,shiftId:'first',shiftRevision:1},h));assert.equal((await progress(f,o)).label,'Published first shift confirmed');
 await f.db.prepare("UPDATE records SET revision=revision+1,data=json_set(data,'$.cancelled',1) WHERE id='first'").run();assert.equal((await progress(f,o)).state,'review');assert.deepEqual(await f.saved(o),snapshot);
});
test('revised approval requires owner recheck while retaining the original link review snapshot',async t=>{
 const f=await openingFixture(t),{h}=await f.hire();let o=await f.link(await f.opening(),h);const link=(await f.saved(o)).data.onboarding.links[0];
 o=ok(await f.call('owner','opening.revise',{...openingFacts,neededOn:'2026-11-01',resetApproval:true,note:'Changed target'},o));assert.equal((await progress(f,o)).state,'review');assert.notEqual((await f.call('owner','opening.review-handoff',{...await f.linkInput(h),linkId:link.id},o)).status,200);
 o=ok(await f.call('owner','opening.submit',{note:'Reviewed change',checked:true},o));o=ok(await f.call('owner','opening.approve',{note:'New approval',approved:true},o));assert.equal((await progress(f,o)).state,'review');
 o=ok(await f.call('owner','opening.review-handoff',{...await f.linkInput(h),linkId:link.id,note:'PRIVATE-RECHECK'},o));const next=(await f.saved(o)).data.onboarding.links[0];assert.equal(next.reviews.length,2);assert.deepEqual(next.reviews[0],link.reviews[0]);assert.equal((await progress(f,o)).state,'awaiting');
});
test('capacity and one-hire-per-request linkage require explicit release, which never cancels employee or schedule',async t=>{
 const f=await openingFixture(t),a=await f.hire('hire-a'),b=await f.hire('hire-b');let o=await f.link(await f.opening(),a.h);const second=await f.opening();
 assert.equal((await f.call('owner','opening.link-handoff',await f.linkInput(a.h),second)).status,409);assert.notEqual((await f.call('owner','opening.link-handoff',await f.linkInput(b.h),o)).status,200);
 const before=await f.saved(a.h),link=(await f.saved(o)).data.onboarding.links[0];o=ok(await f.call('owner','opening.release-handoff',{linkId:link.id,note:'PRIVATE-RELEASE',checked:true},o));assert.equal((await progress(f,o)).state,'released');assert.deepEqual(await f.saved(a.h),before);
 o=await f.link(o,b.h);assert.equal((await f.saved(o)).data.onboarding.links.length,2);await f.link(second,a.h);
});
test('retained associations prevent silently shrinking capacity and rehire or cancelled handoff needs review',async t=>{
 const f=await openingFixture(t),a=await f.hire('hire-a'),b=await f.hire('hire-b');let o=await f.opening({positions:2});o=await f.link(o,a.h);o=await f.link(o,b.h);
 assert.notEqual((await f.call('owner','opening.revise',{...openingFacts,positions:1,resetApproval:true,note:'Reduce'},o)).status,200);
 await f.db.prepare("UPDATE memberships SET employment=json_set(employment,'$.hireDate','2026-09-15'),revision=revision+1 WHERE id=?").bind(b.person.id).run();assert.equal((await progress(f,o)).state,'review');const l=(await f.saved(o)).data.onboarding.links.at(-1);assert.notEqual((await f.call('owner','opening.review-handoff',{...await f.linkInput(b.h),linkId:l.id},o)).status,200);
});
test('inactive scheduler and concurrent employee change cannot commit a stale onboarding link',async t=>{
 const f=await openingFixture(t),{h,person}=await f.hire(),o=await f.opening(),input=await f.linkInput(h);let batches=0;
 const binding={withSession:()=>({prepare:(...a)=>f.db.prepare(...a),batch:async statements=>{if(++batches===2)await f.db.prepare('UPDATE memberships SET revision=revision+1 WHERE id=?').bind(person.id).run();return f.db.batch(statements)}})};
 if(!f.compiled){assert.equal((await f.call('owner','opening.link-handoff',input,o,{},binding)).status,409);assert.equal((await f.saved(o)).data.onboarding,undefined);}else await f.db.prepare('UPDATE memberships SET revision=revision+1 WHERE id=?').bind(person.id).run();
 assert.equal((await f.call('owner','opening.link-handoff',input,o)).status,409);await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='manager'").run();assert.notEqual((await f.call('owner','opening.link-handoff',await f.linkInput(h),o)).status,200);
});
test('lost acknowledgments, stale requests and failed commits preserve one link and its private evidence',async t=>{
 const f=await openingFixture(t),{h}=await f.hire();let o=await f.opening();const input=await f.linkInput(h),before=o,extra={requestId:'link-once'};
 await f.db.prepare("CREATE TRIGGER fail_link BEFORE INSERT ON command_receipts WHEN NEW.request_id='link-fail' BEGIN SELECT RAISE(ABORT,'fixture rollback'); END").run();assert.equal((await f.call('owner','opening.link-handoff',input,o,{requestId:'link-fail'})).status,503);assert.equal((await f.saved(o)).data.onboarding,undefined);
 o=ok(await f.call('owner','opening.link-handoff',input,o,extra));assert.deepEqual(ok(await f.call('owner','opening.link-handoff',input,before,extra)),o);assert.equal((await f.saved(o)).data.onboarding.links.length,1);assert.equal((await f.call('owner','opening.link-handoff',{...input,note:'Changed'},before,extra)).status,409);
});
test('history retains the handoff dependency and filed links still prevent duplicate association',async t=>{
 const f=await openingFixture(t),{h}=await f.hire();let o=await f.link(await f.opening(),h);
 await f.db.prepare("UPDATE records SET updated_at='2026-01-01T00:00:00Z',data=json_set(data,'$.status','cancelled') WHERE id=?").bind(h.recordId).run();assert.equal(historyPlan(await f.view(),'2026-08-01').records.some(x=>x.id===h.recordId),false);
 o=ok(await f.call('owner','opening.close',{note:'Fictional closed request',confirmed:true},o));await f.db.prepare("UPDATE records SET updated_at='2026-01-01T00:00:00Z' WHERE id=?").bind(o.recordId).run();const plan=ok(await f.request('owner','/api/history?locationId=a&preview=1&before=2026-08-01'));
 ok(await f.request('owner','/api/history',{locationId:'a',requestId:'archive-links',action:'archive',confirmed:true,before:'2026-08-01',workspaceRevision:plan.workspaceRevision,records:plan.records.map(({id,revision})=>({id,revision}))}));
 const archived=ok(await f.request('manager','/api/history?locationId=a&kind=opening'));assert.equal(archived.items[0].record.data.onboarding,undefined);assert.doesNotMatch(JSON.stringify(archived),/PRIVATE-LINK-REASON/);
 const restore=ok(await f.request('owner','/api/history?locationId=a&restore='+o.recordId));assert.ok(restore.records.some(x=>x.id===h.recordId));
 // Restore only the handoff through its existing owner workflow, leaving the opening filed.
 const hp=ok(await f.request('owner','/api/history?locationId=a&restore='+h.recordId));ok(await f.request('owner','/api/history',{locationId:'a',requestId:'restore-hire',action:'restore',confirmed:true,recordId:h.recordId,workspaceRevision:hp.workspaceRevision,records:hp.records.map(({id,revision})=>({id,revision}))}));
 const current=(await f.view()).records.find(x=>x.id===h.recordId);const reopened=ok(await f.call('owner','hirehandoff.reopen',{note:'Fictional reopened handoff'},current));const other=await f.opening();assert.equal((await f.call('owner','opening.link-handoff',await f.linkInput(reopened),other)).status,409);
});
