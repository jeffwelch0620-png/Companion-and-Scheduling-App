import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {handleRecordHistory} from '../.sites-runtime/shared/history-service.mjs';
import {applyCommand,publicWorkspace} from '../.sites-runtime/shared/domain.mjs';
import {handleAccess} from '../.sites-runtime/shared/access-service.mjs';
import {maintenanceSchedule} from '../.sites-runtime/shared/maintenance.mjs';
import {maintenanceOccurrence,maintenanceTiming} from '../.sites-runtime/shared/maintenance-calendar.mjs';
import {operationsHome} from '../.sites-runtime/shared/operations-home.mjs';
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
const contactFacts={title:'Fictional equipment service',category:'Equipment repair',contactName:'Fictional desk',phone:'+1 (202) 555-0101',afterHoursPhone:'202-555-0102',hours:'Fictional hours for tests only',instructions:'Test extension 123',sourceRef:'Fictional checked service directory',note:'Checked against fictional source',checked:true};
const saved=async(f,who,r)=>ok(await f.view(who)).records.find(x=>x.id===(r.recordId??r.id));
const createContact=f=>f.call('owner','servicecontact.create',contactFacts);
const issue=f=>f.call('manager','managerlog.create',{title:'Fictional broken unit',department:'BOH',category:'Maintenance',priority:'routine',ownerId:'manager',due:'2099-01-01T12:00:00Z',detail:'Fictional issue; no actual service needed.'});
const callFacts=c=>({contactId:c.recordId??c.id,contactRevision:c.revision,route:'regular',occurredAt:new Date().toISOString(),result:'no-answer',note:'No answer; manager will follow up.',confirmed:true});
const hist=async(f,who,params={},body)=>{const r=await handleRecordHistory(new Request('https://test.example/api/history?'+new URLSearchParams({locationId:'a',...params}),{headers:{...f.headers(who),Origin:'https://test.example','Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})}),f.db);return {status:r.status,data:await r.json()}};

const facts={title:'Fictional filter service',equipment:'DEMO unit R-1',task:'Fictional complete task, not an operating procedure',sourceRef:'Fictional task agreement §1',initialDue:'2026-09-29',intervalDays:30,warningDays:5,managerId:'manager',note:'Checked fictional task and dates',checked:true};
const create=f=>f.call('owner','maintenance.create',facts);
const service={date:'2026-09-28',performedBy:'Fictional technician',evidence:'Fictional report TEST-001, test folder',note:'All fictional task requirements completed',completed:true};
const schedule=r=>maintenanceSchedule(r.data,'2026-09-29');


const assetFacts={title:'Fictional fryer',assetTag:'TEST-A1',placement:'Fictional west kitchen',manufacturer:'Fixture make',model:'Fixture model',serial:'FIXTURE-001',sourceRef:'Fictional checked label',details:'Fixture only',checked:true,note:'Label and physical unit checked'};
const assetCreate=f=>f.call('owner','equipment.create',assetFacts);
const linked=(a,patch={})=>({...facts,assetId:a.recordId??a.id,assetRevision:a.revision,...patch});
test('equipment register is owner-maintained, manager-readable, restaurant-scoped and absent from employee/AI context',async t=>{
 const f=await fixture(t),a=ok(await assetCreate(f));
 for(const who of ['owner','manager','foh'])assert.equal((await saved(f,who,a)).data.assetTag,'TEST-A1');
 for(const who of ['worker','dish'])assert.equal(await saved(f,who,a),undefined);
 for(const who of ['manager','worker','dish'])assert.equal((await f.call(who,'equipment.create',assetFacts)).status,403);
 assert.equal((await f.call('foreign','equipment.create',assetFacts)).status,403);
 const w=ok(await f.view('manager'));assert.equal(publicWorkspace({...w,me:{...w.me,scheduleOnly:true}}).records.some(r=>r.id===a.recordId),false);
 assert.ok(!JSON.stringify(companionContext(w,'What needs attention?',new Date().toISOString())).includes(assetFacts.serial));
});
test('equipment requires checked fields, retains unique tags even retired, reactivates only by recheck and never renames a tag',async t=>{
 const f=await fixture(t);
 for(const patch of [{title:''},{assetTag:''},{placement:''},{sourceRef:''},{checked:false},{note:''}])assert.equal((await f.call('owner','equipment.create',{...assetFacts,...patch})).status,400);
 let a=ok(await f.call('owner','equipment.create',{...assetFacts,manufacturer:'',model:'',serial:'',details:''}));
 assert.equal((await f.call('owner','equipment.create',{...assetFacts,assetTag:' test-a1 '})).status,409);
 assert.equal((await f.call('owner','equipment.revise',{...assetFacts,assetTag:'OTHER'},a)).status,400);
 a=ok(await f.call('owner','equipment.retire',{note:'Fictional retirement'},a));
 assert.equal(await saved(f,'manager',a),undefined);assert.equal((await assetCreate(f)).status,409);
 assert.equal((await f.call('owner','equipment.revise',{...assetFacts,checked:false},a)).status,400);
 a=ok(await f.call('owner','equipment.revise',assetFacts,a));assert.equal((await saved(f,'manager',a)).data.status,'active');
 assert.equal((await saved(f,'owner',a)).data.versions.length,1);
});
test('maintenance selects current same-restaurant equipment and copies checked details rather than trusting input snapshots',async t=>{
 const f=await fixture(t),a=ok(await assetCreate(f));
 assert.equal((await f.call('owner','maintenance.create',linked(a,{assetRevision:0}))).status,409);
 assert.equal((await f.call('owner','maintenance.create',linked(a,{assetId:'missing'}))).status,400);
 const r=ok(await f.call('owner','maintenance.create',linked(a,{asset:{id:'forged',facts:{serial:'forged'}}})));
 const d=await saved(f,'owner',r);assert.equal(d.data.asset.id,a.recordId);assert.equal(d.data.asset.facts.serial,assetFacts.serial);
 await f.db.prepare("UPDATE records SET location_id='b' WHERE id=?").bind(a.recordId).run();
 assert.equal((await f.call('owner','maintenance.create',linked(a,{title:'Another'}))).status,400);
 assert.equal((await f.call('manager','maintenance.service',service,r)).status,409);
});
test('equipment changes invalidate linked service until plan recheck; old service snapshots and asset association survive',async t=>{
 const f=await fixture(t);let a=ok(await assetCreate(f)),r=ok(await f.call('owner','maintenance.create',linked(a)));
 r=ok(await f.call('manager','maintenance.service',service,r));
 a=ok(await f.call('owner','equipment.revise',{...assetFacts,placement:'Fictional east kitchen',sourceRef:'Fictional rechecked label'},a));
 assert.equal((await f.call('manager','maintenance.service',{...service,date:'2026-09-27'},r)).status,409);
 assert.equal((await f.call('owner','maintenance.revise',facts,r)).status,400);
 const other=ok(await f.call('owner','equipment.create',{...assetFacts,assetTag:'TEST-A2'}));
 assert.equal((await f.call('owner','maintenance.revise',linked(other),r)).status,400);
 r=ok(await f.call('owner','maintenance.revise',linked(a),r));
 r=ok(await f.call('manager','maintenance.service',{...service,date:'2026-09-27'},r));
 const d=await saved(f,'owner',r);assert.equal(d.data.services[0].plan.asset.facts.placement,assetFacts.placement);assert.equal(d.data.services[1].plan.asset.facts.placement,'Fictional east kitchen');
 assert.equal(d.data.versions[0].facts.asset.revision,1);
 a=ok(await f.call('owner','equipment.retire',{note:'Fictional retirement'},a));
 assert.equal((await f.call('manager','maintenance.service',{...service,date:'2026-09-26'},r)).status,409);
 assert.equal(operationsHome(ok(await f.view('manager')),'2027-01-01T12:00:00Z').maintenance.length,1);
 a=ok(await f.call('owner','equipment.revise',assetFacts,a));
 assert.equal((await f.call('manager','maintenance.service',{...service,date:'2026-09-26'},r)).status,409);
});
test('unlinked old plans stay usable and cannot be relabeled as checked linked equipment after service',async t=>{
 const f=await fixture(t),a=ok(await assetCreate(f));let r=ok(await create(f));
 r=ok(await f.call('manager','maintenance.service',service,r));assert.equal((await saved(f,'owner',r)).data.asset,undefined);
 assert.equal((await f.call('owner','maintenance.revise',linked(a),r)).status,400);
});
test('equipment retry, stale revision and rollback retain one checked record without partial audit or versions',async t=>{
 const f=await fixture(t),request={requestId:'asset-once'},a=ok(await f.call('owner','equipment.create',assetFacts,undefined,request));
 assert.deepEqual(ok(await f.call('owner','equipment.create',assetFacts,undefined,request)),a);
 assert.equal((await f.call('owner','equipment.create',{...assetFacts,note:'Changed'},undefined,request)).status,409);
 await f.db.prepare("CREATE TRIGGER fail_asset BEFORE INSERT ON command_receipts WHEN NEW.request_id='asset-fail' BEGIN SELECT RAISE(ABORT,'fixture rollback'); END").run();
 assert.equal((await f.call('owner','equipment.revise',{...assetFacts,placement:'Different'},a,{requestId:'asset-fail'})).status,503);
 assert.equal((await saved(f,'owner',a)).data.versions.length,0);
 const race=await Promise.all([f.call('owner','equipment.revise',assetFacts,a),f.call('otherowner','equipment.retire',{note:'Test retire'},a)]);
 assert.deepEqual(race.map(x=>x.status).sort(),[200,409]);
});
test('equipment edits between plan validation and commit invalidate the workspace transaction',async t=>{
 const f=await fixture(t),a=ok(await assetCreate(f));let batches=0;
 const binding={withSession:()=>({prepare:(...args)=>f.db.prepare(...args),batch:async statements=>{batches++;if(batches===2)ok(await f.call('owner','equipment.revise',{...assetFacts,placement:'Changed during save'},a));return f.db.batch(statements)}})};
 assert.equal((await f.call('owner','maintenance.create',linked(a),undefined,{},binding)).status,409);
 assert.equal((await f.db.prepare("SELECT count(*) n FROM records WHERE kind='maintenance'").first()).n,0);
});
test('filed linked plan retains its asset snapshot and restoring it does not bypass current equipment checks',async t=>{
 const f=await fixture(t);let a=ok(await assetCreate(f)),r=ok(await f.call('owner','maintenance.create',linked(a)));
 r=ok(await f.call('manager','maintenance.service',service,r));r=ok(await f.call('owner','maintenance.retire',{note:'Keep history'},r));
 a=ok(await f.call('owner','equipment.retire',{note:'Removed from service'},a));
 await f.db.prepare("UPDATE records SET updated_at='2026-01-01T12:00:00Z'").run();
 const p=ok(await hist(f,'owner',{preview:'1',before:'2026-05-01'}));assert.ok(p.records.some(x=>x.id===r.recordId));assert.ok(p.records.some(x=>x.id===a.recordId));
 ok(await hist(f,'owner',{}, {locationId:'a',requestId:'file-linked',action:'archive',confirmed:true,before:'2026-05-01',workspaceRevision:p.workspaceRevision,records:p.records.map(({id,revision})=>({id,revision}))}));
 const d=ok(await hist(f,'owner',{recordId:r.recordId}));assert.ok(JSON.stringify(d).includes(assetFacts.serial));
 const restore=ok(await hist(f,'owner',{restore:r.recordId}));ok(await hist(f,'owner',{}, {locationId:'a',requestId:'restore-linked',action:'restore',confirmed:true,recordId:r.recordId,workspaceRevision:restore.workspaceRevision,records:restore.records.map(({id,revision})=>({id,revision}))}));
 r=await saved(f,'owner',r);assert.equal(r.data.status,'retired');assert.equal((await f.call('owner','maintenance.revise',linked(a),r)).status,400);
});

const ageEquipment=async f=>f.db.prepare("UPDATE records SET updated_at='2026-01-01T12:00:00Z'").run();
const filePlan=async(f,requestId='fixture-file')=>{const p=ok(await hist(f,'owner',{preview:'1',before:'2026-05-01'}));const body={locationId:'a',requestId,action:'archive',confirmed:true,before:'2026-05-01',workspaceRevision:p.workspaceRevision,records:p.records.map(({id,revision})=>({id,revision}))};return {preview:p,body,result:await hist(f,'owner',{},body)}};
test('only older retired assets with no live maintenance dependants can be filed',async t=>{
 const f=await fixture(t);let a=ok(await assetCreate(f));await ageEquipment(f);assert.equal(ok(await hist(f,'owner',{preview:'1',before:'2026-05-01'})).records.length,0);
 let r=ok(await f.call('owner','maintenance.create',linked(a)));a=ok(await f.call('owner','equipment.retire',{note:'Fictional retirement'},a));await ageEquipment(f);
 let p=ok(await hist(f,'owner',{preview:'1',before:'2026-05-01'}));assert.equal(p.records.length,0);assert.equal(p.remainingCandidates,1);
 r=ok(await f.call('owner','maintenance.retire',{note:'Fictional retirement'},r));await ageEquipment(f);
 p=ok(await hist(f,'owner',{preview:'1',before:'2026-05-01'}));assert.deepEqual(p.records.map(x=>x.id),[r.recordId,a.recordId]);
 assert.equal(ok(await hist(f,'manager',{preview:'1',before:'2026-05-01'})).records.length,0);
 const filed=await filePlan(f);assert.equal(ok(filed.result).count,2);assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM records WHERE archived_at IS NOT NULL').first()).n,2);
});
test('filed equipment retains source, versions and tags while history stays owner-only and restaurant-scoped',async t=>{
 const f=await fixture(t);let a=ok(await assetCreate(f));a=ok(await f.call('owner','equipment.revise',{...assetFacts,placement:'Fictional east kitchen'},a));a=ok(await f.call('owner','equipment.retire',{note:'Fictional decommissioning'},a));await ageEquipment(f);
 const filed=await filePlan(f);assert.ok(filed.preview.records[0].label.includes(assetFacts.assetTag));ok(filed.result);assert.equal(await saved(f,'owner',a),undefined);
 const page=ok(await hist(f,'owner',{kind:'equipment'}));assert.equal(page.items.length,1);assert.equal(page.items[0].record.data.versions[0].facts.placement,assetFacts.placement);assert.equal(page.items[0].record.data.retirementNote,'Fictional decommissioning');
 const detail=ok(await hist(f,'owner',{recordId:a.recordId}));assert.equal(detail.canRestore,true);assert.equal(detail.workspace.records.find(x=>x.id===a.recordId).data.serial,assetFacts.serial);
 for(const who of ['manager','worker','dish']){assert.equal(ok(await hist(f,who,{kind:'equipment'})).items.length,0);assert.equal((await hist(f,who,{recordId:a.recordId})).status,404);assert.equal((await hist(f,who,{restore:a.recordId})).status,403);}
 assert.equal((await hist(f,'foreign',{kind:'equipment'})).status,403);
 assert.equal((await f.call('owner','equipment.create',{...assetFacts,assetTag:' test-a1 '})).status,409);
 assert.equal((await f.call('foreign','equipment.create',assetFacts,undefined,{locationId:'b'})).status,200);
});
test('restoring linked history brings its retired asset and still requires asset and plan rechecks',async t=>{
 const f=await fixture(t);let a=ok(await assetCreate(f)),r=ok(await f.call('owner','maintenance.create',linked(a)));r=ok(await f.call('manager','maintenance.service',service,r));r=ok(await f.call('owner','maintenance.retire',{note:'Fictional plan retired'},r));a=ok(await f.call('owner','equipment.retire',{note:'Fictional asset retired'},a));await ageEquipment(f);ok((await filePlan(f)).result);
 const restore=ok(await hist(f,'owner',{restore:r.recordId}));assert.deepEqual(new Set(restore.records.map(x=>x.id)),new Set([a.recordId,r.recordId]));
 const body={locationId:'a',requestId:'fixture-restore-asset',action:'restore',confirmed:true,recordId:r.recordId,workspaceRevision:restore.workspaceRevision,records:restore.records.map(({id,revision})=>({id,revision}))};const result=ok(await hist(f,'owner',{},body));assert.deepEqual(ok(await hist(f,'owner',{},body)),result);
 a=await saved(f,'owner',a);r=await saved(f,'owner',r);assert.equal(a.data.status,'retired');assert.equal(r.data.status,'retired');assert.equal(r.data.services[0].plan.asset.revision,1);
 assert.equal((await f.call('owner','maintenance.revise',linked(a),r)).status,400);
 a=ok(await f.call('owner','equipment.revise',assetFacts,a));assert.equal((await f.call('manager','maintenance.service',service,r)).status,404);
 r=ok(await f.call('owner','maintenance.revise',linked(a),r));r=ok(await f.call('manager','maintenance.service',{...service,date:'2026-09-27'},r));assert.equal((await saved(f,'owner',r)).data.services.length,2);
});
test('equipment filing is explicit, stale-safe, retryable and atomic with audit and receipt',async t=>{
 const f=await fixture(t);let a=ok(await assetCreate(f));a=ok(await f.call('owner','equipment.retire',{note:'Fictional retirement'},a));await ageEquipment(f);
 let p=ok(await hist(f,'owner',{preview:'1',before:'2026-05-01'}));const body={locationId:'a',requestId:'fixture-file-fail',action:'archive',confirmed:true,before:'2026-05-01',workspaceRevision:p.workspaceRevision,records:p.records.map(({id,revision})=>({id,revision}))};
 assert.equal((await hist(f,'owner',{}, {...body,confirmed:false})).status,400);
 await f.db.prepare("CREATE TRIGGER fail_equipment_file BEFORE INSERT ON command_receipts WHEN NEW.request_id='fixture-file-fail' BEGIN SELECT RAISE(ABORT,'fixture rollback'); END").run();assert.equal((await hist(f,'owner',{},body)).status,503);assert.ok(await saved(f,'owner',a));assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='history.archive'").first()).n,0);
 await f.db.prepare('DROP TRIGGER fail_equipment_file').run();const filed=ok(await hist(f,'owner',{},body));assert.deepEqual(ok(await hist(f,'owner',{},body)),filed);assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='history.archive'").first()).n,1);
 const restore=ok(await hist(f,'owner',{restore:a.recordId}));ok(await hist(f,'owner',{}, {locationId:'a',requestId:'fixture-restore-stale',action:'restore',confirmed:true,recordId:a.recordId,workspaceRevision:restore.workspaceRevision,records:restore.records.map(({id,revision})=>({id,revision}))}));await ageEquipment(f);p=ok(await hist(f,'owner',{preview:'1',before:'2026-05-01'}));a=await saved(f,'owner',a);ok(await f.call('owner','equipment.revise',assetFacts,a));
 assert.equal((await hist(f,'owner',{}, {...body,requestId:'stale-file',workspaceRevision:p.workspaceRevision,records:p.records.map(({id,revision})=>({id,revision}))})).status,409);assert.ok(await saved(f,'owner',a));
});
test('filed tag lookup pages projected tags and preserves Unicode case folding beyond the first page',async t=>{
 const f=await fixture(t);
 for(let i=0;i<101;i++)await f.db.prepare("INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at,archived_at,archived_by) VALUES(?,'a','equipment','owner','Executive',1,?,'2026-01-01','2026-01-02','owner')").bind('filed-'+String(i).padStart(3,'0'),JSON.stringify({assetTag:i===100?'ÉQUIPEMENT-001':'FIX-'+i})).run();
 assert.equal((await f.call('owner','equipment.create',{...assetFacts,assetTag:'équipement-001'})).status,409);ok(await f.call('owner','equipment.create',{...assetFacts,assetTag:'Unrelated-tag'}));
});
test('history reads suppress filed equipment when access changes after reading the source',async t=>{
 const f=await fixture(t);let a=ok(await assetCreate(f));a=ok(await f.call('owner','equipment.retire',{note:'Fictional retirement'},a));await ageEquipment(f);ok((await filePlan(f)).result);
 const binding={withSession(){return this},batch:s=>f.db.batch(s),prepare(sql){const p=f.db.prepare(sql);return {bind(...args){const b=p.bind(...args);if(!sql.startsWith('SELECT * FROM records WHERE location_id=? AND id=? AND archived_at IS NOT NULL'))return b;return {async first(){const value=await b.first();await f.db.prepare("UPDATE memberships SET revision=revision+1,capabilities='[]' WHERE id='owner'").run();return value}}}}}};
 const r=await handleRecordHistory(new Request('https://test.example/api/history?locationId=a&recordId='+a.recordId,{headers:f.headers('owner')}),binding);assert.equal(r.status,409);assert.doesNotMatch(await r.text(),/FIXTURE-001|Fictional fryer/);
});
