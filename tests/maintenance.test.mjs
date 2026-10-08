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

test('checked maintenance is scoped to restaurant managers; only owner configures and assigned manager or owner records work',async t=>{
 const f=await fixture(t),r=ok(await create(f));
 for(const who of ['owner','otherowner','manager','foh'])assert.equal((await saved(f,who,r)).data.title,facts.title);
 for(const who of ['worker','dish'])assert.equal(await saved(f,who,r),undefined);
 assert.equal((await f.view('foreign')).status,403);
 for(const who of ['manager','foh','worker','dish'])assert.equal((await f.call(who,'maintenance.create',facts)).status,403);
 assert.equal((await f.call('foh','maintenance.service',service,r)).status,403);
 assert.equal((await f.call('worker','maintenance.service',service,r)).status,403);
 const w=ok(await f.view('manager'));assert.equal(publicWorkspace({...w,me:{...w.me,scheduleOnly:true}}).records.some(x=>x.id===r.recordId),false);
 assert.throws(()=>applyCommand({...w,me:{...w.me,scheduleOnly:true}},{locationId:'a',requestId:'disabled',action:'maintenance.service',recordId:r.recordId,expectedRevision:r.revision,input:service},new Date().toISOString()),/manager/);
 ok(await f.call('manager','maintenance.service',service,r));assert.equal(ok(await f.view('owner')).records.filter(x=>x.kind==='message').length,0);
});
test('source fields and recurrence require deliberate checked values and a current manager; empty or fabricated defaults are rejected',async t=>{
 const f=await fixture(t);for(const patch of [{title:''},{equipment:''},{task:''},{sourceRef:''},{initialDue:'2026-02-30'},{intervalDays:0},{intervalDays:1.5},{intervalDays:'30'},{intervalDays:3651},{warningDays:-1},{warningDays:366},{warningDays:'5'},{checked:false},{note:''},{managerId:'worker'},{managerId:'dish'},{managerId:'foreign'}])assert.notEqual((await f.call('owner','maintenance.create',{...facts,...patch})).status,200,JSON.stringify(patch));
 ok(await create(f));assert.equal((await create(f)).status,409);
 await f.db.prepare("UPDATE memberships SET schedule_only=1,revision=revision+1 WHERE id='manager'").run();assert.notEqual((await f.call('owner','maintenance.create',{...facts,title:'Another'})).status,200);
});
test('actual service and late-entered older evidence use latest actual date, retain source and do not invent a completed date',async t=>{
 const f=await fixture(t);let r=ok(await create(f));let d=await saved(f,'owner',r);assert.equal(schedule(d).due,facts.initialDue);assert.equal(schedule(d).latest,null);assert.equal(schedule(d).state,'today');
 for(const patch of [{date:'2099-01-01'},{date:'2026-02-30'},{performedBy:''},{evidence:''},{completed:false},{note:''}])assert.equal((await f.call('manager','maintenance.service',{...service,...patch},r)).status,400);
 r=ok(await f.call('manager','maintenance.service',service,r));d=await saved(f,'owner',r);assert.equal(schedule(d).due,'2026-10-28');assert.equal(d.data.services[0].plan.sourceRef,facts.sourceRef);
 assert.equal((await f.call('manager','maintenance.service',service,r)).status,409);
 r=ok(await f.call('owner','maintenance.service',{...service,date:'2026-09-01'},r));d=await saved(f,'owner',r);assert.equal(schedule(d).due,'2026-10-28');assert.equal(d.data.services.length,2);
});
test('calendar day recurrence handles leap days, DST and local warning windows without skipping Tuesday maintenance',async()=>{
 const data={...facts,status:'active',services:[]};
 assert.equal(maintenanceSchedule(data,'2026-09-28').state,'soon');assert.equal(maintenanceSchedule(data,'2026-09-30').state,'overdue');assert.equal(maintenanceSchedule(data,'2026-09-23').state,'upcoming');
 assert.equal(maintenanceSchedule({...data,intervalDays:1,services:[{date:'2028-02-28',voided:null}]},'2028-02-28').due,'2028-02-29');
 assert.equal(maintenanceSchedule({...data,intervalDays:1,services:[{date:'2026-03-08',voided:null}]},'2026-03-08').due,'2026-03-09');
 const me={id:'o',locationId:'a',name:'Owner',position:'Manager',area:'Executive',capabilities:['location.manage'],qualifications:[]};
 const r={id:'p',locationId:'a',ownerId:'o',area:'Executive',kind:'maintenance',revision:1,updatedAt:'2026-09-28T00:00:00Z',data};const w={location:{id:'a',timezone:'America/New_York'},me,members:[me],records:[r,{...r,id:'foreign',locationId:'b'}]};
 const monday=operationsHome(w,'2026-09-29T02:00:00Z');assert.equal(monday.day,'2026-09-28');assert.equal(monday.maintenance.length,1);assert.equal(monday.maintenance[0].state,'soon');
 const tuesday=operationsHome(w,'2026-09-29T12:00:00Z');assert.equal(tuesday.maintenance[0].state,'today');
 assert.equal(operationsHome({...w,me:{...me,capabilities:[]}},'2026-09-29T12:00:00Z').maintenance.length,0);
});
test('owner voids wrong evidence without erasing it; schedule falls back to prior actual work then initial source date',async t=>{
 const f=await fixture(t);let r=ok(await create(f));r=ok(await f.call('manager','maintenance.service',{...service,date:'2026-09-01'},r));r=ok(await f.call('manager','maintenance.service',service,r));let d=await saved(f,'owner',r),latest=d.data.services[1];
 assert.equal((await f.call('manager','maintenance.void',{serviceId:latest.id,note:'Test correction',confirmed:true},r)).status,403);
 assert.equal((await f.call('owner','maintenance.void',{serviceId:latest.id,note:'Test correction',confirmed:false},r)).status,400);
 r=ok(await f.call('owner','maintenance.void',{serviceId:latest.id,note:'Fictional date entered incorrectly',confirmed:true},r));d=await saved(f,'owner',r);assert.equal(schedule(d).due,'2026-10-01');assert.equal(d.data.services[1].evidence,service.evidence);assert.ok(d.data.services[1].voided);
 assert.equal((await f.call('owner','maintenance.void',{serviceId:latest.id,note:'Again',confirmed:true},r)).status,400);
 r=ok(await f.call('owner','maintenance.void',{serviceId:d.data.services[0].id,note:'Fictional wrong task',confirmed:true},r));d=await saved(f,'owner',r);assert.equal(schedule(d).due,facts.initialDue);
 r=ok(await f.call('manager','maintenance.service',service,r));assert.equal(schedule(await saved(f,'owner',r)).due,'2026-10-28');
});
test('source revision recalculates explicit interval but keeps service evidence attached to the original equipment and task',async t=>{
 const f=await fixture(t);let r=ok(await create(f));r=ok(await f.call('manager','maintenance.service',service,r));
 r=ok(await f.call('owner','maintenance.revise',{...facts,intervalDays:14,warningDays:2,managerId:'foh',sourceRef:'Fictional revised agreement',note:'Checked new interval'},r));let d=await saved(f,'owner',r);assert.equal(schedule(d).due,'2026-10-12');assert.equal(d.data.versions[0].facts.intervalDays,30);assert.equal(d.data.services[0].plan.intervalDays,30);assert.equal(d.data.services[0].plan.managerId,'manager');
 for(const patch of [{equipment:'Another asset'},{task:'Different work'},{checked:false}])assert.equal((await f.call('owner','maintenance.revise',{...facts,...patch},r)).status,400);
 assert.equal((await f.call('manager','maintenance.service',{...service,date:'2026-09-27'},r)).status,403);
 r=ok(await f.call('owner','maintenance.retire',{note:'Fictional asset no longer used'},r));assert.equal(await saved(f,'manager',r),undefined);assert.equal((await f.call('owner','maintenance.service',service,r)).status,400);
 r=ok(await f.call('owner','maintenance.revise',{...facts,note:'Rechecked same asset and task'},r));assert.equal((await saved(f,'manager',r)).data.status,'active');
});
test('optional provider reference requires current same-store contact and preserves its source revision after retirement',async t=>{
 const f=await fixture(t);let c=ok(await createContact(f)),r=ok(await create(f));const input={...service,contactId:c.recordId,contactRevision:c.revision};
 assert.equal((await f.call('manager','maintenance.service',{...input,contactRevision:0},r)).status,409);
 assert.equal((await f.call('manager','maintenance.service',{...input,contactId:'missing'},r)).status,400);
 r=ok(await f.call('manager','maintenance.service',input,r));c=ok(await f.call('owner','servicecontact.retire',{note:'Fictional retirement'},c));const d=await saved(f,'owner',r);assert.equal(d.data.services[0].contact.title,contactFacts.title);assert.equal(d.data.services[0].contact.revision,1);
 assert.equal((await f.call('manager','maintenance.service',{...input,date:'2026-09-27',contactRevision:c.revision},r)).status,400);
});
test('retry receipts, racing edits and transaction failure cannot duplicate or partially persist service',async t=>{
 const f=await fixture(t),extra={requestId:'maintenance-create-once'};let r=ok(await f.call('owner','maintenance.create',facts,undefined,extra));assert.deepEqual(ok(await f.call('owner','maintenance.create',facts,undefined,extra)),r);
 const request={requestId:'maintenance-service-once'},result=ok(await f.call('manager','maintenance.service',service,r,request));assert.deepEqual(ok(await f.call('manager','maintenance.service',service,r,request)),result);assert.equal((await f.call('manager','maintenance.service',{...service,note:'Changed'},r,request)).status,409);r=await saved(f,'owner',r);assert.equal(r.data.services.length,1);
 await f.db.prepare("CREATE TRIGGER fail_service BEFORE INSERT ON command_receipts WHEN NEW.request_id='service-fail' BEGIN SELECT RAISE(ABORT,'test rollback'); END").run();assert.equal((await f.call('manager','maintenance.service',{...service,date:'2026-09-27'},r,{requestId:'service-fail'})).status,503);assert.equal((await saved(f,'owner',r)).data.services.length,1);
 const race=await Promise.all([f.call('manager','maintenance.service',{...service,date:'2026-09-27'},r),f.call('owner','maintenance.retire',{note:'Fictional retirement'},r)]);assert.deepEqual(race.map(x=>x.status).sort(),[200,409]);
});
test('retired plans can be filed by owners, preserve evidence in history and restore retired without scheduling work',async t=>{
 const f=await fixture(t);let r=ok(await create(f));r=ok(await f.call('manager','maintenance.service',service,r));r=ok(await f.call('owner','maintenance.retire',{note:'Retain fictional equipment history'},r));await f.db.prepare("UPDATE records SET updated_at='2026-01-01T12:00:00Z' WHERE id=?").bind(r.recordId).run();
 const before='2026-05-01',plan=ok(await hist(f,'owner',{preview:'1',before}));assert.equal(plan.records.length,1);assert.equal(ok(await hist(f,'manager',{preview:'1',before})).records.length,0);
 ok(await hist(f,'owner',{}, {locationId:'a',requestId:'archive-maintenance',action:'archive',confirmed:true,before,workspaceRevision:plan.workspaceRevision,records:plan.records.map(({id,revision})=>({id,revision}))}));assert.equal(ok(await hist(f,'owner',{kind:'maintenance'})).items.length,1);
 for(const who of ['manager','worker','dish']){assert.equal(ok(await hist(f,who,{kind:'maintenance'})).items.length,0);assert.equal((await hist(f,who,{recordId:r.recordId})).status,404);}
 const restore=ok(await hist(f,'owner',{restore:r.recordId}));ok(await hist(f,'owner',{}, {locationId:'a',requestId:'restore-maintenance',action:'restore',confirmed:true,recordId:r.recordId,workspaceRevision:restore.workspaceRevision,records:restore.records.map(({id,revision})=>({id,revision}))}));const d=await saved(f,'owner',r);assert.equal(d.data.status,'retired');assert.equal(d.data.services.length,1);assert.equal(await saved(f,'manager',r),undefined);
});

