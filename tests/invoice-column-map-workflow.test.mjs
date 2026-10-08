import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {Miniflare} from 'miniflare';
import {handleFood} from '../.sites-runtime/shared/food-service.mjs';
import {handleInvoiceArchive} from '../.sites-runtime/shared/invoice-archive-service.mjs';
import {handleInvoiceCatalog} from '../.sites-runtime/shared/invoice-catalog-service.mjs';
import {readInvoiceCsv,inspectInvoiceCsv} from '../.sites-runtime/shared/food-invoice-csv.mjs';
import {csvDigest} from '../.sites-runtime/shared/invoice-archive.mjs';
import {prepareInvoiceBatch,advanceInvoiceBatch} from '../.sites-runtime/shared/invoice-batch.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
const csv='\uFEFFCode,Line,Qty,Net,Note\r\n001,1,2,20.00,Fictional only\r\n001,2,3,30.00,Second fictional line\r\n';
const layout={version:1,headers:inspectInvoiceCsv(csv).headers,fields:{vendor:{literal:'Fixture Supplier'},vendor_sku:0,invoice_number:{literal:'INV-MAP'},line_reference:1,invoice_date:{literal:'2026-01-01'},quantity:2,unit_basis:{literal:'supplier-pack'},invoice_unit:{literal:'case'},line_total:3}};
async function fixture(t){
 const dist=process.env.JMAX_TEST_DIST;let outbound=0;
 const mf=new Miniflare({modules:true,...(dist?{scriptPath:path.resolve(dist,'server/index.js'),modulesRoot:path.resolve(dist,'server'),modulesRules:[{type:'ESModule',include:['**/*.js']}]}:{script:'export default {fetch(){return new Response("fixture")}}'}),compatibilityDate:'2026-05-22',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],serviceBindings:{ASSETS:()=>new Response('Missing',{status:404})},outboundService:()=>{outbound++;throw Error('No outbound expected')}});t.after(async()=>{await mf.dispose();assert.equal(outbound,0)});
 const db=await mf.getD1Database('DB');for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+f,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const loc of ['a','b','c'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(loc,'Fictional '+loc,'America/New_York').run();
 for(const [who,loc,caps] of [['owner','a',['location.manage']],['buyer','a',['orders.review']],['manager','a',['tasks.manage']],['worker','a',[]],['foreign','b',['location.manage']],['third','c',['location.manage']]])await db.prepare("INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,active) VALUES(?,?,?,?,?,'BOH','Manager',?,'[]',1)").bind(who,who+'@example.test',who+'-identity',loc,'Fictional '+who,JSON.stringify(caps)).run();
 const call=async(route,body,who='buyer',headers={})=>{
  const request=new Request('http://localhost/api/food'+route,{method:body?'POST':'GET',headers:{'oai-authenticated-user-id':who+'-identity','oai-authenticated-user-email':who+'@example.test',Origin:'http://localhost','Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
  if(dist)return mf.dispatchFetch(request.url,request);
  return (route.startsWith('/invoice-files')?handleInvoiceArchive:route.startsWith('/invoice-review')?handleInvoiceCatalog:handleFood)(request,db);
 };
 const item={restaurantId:'fixture',name:'Fictional ingredient',controlNumber:'FIX-MAP',purchaseUnit:'case',packCount:2,unitQty:5,unitUOM:'lb',vendorSkus:[{id:'sku',vendor:'Fixture Supplier',vendorSku:'001',purchaseUnit:'case',packCount:2,unitQty:5,unitUOM:'lb',price:10,priceUpdatedAt:'2026-01-01',available:true}]};
 await ok(await call('',{locationId:'a',requestId:crypto.randomUUID(),action:'fooditem.import',input:{dataset:'demo',sourceRestaurantId:'fixture',sourceLabel:'Fictional column map fixture',destinationLocationId:'a',confirmed:true,rows:[item]}},'owner'));
 const record=await db.prepare('SELECT id,revision FROM food_records').first(),file={kind:'csv',fileName:'Fictional mapped supplier.csv',byteLength:Buffer.byteLength(csv),sha256:await csvDigest(csv),layout};
 const archive=patch=>call('/invoice-files',{locationId:'a',dataset:'demo',csv,...file,kind:undefined,confirmed:true,...patch});
 const command=(row=readInvoiceCsv(csv,layout)[0])=>({locationId:'a',requestId:crypto.randomUUID(),action:'fooditem.invoice',recordId:record.id,expectedRevision:record.revision,input:{...row,skuId:'sku',sourceNote:'Fictional source checked',confirmed:true,fileSource:{...file,row}}});
 return {db,call,record,file,archive,command};
}
const ok=async r=>{assert.equal(r.status,200,await r.clone().text());return r.json()};
test('mapped catalog review, original archive, sequential group save and history work through the existing scoped writer',async t=>{
 const f=await fixture(t),request={locationId:'a',dataset:'demo',csv,layout};
 const review=await ok(await f.call('/invoice-review',request));assert.equal(review.entries.length,2);assert.equal(review.totals.ready,2);
 const blocked=await f.call('',f.command());assert.equal(blocked.status,409);assert.match(await blocked.text(),/Archive the original/);
 await ok(await f.archive());await ok(await f.archive());assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM invoice_files').first()).n,1);
 let group=prepareInvoiceBatch(review,f.file,review.entries.map(e=>({recordNumber:e.row.recordNumber,itemId:e.matches[0].itemId,skuId:'sku'})),'Fictional checked invoice',true);
 group=await advanceInvoiceBatch(group,command=>f.call('',command));group=await advanceInvoiceBatch(group,command=>f.call('',command));assert.deepEqual(group.lines.map(l=>l.state),['saved','saved']);
 const retry=await ok(await f.call('',group.lines[1].command));assert.equal(retry.revision,group.revisions[f.record.id]);
 const history=await f.db.prepare("SELECT event FROM food_history WHERE json_extract(event,'$.invoiceLine') IS NOT NULL ORDER BY sequence").all();assert.equal(history.results.length,2);for(const h of history.results)assert.deepEqual(JSON.parse(h.event).invoiceLine.fileSource.layout,layout);
 const data=JSON.parse((await f.db.prepare('SELECT data FROM food_records').first()).data);assert.equal(data.count,null);assert.equal(data.vendorSkus[0].price,10);
 assert.equal((await ok(await f.call('/invoice-review',request))).historyTotals.recorded,2);
 const original=await f.call('/invoice-files?'+new URLSearchParams({locationId:'a',dataset:'demo',sha256:f.file.sha256,download:'1'}));assert.equal(original.status,200);assert.deepEqual(Buffer.from(await original.arrayBuffer()),Buffer.from(csv));
});
test('mapped reads and saves enforce purchasing roles, three-store boundaries and archive dataset ownership',async t=>{
 const f=await fixture(t),request={locationId:'a',dataset:'demo',csv,layout};
 for(const who of ['manager','worker','foreign','third']){
  assert.equal((await f.call('/invoice-review',request,who)).status,403);
  assert.equal((await f.call('',f.command(),who)).status,403);
 }
 await ok(await f.archive({dataset:'operating'}));assert.equal((await f.call('',f.command())).status,409);
 await ok(await f.archive());
 for(const who of ['manager','worker','foreign','third'])assert.equal((await f.call('/invoice-files?'+new URLSearchParams({locationId:'a',dataset:'demo',sha256:f.file.sha256,download:'1'}),undefined,who)).status,403);
 await f.db.prepare('UPDATE memberships SET active=0 WHERE id=?').bind('buyer').run();assert.equal((await f.call('',f.command())).status,403);
 assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM food_history WHERE json_extract(event,'$.invoiceLine') IS NOT NULL").first()).n,0);
});
test('changed maps, bytes and row amounts cannot replace source facts or bypass source confirmation and revisions',async t=>{
 const f=await fixture(t),request={locationId:'a',dataset:'demo',csv,layout};
 const bad=structuredClone(layout);bad.fields.quantity=3;
 assert.equal((await f.call('/invoice-review',{...request,layout:bad})).status,400);
 assert.equal((await f.call('/invoice-review',request,'buyer',{Origin:'https://foreign.test'})).status,403);
 assert.equal((await f.archive({csv:csv.replace('20.00','21.00')})).status,400);await ok(await f.archive());
 const changed=f.command();changed.input.lineTotal='21.00';changed.input.fileSource.row.lineTotal='21.00';assert.equal((await f.call('',changed)).status,409);
 const unchecked=f.command();unchecked.input.confirmed=false;assert.equal((await f.call('',unchecked)).status,400);
 const saved=await ok(await f.call('',f.command()));assert.equal(saved.revision,f.record.revision+1);
 assert.equal((await f.call('',f.command())).status,409);
 const review=await ok(await f.call('/invoice-review',{...request,csv:csv.replace('20.00','21.00')}));assert.equal(review.entries[0].saved.state,'conflict');assert.deepEqual(review.entries[0].saved.differences,['net line amount']);
});
