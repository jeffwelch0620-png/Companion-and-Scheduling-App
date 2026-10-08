import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,ok} from './maintenance-meter-fixture.mjs';
import {transferLocalTimestamp as clock} from '../.sites-runtime/shared/food-transfer-time.mjs';
process.env.JMAX_METER_COMPILED='1';
async function setup(t){
 const f=await fixture(t);
 await f.db.prepare("UPDATE locations SET timezone='America/Chicago' WHERE id='a'").run();
 const command=(actor,loc,path,action,input,record,extra={})=>f.request(actor,path,{requestId:crypto.randomUUID(),locationId:loc,action,input:{dataset:'demo',...input},...(record?{recordId:record.recordId,expectedRevision:record.revision}:{}),...extra});
 const item=ok(await command('owner','a','/api/food','fooditem.import',{sourceRestaurantId:'fixture-a',sourceLabel:'Fictional transfer time fixture',destinationLocationId:'a',confirmed:true,rows:[{restaurantId:'fixture-a',name:'Fictional flour',controlNumber:'TIME-FLOUR',purchaseUnit:'bag',packCount:1,unitQty:25,unitUOM:'lb',active:true,needsReview:false,vendorSkus:[]}]}));
 await f.db.prepare("INSERT INTO food_transfer_routes(source_id,destination_id,dataset,active) VALUES('a','b','demo',1)").run();
 const call=(actor,loc,action,input,record,extra)=>command(actor,loc,'/api/food/transfers',action,input,record,extra);
 const get=(actor,loc,record)=>f.request(actor,`/api/food/transfers?locationId=${loc}&dataset=demo&recordId=${record.recordId}`);
 const facts={itemId:item.recordId,itemRevision:item.revision,destinationId:'b',reference:'Fictional midnight slip',quantity:4,dispatchedAt:clock('2026-09-28','23:59:37','America/Chicago'),confirmed:true};
 return {...f,call,get,facts};
}
test('built transfer preserves source and destination clock conversion through parcels, open/final checks and correction',async t=>{
 const f=await setup(t),before=(await f.db.prepare('SELECT id,data FROM food_records ORDER BY id').all()).results;
 const sent=ok(await f.call('manager','a','transfer.dispatch',f.facts));
 const departed=ok(await f.call('manager','a','transfer.parcel-depart',{tripReference:'Night trip',parcelReference:'P1',quantity:2,departedAt:clock('2026-09-29','00:00:07','America/Chicago'),confirmed:true},sent));
 const parcel=ok(await f.get('foreign','b',sent)).transfer.parcels[0];
 const arrived=ok(await f.call('foreign','b','transfer.parcel-arrive',{parcelId:parcel.id,arrivedAt:clock('2026-09-29','01:10:11','America/New_York'),confirmed:true},departed));
 const receipt={accepted:2,rejected:0,missing:0,complete:false,receivedAt:clock('2026-09-29','01:11:12','America/New_York'),confirmed:true};
 assert.equal((await f.call('manager','a','transfer.receive',receipt,arrived)).status,403);
 assert.equal((await f.get('third','c',sent)).status,404);
 assert.equal((await f.get('worker','a',sent)).status,403);
 const requestId=crypto.randomUUID(),open=ok(await f.call('foreign','b','transfer.receive',receipt,arrived,{requestId}));
 assert.deepEqual(ok(await f.call('foreign','b','transfer.receive',receipt,arrived,{requestId})),open);
 const final=ok(await f.call('foreign','b','transfer.check-progress',{...receipt,accepted:3,rejected:1,complete:true,reason:'Fictional damaged bag',receivedAt:clock('2026-09-29','01:20:33','America/New_York')},open));
 ok(await f.call('foreign','b','transfer.correct-receipt',{...receipt,accepted:4,complete:true,correctionReason:'Fictional quality recheck correction',receivedAt:clock('2026-09-29','01:21:44','America/New_York')},final));
 const d=ok(await f.get('owner','a',sent));
 assert.equal(d.transfer.dispatch.dispatchedAt,'2026-09-29T04:59:37.000Z');assert.equal(d.transfer.parcels[0].arrival.arrivedAt,'2026-09-29T05:10:11.000Z');assert.equal(d.transfer.receipt.receivedAt,'2026-09-29T05:21:44.000Z');assert.equal(d.transfer.receipt.accepted,4);
 assert.deepEqual(d.events.filter(e=>e.receipt).map(e=>e.receipt.receivedAt),['2026-09-29T05:11:12.000Z','2026-09-29T05:20:33.000Z','2026-09-29T05:21:44.000Z']);
 assert.deepEqual((await f.db.prepare('SELECT id,data FROM food_records ORDER BY id').all()).results,before);
});
test('built transfer rejects destination clock earlier than dispatch, future dispatch and stale revisions',async t=>{
 const f=await setup(t);
 assert.equal((await f.call('manager','a','transfer.dispatch',{...f.facts,dispatchedAt:clock('2099-09-28','23:59:37','America/Chicago')})).status,400);
 const sent=ok(await f.call('manager','a','transfer.dispatch',f.facts));
 const receipt={accepted:4,rejected:0,missing:0,confirmed:true,receivedAt:clock('2026-09-29','00:58:37','America/New_York')};
 assert.equal((await f.call('foreign','b','transfer.receive',receipt,sent)).status,400);
 receipt.receivedAt=clock('2026-09-29','01:00:37','America/New_York');
 ok(await f.call('foreign','b','transfer.receive',receipt,sent));
 assert.equal((await f.call('foreign','b','transfer.correct-receipt',{...receipt,correctionReason:'Fictional stale correction'},sent)).status,409);
 assert.equal(ok(await f.get('owner','a',sent)).events.length,2);
});
