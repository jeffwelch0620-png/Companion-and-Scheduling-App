import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,ok,assetFacts,planFacts,reading,service} from './maintenance-meter-fixture.mjs';
import {maintenanceSchedule} from '../.sites-runtime/shared/maintenance.mjs';
import {meterSchedule,meterRule} from '../.sites-runtime/shared/maintenance-meter.mjs';
import {operationsHome} from '../.sites-runtime/shared/operations-home.mjs';
import {applyCommand} from '../.sites-runtime/shared/domain.mjs';

test('checked date-and-hour source requires an equipment link and explicit valid thresholds; calendar-only plans stay compatible',async t=>{
 const f=await fixture(t);assert.equal((await f.call('owner','maintenance.create',planFacts)).status,400);
 const {record,facts}=await f.setup();let d=(await f.saved(record)).data;assert.equal(d.meter.intervalHours,50);assert.equal(maintenanceSchedule(d,'2026-09-29').state,'needs-reading');assert.equal(d.initialDue,'2026-12-01');
 for(const patch of [{initialDueHours:0},{intervalHours:0},{warningHours:51},{intervalHours:-1},{meterRef:''},{warningHours:'10'},{initialDueHours:1e9},{intervalHours:Number.MIN_VALUE}])assert.equal((await f.call('owner','maintenance.revise',{...facts,...patch},record)).status,400);
 const legacy=ok(await f.call('owner','maintenance.create',{...planFacts,title:'Fictional calendar only',meterEnabled:false}));d=(await f.saved(legacy)).data;assert.equal(d.meter,undefined);assert.equal(maintenanceSchedule(d,'2026-09-29').state,'upcoming');assert.equal(meterSchedule(d),null);
});

test('observed hours drive warning and due state without replacing calendar dates; service keeps exact meter and plan snapshots',async t=>{
 const f=await fixture(t);let {record:r}=await f.setup();r=ok(await f.call('manager','maintenance.meter',reading,r,{requestId:'read-90'}));let d=(await f.saved(r)).data;
 assert.equal(meterSchedule(d).state,'soon');assert.equal(maintenanceSchedule(d,'2026-09-29').due,'2026-12-01');
 r=ok(await f.call('manager','maintenance.meter',{...reading,hours:100},r,{requestId:'read-100'}));d=(await f.saved(r)).data;assert.equal(meterSchedule(d).state,'due');assert.equal(maintenanceSchedule(d,'2026-09-29').state,'due');
 assert.equal((await f.call('manager','maintenance.service',service,r)).status,400);assert.equal((await f.call('manager','maintenance.service',{...service,date:'2026-09-27',meterReadingId:'read-100'},r)).status,400);
 r=ok(await f.call('manager','maintenance.service',{...service,meterReadingId:'read-100'},r,{requestId:'service-100'}));d=(await f.saved(r)).data;assert.equal(meterSchedule(d).dueHours,150);assert.equal(d.services[0].meter.evidence,reading.evidence);assert.equal(d.services[0].plan.meter.meterRef,planFacts.meterRef);
 r=ok(await f.call('manager','maintenance.meter',{...reading,date:'2026-09-29',hours:155},r));d=(await f.saved(r)).data;assert.equal(meterSchedule(d).state,'overdue');assert.equal(meterSchedule(d).reading.hours,155);assert.equal(d.services[0].meter.hours,100);
 const home=operationsHome(await f.view('manager'),'2026-09-29T15:00:00Z');assert.equal(home.maintenance[0].meter.dueHours,150);assert.equal(home.maintenance[0].meter.reading.date,'2026-09-29');
 assert.equal((await f.call('owner','maintenance.service',{...service,date:'2026-09-29',meterReadingId:d.meterReadings.at(-1).id},r,{requestId:'service-100'})).status,409);
});

test('reading corrections retain evidence, cannot decrease active observations, and require service dependencies to be corrected first',async t=>{
 const f=await fixture(t);let {record:r}=await f.setup();r=ok(await f.call('manager','maintenance.meter',reading,r,{requestId:'source-reading'}));
 for(const patch of [{hours:-1},{hours:'90'},{checked:false},{date:'2099-01-01'},{date:'2026-09-27',hours:100},{hours:80},{}])assert.ok((await f.call('manager','maintenance.meter',{...reading,...patch},r)).status>=400);
 r=ok(await f.call('manager','maintenance.service',{...service,meterReadingId:'source-reading'},r,{requestId:'source-service'}));assert.equal((await f.call('owner','maintenance.meter-void',{readingId:'source-reading',note:'Fixture correction',confirmed:true},r)).status,409);
 r=ok(await f.call('owner','maintenance.void',{serviceId:'source-service',note:'Fixture incorrect service',confirmed:true},r));r=ok(await f.call('owner','maintenance.meter-void',{readingId:'source-reading',note:'Fixture wrong reading',confirmed:true},r));let d=(await f.saved(r)).data;assert.equal(meterSchedule(d).state,'needs-reading');assert.equal(meterSchedule(d).dueHours,100);assert.equal(d.services[0].meter.hours,90);assert.equal(d.meterReadings[0].hours,90);
 r=ok(await f.call('manager','maintenance.meter',{...reading,hours:80},r));d=(await f.saved(r)).data;assert.equal(meterSchedule(d).reading.hours,80);assert.equal(d.meterReadings[0].voided.reason,'Fixture wrong reading');
});

