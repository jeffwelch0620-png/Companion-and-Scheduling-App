import test from 'node:test';import assert from 'node:assert/strict';
import {fixture,ok} from './maintenance-meter-fixture.mjs';
import {localDate} from '../.sites-runtime/shared/local-time.mjs';
process.env.JMAX_METER_COMPILED='1';
test('compiled item view reads real saved waste and later voids without changing catalog or counts',async t=>{
 const f=await fixture(t),command=(actor,action,input,record)=>f.request(actor,'/api/food',{requestId:crypto.randomUUID(),locationId:'a',action,input,...(record?{recordId:record.recordId,expectedRevision:record.revision}:{})});
 const base=ok(await command('owner','fooditem.import',{dataset:'demo',sourceRestaurantId:'source-a',sourceLabel:'Fictional waste item fixture',destinationLocationId:'a',confirmed:true,rows:[{restaurantId:'source-a',name:'Fictional flour',controlNumber:'FLOUR',purchaseUnit:'bag',packCount:1,unitQty:25,unitUOM:'lb',active:true,needsReview:false,vendorSkus:[{id:'sku',vendor:'Fixture',vendorSku:'F',purchaseUnit:'bag',packCount:1,unitQty:25,unitUOM:'lb',price:20,priceUpdatedAt:'2026-01-01',available:true,preferred:true}]}]}));
 const one=ok(await command('manager','fooditem.waste',{quantity:0.25,reason:'spoilage',confirmed:true},base)),two=ok(await command('manager','fooditem.waste',{quantity:0.5,reason:'dropped',confirmed:true},one));
 const date=localDate(new Date().toISOString(),'America/New_York'),get=(actor,params)=>f.request(actor,'/api/food?'+new URLSearchParams({locationId:'a',dataset:'demo',from:date,through:date,...params}));
 const parent=ok(await get('manager',{view:'waste'})),g=ok(await get('manager',{view:'waste-items',revision:String(parent.revision)})).groups[0];assert.equal(g.activeQuantity,0.75);assert.equal(g.knownEstimatedCents,1500);assert.equal(g.active,2);
 assert.equal((await get('worker',{view:'waste-items',revision:String(parent.revision)})).status,403);
 ok(await command('manager','fooditem.waste-void',{wasteRevision:one.revision,reason:'Fictional mistaken observation'},two));
 assert.equal((await get('manager',{view:'waste-items',revision:String(parent.revision)})).status,409);
 const fresh=ok(await get('manager',{view:'waste'})),after=ok(await get('manager',{view:'waste-items',revision:String(fresh.revision)})).groups[0];assert.equal(after.activeQuantity,0.5);assert.equal(after.knownEstimatedCents,1000);assert.equal(after.voided,1);
 const record=JSON.parse((await f.db.prepare('SELECT data FROM food_records WHERE id=?').bind(base.recordId).first()).data);assert.equal(record.count,null);assert.equal(record.vendorSkus[0].price,20);
});
