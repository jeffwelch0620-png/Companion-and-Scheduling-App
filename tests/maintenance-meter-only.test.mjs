import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,ok,assetFacts,planFacts,reading,service} from './maintenance-meter-fixture.mjs';
import {maintenanceSchedule} from '../.sites-runtime/shared/maintenance.mjs';
import {maintenanceTiming,maintenanceDue} from '../.sites-runtime/shared/maintenance-calendar.mjs';
import {operationsHome} from '../.sites-runtime/shared/operations-home.mjs';
const only={...planFacts,title:'Fictional hours-only service',recurrenceKind:'meter-only',initialDue:'',intervalDays:0,warningDays:0};
async function setup(f){const asset=ok(await f.call('owner','equipment.create',assetFacts));const facts={...only,assetId:asset.recordId,assetRevision:asset.revision};return {asset,facts,r:ok(await f.call('owner','maintenance.create',facts))};}

test('hour-only plans require a checked meter and current equipment, reject calendar inputs and never invent due dates',async t=>{
 const f=await fixture(t);assert.equal((await f.call('owner','maintenance.create',only)).status,400);
 let {facts,r}=await setup(f);const d=(await f.saved(r)).data;
 assert.equal(d.meterOnly,true);assert.equal(d.initialDue,'');assert.equal(d.intervalDays,0);assert.equal(d.warningDays,0);assert.equal(d.recurrence,undefined);
 for(const date of ['2026-01-01','2099-12-31']){const s=maintenanceSchedule(d,date);assert.equal(s.due,'');assert.equal(s.days,null);assert.equal(s.calendarState,null);assert.equal(s.state,'needs-reading');assert.equal(s.meter.dueHours,100);}
 assert.equal(maintenanceDue(d,d.services),'');assert.match(maintenanceTiming(d),/no calendar due date/);
 for(const patch of [{meterEnabled:false},{initialDue:'2026-12-01'},{intervalDays:30},{warningDays:5},{calendarEvery:1},{calendarWeekday:0},{calendarOrdinal:1},{assetRevision:99},{initialDueHours:0}])assert.ok((await f.call('owner','maintenance.revise',{...facts,...patch},r)).status>=400,JSON.stringify(patch));
});

test('hour-only reading, actual service and correction change the hour threshold while snapshots retain the selected mode',async t=>{
 const f=await fixture(t);let {r}=await setup(f);
 r=ok(await f.call('manager','maintenance.meter',reading,r,{requestId:'only-90'}));let d=(await f.saved(r)).data;assert.equal(maintenanceSchedule(d,'2099-01-01').state,'soon');
 r=ok(await f.call('manager','maintenance.meter',{...reading,hours:100},r,{requestId:'only-100'}));assert.equal(maintenanceSchedule((await f.saved(r)).data,'2020-01-01').state,'due');
 assert.equal((await f.call('manager','maintenance.service',{...service,meterReadingId:'only-100',scheduledDue:'2026-01-01'},r)).status,400);
 assert.equal((await f.call('manager','maintenance.service',{...service,date:'2026-09-27',meterReadingId:'only-100'},r)).status,400);
 const before=r,body={...service,meterReadingId:'only-100'};r=ok(await f.call('manager','maintenance.service',body,r,{requestId:'only-service'}));assert.deepEqual(ok(await f.call('manager','maintenance.service',body,before,{requestId:'only-service'})),r);
 d=(await f.saved(r)).data;assert.equal(d.services[0].plan.meterOnly,true);assert.equal(d.services[0].meter.plan.meterOnly,true);assert.equal(d.services[0].scheduledDue,undefined);assert.equal(maintenanceSchedule(d,'2099-01-01').meter.dueHours,150);assert.equal(maintenanceSchedule(d,'2099-01-01').state,'upcoming');
 r=ok(await f.call('manager','maintenance.meter',{...reading,date:'2026-09-29',hours:155},r));assert.equal(maintenanceSchedule((await f.saved(r)).data,'2026-09-29').state,'overdue');
 r=ok(await f.call('owner','maintenance.void',{serviceId:'only-service',confirmed:true,note:'Fictional wrong service report'},r));d=(await f.saved(r)).data;assert.equal(maintenanceSchedule(d,'2026-09-29').meter.dueHours,100);assert.equal(d.services[0].meter.hours,100);assert.equal(d.services[0].plan.initialDue,'');
});