test('active maintenance responsibility remains visible as a count and assignment races fail without saving a stale manager',async t=>{
 const f=await fixture(t);let r=ok(await create(f));const a=await handleAccess(new Request('https://test.example/api/access?locationId=a',{headers:f.headers('owner')}),f.db),access=await a.json();assert.equal(a.status,200);assert.ok(access.accounts.find(x=>x.id==='manager').responsibilities.some(x=>x.category==='Active maintenance plans'&&x.count===1));assert.ok(!JSON.stringify(access).includes(facts.sourceRef));
 await f.db.prepare("UPDATE memberships SET capabilities='[]',revision=revision+1 WHERE id='manager'").run();assert.equal(await saved(f,'manager',r),undefined);assert.equal((await f.call('manager','maintenance.service',service,r)).status,403);
 r=ok(await f.call('owner','maintenance.revise',{...facts,managerId:'opener',note:'Assign current manager'},r));
 let batches=0;const binding={withSession:()=>({prepare:(...args)=>f.db.prepare(...args),batch:async statements=>{batches++;if(batches===2)await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='opener'").run();return f.db.batch(statements)}})};
 assert.equal((await f.call('owner','maintenance.create',{...facts,title:'Different test plan',managerId:'opener'},undefined,{},binding)).status,409);assert.equal((await f.db.prepare("SELECT count(*) n FROM records WHERE kind='maintenance'").first()).n,1);
});

const monthly={...facts,initialDue:'2026-01-31',recurrenceKind:'calendar-months',calendarEvery:1};
test('explicit month-end timing differs from same-day timing and preserves quarterly and leap-year anchors',()=>{
 const p={...facts,initialDue:'2026-04-30',recurrence:{kind:'calendar-month-end',every:1},services:[],status:'active'};
 assert.deepEqual([0,1,2,3].map(i=>maintenanceOccurrence(p,i)),['2026-04-30','2026-05-31','2026-06-30','2026-07-31']);
 assert.equal(maintenanceOccurrence({...p,recurrence:{kind:'calendar-months',every:1}},1),'2026-05-30');
 const quarterly={...p,initialDue:'2026-02-28',recurrence:{kind:'calendar-month-end',every:3}};
 assert.deepEqual([0,1,2,3].map(i=>maintenanceOccurrence(quarterly,i)),['2026-02-28','2026-05-31','2026-08-31','2026-11-30']);
 for(const [year,expected] of [[2028,'2028-02-29'],[2100,'2100-02-28'],[2000,'2000-02-29']])assert.equal(maintenanceOccurrence({...p,initialDue:year+'-01-31'},1),expected);
 assert.match(maintenanceTiming(p),/Last day of the month/);assert.equal(maintenanceSchedule(p,'2027-01-01').due,'2026-04-30');
});
test('weekday-position timing handles first through fourth and last without interpreting last as fifth',()=>{
 const p={...facts,initialDue:'2026-01-05',recurrence:{kind:'calendar-month-weekday',every:1,weekday:1,ordinal:1}};
 assert.deepEqual([0,1,2,3].map(i=>maintenanceOccurrence(p,i)),['2026-01-05','2026-02-02','2026-03-02','2026-04-06']);
 const last={...p,initialDue:'2026-01-25',recurrence:{...p.recurrence,weekday:0,ordinal:-1}};
 assert.deepEqual([0,1,2,3].map(i=>maintenanceOccurrence(last,i)),['2026-01-25','2026-02-22','2026-03-29','2026-04-26']);
 assert.match(maintenanceTiming(last),/Last Sunday/);
 for(const year of [2000,2024,2026,2028,2100])for(let month=0;month<12;month++)for(let weekday=0;weekday<7;weekday++)for(const ordinal of [1,2,3,4,-1]){
  const initialDue=year+'-'+String(month+1).padStart(2,'0')+'-01',rule={...p,initialDue,recurrence:{kind:'calendar-month-weekday',every:1,weekday,ordinal}},date=new Date(maintenanceOccurrence(rule,0)+'T12:00:00Z');
  assert.equal(date.getUTCFullYear(),year);assert.equal(date.getUTCMonth(),month);assert.equal(date.getUTCDay(),weekday);
  if(ordinal===-1){const weekLater=new Date(date);weekLater.setUTCDate(date.getUTCDate()+7);assert.notEqual(weekLater.getUTCMonth(),month);}else assert.equal(Math.ceil(date.getUTCDate()/7),ordinal);
 }
 assert.equal(maintenanceOccurrence({...p,initialDue:'2026-11-02',recurrence:{...p.recurrence,every:3}},1),'2027-02-01');
});
test('monthly source rules validate anchor, explicit weekday/position and numeric intervals before saving',async t=>{
 const f=await fixture(t),nth={...monthly,initialDue:'2026-01-05',recurrenceKind:'calendar-month-weekday',calendarWeekday:1,calendarOrdinal:1};
 for(const patch of [{calendarWeekday:undefined},{calendarWeekday:'1'},{calendarWeekday:-1},{calendarWeekday:7},{calendarWeekday:1.5},{calendarOrdinal:undefined},{calendarOrdinal:'1'},{calendarOrdinal:0},{calendarOrdinal:5},{calendarOrdinal:2.5},{initialDue:'2026-01-06'},{initialDue:'2026-01-12'},{calendarEvery:121},{calendarEvery:0},{initialDue:'9999-12-06'}])assert.equal((await f.call('owner','maintenance.create',{...nth,...patch})).status,400,JSON.stringify(patch));
 assert.equal((await f.call('owner','maintenance.create',{...monthly,recurrenceKind:'calendar-month-end',initialDue:'2026-04-29'})).status,400);
 const r=ok(await f.call('owner','maintenance.create',nth)),d=await saved(f,'owner',r);assert.deepEqual(d.data.recurrence,{kind:'calendar-month-weekday',every:1,weekday:1,ordinal:1});
 const end=ok(await f.call('owner','maintenance.create',{...monthly,title:'Separate month-end fixture',initialDue:'2026-04-30',recurrenceKind:'calendar-month-end'}));assert.equal(schedule(await saved(f,'owner',end)).due,'2026-04-30');
});
test('monthly pattern evidence remains immutable through source revision, retained voids and manager service',async t=>{
 const f=await fixture(t),nth={...monthly,initialDue:'2026-01-05',recurrenceKind:'calendar-month-weekday',calendarWeekday:1,calendarOrdinal:1};let r=ok(await f.call('owner','maintenance.create',nth));
 assert.equal((await f.call('manager','maintenance.create',{...nth,title:'Denied new pattern'})).status,403);
 const input={...service,date:'2026-09-27',scheduledDue:'2026-01-05'},req={requestId:'nth-service-once'},done=ok(await f.call('manager','maintenance.service',input,r,req));assert.deepEqual(ok(await f.call('manager','maintenance.service',input,r,req)),done);r=done;
 let d=await saved(f,'owner',r);assert.equal(schedule(d).due,'2026-02-02');assert.deepEqual(d.data.services[0].plan.recurrence,d.data.recurrence);
 for(const patch of [{calendarWeekday:2,initialDue:'2026-01-06'},{calendarOrdinal:2,initialDue:'2026-01-12'},{calendarEvery:2},{recurrenceKind:'calendar-months'}])assert.equal((await f.call('owner','maintenance.revise',{...nth,...patch},r)).status,400);
 r=ok(await f.call('owner','maintenance.revise',{...nth,sourceRef:'Fictional clarified source',warningDays:10},r));d=await saved(f,'owner',r);assert.equal(d.data.versions[0].facts.recurrence.ordinal,1);assert.equal(d.data.services[0].plan.sourceRef,facts.sourceRef);
 r=ok(await f.call('manager','maintenance.service',{...service,scheduledDue:'2026-02-02'},r));d=await saved(f,'owner',r);const first=d.data.services[0];r=ok(await f.call('owner','maintenance.void',{serviceId:first.id,note:'Fictional wrong occurrence evidence',confirmed:true},r));d=await saved(f,'owner',r);assert.equal(schedule(d).due,'2026-01-05');assert.equal(d.data.services[1].scheduledDue,'2026-02-02');
 r=ok(await f.call('manager','maintenance.service',{...service,date:'2026-09-26',scheduledDue:'2026-01-05'},r));assert.equal(schedule(await saved(f,'owner',r)).due,'2026-03-02');
 const home=operationsHome(ok(await f.view('manager')),'2026-09-29T02:00:00Z');assert.equal(home.maintenance[0].due,'2026-03-02');assert.equal(home.maintenance[0].state,'overdue');
});
test('fixed calendar recurrence keeps its original day through leap years, short months and late service',()=>{
 const m={...facts,initialDue:'2026-01-31',recurrence:{kind:'calendar-months',every:1},status:'active',services:[]};
 assert.deepEqual([0,1,2,3].map(i=>maintenanceOccurrence(m,i)),['2026-01-31','2026-02-28','2026-03-31','2026-04-30']);
 assert.equal(maintenanceOccurrence({...m,initialDue:'2028-01-31'},1),'2028-02-29');
 assert.equal(maintenanceOccurrence({...m,initialDue:'2099-12-31'},2),'2100-02-28');
 assert.equal(maintenanceOccurrence({...m,initialDue:'1999-12-31'},2),'2000-02-29');
 const yearly={...m,initialDue:'2028-02-29',recurrence:{kind:'calendar-months',every:12}};
 assert.equal(maintenanceOccurrence(yearly,1),'2029-02-28');assert.equal(maintenanceOccurrence(yearly,4),'2032-02-29');
 assert.equal(maintenanceOccurrence({...m,initialDue:'2026-04-30'},1),'2026-05-30');
 const days={...m,initialDue:'2026-03-07',recurrence:{kind:'calendar-days',every:2}};
 assert.equal(maintenanceOccurrence(days,1),'2026-03-09');
 assert.equal(maintenanceSchedule({...days,services:[{scheduledDue:'2026-03-07',date:'2026-03-28',voided:null}]},'2026-09-29').due,'2026-03-09');
 const missed=maintenanceSchedule(m,'2026-09-29');assert.equal(missed.due,'2026-01-31');assert.equal(missed.state,'overdue');
 const full={...m,services:Array.from({length:100},(_,i)=>({scheduledDue:maintenanceOccurrence(m,i),date:'2026-01-01',voided:null}))};
 assert.equal(maintenanceSchedule(full,'2035-01-01').due,maintenanceOccurrence(m,100));
 assert.match(maintenanceTiming(m),/shorter months/);assert.match(maintenanceTiming(days),/calendar days/);assert.match(maintenanceTiming(facts),/after the latest recorded service/);
});
test('calendar plans validate their explicit kind, interval and supported date range while legacy day plans remain valid',async t=>{
 const f=await fixture(t);
 for(const patch of [{recurrenceKind:'first-monday'},{recurrenceKind:''},{recurrenceKind:{}},{calendarEvery:0},{calendarEvery:1.5},{calendarEvery:'1'},{calendarEvery:121},{calendarEvery:null},{initialDue:'9999-12-31'},{initialDue:'2026-02-30'}])assert.equal((await f.call('owner','maintenance.create',{...monthly,...patch})).status,400,JSON.stringify(patch));
 assert.equal((await f.call('owner','maintenance.create',{...monthly,recurrenceKind:'calendar-days',calendarEvery:3651})).status,400);
 const r=ok(await f.call('owner','maintenance.create',monthly)),d=await saved(f,'owner',r);assert.deepEqual(d.data.recurrence,{kind:'calendar-months',every:1});assert.equal(d.data.intervalDays,0);
 const legacy=ok(await f.call('owner','maintenance.create',{...facts,title:'Legacy timing'}));assert.equal((await saved(f,'owner',legacy)).data.recurrence,undefined);
 assert.equal((await f.call('manager','maintenance.service',{...service,scheduledDue:facts.initialDue},legacy)).status,400);
});
test('calendar service covers exactly the first outstanding occurrence; late work and voids never erase missed cycles',async t=>{
 const f=await fixture(t);let r=ok(await f.call('owner','maintenance.create',monthly));
 for(const scheduledDue of [undefined,'2026-02-28','2025-12-31'])assert.notEqual((await f.call('manager','maintenance.service',{...service,scheduledDue},r)).status,200);
 r=ok(await f.call('manager','maintenance.service',{...service,date:'2026-09-27',scheduledDue:'2026-01-31'},r));let d=await saved(f,'owner',r);assert.equal(schedule(d).due,'2026-02-28');assert.equal(schedule(d).state,'overdue');
 assert.equal((await f.call('manager','maintenance.service',{...service,scheduledDue:'2026-01-31'},r)).status,409);
 r=ok(await f.call('manager','maintenance.service',{...service,scheduledDue:'2026-02-28'},r));d=await saved(f,'owner',r);assert.equal(schedule(d).due,'2026-03-31');
 const first=d.data.services[0],second=d.data.services[1];r=ok(await f.call('owner','maintenance.void',{serviceId:first.id,note:'Wrong occurrence evidence',confirmed:true},r));d=await saved(f,'owner',r);assert.equal(schedule(d).due,'2026-01-31');assert.equal(d.data.services[1].scheduledDue,'2026-02-28');assert.equal(d.data.services[1].id,second.id);
 r=ok(await f.call('manager','maintenance.service',{...service,date:'2026-09-26',scheduledDue:'2026-01-31'},r));d=await saved(f,'owner',r);assert.equal(schedule(d).due,'2026-03-31');assert.equal(d.data.services.length,3);assert.ok(d.data.services[0].voided);
 assert.deepEqual(d.data.services[2].plan.recurrence,{kind:'calendar-months',every:1});
});
test('early actual work preserves a fixed day anchor and calendar rule changes cannot reassign existing service evidence',async t=>{
 const f=await fixture(t),dayPlan={...facts,initialDue:'2026-09-29',recurrenceKind:'calendar-days',calendarEvery:7};let r=ok(await f.call('owner','maintenance.create',dayPlan));
 r=ok(await f.call('manager','maintenance.service',{...service,scheduledDue:'2026-09-29'},r));assert.equal(schedule(await saved(f,'owner',r)).due,'2026-10-06');
 for(const patch of [{initialDue:'2026-09-30'},{calendarEvery:14},{recurrenceKind:'calendar-months',calendarEvery:1},{recurrenceKind:'after-service',intervalDays:7}])assert.equal((await f.call('owner','maintenance.revise',{...dayPlan,...patch},r)).status,400);
 r=ok(await f.call('owner','maintenance.revise',{...dayPlan,warningDays:1,managerId:'foh',sourceRef:'Fictional rechecked calendar source'},r));let d=await saved(f,'owner',r);assert.equal(d.data.versions[0].facts.recurrence.every,7);assert.equal(d.data.services[0].plan.managerId,'manager');assert.equal(d.data.services[0].plan.sourceRef,facts.sourceRef);assert.equal(schedule(d).due,'2026-10-06');
 const last=d.data.services[0];r=ok(await f.call('owner','maintenance.void',{serviceId:last.id,note:'Retain wrong original evidence',confirmed:true},r));assert.equal((await f.call('owner','maintenance.revise',{...dayPlan,calendarEvery:14},r)).status,400);
 let legacy=ok(await f.call('owner','maintenance.create',{...facts,title:'Legacy history'}));legacy=ok(await f.call('manager','maintenance.service',service,legacy));assert.equal((await f.call('owner','maintenance.revise',{...monthly,title:'Legacy history'},legacy)).status,400);
});
test('calendar occurrences retain scoped authority, exact retries and atomic rollback under competing saves',async t=>{
 const f=await fixture(t);let r=ok(await f.call('owner','maintenance.create',monthly));const input={...service,scheduledDue:'2026-01-31'};
 for(const who of ['foh','worker','dish','foreign'])assert.equal((await f.call(who,'maintenance.service',input,r)).status,403);
 const req={requestId:'calendar-one'},result=ok(await f.call('manager','maintenance.service',input,r,req));assert.deepEqual(ok(await f.call('manager','maintenance.service',input,r,req)),result);assert.equal((await f.call('manager','maintenance.service',{...input,scheduledDue:'2026-02-28'},r,req)).status,409);r=result;
 await f.db.prepare("CREATE TRIGGER fail_calendar BEFORE INSERT ON command_receipts WHEN NEW.request_id='calendar-fail' BEGIN SELECT RAISE(ABORT,'test rollback'); END").run();const next={...service,date:'2026-09-27',scheduledDue:'2026-02-28'};
 assert.equal((await f.call('manager','maintenance.service',next,r,{requestId:'calendar-fail'})).status,503);assert.equal(schedule(await saved(f,'owner',r)).due,'2026-02-28');
 const race=await Promise.all([f.call('manager','maintenance.service',next,r),f.call('owner','maintenance.service',{...next,date:'2026-09-26'},r)]);assert.deepEqual(race.map(x=>x.status).sort(),[200,409]);const d=await saved(f,'owner',r);assert.equal(d.data.services.length,2);assert.equal(schedule(d).due,'2026-03-31');
});
test('calendar overdue work reaches the local daily brief and survives retirement, filing and restoration with its occurrence evidence',async t=>{
 const f=await fixture(t);let r=ok(await f.call('owner','maintenance.create',monthly));r=ok(await f.call('manager','maintenance.service',{...service,scheduledDue:'2026-01-31'},r));
 const home=operationsHome(ok(await f.view('manager')),'2026-09-29T02:00:00Z');assert.equal(home.day,'2026-09-28');assert.equal(home.maintenance[0].due,'2026-02-28');assert.equal(home.maintenance[0].state,'overdue');
 r=ok(await f.call('owner','maintenance.retire',{note:'Fictional plan retired with history'},r));await f.db.prepare("UPDATE records SET updated_at='2026-01-01T12:00:00Z' WHERE id=?").bind(r.recordId).run();const before='2026-05-01',p=ok(await hist(f,'owner',{preview:'1',before}));
 ok(await hist(f,'owner',{}, {locationId:'a',requestId:'archive-calendar',action:'archive',confirmed:true,before,workspaceRevision:p.workspaceRevision,records:p.records.map(({id,revision})=>({id,revision}))}));const savedHistory=ok(await hist(f,'owner',{recordId:r.recordId}));assert.ok(JSON.stringify(savedHistory).includes('2026-01-31'));
 const restore=ok(await hist(f,'owner',{restore:r.recordId}));ok(await hist(f,'owner',{}, {locationId:'a',requestId:'restore-calendar',action:'restore',confirmed:true,recordId:r.recordId,workspaceRevision:restore.workspaceRevision,records:restore.records.map(({id,revision})=>({id,revision}))}));const d=await saved(f,'owner',r);assert.equal(d.data.status,'retired');assert.equal(d.data.services[0].scheduledDue,'2026-01-31');assert.equal(schedule(d).due,'2026-02-28');assert.equal(schedule(d).state,'retired');assert.equal(await saved(f,'manager',r),undefined);
});
