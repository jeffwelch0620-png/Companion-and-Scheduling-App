import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {prepareInvoiceBatch,advanceInvoiceBatch} from '../.sites-runtime/shared/invoice-batch.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
test('compiled writer saves reviewed groups with real receipt retry, same-item revisions and stop-on-access-change',async t=>{
 let outbound=0;const mf=new Miniflare({modules:true,scriptPath:path.resolve('dist/server/index.js'),modulesRoot:path.resolve('dist/server'),modulesRules:[{type:'ESModule',include:['**/*.js']}],compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],serviceBindings:{ASSETS:()=>new Response('Missing',{status:404})},outboundService:()=>{outbound++;throw Error('No outbound expected')}});t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB');for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+f,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const id of ['a','b','c'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(id,'Fictional '+id,'America/New_York').run();
 for(const [id,caps,loc='a'] of [['owner',['location.manage']],['purchaser',['orders.review']],['worker',[]],['foreign',['location.manage'],'b'],['third',['orders.review'],'c']])await db.prepare("INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,active) VALUES(?,?,?,?,?,'BOH','Manager',?,'[]',1)").bind(id,id+'@example.test',id+'-identity',loc,'Fictional '+id,JSON.stringify(caps)).run();
 const headers=id=>({'oai-authenticated-user-id':id+'-identity','oai-authenticated-user-email':id+'@example.test',Origin:'http://localhost','Content-Type':'application/json'});
 const post=(actor,url,body)=>mf.dispatchFetch('http://localhost'+url,{method:'POST',headers:headers(actor),body:JSON.stringify(body)});
 const ok=async r=>{const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data};
 const item=n=>({restaurantId:'fixture',name:'Fictional ingredient '+n,controlNumber:'FIX-'+n,purchaseUnit:'case',packCount:2,unitQty:5,unitUOM:'lb',vendorSkus:[{id:'sku-'+n,vendor:'Fixture Supplier',vendorSku:'00'+n,purchaseUnit:'case',packCount:2,unitQty:5,unitUOM:'lb',price:10,priceUpdatedAt:'2026-01-01',available:true}]});
 await ok(await post('owner','/api/food',{locationId:'a',requestId:'fixture-import',action:'fooditem.import',input:{dataset:'demo',sourceRestaurantId:'fixture',sourceLabel:'Fictional worker fixture',destinationLocationId:'a',confirmed:true,rows:[item(1),item(2)]}}));
 const csvFor=inv=>'vendor,vendor_sku,invoice_number,line_reference,invoice_date,quantity,unit_basis,invoice_unit,line_total\n'+[1,1,2].map((sku,i)=>`Fixture Supplier,00${sku},${inv},${i+1},2026-01-01,20,measure,lb,30.00`).join('\n');
 const prepare=async(inv='GROUP-1')=>{
  const csv=csvFor(inv),review=await ok(await post('purchaser','/api/food/invoice-review',{locationId:'a',dataset:'demo',csv}));
  const file={kind:'csv',fileName:'Fictional group.csv',byteLength:Buffer.byteLength(csv),sha256:Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(csv))).toString('hex')};
  return prepareInvoiceBatch(review,file,review.entries.map(e=>({recordNumber:e.row.recordNumber,itemId:e.matches[0].itemId,skuId:e.matches[0].skuId})),'Fictional checked source',true);
 };
 let batch=await prepare(),lost;
 batch=await advanceInvoiceBatch(batch,async c=>{lost=structuredClone(c);await ok(await post('purchaser','/api/food',c));throw Error('Simulated lost reply AFTER commit')},()=> 'fixture-pending');
 assert.equal(batch.lines[0].state,'uncertain');assert.equal(batch.lines[1].state,'queued');
 batch=await advanceInvoiceBatch(batch,async c=>{assert.deepEqual(c,lost);return post('purchaser','/api/food',c)},()=>{throw Error('Keep same ID')});
 batch=await advanceInvoiceBatch(batch,c=>post('purchaser','/api/food',c));batch=await advanceInvoiceBatch(batch,c=>post('purchaser','/api/food',c));assert.ok(batch.lines.every(l=>l.state==='saved'));
 const recorded=await ok(await post('purchaser','/api/food/invoice-review',{locationId:'a',dataset:'demo',csv:csvFor('GROUP-1')}));assert.equal(recorded.historyTotals.recorded,3);assert.equal(recorded.historyTotals.notRecorded,0);
 const counts=await db.prepare("SELECT count(*) AS n FROM food_history WHERE json_extract(event,'$.invoiceLine') IS NOT NULL").first();assert.equal(counts.n,3);
 for(const actor of ['worker','foreign','third'])assert.equal((await post(actor,'/api/food',{...lost,requestId:actor+'-denied'})).status,403);
 const operating=await ok(await post('purchaser','/api/food/invoice-review',{locationId:'a',dataset:'operating',csv:csvFor('GROUP-1')}));assert.equal(operating.historyTotals.recorded,0);assert.equal(operating.totals.unmatched,3);
 let stale=await prepare('STALE');await db.prepare('UPDATE food_records SET revision=revision+1 WHERE id=?').bind(stale.lines[0].match.itemId).run();stale=await advanceInvoiceBatch(stale,c=>post('purchaser','/api/food',c));assert.deepEqual(stale.lines.map(l=>l.state),['rejected','queued','queued']);
 let access=await prepare('ACCESS');access=await advanceInvoiceBatch(access,c=>post('purchaser','/api/food',c));assert.equal(access.lines[0].state,'saved');
 await db.prepare("UPDATE memberships SET capabilities='[]',revision=revision+1 WHERE id='purchaser'").run();access=await advanceInvoiceBatch(access,c=>post('purchaser','/api/food',c));assert.deepEqual(access.lines.map(l=>l.state),['saved','rejected','queued']);
 const final=await db.prepare('SELECT data FROM food_records').all();for(const r of final.results){const data=JSON.parse(r.data);assert.equal(data.vendorSkus[0].price,10);assert.equal(data.count,null)}
 assert.equal((await db.prepare("SELECT count(*) AS n FROM food_history WHERE json_extract(event,'$.invoiceLine') IS NOT NULL").first()).n,4);assert.equal(outbound,0);
});
