import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {Miniflare} from 'miniflare';
import {handleFood} from '../.sites-runtime/shared/food-service.mjs';
import {handleOrderGuide} from '../.sites-runtime/shared/food-order-guide-service.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
const csv='\uFEFFProduct ID,Product,Provider,In stock ,Order,PPU Unit,Provider\r\n001,Fictional beef,Fixture Supplier,99,2,CS,Fixture Supplier\r\n002,Fictional lettuce,Fixture Supplier,,0,CS,Fixture Supplier\r\n';
const input={locationId:'a',dataset:'demo',csv,fileName:'Fictional guide.csv',confirmed:true};
async function fixture(t){
 const dist=process.env.JMAX_TEST_DIST;let outbound=0;
 const mf=new Miniflare({modules:true,...(dist?{scriptPath:path.resolve(dist,'server/index.js'),modulesRoot:path.resolve(dist,'server'),modulesRules:[{type:'ESModule',include:['**/*.js']}]}:{script:'export default {fetch(){return new Response("fixture")}}'}),compatibilityDate:'2026-05-22',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],serviceBindings:{ASSETS:()=>new Response('Missing',{status:404})},outboundService:()=>{outbound++;throw Error('No outbound expected')}});t.after(async()=>{await mf.dispose();assert.equal(outbound,0)});
 const db=await mf.getD1Database('DB');for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+f,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const loc of ['a','b','c'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(loc,'Fictional '+loc,'America/New_York').run();
 for(const [who,loc,caps] of [['owner','a',['location.manage']],['buyer','a',['orders.review']],['manager','a',['tasks.manage']],['worker','a',[]],['foreign','b',['location.manage']],['third','c',['location.manage']]])await db.prepare("INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,active) VALUES(?,?,?,?,?,'BOH','Manager',?,'[]',1)").bind(who,who+'@example.test',who+'-identity',loc,'Fictional '+who,JSON.stringify(caps)).run();
 const request=(body=input,who='buyer',headers={})=>new Request('http://localhost/api/food/order-guide-review',{method:'POST',headers:{'oai-authenticated-user-id':who+'-identity','oai-authenticated-user-email':who+'@example.test',Origin:'http://localhost','Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 const review=async(body=input,who='buyer',headers={})=>{const req=request(body,who,headers);return dist?mf.dispatchFetch(req.url,req):handleOrderGuide(req,db)};
 const item={restaurantId:'fixture',name:'Fictional beef',controlNumber:'FIX',purchaseUnit:'case',packCount:2,unitQty:5,unitUOM:'lb',vendorSkus:[{id:'sku',vendor:'Fixture Supplier',vendorSku:'001',purchaseUnit:'case',packCount:2,unitQty:5,unitUOM:'lb',price:10,priceUpdatedAt:'2026-01-01',available:true}]};
 const add=async(who,loc,patch={})=>{
  const req=new Request('http://localhost/api/food',{method:'POST',headers:{'oai-authenticated-user-id':who+'-identity','oai-authenticated-user-email':who+'@example.test',Origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify({locationId:loc,requestId:crypto.randomUUID(),action:'fooditem.import',input:{dataset:'demo',sourceRestaurantId:'fixture',sourceLabel:'Fictional fixture',destinationLocationId:loc,confirmed:true,rows:[{...item,...patch}]}})});return ok(await (dist?mf.dispatchFetch(req.url,req):handleFood(req,db)));
 };
 await add('owner','a');await add('foreign','b',{controlNumber:'OTHER'});await add('third','c',{controlNumber:'THIRD'});
 const snapshot=async()=>JSON.stringify(await Promise.all(['food_records','food_history','food_state','food_receipts','invoice_files'].map(async table=>(await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results)));
 return {db,mf,review,request,add,snapshot};
}
const ok=async r=>{assert.equal(r.status,200,await r.clone().text());return r.json()};
test('guide review matches only the selected catalog and leaves all food, invoice, count and receipt state unchanged',async t=>{
 const f=await fixture(t),before=await f.snapshot(),result=await ok(await f.review());assert.equal(result.table.rows.length,2);assert.equal(result.totals['check-pack'],1);assert.equal(result.totals.unmatched,1);assert.equal(result.entries[0].matches[0].controlNumber,'FIX');assert.equal(result.entries[0].oldCount,'99');assert.equal(result.entries[0].oldOrder,'2');
 assert.equal(result.sha256,Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(csv))).toString('hex'));assert.equal('price'in result.entries[0].matches[0],false);assert.equal('count'in result.entries[0].matches[0],false);
 const other=await ok(await f.review({...input,locationId:'b'},'foreign'));assert.equal(other.entries[0].matches[0].controlNumber,'OTHER');
 const third=await ok(await f.review({...input,locationId:'c'},'third'));assert.equal(third.entries[0].matches[0].controlNumber,'THIRD');
 const empty=await ok(await f.review({...input,dataset:'operating'}));assert.equal(empty.totals.unmatched,2);assert.equal(await f.snapshot(),before);
});
test('purchasing access, explicit scope confirmation and same-origin requests are enforced on the server',async t=>{
 const f=await fixture(t);for(const who of ['manager','worker','foreign','third'])assert.equal((await f.review(input,who)).status,403);
 for(const body of [{...input,confirmed:false},{...input,dataset:'invalid'},{...input,fileName:'../private.csv'},{...input,rows:[]}])assert.equal((await f.review(body)).status,400);
 assert.equal((await f.review(input,'buyer',{Origin:'https://elsewhere.example'})).status,403);assert.equal((await f.review(input,'buyer',{'Sec-Fetch-Site':'cross-site'})).status,403);assert.equal((await f.review(input,'buyer',{'Content-Type':'text/plain'})).status,415);
 await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='buyer'").run();assert.equal((await f.review()).status,403);
});
test('a second unavailable definition remains ambiguous and a malformed guide has no side effects',async t=>{
 const f=await fixture(t);await f.add('owner','a',{controlNumber:'SECOND',vendorSkus:[{id:'off',vendor:'Fixture Supplier',vendorSku:'001',purchaseUnit:'each',available:false}]});const before=await f.snapshot();
 const result=await ok(await f.review());assert.equal(result.entries[0].status,'ambiguous');assert.equal(result.entries[0].matches.length,2);assert.equal((await f.review({...input,csv:'Wrong,headings\n1,2'})).status,400);assert.equal(await f.snapshot(),before);
});
test('a catalog change during read invalidates the comparison instead of returning a mixed snapshot',async t=>{
 const f=await fixture(t);let changed=false;
 const wrapped={withSession:()=>wrapped,batch:statements=>f.db.batch(statements),prepare:sql=>{
  const stmt=f.db.prepare(sql);if(!sql.startsWith('SELECT id,revision,json_object'))return stmt;
  return {bind:(...values)=>({all:async()=>{
   const result=await stmt.bind(...values).all();if(!changed){changed=true;await f.db.prepare("UPDATE food_state SET revision=revision+1 WHERE location_id='a'").run()}return result;
  }})};
 }};
 const r=await handleOrderGuide(f.request(),wrapped);assert.equal(r.status,409);assert.match(await r.text(),/changed/);
});
