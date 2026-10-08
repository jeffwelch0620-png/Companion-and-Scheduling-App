import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {coverageIssue} from '../.sites-runtime/shared/coverage.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
// Future dates are relative to the run so expiry checks do not age out fixtures.
const start=new Date(Date.now()+7*86400000);start.setUTCHours(18,0,0,0);
const period={start:start.toISOString(),end:new Date(start.getTime()+5*3600000).toISOString()};
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data};
async function fixture(t,{closing=true}={}) {
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const id of ['a','b'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(id,'Fictional '+id,'America/New_York').run();
 for(const [id,caps,qualification='Server',area='FOH',location='a',position='Server'] of [
  ['owner',[]],['one',[]],['two',[]],['unqualified',[],''],
  ['manager',['schedule.manage','schedule.publish','schedule.change','tasks.manage','close.confirm','standards.approve']],
  ['other-manager',['schedule.manage','schedule.change','tasks.manage','close.confirm']],
  ['senior',['close.verify']],['cross-area',[],'Server','BOH'],['outsider',[],'Server','FOH','b'],
  ['dish',[],'Server','FOH','a','Dishwasher'],['dish-two',[],'Dishwasher','BOH','a','Dishwasher'],
 ])await db.prepare('INSERT INTO memberships(id,email,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?)').bind(id,id+'@example.test',location,id,area,position,JSON.stringify(caps),JSON.stringify(qualification?[qualification]:[])).run();
 const call=async(actor,action,input={},record,options={})=>{
  const body={requestId:options.requestId??crypto.randomUUID(),locationId:'a',action,input,...(record?{recordId:record.id??record.recordId,expectedRevision:record.revision}:{})};
  const response=await handleWorkspace(new Request('https://test.example/api/workspace',{method:'POST',headers:{'oai-authenticated-user-id':actor+'-id','oai-authenticated-user-email':actor+'@example.test',Origin:options.origin??'https://test.example','Content-Type':'application/json'},body:JSON.stringify(body)}),db);return {status:response.status,data:await response.json()};
 };
 const view=async actor=>{const response=await handleWorkspace(new Request('https://test.example/api/workspace?locationId=a',{headers:{'oai-authenticated-user-id':actor+'-id','oai-authenticated-user-email':actor+'@example.test'}}),db);return {status:response.status,data:await response.json()}};
 ok(await call('manager','leadership.assign',{personId:'manager',area:'FOH',...period,note:'Fixture shift leader'}));
 let shift=ok(await call('manager','shift.save',{personId:'owner',position:'Server',...period})),close,standard;
 if(closing){
  standard=ok(await call('manager','standard.save',{title:'Fixture station',zone:'Fixture zone',position:'Server',version:1,criteria:['Fixture counter ready','Fixture stock counted'],verification:'senior-then-manager',source:'Fictional software test conditions'}));
  standard=ok(await call('manager','standard.approve',{validated:true,note:'Fixture only'},standard));
  close=ok(await call('manager','close.assign',{shiftId:shift.recordId,standardId:standard.recordId,managerId:'manager',verifierId:'senior',due:period.end}));
 }
 shift=ok(await call('manager','shift.publish',{},shift));
 const offer=async(note='Private family details for my manager')=>ok(await call('owner','coverage.create',{shiftId:shift.recordId,shiftRevision:shift.revision,note}));
 const fresh=async(actor,id)=>ok(await view(actor)).records.find(r=>r.id===(id.recordId??id.id??id));
 return {db,call,view,offer,fresh,shift,close,standard};
}
test('coverage discovery exposes the shift duties only to eligible coworkers and hides private notes and other volunteers',async t=>{
 const f=await fixture(t),o=await f.offer();
 const coverageNotices=actor=>f.view(actor).then(r=>ok(r).records.filter(m=>m.kind==='message'&&m.data.title==='A shift is available for coverage'));
 assert.equal((await coverageNotices('owner')).length,0,'The offer author must not receive copies addressed to each coworker.');
 assert.equal((await coverageNotices('one')).length,1);assert.equal((await coverageNotices('two')).length,1);
 const storedNotices=await f.db.prepare("SELECT data FROM records WHERE kind='message' AND json_extract(data,'$.title')='A shift is available for coverage'").all();
 assert.equal(storedNotices.results.length,1);assert.ok(JSON.parse(storedNotices.results[0].data).recipients.length>1);
 assert.deepEqual((await coverageNotices('one'))[0].data.recipients,['one']);
 const oneNotice=(await coverageNotices('one'))[0];ok(await f.call('one','message.read',{},oneNotice));
 assert.deepEqual((await coverageNotices('two'))[0].data.readBy,[]);
 assert.deepEqual((await coverageNotices('one'))[0].data.readBy,['one']);
 const one=await f.fresh('one',o);assert.equal(one.data.eligible,true);assert.equal(one.data.note,'');assert.deepEqual(one.data.history,[]);assert.equal(one.data.duties[0].criteria.length,2);
 assert.equal(await f.fresh('unqualified',o),undefined);assert.equal(await f.fresh('cross-area',o),undefined);assert.equal(await f.fresh('senior',o),undefined);assert.equal(await f.fresh('dish',o),undefined);
 assert.equal((await f.view('outsider')).status,403);assert.match((await f.fresh('owner',o)).data.note,/family/);
 const first=ok(await f.call('one','coverage.volunteer',{confirmed:true},o));
 assert.deepEqual((await f.fresh('two',first)).data.volunteers,[]);
 const second=ok(await f.call('two','coverage.volunteer',{confirmed:true},first));
 assert.deepEqual((await f.fresh('one',second)).data.volunteers.map(v=>v.personId),['one']);
 for(const message of ok(await f.view('one')).records.filter(r=>r.kind==='message')) {assert.equal(message.data.recipients.length,1);assert.doesNotMatch(message.data.body,/family/);}
 assert.equal((await f.fresh('manager',second)).data.volunteers.length,2);
 assert.equal((await f.fresh('owner',f.shift)).ownerId,'owner');
});
test('approval requires the assigned independent leader and transfers the shift and every closing duty atomically',async t=>{
 const f=await fixture(t);let o=await f.offer();
 assert.equal((await f.call('one','coverage.volunteer',{},o)).status,400);
 o=ok(await f.call('one','coverage.volunteer',{confirmed:true},o));
 assert.equal((await f.call('other-manager','coverage.approve',{personId:'one',confirmed:true,note:'Wrong leader'},o)).status,403);
 assert.equal((await f.call('owner','coverage.approve',{personId:'one',confirmed:true,note:'Self approval'},o)).status,403);
 assert.equal((await f.call('one','coverage.approve',{personId:'one',confirmed:true,note:'Self approval'},o)).status,403);
 assert.equal((await f.call('manager','coverage.approve',{personId:'two',confirmed:true,note:'Did not volunteer'},o)).status,409);
 ok(await f.call('owner','close.transition',{step:'ready',answers:[0,1],note:'Fixture ready'},f.close));
 const approved=ok(await f.call('manager','coverage.approve',{personId:'one',confirmed:true,note:'Reviewed exact shift and duties'},o));
 const w=ok(await f.view('one'));assert.equal(w.records.find(r=>r.id===f.shift.recordId).ownerId,'one');
 const inherited=w.records.find(r=>r.id===f.close.recordId);assert.equal(inherited.ownerId,'one');assert.equal(inherited.data.phase,'open');assert.deepEqual(inherited.data.answers,[]);
 assert.equal((await f.fresh('owner',approved)).data.selectedId,'one');
 assert.equal((await f.call('two','coverage.volunteer',{confirmed:true},approved)).status,404);
 assert.equal((await f.call('owner','coverage.withdraw',{note:'Too late'},approved)).status,409);
});
test('approval rechecks current availability, explicit clearance, overlapping shifts and account activation',async t=>{
 const f=await fixture(t);let o=await f.offer();o=ok(await f.call('one','coverage.volunteer',{confirmed:true},o));
 await f.db.prepare("UPDATE memberships SET qualifications='[]' WHERE id='one'").run();
 assert.equal((await f.call('manager','coverage.approve',{personId:'one',confirmed:true,note:'No clearance'},o)).status,409);
 await f.db.prepare('UPDATE memberships SET qualifications=? WHERE id=?').bind('["Server"]','one').run();
 const conflict=ok(await f.call('manager','shift.save',{personId:'one',position:'Server',...period}));
 assert.equal((await f.call('manager','coverage.approve',{personId:'one',confirmed:true,note:'Overlap'},o)).status,409);
 ok(await f.call('manager','shift.cancel',{note:'Remove fictional conflict'},conflict));
 const request=ok(await f.call('one','request.create',{type:'time-off',...period,note:'Time off'}));
 ok(await f.call('manager','request.review',{approve:true,note:'Approved fixture time off'},request));
  assert.equal((await f.call('manager','coverage.approve',{personId:'one',confirmed:true,note:'Time off conflict'},o)).status,409);
 const school=ok(await f.call('two','availability.save',{title:'School day',kind:'school',startDate:period.start.slice(0,10),endDate:period.start.slice(0,10),days:[0,1,2,3,4,5,6],startMinute:0,endMinute:1440,beforeMinutes:0,afterMinutes:0}));
 ok(await f.call('manager','availability.review',{approve:true,note:'School block checked'},school));
 assert.equal((await f.call('two','coverage.volunteer',{confirmed:true},o)).status,404);
 assert.equal((await f.fresh('owner',f.shift)).ownerId,'owner');
 await f.db.prepare("UPDATE memberships SET active=0 WHERE id='one'").run();
 assert.equal((await f.call('manager','coverage.approve',{personId:'one',confirmed:true,note:'Inactive'},o)).status,400);
});
test('withdrawals keep original responsibility and stale volunteer/approval requests cannot revive consent',async t=>{
 const f=await fixture(t);let o=await f.offer(),original=o;
 o=ok(await f.call('one','coverage.volunteer',{confirmed:true},o));
 o=ok(await f.call('one','coverage.withdraw-volunteer',{},o));
 assert.equal((await f.call('manager','coverage.approve',{personId:'one',confirmed:true,note:'No longer volunteering'},o)).status,409);
 assert.equal((await f.call('two','coverage.volunteer',{confirmed:true},original)).status,409);
 o=ok(await f.call('owner','coverage.withdraw',{note:'Private withdrawal reason'},o));
 assert.equal((await f.call('one','coverage.volunteer',{confirmed:true},o)).status,404);
 assert.equal((await f.fresh('owner',f.shift)).ownerId,'owner');assert.equal((await f.fresh('owner',f.close)).ownerId,'owner');
 assert.equal((await f.offer('Reopened as a new request')).revision,1);
});
test('changing the shift or its closing duties invalidates old offers and their consent in the same transaction',async t=>{
 const f=await fixture(t);let o=await f.offer();o=ok(await f.call('one','coverage.volunteer',{confirmed:true},o));
 const shift=ok(await f.call('manager','shift.save',{personId:'owner',position:'Server',...period,note:'Updated published note'},f.shift));
 assert.equal((await f.fresh('owner',o)).data.status,'invalidated');
 assert.equal((await f.call('manager','coverage.approve',{personId:'one',confirmed:true,note:'Old offer'},o)).status,409);
 const notice=ok(await f.view('one')).records.find(r=>r.kind==='message'&&r.data.title==='Coverage offer needs a fresh review');assert.equal(notice.data.recordId,o.recordId);
 let fresh=ok(await f.call('owner','coverage.create',{shiftId:shift.recordId,shiftRevision:shift.revision,note:''}));
 ok(await f.call('manager','close.cancel',{note:'Changed duties for this fixture'},await f.fresh('manager',f.close)));
 assert.equal((await f.fresh('owner',fresh)).data.status,'invalidated');
});
test('competing approvals, repeated requests and a transaction failure cannot double-book or partially transfer work',async t=>{
 const f=await fixture(t);let o=await f.offer();o=ok(await f.call('one','coverage.volunteer',{confirmed:true},o));o=ok(await f.call('two','coverage.volunteer',{confirmed:true},o));
 await f.db.prepare("CREATE TRIGGER coverage_abort BEFORE UPDATE ON records WHEN NEW.kind='coverage' AND json_extract(NEW.data,'$.status')='approved' BEGIN SELECT RAISE(ABORT,'test rollback'); END").run();
 assert.equal((await f.call('manager','coverage.approve',{personId:'one',confirmed:true,note:'Fault injection'},o)).status,503);
 assert.equal((await f.fresh('owner',f.shift)).ownerId,'owner');assert.equal((await f.fresh('owner',f.close)).ownerId,'owner');assert.equal((await f.fresh('manager',o)).data.status,'open');
 await f.db.prepare('DROP TRIGGER coverage_abort').run();
 const options={requestId:'same-coverage-decision'},input={personId:'one',confirmed:true,note:'Exact approved replacement'};
 const results=await Promise.all([f.call('manager','coverage.approve',input,o,options),f.call('manager','coverage.approve',{personId:'two',confirmed:true,note:'Competing choice'},o)]);
 assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===409).length,1);
 const picked=(await f.fresh('manager',o)).data.selectedId;assert.ok(['one','two'].includes(picked));
 if(picked==='one'){const again=ok(await f.call('manager','coverage.approve',input,o,options));assert.deepEqual(again,results[0].data);}
 const rows=(await f.db.prepare("SELECT owner_id FROM records WHERE id IN (?,?)").bind(f.shift.recordId,f.close.recordId).all()).results;assert.ok(rows.every(r=>r.owner_id===picked));
});
test('expired offers and cross-site writes are rejected, and full storage rolls back a notification fanout',async t=>{
 const f=await fixture(t);let o=await f.offer();
 const w=ok(await f.view('manager')),raw=w.records.find(r=>r.id===o.recordId);
 assert.equal(coverageIssue(w,raw,new Date(Date.parse(period.start)-1).toISOString()),'');
 assert.match(coverageIssue(w,raw,period.start),/has started/);
 assert.equal((await f.call('one','coverage.volunteer',{confirmed:true},o,{origin:'https://other.example'})).status,403);
 const original=await f.db.prepare('SELECT data FROM records WHERE id=?').bind(f.shift.recordId).first();
 const shifted=JSON.parse(original.data);shifted.start='2000-01-01T12:00:00.000Z';shifted.end='2000-01-01T17:00:00.000Z';
 await f.db.prepare('UPDATE records SET data=? WHERE id=?').bind(JSON.stringify(shifted),f.shift.recordId).run();
 assert.equal(await f.fresh('two',o),undefined);assert.match((await f.fresh('owner',o)).data.unavailableReason,/changed/);
 await f.db.prepare('UPDATE records SET data=? WHERE id=?').bind(original.data,f.shift.recordId).run();
 const count=(await f.db.prepare('SELECT COUNT(*) AS n FROM records').first()).n;
 const filler=JSON.stringify({title:'Fixture',body:'Fixture',recipients:['owner'],readBy:[],replies:[]});
 await f.db.prepare("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<?) INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) SELECT 'filler-'||x,'a','message','owner','FOH',1,?,? FROM n").bind(3000-count,filler,new Date().toISOString()).run();
 assert.equal((await f.call('one','coverage.volunteer',{confirmed:true},o)).status,503);
 assert.equal((await f.fresh('manager',o)).data.volunteers.length,0);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM records').first()).n,3000);
});
test('a separately approved direct swap supersedes the open offer without losing its closing duties',async t=>{
 const f=await fixture(t);let o=await f.offer();o=ok(await f.call('one','coverage.volunteer',{confirmed:true},o));
 let swap=ok(await f.call('owner','request.create',{type:'swap',shiftId:f.shift.recordId,replacementId:'two',...period,note:'Named replacement found'}));
 swap=ok(await f.call('two','request.consent',{accept:true},swap));
 ok(await f.call('manager','request.review',{approve:true,note:'Assigned leader approved the named replacement'},swap));
 assert.equal((await f.fresh('owner',o)).data.status,'invalidated');
 assert.equal((await f.call('manager','coverage.approve',{personId:'one',confirmed:true,note:'Cannot approve old owner offer'},await f.fresh('manager',o))).status,409);
 assert.equal((await f.fresh('two',f.shift)).ownerId,'two');assert.equal((await f.fresh('two',f.close)).ownerId,'two');
});
test('Dish can offer and volunteer for qualified scheduling work with no operational closing assignment',async t=>{
 const f=await fixture(t,{closing:false});
 await f.db.prepare("UPDATE memberships SET qualifications='[\"Dishwasher\"]',area='BOH' WHERE id='dish'").run();
 // Fixture grants are explicit; no job-title shortcut supplies clearance.
 await f.db.prepare("UPDATE memberships SET capabilities='[\"schedule.manage\",\"schedule.publish\",\"schedule.change\",\"location.manage\"]' WHERE id='manager'").run();
 ok(await f.call('manager','leadership.assign',{personId:'manager',area:'BOH',...period,note:'Fixture BOH leadership'}));
 let shift=ok(await f.call('manager','shift.save',{personId:'dish',position:'Dishwasher',...period}));shift=ok(await f.call('manager','shift.publish',{},shift));
 let offer=ok(await f.call('dish','coverage.create',{shiftId:shift.recordId,shiftRevision:shift.revision,note:''}));
 assert.equal((await f.fresh('dish-two',offer)).data.eligible,true);assert.deepEqual((await f.fresh('dish-two',offer)).data.duties,[]);
 offer=ok(await f.call('dish-two','coverage.volunteer',{confirmed:true},offer));
 ok(await f.call('manager','coverage.approve',{personId:'dish-two',confirmed:true,note:'Approved scheduling-only coverage'},offer));
 const view=ok(await f.view('dish-two'));assert.equal(view.records.find(r=>r.id===shift.recordId).ownerId,'dish-two');assert.equal(view.records.some(r=>['close','task','development'].includes(r.kind)),false);
});
