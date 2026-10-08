import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {handleFood} from '../.sites-runtime/shared/food-service.mjs';
import {parseFoodItem,parseFoodRecipe} from '../.sites-runtime/shared/food.mjs';
import {foodItemCost,foodRecipeCost,foodShortfall} from '../.sites-runtime/shared/food-model.mjs';
import {jeffDemo} from './food-fixture.mjs';
import {parseInvoiceLine,invoiceUnit} from '../.sites-runtime/shared/food-invoice.mjs';
import {wasteCost} from '../.sites-runtime/shared/food-waste.mjs';
import {parseCredit} from '../.sites-runtime/shared/food-credit.mjs';
import {parseReceiving} from '../.sites-runtime/shared/food-receiving.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
const source={dataset:'demo',sourceRestaurantId:'demo_diner',label:'Fabricated fixture',importedAt:'2026-09-28T12:00:00Z',importedBy:'owner'};
export const rawItem={restaurantId:'demo_diner',name:'Demo beef',controlNumber:'BEEF',storageArea:'Walk-in',purchaseUnit:'case',packCount:8,unitQty:5,unitUOM:'lb',portionSize:6,portionUOM:'oz',par:4,currentStock:99,lastCounted:'2026-09-28',vendorSkus:[{id:'sku1',vendor:'Demo supplier',vendorSku:'1',purchaseUnit:'case',packCount:8,unitQty:5,unitUOM:'lb',price:92.5,priceUpdatedAt:'2026-09-28',preferred:true,available:true}]};
const rawRecipe={restaurantId:'demo_diner',id:'burger',name:'Demo burger',recipeType:'menu',yieldQty:1,yieldUOM:'each',lines:[{sourceType:'item',controlNumber:'BEEF',qty:1}]};
const importInput=rows=>({dataset:'demo',sourceRestaurantId:'demo_diner',sourceLabel:'Fabricated test fixture',destinationLocationId:'a',confirmed:true,rows});
async function fixture(t){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync(`drizzle/${file}`,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const loc of ['a','b'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(loc,loc,'America/New_York').run();
 for(const [id,area,caps,loc='a'] of [['owner','Executive',['location.manage']],['manager','BOH',['tasks.manage']],['buyer','FOH',['orders.review']],['foh','FOH',['tasks.manage']],['worker','BOH',[]],['foreign','BOH',['location.manage'],'b']])await db.prepare('INSERT INTO memberships(id,email,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?)').bind(id,id+'@example.test',loc,id,area,'Manager',JSON.stringify(caps),'[]').run();
 const headers=id=>({'oai-authenticated-user-id':id+'-identity','oai-authenticated-user-email':id+'@example.test'});
 const call=async(id,action,input={},record,extra={})=>{const response=await handleFood(new Request('https://test.example/api/food',{method:'POST',headers:{...headers(id),Origin:'https://test.example','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),locationId:'a',action,input,...(record?{recordId:record.recordId??record.id,expectedRevision:record.revision}:{}),...extra})}),db);return {status:response.status,data:await response.json()}};
 const get=async(actor,params={})=>{const r=await handleFood(new Request('https://test.example/api/food?'+new URLSearchParams({locationId:'a',dataset:'demo',...params}),{headers:headers(actor)}),db);return {status:r.status,data:await r.json()}};
 const view=async(actor,loc='a')=>{const items=await get(actor,{locationId:loc}),recipes=await get(actor,{locationId:loc,kind:'foodrecipe'});return items.status===200?{...items,data:{...items.data,records:[...items.data.records,...recipes.data.records]}}:items};return {db,call,view,get,headers};
}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
const invoiceInput={skuId:'sku1',invoiceNumber:'DEMO-100',lineReference:'1',invoiceDate:'2026-09-28',sourceNote:'Fictional test invoice, page 1',quantity:80,unitBasis:'measure',invoiceUnit:'lbs',lineTotal:'200.00',confirmed:true};
const priceInput=invoiceRevision=>({invoiceRevision,reason:'Checked current supplier price against invoice',confirmed:true});
const creditInput=invoiceRevision=>({invoiceRevision,creditNumber:'CREDIT-1',lineReference:'1',creditDate:'2026-09-28',sourceNote:'Fictional issued supplier credit document page 1',reason:'returned',quantity:20,amount:'50.00',confirmed:true});
const receivingInput=invoiceRevision=>({invoiceRevision,deliveryReference:'DEMO-TICKET-1',receivedDate:'2026-09-28',accepted:30,rejected:10,rejectionReason:'Package damaged at delivery',note:'Fictional receiving fixture',confirmed:true});

import {readInvoiceCsv,parseInvoiceFileSource,invoiceCsvColumns,invoiceCsvMaxBytes,csvMatchesSupplier} from '../.sites-runtime/shared/food-invoice-csv.mjs';
const csvHeader=invoiceCsvColumns.join(',');
const csvData='Demo supplier,1,DEMO-100,1,2026-09-28,80,measure,lbs,200.00';
const csvText=csvHeader+'\r\n'+csvData+'\r\n';
const fileSource=()=>({kind:'csv',fileName:'fictional-invoice.csv',byteLength:Buffer.byteLength(csvText),sha256:'a'.repeat(64),row:readInvoiceCsv(csvText)[0]});
const at='2026-09-29T03:00:00Z';

import {reviewInvoiceCatalog} from '../.sites-runtime/shared/invoice-catalog-review.mjs';
import {handleInvoiceCatalog} from '../.sites-runtime/shared/invoice-catalog-service.mjs';
const catItem=(id='one',patch={})=>({id,revision:1,data:{...parseFoodItem(rawItem,source),...patch}});
const review=(items,rows=readInvoiceCsv(csvText),at='2026-09-29T12:00:00Z')=>reviewInvoiceCatalog(rows,items,at,'America/New_York');
test('catalog matching preserves supplier codes, normalizes spaces/case and calculates compatible packs',()=>{
 const value=review([catItem()]);assert.equal(value.totals.ready,1);assert.equal(value.entries[0].matches[0].quantity,2);assert.equal(value.entries[0].matches[0].price,100);
 assert.equal(review([catItem()],readInvoiceCsv(csvText.replace('Demo supplier',' demo  SUPPLIER '))).totals.ready,1);
 assert.equal(review([catItem()],readInvoiceCsv(csvText.replace(',1,DEMO-',',01,DEMO-'))).totals.unmatched,1);
});
test('catalog ambiguity is explicit even if one matched item has unresolved mapping',()=>{
 const value=review([catItem(),catItem('two',{needsReview:true})]);assert.equal(value.totals['choose-item'],1);assert.equal(value.entries[0].matches.length,2);assert.ok(value.entries[0].matches[1].issue);
 assert.equal(review([catItem('one',{vendorSkus:[rawItem.vendorSkus[0],{...rawItem.vendorSkus[0],id:'sku2'}]})]).totals['choose-item'],1);
});
test('inactive, unmapped, unavailable, future and incompatible unit cases do not become ready',()=>{
 for(const patch of [{active:false},{needsReview:true}])assert.equal(review([catItem('one',patch)]).totals['needs-review'],1);
 assert.equal(review([catItem('one',{vendorSkus:[{...rawItem.vendorSkus[0],available:false}]})]).totals.unmatched,1);
 assert.equal(review([catItem()],readInvoiceCsv(csvText.replace(',lbs,',',gal,'))).totals['needs-review'],1);
 assert.equal(review([catItem()],undefined,'2026-09-28T02:00:00Z').totals['needs-review'],1);
});
test('matching covers off-page catalogs and fails closed on excessive catalog/ambiguous results',()=>{
 const items=Array.from({length:4501},(_,i)=>catItem('item'+i,{vendorSkus:[{...rawItem.vendorSkus[0],vendorSku:String(i)}]}));
 const v=review(items,readInvoiceCsv(csvText.replace(',1,DEMO-',',4500,DEMO-')));assert.equal(v.entries[0].matches[0].itemId,'item4500');
 assert.throws(()=>review(Array.from({length:21},(_,i)=>catItem('i'+i))));assert.throws(()=>review(Array.from({length:5001},(_,i)=>catItem('i'+i))));
});
const request=(headers,patch={})=>new Request('https://test.example/api/food/invoice-review',{method:'POST',headers:{...headers,Origin:'https://test.example','Content-Type':'application/json'},body:JSON.stringify({locationId:'a',dataset:'demo',csv:csvText,...patch})});
const callReview=async(f,actor='buyer',patch={})=>{const r=await handleInvoiceCatalog(request(f.headers(actor),patch),f.db);return {status:r.status,data:await r.json()}};
test('catalog service isolates restaurant/dataset and invoice authority without changing Food records',async t=>{
 const f=await fixture(t);ok(await f.call('owner','fooditem.import',importInput([rawItem])));
 const before=await f.db.prepare('SELECT * FROM food_records').all(),history=await f.db.prepare('SELECT * FROM food_history').all();
 const value=ok(await callReview(f));assert.equal(value.totals.ready,1);assert.equal(value.dataset,'demo');assert.equal(value.locationId,'a');assert.equal(value.entries[0].matches[0].title,'Demo beef');
 assert.equal(ok(await callReview(f,'buyer',{dataset:'operating'})).totals.unmatched,1);
 for(const actor of ['manager','foh','worker','foreign'])assert.equal((await callReview(f,actor)).status,403);
 assert.equal((await callReview(f,'buyer',{locationId:'b'})).status,403);
 assert.deepEqual((await f.db.prepare('SELECT * FROM food_records').all()).results,before.results);assert.deepEqual((await f.db.prepare('SELECT * FROM food_history').all()).results,history.results);
 assert.ok(!JSON.stringify(value).includes('countHistory'));assert.ok(!JSON.stringify(value).includes('example.test'));
});
test('catalog endpoint rejects wrong origin, oversized/invalid CSV, unknown fields and wrong methods',async t=>{
 const f=await fixture(t);
 let res=await handleInvoiceCatalog(new Request('https://test.example/api/food/invoice-review'),f.db);assert.equal(res.status,405);assert.equal(res.headers.get('Allow'),'POST');
 const req=request(f.headers('owner'));req.headers.set('Origin','https://foreign.test');assert.equal((await handleInvoiceCatalog(req,f.db)).status,403);
 for(const patch of [{dataset:'other'},{csv:'bad'},{csv:'x'.repeat(262145)},{csv:42},{extra:true}])assert.equal((await callReview(f,'owner',patch)).status,400);
});
test('catalog detects food or membership changes during review before returning matches',async t=>{
 const f=await fixture(t);ok(await f.call('owner','fooditem.import',importInput([rawItem])));await callReview(f);
 for(const sql of ["UPDATE food_state SET revision=revision+1 WHERE location_id='a'","UPDATE memberships SET revision=revision+1 WHERE id='buyer'"]){
  const binding={withSession(){return this},prepare(query){const stmt=f.db.prepare(query);if(!query.startsWith('SELECT id,revision,json_object'))return stmt;return {bind(...args){const bound=stmt.bind(...args);return {async all(){const value=await bound.all();await f.db.prepare(sql).run();return value}}}}},batch:args=>f.db.batch(args)};
  const res=await handleInvoiceCatalog(request(f.headers('buyer')),binding);assert.equal(res.status,409,await res.text());
 }
});
test('matched selection saves through existing invoice writer with source identity, stale and duplicate guards',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),match=ok(await callReview(f)).entries[0].matches[0];
 const input={...invoiceInput,skuId:match.skuId,fileSource:fileSource()},r={id:match.itemId,revision:match.itemRevision};
 const saved=ok(await f.call('buyer','fooditem.invoice',input,r));assert.equal((await f.call('buyer','fooditem.invoice',{...input,invoiceNumber:'OTHER'},r)).status,409);assert.equal((await f.call('buyer','fooditem.invoice',input,saved)).status,409);
 const h=ok(await f.get('buyer',{view:'history',recordId:base.recordId}));assert.deepEqual(h.entries.at(-1).event.invoiceLine.fileSource,input.fileSource);
});
import {checkSavedInvoice} from '../.sites-runtime/shared/invoice-saved-review.mjs';
import {invoiceEntryKey} from '../.sites-runtime/shared/food-invoice.mjs';
test('saved invoice comparison accepts numeric formatting and unit aliases while retaining source identity',()=>{
 const row=readInvoiceCsv(csvText)[0],s={entryKey:invoiceEntryKey(row.vendor,row.invoiceNumber,row.lineReference),itemId:'one',title:'Fixture',controlNumber:'FIX',sequence:20,revision:2,invoiceDate:row.invoiceDate,quantity:80,unitBasis:'measure',invoiceUnit:'lb',lineTotalCents:20000,vendorSku:'1'};
 assert.equal(checkSavedInvoice({...row,quantity:'080.00',invoiceUnit:'pounds',lineTotal:'200.0'},s).state,'recorded');assert.equal(checkSavedInvoice(row).state,'not-recorded');
 assert.equal(invoiceEntryKey(' DEMO  Supplier ',' demo-100 ','1'),s.entryKey);
});
test('saved invoice comparison names changed source fields without silently converting quantity bases or codes',()=>{
 const row=readInvoiceCsv(csvText)[0],s={entryKey:'fixture',itemId:'one',title:'Fixture',controlNumber:'FIX',sequence:20,revision:2,invoiceDate:'2026-09-27',quantity:2,unitBasis:'supplier-pack',invoiceUnit:'case',lineTotalCents:0,vendorSku:'01'};
 const v=checkSavedInvoice(row,s);assert.equal(v.state,'conflict');assert.deepEqual(v.differences,['supplier SKU','invoice date','quantity','quantity basis','invoice unit','net line amount']);assert.equal(v.source,s);
});
test('saved source precheck survives item mapping changes and voiding releases only the active entry',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),saved=ok(await f.call('buyer','fooditem.invoice',{...invoiceInput,fileSource:fileSource()},base));
 let v=ok(await callReview(f));assert.deepEqual(v.historyTotals,{notRecorded:0,recorded:1,conflict:0});assert.equal(v.entries[0].saved.source.itemId,base.recordId);assert.equal(v.entries[0].saved.source.revision,saved.revision);
 // Existing checked definitions can change. Read evidence is still bound to the saved source key.
 await f.db.prepare("UPDATE food_records SET data=json_set(data,'$.vendorSkus[0].vendorSku','CHANGED','$.active',json('false')) WHERE id=?").bind(base.recordId).run();
 v=ok(await callReview(f));assert.equal(v.entries[0].status,'unmatched');assert.equal(v.entries[0].saved.state,'recorded');
 assert.equal((await f.call('buyer','fooditem.invoice',{...invoiceInput,fileSource:fileSource()},saved)).status,400);
 await f.db.prepare("UPDATE food_records SET data=json_set(data,'$.vendorSkus[0].vendorSku','1','$.active',json('true')) WHERE id=?").bind(base.recordId).run();
 const voided=ok(await f.call('buyer','fooditem.invoice-void',{invoiceRevision:saved.revision,reason:'Fictional correction'},saved));
 assert.equal(ok(await callReview(f)).entries[0].saved.state,'not-recorded');
 const correction=ok(await f.call('buyer','fooditem.invoice',{...invoiceInput,lineTotal:'210.00'},voided));v=ok(await callReview(f));assert.equal(v.entries[0].saved.state,'conflict');assert.deepEqual(v.entries[0].saved.differences,['net line amount']);assert.equal(v.entries[0].saved.source.revision,correction.revision);
});
test('saved source review does not confuse another item match, restaurant or operating dataset with identity',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem,{...rawItem,controlNumber:'SECOND',name:'Second candidate'}])));const items=ok(await f.get('buyer')).records;
 const first=items.find(i=>i.data.controlNumber==='BEEF');ok(await f.call('buyer','fooditem.invoice',invoiceInput,first));
 let value=ok(await callReview(f));assert.equal(value.entries[0].matches.length,2);assert.equal(value.entries[0].saved.source.itemId,first.id);assert.equal(value.entries[0].saved.state,'recorded');
 value=ok(await callReview(f,'buyer',{csv:csvText.replace(',1,DEMO-',',01,DEMO-')}));assert.equal(value.entries[0].saved.state,'conflict');assert.deepEqual(value.entries[0].saved.differences,['supplier SKU']);
 assert.equal(ok(await callReview(f,'buyer',{dataset:'operating'})).entries[0].saved.state,'not-recorded');assert.equal(ok(await callReview(f,'foreign',{locationId:'b'})).entries[0].saved.state,'not-recorded');
 value=ok(await callReview(f,'buyer',{csv:csvText.replace('Demo supplier','Another supplier')}));assert.equal(value.entries[0].saved.state,'not-recorded');
});
test('saved source review checks all 250 rows with bounded history queries and no notes or employee payload',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem])));
 const values=[];for(let i=0;i<250;i++){const input={...invoiceInput,invoiceNumber:'INVOICE-'+i,sourceNote:'PRIVATE SOURCE NOTE MARKER'},line=parseInvoiceLine(input,parseFoodItem(rawItem,source),'2026-09-29T12:00:00Z','PRIVATE ACTOR','America/New_York');values.push(f.db.prepare('INSERT INTO food_history(location_id,record_id,revision,actor_id,at,event) VALUES(?,?,?,?,?,?)').bind('a',base.recordId,i+2,'PRIVATE ACTOR','2026-09-29T12:00:00Z',JSON.stringify({action:'fooditem.invoice',invoiceLine:line,history:[]})));}
 for(let start=0;start<values.length;start+=50)await f.db.batch(values.slice(start,start+50));
 const csv=csvHeader+'\n'+Array.from({length:250},(_,i)=>csvData.replace('DEMO-100','INVOICE-'+i)).join('\n');
 const v=ok(await callReview(f,'buyer',{csv}));assert.equal(v.entries.length,250);assert.equal(v.historyTotals.recorded,250);assert.equal(new Set(v.entries.map(e=>e.saved.source.sequence)).size,250);assert.doesNotMatch(JSON.stringify(v),/PRIVATE SOURCE|PRIVATE ACTOR|sourceNote|actorId/);
});
test('saved source duplicates fail closed rather than arbitrarily picking one invoice history entry',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem])));ok(await f.call('buyer','fooditem.invoice',invoiceInput,base));
 const raw=await f.db.prepare("SELECT * FROM food_history WHERE json_extract(event,'$.invoiceLine') IS NOT NULL").first();
 await f.db.prepare('INSERT INTO food_history(location_id,record_id,revision,actor_id,at,event) VALUES(?,?,?,?,?,?)').bind('a',base.recordId,3,raw.actor_id,raw.at,raw.event).run();
 const v=await callReview(f);assert.equal(v.status,503);assert.match(v.data.error,/duplicate source identifiers/);
});
test('a change after saved history lookup discards the whole response before matches escape',async t=>{
 const f=await fixture(t);ok(await f.call('owner','fooditem.import',importInput([rawItem])));await callReview(f);
 const binding={withSession(){return this},prepare(query){const stmt=f.db.prepare(query);if(!query.startsWith('SELECT h.record_id AS itemId'))return stmt;return {bind(...args){const b=stmt.bind(...args);return {async all(){const v=await b.all();await f.db.prepare("UPDATE food_state SET revision=revision+1 WHERE location_id='a'").run();return v}}}}},batch:a=>f.db.batch(a)};
 const r=await handleInvoiceCatalog(request(f.headers('buyer')),binding);assert.equal(r.status,409,await r.text());
});
