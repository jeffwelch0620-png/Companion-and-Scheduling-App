import {serviceCost,maintenanceCosts,serviceCostCents} from '../.sites-runtime/shared/maintenance-cost.mjs';
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
const cost=serviceId=>({serviceId,amount:'125.39',documentDate:'2026-09-28',sourceRef:'Fictional invoice TEST-COST-1',allocation:'This service only; fictional labor, parts and tax included',note:'Checked fictional source',confirmed:true});
const withService=async f=>{let r=ok(await create(f));r=ok(await f.call('manager','maintenance.service',service,r));return {r,id:(await saved(f,'owner',r)).data.services[0].id}};
test('service cost uses exact cents and distinguishes checked no-charge from missing evidence',()=>{
 for(const [input,cents] of [['0',0],['0.00',0],['1.2',120],['125.39',12539],['9999999.99',999999999]])assert.equal(serviceCostCents(input),cents);
 for(const x of ['',null,0,12.34,'-1','+1','01','1.001','1e3','NaN','Infinity',' 1','1,000','10000000.00'])assert.throws(()=>serviceCostCents(x));
 const known={id:'c',kind:'recorded',amountCents:0};assert.deepEqual(maintenanceCosts({services:[{costHistory:[known]},{},{voided:{},costHistory:[{...known,amountCents:5000}]}]}),{amountCents:0,recorded:1,missing:1,voided:1});
});
test('assigned manager records first cost; current owner corrects it without rewriting service or due date',async t=>{
 const f=await fixture(t);let {r,id}=await withService(f);const before=(await saved(f,'owner',r)).data.services[0];
 for(const who of ['foh','worker','dish','foreign'])assert.equal((await f.call(who,'maintenance.cost',cost(id),r)).status,403);
 r=ok(await f.call('manager','maintenance.cost',cost(id),r));let d=await saved(f,'owner',r);assert.equal(serviceCost(d.data.services[0]).amountCents,12539);assert.equal(schedule(d).due,'2026-10-28');
 assert.equal((await f.call('manager','maintenance.cost',{...cost(id),amount:'100'},r)).status,403);
 r=ok(await f.call('otherowner','maintenance.cost',{...cost(id),amount:'120.29',note:'Fictional invoice allocation correction'},r));d=await saved(f,'owner',r);assert.equal(d.data.services[0].costHistory.length,2);assert.equal(maintenanceCosts(d.data).amountCents,12029);
 const {costHistory,...unchanged}=d.data.services[0];assert.deepEqual(unchanged,before);
 await f.db.prepare("UPDATE memberships SET active=0 WHERE id='otherowner'").run();d=ok(await f.view('manager'));assert.ok(d.formerMembers.some(x=>x.id==='otherowner'));
 assert.equal(d.records.some(x=>x.kind==='message'),false);
});
test('cost evidence is deliberate, scoped and never inferred from an old service',async t=>{
 const f=await fixture(t);let {r,id}=await withService(f);
 for(const patch of [{amount:''},{amount:0},{sourceRef:''},{allocation:''},{documentDate:'2026-02-30'},{documentDate:'2099-01-01'},{note:''},{confirmed:false},{serviceId:'foreign-service'}])assert.notEqual((await f.call('manager','maintenance.cost',{...cost(id),...patch},r)).status,200,JSON.stringify(patch));
 r=ok(await f.call('manager','maintenance.cost',{...cost(id),amount:'0',sourceRef:'Fictional warranty no-charge report'},r));assert.equal(maintenanceCosts((await saved(f,'owner',r)).data).recorded,1);
});
test('withdrawal retains original evidence, restores unknown cost and permits owner replacement',async t=>{
 const f=await fixture(t);let {r,id}=await withService(f);r=ok(await f.call('manager','maintenance.cost',cost(id),r));
 assert.equal((await f.call('manager','maintenance.cost-withdraw',{serviceId:id,note:'Wrong invoice',confirmed:true},r)).status,403);
 assert.equal((await f.call('owner','maintenance.cost-withdraw',{serviceId:id,note:'Wrong invoice',confirmed:false},r)).status,400);
 r=ok(await f.call('owner','maintenance.cost-withdraw',{serviceId:id,note:'Fictional wrong invoice',confirmed:true},r));let d=await saved(f,'owner',r);assert.equal(serviceCost(d.data.services[0]),null);assert.equal(d.data.services[0].costHistory[0].sourceRef,cost(id).sourceRef);assert.equal(maintenanceCosts(d.data).missing,1);assert.equal(schedule(d).due,'2026-10-28');
 assert.equal((await f.call('owner','maintenance.cost-withdraw',{serviceId:id,note:'Again',confirmed:true},r)).status,400);
 r=ok(await f.call('owner','maintenance.cost',cost(id),r));assert.equal((await saved(f,'owner',r)).data.services[0].costHistory.length,3);
});
test('costs are excluded for voided work; retirement retains owner correction and filed history stays immutable',async t=>{
 const f=await fixture(t);let {r,id}=await withService(f);r=ok(await f.call('manager','maintenance.cost',cost(id),r));r=ok(await f.call('owner','maintenance.void',{serviceId:id,note:'Wrong service evidence',confirmed:true},r));let d=await saved(f,'owner',r);assert.equal(serviceCost(d.data.services[0]).amountCents,12539);assert.equal(maintenanceCosts(d.data).amountCents,0);assert.equal((await f.call('owner','maintenance.cost',cost(id),r)).status,400);
 r=ok(await f.call('manager','maintenance.service',service,r));id=(await saved(f,'owner',r)).data.services[1].id;r=ok(await f.call('owner','maintenance.retire',{note:'Retain fictional history'},r));
 assert.equal((await f.call('manager','maintenance.cost',cost(id),r)).status,404);r=ok(await f.call('owner','maintenance.cost',cost(id),r));
 await f.db.prepare("UPDATE records SET updated_at='2026-01-01T12:00:00Z' WHERE id=?").bind(r.recordId).run();const before='2026-05-01',plan=ok(await hist(f,'owner',{preview:'1',before}));
 ok(await hist(f,'owner',{}, {locationId:'a',requestId:'file-costs',action:'archive',confirmed:true,before,workspaceRevision:plan.workspaceRevision,records:plan.records.map(({id,revision})=>({id,revision}))}));
 const detail=ok(await hist(f,'owner',{recordId:r.recordId}));assert.match(JSON.stringify(detail),/TEST-COST-1/);assert.notEqual((await f.call('owner','maintenance.cost',cost(id),r)).status,200);assert.equal((await hist(f,'worker',{recordId:r.recordId})).status,404);
});
test('cost receipts, conflicts and transaction rollback prevent duplicate or partial cost evidence',async t=>{
 const f=await fixture(t);let {r,id}=await withService(f);const extra={requestId:'cost-once'},result=ok(await f.call('manager','maintenance.cost',cost(id),r,extra));assert.deepEqual(ok(await f.call('manager','maintenance.cost',cost(id),r,extra)),result);assert.equal((await f.call('manager','maintenance.cost',{...cost(id),amount:'5'},r,extra)).status,409);r=result;
 await f.db.prepare("CREATE TRIGGER fail_cost BEFORE INSERT ON command_receipts WHEN NEW.request_id='cost-fail' BEGIN SELECT RAISE(ABORT,'test rollback'); END").run();assert.equal((await f.call('owner','maintenance.cost',{...cost(id),amount:'8'},r,{requestId:'cost-fail'})).status,503);assert.equal((await saved(f,'owner',r)).data.services[0].costHistory.length,1);
 const race=await Promise.all([f.call('owner','maintenance.cost',{...cost(id),amount:'9'},r),f.call('otherowner','maintenance.cost-withdraw',{serviceId:id,note:'Fictional correction',confirmed:true},r)]);assert.deepEqual(race.map(x=>x.status).sort(),[200,409]);assert.equal((await saved(f,'owner',r)).data.services[0].costHistory.length,2);
});
test('cost evidence date uses restaurant day and history caps reject further changes without losing evidence',async t=>{
 const f=await fixture(t);let {r,id}=await withService(f);const w=ok(await f.view('owner')),cmd={locationId:'a',requestId:'local-day',action:'maintenance.cost',recordId:r.recordId,expectedRevision:r.revision,input:{...cost(id),documentDate:'2026-09-30'}};
 assert.throws(()=>applyCommand(w,cmd,'2026-09-30T02:00:00Z'),/future/);assert.doesNotThrow(()=>applyCommand(w,{...cmd,input:{...cmd.input,documentDate:'2026-09-29'}},'2026-09-30T02:00:00Z'));
 const rec=w.records.find(x=>x.id===r.recordId);rec.data.services[0].costHistory=Array.from({length:20},(_,i)=>({id:'cost-'+i,kind:'recorded',amountCents:i,by:'owner',at:'2026-09-29T00:00:00Z',note:'Fixture correction',currency:'USD',documentDate:'2026-09-28',sourceRef:'Fixture invoice',allocation:'Fixture service'}));
 assert.throws(()=>applyCommand(w,{...cmd,input:cost(id)},'2026-09-30T12:00:00Z'),/history limit/);assert.equal(rec.data.services[0].costHistory.length,20);
});

