import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');

test('built transfer endpoint retains a parcel arrival across reload without changing receiving or catalog',async t=>{
 let outbound=0;
 const mf=new Miniflare({modules:true,scriptPath:path.resolve('dist/server/index.js'),modulesRoot:path.resolve('dist/server'),modulesRules:[{type:'ESModule',include:['**/*.js']}],compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],serviceBindings:{ASSETS:()=>new Response('Not found',{status:404})},outboundService:()=>{outbound++;throw new Error('No external calls expected');}});t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB');for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const loc of ['a','b']){await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(loc,'Fictional '+loc,'America/New_York').run();await db.prepare("INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,active) VALUES(?,?,?,?,?,'BOH','Owner','[\"location.manage\"]','[]',1)").bind(loc,loc+'@example.test',loc+'-identity',loc,'Fictional '+loc).run();}
 const headers=loc=>({'oai-authenticated-user-id':loc+'-identity','oai-authenticated-user-email':loc+'@example.test',Origin:'http://localhost','Content-Type':'application/json'});
 const post=async(loc,endpoint,body)=>{const r=await mf.dispatchFetch('http://localhost/api/'+endpoint,{method:'POST',headers:headers(loc),body:JSON.stringify({requestId:crypto.randomUUID(),locationId:loc,...body})});return {status:r.status,data:await r.json()};};
 const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
 const item=ok(await post('a','food',{action:'fooditem.import',input:{dataset:'demo',sourceRestaurantId:'fixture-a',sourceLabel:'Fictional parcel fixture',destinationLocationId:'a',confirmed:true,rows:[{restaurantId:'fixture-a',name:'Fictional flour',controlNumber:'FLOUR',purchaseUnit:'bag',packCount:1,unitQty:25,unitUOM:'lb',active:true,needsReview:false,vendorSkus:[]}]}}));
 await db.prepare("INSERT INTO food_transfer_routes(source_id,destination_id,dataset,active) VALUES('a','b','demo',1)").run();
 const before=(await db.prepare('SELECT id,data FROM food_records ORDER BY id').all()).results;
 const sent=ok(await post('a','food/transfers',{action:'transfer.dispatch',input:{dataset:'demo',destinationId:'b',itemId:item.recordId,itemRevision:item.revision,reference:'Fictional built parcel transfer',quantity:4,dispatchedAt:'2000-02-29T12:00:00Z',confirmed:true}}));
 const body={requestId:crypto.randomUUID(),action:'transfer.parcel-depart',recordId:sent.recordId,expectedRevision:sent.revision,input:{dataset:'demo',tripReference:'Trip A',parcelReference:'Parcel 1',quantity:2,departedAt:'2000-02-29T12:00:00Z',confirmed:true}};
 assert.equal((await post('b','food/transfers',body)).status,403);
 const departed=ok(await post('a','food/transfers',body));assert.deepEqual(ok(await post('a','food/transfers',body)),departed);
 const get=async loc=>{const r=await mf.dispatchFetch('http://localhost/api/food/transfers?locationId='+loc+'&dataset=demo&recordId='+sent.recordId,{headers:headers(loc)});assert.equal(r.status,200);return r.json();};
 const detail=await get('b'),parcel=detail.transfer.parcels[0];assert.equal(parcel.tripReference,'Trip A');assert.equal(detail.transfer.receipt,null);
 const arrival={action:'transfer.parcel-arrive',recordId:sent.recordId,expectedRevision:departed.revision,input:{dataset:'demo',parcelId:parcel.id,arrivedAt:'2000-02-29T13:00:00Z',confirmed:true}};
 assert.equal((await post('a','food/transfers',arrival)).status,403);ok(await post('b','food/transfers',arrival));
 const reload=await get('a');assert.equal(reload.transfer.parcels[0].arrival.by,'b');assert.equal(reload.transfer.receipt,null);assert.equal(reload.transfer.status,'sent');assert.equal(reload.events.length,3);
 assert.deepEqual((await db.prepare('SELECT id,data FROM food_records ORDER BY id').all()).results,before);assert.equal(outbound,0);
});
