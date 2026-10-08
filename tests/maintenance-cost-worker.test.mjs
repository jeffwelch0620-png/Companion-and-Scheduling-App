import test from 'node:test';import assert from 'node:assert/strict';import {fixture,ok,service} from './maintenance-meter-fixture.mjs';
process.env.JMAX_METER_COMPILED='1';
test('compiled maintenance cost lifecycle checks roles, receipt retry, correction and retained evidence with zero outbound calls',async t=>{
 const f=await fixture(t);let {record:r}=await f.setup();
 r=ok(await f.call('manager','maintenance.meter',{date:service.date,hours:100,evidence:'Fixture reading',note:'Fixture checked',checked:true},r));let d=await f.saved(r);
 r=ok(await f.call('manager','maintenance.service',{...service,meterReadingId:d.data.meterReadings[0].id},r));d=await f.saved(r);const id=d.data.services[0].id,input={serviceId:id,amount:'125.39',documentDate:service.date,sourceRef:'Fixture invoice',allocation:'Fixture service only including tax',note:'Fixture checked',confirmed:true};
 for(const who of ['othermanager','worker','dish','schedule','foreign','third'])assert.equal((await f.call(who,'maintenance.cost',input,r)).status,403);
 const old=r;r=ok(await f.call('manager','maintenance.cost',input,r,{requestId:'cost-once'}));assert.deepEqual(ok(await f.call('manager','maintenance.cost',input,old,{requestId:'cost-once'})),r);
 assert.equal((await f.call('manager','maintenance.cost',{...input,amount:'1'},r)).status,403);
 r=ok(await f.call('owner','maintenance.cost',{...input,amount:'0',sourceRef:'Fictional warranty no-charge'},r));d=await f.saved(r);assert.equal(d.data.services[0].costHistory[1].amountCents,0);assert.equal(d.data.services[0].meter.hours,100);
 r=ok(await f.call('owner','maintenance.cost-withdraw',{serviceId:id,note:'Fictional wrong allocation',confirmed:true},r));d=await f.saved(r);assert.equal(d.data.services[0].costHistory.length,3);assert.equal(d.data.services[0].costHistory[0].amountCents,12539);assert.equal(d.data.services[0].voided,null);assert.equal((await f.view('worker')).records.some(x=>x.kind==='maintenance'),false);
});