test('meter evidence pins task, physical asset and rule; stale asset changes require an owner recheck',async t=>{
 const f=await fixture(t);let {record:r,asset,facts}=await f.setup();r=ok(await f.call('manager','maintenance.meter',reading,r));
 for(const patch of [{meterEnabled:false},{intervalHours:60},{initialDueHours:101},{meterRef:'Different meter'},{task:'Different task'},{assetId:''}])assert.ok((await f.call('owner','maintenance.revise',{...facts,...patch},r)).status>=400);
 asset=ok(await f.call('owner','equipment.revise',{...assetFacts,placement:'Changed fixture room'},asset));assert.equal((await f.call('manager','maintenance.meter',{...reading,hours:100},r)).status,409);
 r=ok(await f.call('owner','maintenance.revise',{...facts,assetRevision:asset.revision,note:'Fixture physical recheck'},r));r=ok(await f.call('manager','maintenance.meter',{...reading,hours:100},r));const d=(await f.saved(r)).data;assert.equal(d.meterReadings[0].plan.asset.facts.placement,'Test room');assert.equal(d.meterReadings[1].plan.asset.facts.placement,'Changed fixture room');
});

test('only assigned managers and owners record hours; reader and correction permissions stay inside the restaurant',async t=>{
 const f=await fixture(t);let {record:r}=await f.setup();
 for(const actor of ['othermanager','worker','dish','schedule','foreign','third'])assert.equal((await f.call(actor,'maintenance.meter',reading,r)).status,403);
 for(const [actor,loc] of [['foreign','b'],['third','c']]){assert.equal((await f.call(actor,'maintenance.meter',reading,r,{locationId:loc})).status,404);assert.equal((await f.view(actor,loc)).records.length,0);}
 r=ok(await f.call('manager','maintenance.meter',reading,r,{requestId:'protected-reading'}));assert.equal((await f.view('othermanager')).records.find(x=>x.kind==='maintenance').data.meterReadings.length,1);
 for(const actor of ['manager','othermanager'])assert.equal((await f.call(actor,'maintenance.meter-void',{readingId:'protected-reading',note:'No authority',confirmed:true},r)).status,403);
 for(const actor of ['worker','dish','schedule'])assert.equal((await f.view(actor)).records.some(x=>x.kind==='maintenance'),false);
});

test('meter writes retain exact retries, reject stale revisions and roll back audit and evidence together',async t=>{
 const f=await fixture(t);const {record:r}=await f.setup();await f.db.prepare("CREATE TRIGGER fail_meter BEFORE INSERT ON audit_events WHEN NEW.action='maintenance.meter' BEGIN SELECT RAISE(ABORT,'fictional failure'); END").run();
 assert.equal((await f.call('manager','maintenance.meter',reading,r,{requestId:'meter-retry'})).status,503);assert.equal((await f.saved(r)).data.meterReadings,undefined);
 await f.db.prepare('DROP TRIGGER fail_meter').run();const result=ok(await f.call('manager','maintenance.meter',reading,r,{requestId:'meter-retry'}));assert.deepEqual(ok(await f.call('manager','maintenance.meter',reading,r,{requestId:'meter-retry'})),result);
 assert.equal((await f.call('manager','maintenance.meter',{...reading,hours:100},r)).status,409);assert.equal((await f.saved(result)).data.meterReadings.length,1);
 assert.equal((await f.call('owner','maintenance.meter',{...reading,hours:100},result,{requestId:'meter-retry'})).status,409);assert.equal((await f.saved(result)).data.meterReadings.length,1);
});

test('retired plans retain meter/service evidence in Work history and cannot accept readings until deliberately reactivated',async t=>{
 const f=await fixture(t);let {record:r}=await f.setup();r=ok(await f.call('manager','maintenance.meter',reading,r,{requestId:'historical-reading'}));r=ok(await f.call('owner','maintenance.retire',{note:'Fixture retirement'},r));assert.equal((await f.call('owner','maintenance.meter',{...reading,hours:100},r)).status,400);
 await f.db.prepare("UPDATE records SET updated_at='2026-01-01T12:00:00Z' WHERE id=?").bind(r.recordId).run();const p=ok(await f.request('owner','/api/history?locationId=a&preview=1&before=2026-05-01'));ok(await f.request('owner','/api/history',{locationId:'a',action:'archive',requestId:'archive-meter',confirmed:true,before:'2026-05-01',workspaceRevision:p.workspaceRevision,records:p.records}));const detail=ok(await f.request('owner','/api/history?locationId=a&recordId='+r.recordId));assert.equal(detail.workspace.records.find(x=>x.id===r.recordId).data.meterReadings[0].evidence,reading.evidence);
 assert.equal((await f.request('manager','/api/history?locationId=a&recordId='+r.recordId)).status,404);
});

test('meter date uses restaurant day and decimal thresholds do not invent overdue hours',async t=>{
 const f=await fixture(t),{record:r}=await f.setup(),w=await f.view();assert.throws(()=>applyCommand(w,{locationId:'a',requestId:'after-midnight',action:'maintenance.meter',recordId:r.recordId,expectedRevision:r.revision,input:{...reading,date:'2026-09-30'}},'2026-09-30T02:00:00Z'),/future/);
 const d=(await f.saved(r)).data;d.meter={...d.meter,initialDueHours:0.1+0.2};d.meterReadings=[{...reading,id:'decimal',hours:0.3,voided:null}];assert.equal(meterSchedule(d).state,'due');
 assert.throws(()=>meterRule({...planFacts,intervalHours:Infinity}),/number/);assert.throws(()=>meterRule({...planFacts,initialDueHours:NaN}),/number/);
});
