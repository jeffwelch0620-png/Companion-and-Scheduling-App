import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {handleAccess} from '../.sites-runtime/shared/access-service.mjs';
import {carriedIssues,previousShift} from '../.sites-runtime/shared/operations.mjs';
import {handleOperationsHandoff} from '../.sites-runtime/shared/operations-handoff.mjs';
import {operationsHome} from '../.sites-runtime/shared/operations-home.mjs';
import {seedManagerFixture,sharedFixture} from './manager-log-fixture.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
async function fixture(t){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync(`drizzle/${file}`,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const loc of ['a','b'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(loc,loc,'America/New_York').run();
 for(const [id,area,caps,loc='a'] of [['owner','Executive',['location.manage']],['otherowner','Executive',['location.manage']],['manager','BOH',['tasks.manage']],['opener','BOH',['tasks.manage']],['foh','FOH',['tasks.manage']],['worker','BOH',[]],['foreign','BOH',['location.manage'],'b']])await db.prepare('INSERT INTO memberships(id,email,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?)').bind(id,id+'@example.test',loc,id,area,'Manager',JSON.stringify(caps),'[]').run();
 const headers=id=>({'oai-authenticated-user-id':id+'-identity','oai-authenticated-user-email':id+'@example.test'});
 const call=async(id,action,input={},record,extra={})=>{const response=await handleWorkspace(new Request('https://test.example/api/workspace',{method:'POST',headers:{...headers(id),Origin:'https://test.example','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),locationId:'a',action,input,...(record?{recordId:record.recordId??record.id,expectedRevision:record.revision}:{}),...extra})}),db);return {status:response.status,data:await response.json()}};
 const view=async(id,loc='a')=>{const r=await handleWorkspace(new Request('https://test.example/api/workspace?locationId='+loc,{headers:headers(id)}),db);return {status:r.status,data:await r.json()}};
 return {db,call,view};
}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
const log={title:'Cooler gasket',detail:'Gasket split; manager must inspect and arrange repair.',category:'Maintenance',priority:'routine',ownerId:'manager',due:'2026-10-02T17:00:00-04:00'};
test('repair and daily brief share one persisted issue through resolution',async t=>{
 const f=await fixture(t);const record=ok(await f.call('manager','managerlog.create',log));
 const before=operationsHome(ok(await f.view('owner')),new Date().toISOString());
 assert.equal(before.repairs.length,1);assert.equal(before.repairs[0].id,record.recordId);
 const accepted=ok(await f.call('manager','managerlog.accept',{note:'Repair arranged'},record));
 ok(await f.call('manager','managerlog.resolve',{note:'Gasket replaced and inspected'},accepted));
 const after=ok(await f.view('owner'));
 assert.equal(operationsHome(after,new Date().toISOString()).repairs.length,0);
 assert.equal(after.records.filter(r=>r.kind==='managerlog').length,1,'No duplicate repair record');
 assert.equal(after.records.find(r=>r.id===record.recordId).data.resolution,'Gasket replaced and inspected');
});
test('handoff endpoint requires manager scope, rejects foreign store and omits private meetings',async t=>{
 const f=await fixture(t);ok(await f.call('manager','managerlog.create',log));
 ok(await f.call('owner','meeting.create',{managerId:'manager',cadenceDays:14,agenda:'Private coaching',due:log.due}));
 const request=(id,query='locationId=a&date=2026-09-28',method='GET')=>handleOperationsHandoff(new Request('https://test.example/api/operations/handoff?'+query,{method,headers:id?{'oai-authenticated-user-id':id+'-identity','oai-authenticated-user-email':id+'@example.test'}:{}}),f.db);
 assert.equal((await request(null)).status,401);
 assert.equal((await request('worker')).status,403);
 assert.equal((await request('foreign')).status,403);
 assert.equal((await request('foh','locationId=a&date=2026-09-28&department=BOH')).status,403);
 assert.equal((await request('owner','locationId=a&date=bad')).status,400);
 assert.equal((await request('owner','locationId=a','POST')).status,405);
 const r=await request('owner');assert.match(r.headers.get('cache-control'),/no-store/);
 const body=await r.json();assert.equal(body.issues.length,1);assert.equal(body.issues[0].assigned_member_id,'manager');
 assert.ok(!JSON.stringify(body).includes('Private coaching'));assert.equal(body.store_id,'a');
 const foh=await (await request('foh')).json();assert.equal(foh.issues.length,0);
});
test('Red Book persists, carries unresolved work, protects departments and requires outcome',async t=>{
 const f=await fixture(t);let record=ok(await f.call('manager','managerlog.create',log));
 assert.equal(ok(await f.view('opener')).records.filter(r=>r.kind==='managerlog').length,1);
 for(const actor of ['worker','foh']){assert.equal(ok(await f.view(actor)).records.some(r=>r.id===record.recordId),false);assert.equal((await f.call(actor,'managerlog.note',{note:'unauthorized'},record)).status,404);}
 assert.equal((await f.view('foreign')).status,403);
 assert.equal((await f.call('worker','managerlog.create',log)).status,403);
 assert.equal((await f.call('manager','managerlog.create',{...log,ownerId:'foreign'})).status,400);
 assert.equal((await f.call('opener','managerlog.accept',{note:'take'},record)).status,403);
 const accepted=ok(await f.call('manager','managerlog.accept',{note:'I have this'},record));
 assert.equal((await f.call('manager','managerlog.note',{note:'stale'},record)).status,409);
 record=ok(await f.call('manager','managerlog.reassign',{note:'Opener to follow up',ownerId:'opener',due:log.due},accepted));
 let saved=ok(await f.view('opener')).records.find(r=>r.id===record.recordId);assert.equal(saved.data.acceptedBy,'');assert.equal(saved.ownerId,'opener');
 assert.equal((await f.call('opener','managerlog.resolve',{note:''},record)).status,400);
 record=ok(await f.call('opener','managerlog.resolve',{note:'Replaced and inspected'},record));
 saved=ok(await f.view('owner')).records.find(r=>r.id===record.recordId);assert.equal(saved.data.status,'resolved');assert.equal(saved.data.history.length,4);
 record=ok(await f.call('manager','managerlog.reopen',{note:'Repair failed'},record));assert.equal(ok(await f.view('manager')).records.find(r=>r.id===record.recordId).data.status,'open');
 assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='message'").first()).n,0,'No phantom sends');
});
test('private one-on-ones persist recurrence, carry follow-ups, and reject other owners',async t=>{
 const f=await fixture(t),input={managerId:'manager',cadenceDays:14,due:'2026-10-01T10:00:00-04:00',agenda:'Support and next actions'};
 assert.equal((await f.call('manager','meeting.create',input)).status,403);
 let r=ok(await f.call('owner','meeting.create',input));
 assert.equal((await f.call('owner','meeting.create',input)).status,409);
 for(const actor of ['worker','opener','otherowner']){assert.equal(ok(await f.view(actor)).records.some(x=>x.kind==='meeting'),false);assert.equal((await f.call(actor,'meeting.complete',{notes:'private'},r)).status,404);}
 r=ok(await f.call('manager','meeting.action',{title:'Review closing handoff',ownerId:'manager',due:input.due},r));
 let saved=ok(await f.view('owner')).records.find(x=>x.id===r.recordId),actionId=saved.data.actions[0].id;
 r=ok(await f.call('owner','meeting.complete',{notes:'Agreed support plan'},r));
 saved=ok(await f.view('manager')).records.find(x=>x.id===r.recordId);assert.equal(saved.data.sessions.length,1);assert.equal(saved.data.actions[0].doneAt,'');assert.ok(Date.parse(saved.data.due)>Date.now());
 assert.equal((await f.call('manager','meeting.schedule',{...input,note:'change'},r)).status,403);
 r=ok(await f.call('owner','meeting.schedule',{...input,cadenceDays:7,note:'Weekly while training'},r));
 r=ok(await f.call('manager','meeting.action-complete',{actionId},r));
 saved=ok(await f.view('owner')).records.find(x=>x.id===r.recordId);assert.equal(saved.data.cadenceDays,7);assert.ok(saved.data.actions[0].doneAt);assert.equal(saved.data.sessions[0].notes,'Agreed support plan');
});
test('retry is idempotent and a failed save rolls back the entry',async t=>{
 const f=await fixture(t),extra={requestId:'repeat-log'};
 const first=ok(await f.call('manager','managerlog.create',log,undefined,extra));
 assert.deepEqual(ok(await f.call('manager','managerlog.create',log,undefined,extra)),first);
 assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='managerlog'").first()).n,1);
 await f.db.prepare("CREATE TRIGGER fail_log BEFORE INSERT ON command_receipts WHEN NEW.request_id='failed-log' BEGIN SELECT RAISE(ABORT,'test rollback'); END").run();
 assert.equal((await f.call('manager','managerlog.create',{...log,title:'Rollback'},undefined,{requestId:'failed-log'})).status,503);
 assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='managerlog'").first()).n,1);
});

test('shift summary requires explicit submission and preserves corrected content and department access',async t=>{
 const f=await fixture(t),issue=ok(await f.call('owner','managerlog.create',{...log,department:'BOH'}));
 const input={businessDate:'2026-09-21',department:'BOH',shift:'closing',summary:'Cooler repair pending',tomorrowNote:'Inspect before opening',readiness:'action-needed',issueIds:[issue.recordId]};
 let r=ok(await f.call('manager','shiftentry.save',input));
 let saved=ok(await f.view('manager')).records.find(x=>x.id===r.recordId);assert.equal(saved.data.status,'draft');assert.equal(saved.data.submittedAt,'');
 assert.equal((await f.call('opener','shiftentry.save',input)).status,409,'Duplicate date/department/shift rejected');
 assert.equal((await f.call('foh','shiftentry.save',input)).status,403);
 assert.equal((await f.call('foh','shiftentry.submit',{},r)).status,404);
 assert.equal((await f.call('worker','shiftentry.save',input)).status,403);
 assert.equal((await f.call('manager','shiftentry.save',{...input,businessDate:'2099-01-01'})).status,400);
 assert.equal((await f.call('foh','shiftentry.save',{...input,department:'FOH'})).status,400,'Cross-department issue rejected');
 r=ok(await f.call('opener','shiftentry.submit',{},r));
 assert.equal((await f.call('manager','shiftentry.save',{...input,summary:'Overwritten'},r)).status,400,'Submitted edits need a reason');
 const prior=r;
 r=ok(await f.call('manager','shiftentry.save',{...input,summary:'Corrected cooler condition',note:'Added inspection result'},r));
 assert.equal((await f.call('manager','shiftentry.save',{...input,note:'Stale'},prior)).status,409);
 saved=ok(await f.view('manager')).records.find(x=>x.id===r.recordId);
 assert.equal(saved.data.status,'submitted');assert.ok(saved.data.submittedAt);assert.equal(saved.data.versions[0].summary,input.summary);assert.deepEqual(saved.data.versions[0].issueIds,[issue.recordId]);assert.equal(saved.data.history.at(-1).note,'Added inspection result');
 const opening=previousShift(ok(await f.view('manager')),'2026-09-23','BOH');assert.equal(opening.id,r.recordId);assert.equal(opening.data.tomorrowNote,input.tomorrowNote);
 // An owner assigned to a department does not move the issue to Executive.
 const handoff=ok(await f.call('manager','managerlog.create',{...log,ownerId:'owner'}));assert.equal(ok(await f.view('opener')).records.find(x=>x.id===handoff.recordId).area,'BOH');
});

test('shared seven-day fixture keeps closed days empty and reconstructs opening carryover',async t=>{
 const f=await fixture(t);await seedManagerFixture(f.db);
 // Ordinary managers and employees remain pinned to one restaurant. Use
 // separate fictional identities instead of bypassing that policy with one
 // email spread across all four fixture locations.
 for(const store of ['rudds','berts','papa','comm'])await f.db.prepare("UPDATE memberships SET email=replace(email,'@',?) WHERE location_id=?").bind('-'+store+'@',store).run();
 const read=async(actor,store)=>{
  const response=await handleWorkspace(new Request('https://test.example/api/workspace?locationId='+store,{headers:{'oai-authenticated-user-id':actor+'-'+store+'-fixture','oai-authenticated-user-email':actor+'-'+store+'@example.test'}}),f.db);
  assert.equal(response.status,200);return response.json();
 };
 let count=0;
 for(const store of ['rudds','berts','papa','comm']){
  const w=await read('admin',store),entries=w.records.filter(r=>r.kind==='shiftentry');count+=entries.length;
  assert.ok(w.records.every(r=>r.locationId===store));assert.ok(entries.every(r=>r.data.readiness!=='ready'));
  for(const closed of sharedFixture.closed_days.filter(d=>d.store_id===store))assert.equal(entries.some(e=>e.data.businessDate===closed.business_date),false);
  assert.ok(w.records.filter(r=>r.kind==='managerlog').every(r=>r.data.due===null),'Unset fixture deadlines remain unset');
  assert.equal((await read('worker',store)).records.length,0,'Employees cannot read manager logs');
 }
 assert.equal(count,32);assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='managerlog'").first()).n,4);
 const rudds=await read('foh','rudds');
 assert.deepEqual(carriedIssues(rudds,'2026-09-23','FOH').map(r=>r.id),['demo-issue-rudds-01']);
 assert.equal(carriedIssues(rudds,'2026-09-24','FOH').length,0);
 assert.equal(previousShift(rudds,'2026-09-23','FOH').data.businessDate,'2026-09-21');
 assert.equal(carriedIssues(await read('boh','rudds'),'2026-09-23','BOH').length,0);
 assert.equal(carriedIssues(await read('admin','comm'),'2026-09-23','production').length,0);
 // The source's carried-ID arrays omit same-day resolutions. History is used
 // at opening; current resolved status must not erase the earlier obligation.
 assert.equal(carriedIssues(await read('admin','berts'),'2026-09-24','FOH').length,1);
 assert.equal(carriedIssues(await read('admin','papa'),'2026-09-26','combined').length,1);
});

test('access setup counts pending operations without exposing private meeting content',async t=>{
 const f=await fixture(t);
 ok(await f.call('manager','managerlog.create',log));
 ok(await f.call('manager','shiftentry.save',{businessDate:'2026-09-21',department:'BOH',shift:'closing',summary:'Draft',tomorrowNote:'',readiness:'not-assessed',issueIds:[]}));
 ok(await f.call('owner','meeting.create',{managerId:'manager',cadenceDays:14,due:log.due,agenda:'Private agenda marker'}));
 const response=await handleAccess(new Request('https://test.example/api/access?locationId=a',{headers:{'oai-authenticated-user-id':'otherowner-identity','oai-authenticated-user-email':'otherowner@example.test'}}),f.db);
 assert.equal(response.status,200);const access=await response.json(),manager=access.accounts.find(a=>a.id==='manager');
 assert.equal(manager.outstanding,3);assert.deepEqual(manager.responsibilities.map(r=>r.category).sort(),['Active one-on-ones','Draft shift summaries','Manager Log follow-up']);
 assert.ok(!JSON.stringify(access).includes('Private agenda marker'));
});