test('evidence prevents switching either direction between calendar and meter-only modes; checked changes before evidence remain possible',async t=>{
 const f=await fixture(t);let {r,facts}=await setup(f);
 const both={...facts,recurrenceKind:'after-service',initialDue:'2026-12-01',intervalDays:30,warningDays:5};
 r=ok(await f.call('owner','maintenance.revise',both,r));assert.equal((await f.saved(r)).data.meterOnly,undefined);assert.equal((await f.saved(r)).data.versions[0].facts.meterOnly,true);
 r=ok(await f.call('owner','maintenance.revise',facts,r));r=ok(await f.call('manager','maintenance.meter',reading,r));
 assert.equal((await f.call('owner','maintenance.revise',both,r)).status,400);
 const f2=await fixture(t);let {record:r2,facts:both2}=await f2.setup();r2=ok(await f2.call('manager','maintenance.meter',reading,r2));
 assert.equal((await f2.call('owner','maintenance.revise',{...both2,recurrenceKind:'meter-only',initialDue:'',intervalDays:0,warningDays:0},r2)).status,400);
});

test('hour-only plans preserve restaurant, owner/assigned-manager permissions and fresh asset checks',async t=>{
 const f=await fixture(t);let {r,asset,facts}=await setup(f);
 for(const actor of ['manager','othermanager','worker','dish','schedule','foreign','third'])assert.equal((await f.call(actor,'maintenance.create',{...facts,title:'Other fixture'},undefined)).status,403);
 for(const actor of ['othermanager','worker','dish','schedule','foreign','third'])assert.equal((await f.call(actor,'maintenance.meter',reading,r)).status,403);
 for(const [actor,loc] of [['foreign','b'],['third','c']]){assert.equal((await f.call(actor,'maintenance.meter',reading,r,{locationId:loc})).status,404);assert.equal((await f.view(actor,loc)).records.length,0);}
 asset=ok(await f.call('owner','equipment.revise',{...assetFacts,placement:'Changed fictional room'},asset));assert.equal((await f.call('manager','maintenance.meter',reading,r)).status,409);
 r=ok(await f.call('owner','maintenance.revise',{...facts,assetRevision:asset.revision},r));r=ok(await f.call('manager','maintenance.meter',reading,r));assert.equal((await f.saved(r)).data.meterOnly,true);
});

test('daily brief carries missing-reading and hour thresholds without calendar arithmetic or worker leakage',async t=>{
 const f=await fixture(t);let {r}=await setup(f);let home=operationsHome(await f.view('manager'),'2026-09-29T15:00:00Z');
 assert.equal(home.maintenance.length,1);assert.equal(home.maintenance[0].state,'needs-reading');assert.equal(home.maintenance[0].days,null);assert.equal(home.maintenance[0].due,'');
 r=ok(await f.call('manager','maintenance.meter',{...reading,hours:10},r));assert.equal(operationsHome(await f.view('manager'),'2099-01-01T15:00:00Z').maintenance.length,0);
 r=ok(await f.call('manager','maintenance.meter',{...reading,hours:101},r));home=operationsHome(await f.view('manager'),'2026-09-29T15:00:00Z');assert.equal(home.maintenance[0].state,'overdue');assert.equal(home.maintenance[0].meter.dueHours,100);
 assert.equal(operationsHome(await f.view('worker'),'2026-09-29T15:00:00Z').maintenance.length,0);
 r=ok(await f.call('owner','maintenance.retire',{note:'Fixture retired'},r));assert.equal(maintenanceSchedule((await f.saved(r)).data,'2099-01-01').state,'retired');assert.equal(operationsHome(await f.view(),'2099-01-01T15:00:00Z').maintenance.length,0);
});
