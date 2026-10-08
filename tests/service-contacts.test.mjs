import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {handleRecordHistory} from '../.sites-runtime/shared/history-service.mjs';
import {applyCommand,publicWorkspace} from '../.sites-runtime/shared/domain.mjs';
import {phoneLink,contactInstant} from '../.sites-runtime/shared/service-contacts.mjs';
import {companionContext} from '../.sites-runtime/shared/companion-context.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
async function fixture(t){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync(`drizzle/${file}`,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const loc of ['a','b'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(loc,loc,'America/New_York').run();
 for(const [id,area,caps,loc='a',position='Manager'] of [['owner','Executive',['location.manage']],['otherowner','Executive',['location.manage']],['manager','BOH',['tasks.manage']],['opener','BOH',['tasks.manage']],['foh','FOH',['tasks.manage']],['worker','BOH',[]],['coworker','BOH',[]],['server','FOH',[]],['dish','BOH',['location.manage'],'a','Dishwasher'],['foreign','BOH',['location.manage'],'b']])await db.prepare('INSERT INTO memberships(id,email,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?)').bind(id,id+'@example.test',loc,id,area,position,JSON.stringify(caps),'[]').run();
 const headers=id=>({'oai-authenticated-user-id':id+'-identity','oai-authenticated-user-email':id+'@example.test'});
 const call=async(id,action,input={},record,extra={},binding=db)=>{const response=await handleWorkspace(new Request('https://test.example/api/workspace',{method:'POST',headers:{...headers(id),Origin:'https://test.example','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),locationId:'a',action,input,...(record?{recordId:record.recordId??record.id,expectedRevision:record.revision}:{}),...extra})}),binding);return {status:response.status,data:await response.json()}};
 const view=async(id,loc='a')=>{const r=await handleWorkspace(new Request('https://test.example/api/workspace?locationId='+loc,{headers:headers(id)}),db);return {status:r.status,data:await r.json()}};
 return {db,call,view,headers};
}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
const facts={title:'Fictional equipment service',category:'Equipment repair',contactName:'Fictional desk',phone:'+1 (202) 555-0101',afterHoursPhone:'202-555-0102',hours:'Fictional hours for tests only',instructions:'Test extension 123',sourceRef:'Fictional checked service directory',note:'Checked against fictional source',checked:true};
const saved=async(f,who,r)=>ok(await f.view(who)).records.find(x=>x.id===(r.recordId??r.id));
const create=f=>f.call('owner','servicecontact.create',facts);
const issue=f=>f.call('manager','managerlog.create',{title:'Fictional broken unit',department:'BOH',category:'Maintenance',priority:'routine',ownerId:'manager',due:'2099-01-01T12:00:00Z',detail:'Fictional issue; no actual service needed.'});
const callFacts=c=>({contactId:c.recordId??c.id,contactRevision:c.revision,route:'regular',occurredAt:new Date().toISOString(),result:'no-answer',note:'No answer; manager will follow up.',confirmed:true});
const hist=async(f,who,params={},body)=>{const r=await handleRecordHistory(new Request('https://test.example/api/history?'+new URLSearchParams({locationId:'a',...params}),{headers:{...f.headers(who),Origin:'https://test.example','Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})}),f.db);return {status:r.status,data:await r.json()}};

test('owner checked directory is scoped to current restaurant managers; staff, Dish and foreign accounts cannot read it',async t=>{
 const f=await fixture(t),c=ok(await create(f));for(const who of ['manager','foh','opener']){const d=(await saved(f,who,c)).data;assert.equal(d.phone,facts.phone);assert.equal(d.internal,undefined);}
 for(const who of ['worker','dish','server'])assert.equal(await saved(f,who,c),undefined);
 for(const who of ['manager','worker','dish','foreign'])assert.equal((await f.call(who,'servicecontact.create',facts)).status,403);
 assert.equal((await f.view('foreign')).status,403);
 const foreign=ok(await f.call('foreign','servicecontact.create',facts,undefined,{locationId:'b'}));assert.equal((await f.call('owner','servicecontact.retire',{note:'Wrong store'},foreign)).status,404);
 assert.equal((await f.call('manager','servicecontact.revise',facts,c)).status,403);
 const safe=ok(await f.view('worker'));assert.ok(!JSON.stringify(safe).includes('555-010'));assert.ok(!JSON.stringify(companionContext(ok(await f.view('owner')),'Service contacts?',new Date().toISOString())).includes('555-010'));
 await f.db.prepare("UPDATE memberships SET capabilities='[]',revision=revision+1 WHERE id='manager'").run();assert.equal(await saved(f,'manager',c),undefined);
});
test('verified source, phone and availability validation prevents unsafe calling links and duplicate active contacts',async t=>{
 const f=await fixture(t);for(const patch of [{title:''},{category:'Unapproved category'},{phone:'javascript:alert(1)'},{phone:'tel:2025550101'},{phone:'123'},{phone:'2025550101;ext=123'},{phone:'2025550101#999'},{afterHoursPhone:'unknown'},{hours:''},{sourceRef:''},{checked:false},{note:''}])assert.equal((await f.call('owner','servicecontact.create',{...facts,...patch})).status,400,JSON.stringify(patch));
 assert.equal(phoneLink('+1 (202) 555-0101'),'tel:+12025550101');assert.equal(phoneLink('202-555-0101'),'tel:2025550101');assert.equal(phoneLink('++12025550101'),null);assert.equal(phoneLink('2025550101123456'),null);
 const c=ok(await create(f));assert.equal((await f.call('owner','servicecontact.create',{...facts,phone:'+12025550101'})).status,409);
 const w=ok(await f.view('owner'));assert.throws(()=>applyCommand({...w,me:{...w.me,scheduleOnly:true}},{action:'servicecontact.create',input:facts,locationId:'a',requestId:'disabled'},new Date().toISOString()),/owner/);
 assert.equal(publicWorkspace({...w,me:{...w.me,scheduleOnly:true}}).records.some(r=>r.id===c.recordId),false);
});
test('rechecking preserves prior details; retirement removes callable directory access and reactivation requires a new deliberate source check',async t=>{
 const f=await fixture(t);let c=ok(await create(f));c=ok(await f.call('owner','servicecontact.revise',{...facts,phone:'202-555-0110',note:'Fictional number changed'},c));
 let d=(await saved(f,'owner',c)).data;assert.equal(d.internal.versions[0].facts.phone,facts.phone);assert.equal(d.phone,'202-555-0110');
 c=ok(await f.call('owner','servicecontact.retire',{note:'Fictional service no longer used'},c));assert.equal(await saved(f,'manager',c),undefined);assert.equal((await saved(f,'owner',c)).data.status,'retired');
 assert.equal((await f.call('owner','servicecontact.revise',{...facts,checked:false},c)).status,400);c=ok(await f.call('owner','servicecontact.revise',{...facts,note:'Rechecked fictional contact'},c));d=(await saved(f,'manager',c)).data;assert.equal(d.status,'active');assert.equal(d.retirementNote,'');assert.equal((await saved(f,'owner',c)).data.internal.versions.length,2);
});
test('repair calls retain the actually selected number and result; updates or retired contacts never rewrite previous call reports',async t=>{
 const f=await fixture(t);let c=ok(await create(f)),r=ok(await issue(f));const data=callFacts(c);r=ok(await f.call('manager','managerlog.contact',data,r));
 let d=(await saved(f,'owner',r)).data;assert.equal(d.status,'open');assert.equal(d.contactAttempts.length,1);assert.equal(d.contactAttempts[0].result,'no-answer');assert.equal(d.contactAttempts[0].contact.phone,facts.phone);
 c=ok(await f.call('owner','servicecontact.revise',{...facts,phone:'202-555-0199'},c));assert.equal((await f.call('manager','managerlog.contact',{...data,occurredAt:new Date().toISOString()},r)).status,409);
 r=ok(await f.call('manager','managerlog.contact',{...callFacts(c),route:'after-hours',result:'left-message'},r));d=(await saved(f,'manager',r)).data;assert.equal(d.contactAttempts[1].contact.phone,facts.afterHoursPhone);
 c=ok(await f.call('owner','servicecontact.retire',{note:'Fictional retirement'},c));assert.equal((await f.call('manager','managerlog.contact',callFacts(c),r)).status,400);d=(await saved(f,'owner',r)).data;assert.equal(d.contactAttempts[0].contact.phone,facts.phone);assert.equal(d.contactAttempts[0].contact.revision,1);assert.equal(d.contactAttempts[1].contact.revision,2);
 assert.equal(ok(await f.view('owner')).records.filter(x=>x.kind==='message').length,0);
 assert.equal((await f.call('foh','managerlog.contact',callFacts(c),r)).status,404);assert.equal((await f.call('worker','managerlog.contact',callFacts(c),r)).status,404);
});
test('call reports require an actual outcome, explicit confirmation, current contact, correct department and nonfuture occurrence',async t=>{
 const f=await fixture(t),c=ok(await create(f));let r=ok(await issue(f));
 for(const patch of [{contactId:'missing'},{contactRevision:0},{route:'sms'},{occurredAt:'2099-01-01T01:00:00Z'},{occurredAt:'2000-01-01T01:00:00Z'},{result:'delivered'},{confirmed:false},{note:''}])assert.notEqual((await f.call('manager','managerlog.contact',{...callFacts(c),...patch},r)).status,200,JSON.stringify(patch));
 const w=ok(await f.view('manager')),at='2026-09-29T14:00:00Z';const created=w.records.find(x=>x.id===r.recordId);created.data.history[0].at='2026-09-29T13:00:00Z';
 assert.throws(()=>applyCommand(w,{locationId:'a',requestId:'future',action:'managerlog.contact',recordId:r.recordId,expectedRevision:r.revision,input:{...callFacts(c),occurredAt:'2026-09-29T14:00:01Z'}},at),/future/);
 r=ok(await f.call('manager','managerlog.resolve',{note:'Test outcome'},r));assert.equal((await f.call('manager','managerlog.contact',callFacts(c),r)).status,400);
});
test('exact retries and location revision guard preserve one contact and one report through racing edits and failed persistence',async t=>{
 const f=await fixture(t),extra={requestId:'contact-retry'};const c=ok(await f.call('owner','servicecontact.create',facts,undefined,extra));assert.deepEqual(ok(await f.call('owner','servicecontact.create',facts,undefined,extra)),c);assert.equal((await f.call('owner','servicecontact.create',{...facts,title:'Changed'},undefined,extra)).status,409);
 let r=ok(await issue(f));const report=callFacts(c),retry={requestId:'call-retry'};const result=ok(await f.call('manager','managerlog.contact',report,r,retry));assert.deepEqual(ok(await f.call('manager','managerlog.contact',report,r,retry)),result);r=await saved(f,'owner',r);assert.equal(r.data.contactAttempts.length,1);
 await f.db.prepare("CREATE TRIGGER fail_call BEFORE INSERT ON command_receipts WHEN NEW.request_id='call-fail' BEGIN SELECT RAISE(ABORT,'test rollback'); END").run();assert.equal((await f.call('manager','managerlog.contact',callFacts(c),r,{requestId:'call-fail'})).status,503);assert.equal((await saved(f,'owner',r)).data.contactAttempts.length,1);
 const race=await Promise.all([f.call('manager','managerlog.contact',callFacts(c),r),f.call('owner','servicecontact.retire',{note:'Retire during attempt'},c)]);assert.deepEqual(race.map(x=>x.status).sort(),[200,409]);
});
test('owner files retired contacts and restores them retired; history never exposes directory data to staff',async t=>{
 const f=await fixture(t);let c=ok(await create(f));c=ok(await f.call('owner','servicecontact.retire',{note:'Fictional retirement'},c));await f.db.prepare("UPDATE records SET updated_at='2026-01-01T12:00:00Z' WHERE id=?").bind(c.recordId).run();const before='2026-05-01',plan=ok(await hist(f,'owner',{preview:'1',before}));assert.equal(plan.records.length,1);assert.equal(ok(await hist(f,'manager',{preview:'1',before})).records.length,0);
 ok(await hist(f,'owner',{}, {locationId:'a',requestId:'archive-contact',action:'archive',confirmed:true,before,workspaceRevision:plan.workspaceRevision,records:plan.records.map(({id,revision})=>({id,revision}))}));
 assert.equal(ok(await hist(f,'owner',{kind:'servicecontact'})).items.length,1);for(const who of ['manager','worker','dish']){assert.equal(ok(await hist(f,who,{kind:'servicecontact'})).items.length,0);assert.equal((await hist(f,who,{recordId:c.recordId})).status,404);}
 const restore=ok(await hist(f,'owner',{restore:c.recordId}));ok(await hist(f,'owner',{}, {locationId:'a',requestId:'restore-contact',action:'restore',confirmed:true,recordId:c.recordId,workspaceRevision:restore.workspaceRevision,records:restore.records.map(({id,revision})=>({id,revision}))}));assert.equal((await saved(f,'owner',c)).data.status,'retired');assert.equal(await saved(f,'manager',c),undefined);
});

test('call times preserve entered seconds and require a deliberate repeated-hour choice',()=>{
 assert.equal(contactInstant('2026-09-29','08:57:23','America/New_York'),'2026-09-29T12:57:23.000Z');
 assert.equal(contactInstant('2026-09-29','08:57','America/New_York'),'2026-09-29T12:57:00.000Z');
 assert.throws(()=>contactInstant('2026-09-29','08:57:60','America/New_York'),/valid call time/);
 assert.throws(()=>contactInstant('2026-11-01','01:30:21','America/New_York'),/twice/);
 assert.equal(contactInstant('2026-11-01','01:30:21','America/New_York','later'),'2026-11-01T06:30:21.000Z');
 assert.throws(()=>contactInstant('2026-03-08','02:30:21','America/New_York'),/does not exist/);
});
