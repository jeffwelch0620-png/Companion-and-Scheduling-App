import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {handleInvoiceArchive} from '../.sites-runtime/shared/invoice-archive-service.mjs';
import {parseInvoiceArchive,csvDigest,invoiceArchiveMaxBytes} from '../.sites-runtime/shared/invoice-archive.mjs';
import {handleFood} from '../.sites-runtime/shared/food-service.mjs';
import {readInvoiceCsv,invoiceCsvColumns} from '../.sites-runtime/shared/food-invoice-csv.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
const csv='\uFEFF'+invoiceCsvColumns.join(',')+'\r\nFixture Supplier,001,INV-001,1,2026-01-01,2,supplier-pack,case,20.00\r\n';
const input=async(overrides={})=>({locationId:'a',dataset:'demo',fileName:'Fictional café invoice.csv',byteLength:Buffer.byteLength(csv),sha256:await csvDigest(csv),csv,confirmed:true,...overrides});
async function fixture(t){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const loc of ['a','b','c'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(loc,'Fictional '+loc,'America/New_York').run();
 for(const [who,loc,caps] of [['owner','a',['location.manage']],['buyer','a',['orders.review']],['manager','a',['tasks.manage']],['worker','a',[]],['foreign','b',['location.manage']],['third','c',['location.manage']]])await db.prepare("INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,active) VALUES(?,?,?,?,?,'BOH','Manager',?,'[]',1)").bind(who,who+'@example.test',who+'-identity',loc,'Fictional '+who,JSON.stringify(caps)).run();
 const headers=who=>({'oai-authenticated-user-id':who+'-identity','oai-authenticated-user-email':who+'@example.test',Origin:'https://fixture.test','Content-Type':'application/json'});
 const request=async(who='buyer',method='POST',patch={},extra={})=>{const body=await input(patch);return new Request('https://fixture.test/api/food/invoice-files'+(method==='GET'?'?'+new URLSearchParams({locationId:body.locationId,dataset:body.dataset,sha256:body.sha256,...(patch.download?{download:patch.download}:{})}):''),{method,headers:{...headers(who),...extra},...(method==='POST'?{body:JSON.stringify(body)}:{})})};
 const call=async(who='buyer',method='POST',patch={},extra={})=>handleInvoiceArchive(await request(who,method,patch,extra),db);
 return {db,headers,request,call};
}
const ok=async r=>{assert.equal(r.status,200,await r.clone().text());return r.json()};
test('archive validation preserves original BOM, CRLF, Unicode and leading zeroes',async()=>{
 const v=await parseInvoiceArchive(await input());assert.equal(v.csv,csv);assert.equal(v.rowCount,1);assert.equal(v.byteLength,Buffer.byteLength(csv));assert.equal(readInvoiceCsv(v.csv)[0].vendorSku,'001');
});
test('archive rejects unconfirmed, changed bytes, fingerprints, paths, malformed CSV and invalid Unicode',async()=>{
 for(const patch of [{confirmed:false},{byteLength:1},{sha256:'a'.repeat(64)},{fileName:'../invoice.csv'},{fileName:'invoice.pdf'},{csv:csv+'\uD800',byteLength:Buffer.byteLength(csv+'\uD800')},{csv:'not csv',byteLength:7,sha256:await csvDigest('not csv')}])await assert.rejects(()=>input(patch).then(parseInvoiceArchive));
});
test('explicit archive is immutable and byte-exact; metadata and daily data stay separate',async t=>{
 const f=await fixture(t),first=await ok(await f.call());assert.equal(first.file.rowCount,1);assert.equal(first.file.sha256,await csvDigest(csv));assert.equal(first.file.csv,undefined);assert.equal(first.file.createdBy,undefined);
 const retry=await ok(await f.call('owner','POST',{fileName:'renamed.csv'}));assert.deepEqual(retry,first);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM invoice_files').first()).n,1);
 const response=await f.call('buyer','GET',{download:'1'});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.from(csv));assert.match(response.headers.get('Content-Disposition'),/attachment;/);assert.match(response.headers.get('Content-Disposition'),/caf%C3%A9/);assert.match(response.headers.get('Cache-Control'),/no-store/);assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
 for(const table of ['food_records','food_history','records'])assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n,0);
});
test('archive upload, metadata and download require purchaser authority and explicit restaurant/dataset',async t=>{
 const f=await fixture(t);await ok(await f.call());
 for(const who of ['manager','worker','foreign','third'])for(const method of ['POST','GET'])assert.equal((await f.call(who,method,{download:method==='GET'?'1':undefined})).status,403);
 assert.equal((await f.call('buyer','GET',{dataset:'operating'})).status,404);assert.equal((await f.call('buyer','POST',{locationId:'b'})).status,403);
 for(const [who,locationId] of [['foreign','b'],['third','c']]){assert.equal((await f.call(who,'GET',{locationId})).status,404);await ok(await f.call(who,'POST',{locationId}));}
 assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM invoice_files').first()).n,3);
});
test('archive endpoint rejects wrong origin, method, fields, excessive body and cross-site reads',async t=>{
 const f=await fixture(t);assert.equal((await f.call('buyer','POST',{}, {Origin:'https://foreign.test'})).status,403);
 assert.equal((await f.call('buyer','POST',{surprise:true})).status,400);assert.equal((await f.call('buyer','POST',{}, {'Content-Type':'text/plain'})).status,415);
 assert.equal((await f.call('buyer','GET',{}, {'Sec-Fetch-Site':'cross-site'})).status,403);
 assert.equal((await handleInvoiceArchive(new Request('https://fixture.test/api/food/invoice-files',{method:'DELETE'}),f.db)).status,405);
 const big=new Request('https://fixture.test/api/food/invoice-files',{method:'POST',headers:f.headers('buyer'),body:' '.repeat(1600001)});assert.equal((await handleInvoiceArchive(big,f.db)).status,413);
 assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM invoice_files').first()).n,0);
});
test('capacity is scoped and does not remove originals or break retry of a saved identity',async t=>{
 const f=await fixture(t);await ok(await f.call());await f.db.prepare('INSERT INTO invoice_files VALUES(?,?,?,?,?,?,?,?,?)').bind('a','demo','b'.repeat(64),'Fictional capacity fixture.csv',invoiceArchiveMaxBytes,1,'fixture','2026-01-01','owner').run();
 const changed=csv.replace('INV-001','INV-002');assert.equal((await f.call('buyer','POST',{csv:changed,byteLength:Buffer.byteLength(changed),sha256:await csvDigest(changed)})).status,413);
 await ok(await f.call());await ok(await f.call('buyer','POST',{dataset:'operating'}));assert.equal((await f.call('buyer','GET',{download:'1'})).status,200);
});
test('membership changes during a read suppress content and changes before insert prevent writes',async t=>{
 const f=await fixture(t);await ok(await f.call());
 const guarded=(needle,method)=>{
  let done=false;
  return {withSession(){return this},batch:s=>f.db.batch(s),prepare(sql){
   const p=f.db.prepare(sql);
   return {bind(...args){
    const bound=p.bind(...args);if(!sql.includes(needle))return bound;
    return {[method]:async()=>{if(!done){done=true;await f.db.prepare('UPDATE memberships SET revision=revision+1 WHERE id=?').bind('buyer').run()}return bound[method]()}};
   }};
  }};
 };
 const read=await handleInvoiceArchive(await f.request('buyer','GET',{download:'1'}),guarded('FROM invoice_files','first'));assert.equal(read.status,409);assert.doesNotMatch(await read.text(),/Fixture Supplier/);
 const changed=csv.replace('INV-001','INV-003'),request=await f.request('buyer','POST',{csv:changed,sha256:await csvDigest(changed),byteLength:Buffer.byteLength(changed)});
 assert.equal((await handleInvoiceArchive(request,guarded('INSERT INTO invoice_files','run'))).status,409);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM invoice_files').first()).n,1);
});
test('simultaneous retries archive one copy and corrupted download fails closed',async t=>{
 const f=await fixture(t);const results=await Promise.all([f.call(),f.call()]);for(const r of results)await ok(r);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM invoice_files').first()).n,1);
 await f.db.prepare('UPDATE invoice_files SET csv=?').bind(csv.replace('20.00','21.00')).run();const response=await f.call('buyer','GET',{download:'1'});assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/21.00/);
});
test('invoice save rejects a changed row citing an archived fingerprint and accepts its exact source',async t=>{
 const f=await fixture(t);await ok(await f.call());
 const food=async command=>handleFood(new Request('https://fixture.test/api/food',{method:'POST',headers:f.headers('owner'),body:JSON.stringify({locationId:'a',requestId:crypto.randomUUID(),...command})}),f.db);
 const item={restaurantId:'fixture',name:'Fictional ingredient',controlNumber:'FIX',purchaseUnit:'case',packCount:1,unitQty:1,unitUOM:'lb',vendorSkus:[{id:'sku',vendor:'Fixture Supplier',vendorSku:'001',purchaseUnit:'case',packCount:1,unitQty:1,unitUOM:'lb',available:true}]};
 await ok(await food({action:'fooditem.import',input:{dataset:'demo',sourceRestaurantId:'fixture',sourceLabel:'Fictional fixture',destinationLocationId:'a',confirmed:true,rows:[item]}}));
 const record=await f.db.prepare('SELECT id,revision FROM food_records').first(),original=readInvoiceCsv(csv)[0];
 const body=async row=>({action:'fooditem.invoice',recordId:record.id,expectedRevision:record.revision,input:{...row,skuId:'sku',sourceNote:'Fictional test source',confirmed:true,fileSource:{kind:'csv',fileName:'Fictional.csv',byteLength:Buffer.byteLength(csv),sha256:await csvDigest(csv),row}}});
 assert.equal((await food(await body({...original,lineTotal:'21.00'}))).status,409);await ok(await food(await body(original)));assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM food_history WHERE json_extract(event,'$.invoiceLine') IS NOT NULL").first()).n,1);
});

const listRequest=(f,who='buyer',patch={})=>new Request('https://fixture.test/api/food/invoice-files?'+new URLSearchParams({locationId:'a',dataset:'demo',view:'list',...patch}),{headers:f.headers(who)});
const list=(f,who='buyer',patch={})=>handleInvoiceArchive(listRequest(f,who,patch),f.db);
const seed=async(f,n,{location='a',dataset='demo',name=`Fictional ${n}.csv`}={})=>f.db.prepare('INSERT INTO invoice_files VALUES(?,?,?,?,?,?,?,?,?)').bind(location,dataset,n.toString(16).padStart(64,'0'),name,100,1,'fixture','2026-01-01T12:00:00Z','owner').run();
test('archive browser returns scoped metadata, snapshot usage and empty pages without CSV or identities',async t=>{
 const f=await fixture(t);let page=await ok(await list(f));assert.deepEqual(page.files,[]);assert.deepEqual(page.totals,{files:0,bytes:0,matched:0});assert.equal(page.next,null);
 await ok(await f.call());await seed(f,2,{location:'b'});await seed(f,3,{dataset:'operating'});
 page=await ok(await list(f));assert.equal(page.files.length,1);assert.deepEqual(page.totals,{files:1,bytes:Buffer.byteLength(csv),matched:1});assert.equal(page.limits.bytes,invoiceArchiveMaxBytes);assert.equal(page.limits.files,10000);
 assert.deepEqual(Object.keys(page.files[0]).sort(),['byteLength','createdAt','fileName','rowCount','sha256']);assert.doesNotMatch(JSON.stringify(page),/Fixture Supplier|createdBy|sequence/);
 assert.match((await list(f)).headers.get('Cache-Control'),/no-store/);
});
test('stable archive pages have no overlaps or omissions when dates tie and new files arrive',async t=>{
 const f=await fixture(t);for(let n=1;n<=43;n++)await seed(f,n);
 const first=await ok(await list(f));assert.equal(first.files.length,20);assert.equal(first.totals.files,43);assert.ok(first.next);await seed(f,44);
 const seen=[...first.files];let next=first.next;
 while(next){const page=await ok(await list(f,'buyer',{after:next}));assert.equal(page.totals.files,43);seen.push(...page.files);next=page.next;}
 assert.equal(seen.length,43);assert.equal(new Set(seen.map(f=>f.sha256)).size,43);assert.deepEqual(seen.map(f=>parseInt(f.sha256,16)),Array.from({length:43},(_,i)=>43-i));
 const fresh=await ok(await list(f));assert.equal(fresh.totals.files,44);assert.equal(parseInt(fresh.files[0].sha256,16),44);
});
test('file search treats wildcard characters literally and continuation binds restaurant, dataset and search',async t=>{
 const f=await fixture(t);for(let n=1;n<=21;n++)await seed(f,n,{name:`Fictional 001_100% ${n}.csv`});await seed(f,22,{name:'Fictional 001X1000.csv'});
 const page=await ok(await list(f,'buyer',{q:'001_100%'}));assert.equal(page.totals.matched,21);assert.equal(page.totals.files,22);assert.ok(page.next);
 assert.equal((await ok(await list(f,'buyer',{q:'fictional'}))).totals.matched,22);
 for(const patch of [{q:'001_100%',after:'{'},{q:'001_100%',after:JSON.stringify({...JSON.parse(page.next),before:0})},{q:'001_100%',after:JSON.stringify({...JSON.parse(page.next),through:Infinity})},{q:'different',after:page.next},{dataset:'operating',q:'001_100%',after:page.next},{q:'x'.repeat(101)},{sha256:'a'.repeat(64)},{view:'unknown'}])assert.equal((await list(f,'buyer',patch)).status,400);
 assert.equal((await list(f,'foreign',{locationId:'b',q:'001_100%',after:page.next})).status,400);
 assert.equal((await ok(await list(f,'buyer',{q:'not found'}))).totals.matched,0);
});
test('archive browsing enforces role, all three restaurant scopes, datasets and cross-site reads',async t=>{
 const f=await fixture(t);await seed(f,1);await seed(f,2,{location:'b'});await seed(f,3,{location:'c'});await seed(f,4,{dataset:'operating'});
 for(const who of ['manager','worker','foreign','third'])assert.equal((await list(f,who)).status,403);
 for(const [who,locationId,n] of [['owner','a',1],['foreign','b',2],['third','c',3]])assert.equal(parseInt((await ok(await list(f,who,{locationId}))).files[0].sha256,16),n);
 assert.equal(parseInt((await ok(await list(f,'buyer',{dataset:'operating'}))).files[0].sha256,16),4);
 const r=listRequest(f);r.headers.set('Sec-Fetch-Site','cross-site');assert.equal((await handleInvoiceArchive(r,f.db)).status,403);
 for(const table of ['records','food_records','food_history'])assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n,0);
});
test('membership changes during list reads suppress even file names and usage totals',async t=>{
 const f=await fixture(t);await seed(f,1);
 const guarded={withSession(){return this},prepare:q=>f.db.prepare(q),async batch(s){const result=await f.db.batch(s);await f.db.prepare('UPDATE memberships SET revision=revision+1 WHERE id=?').bind('buyer').run();return result}};
 const response=await handleInvoiceArchive(listRequest(f),guarded);assert.equal(response.status,409);assert.doesNotMatch(await response.text(),/Fictional|totals/);
});
const {resumeInvoiceArchive}=await import('../.sites-runtime/shared/invoice-archive-resume.mjs');
const resumeMeta=async()=>({fileName:'Fictional café invoice.csv',byteLength:Buffer.byteLength(csv),sha256:await csvDigest(csv),rowCount:1,createdAt:'2026-01-01T12:00:00Z'});
test('reopening verified originals preserves BOM, CRLF, Unicode and leading zeroes',async()=>{
 const file=await resumeMeta(),selected=await resumeInvoiceArchive(new Response(new TextEncoder().encode(csv)),file);
 assert.equal(selected.csv,csv);assert.deepEqual(selected.archived,file);assert.equal(selected.file.sha256,file.sha256);assert.equal(readInvoiceCsv(selected.csv)[0].vendorSku,'001');
});
test('reopening rejects failed downloads, wrong size, hash, row count and invalid UTF-8',async()=>{
 const file=await resumeMeta();for(const patch of [{byteLength:1},{sha256:'b'.repeat(64)},{rowCount:2},{byteLength:300000}])await assert.rejects(()=>resumeInvoiceArchive(new Response(csv),{...file,...patch}));
 await assert.rejects(()=>resumeInvoiceArchive(new Response(csv,{status:403}),file));
 await assert.rejects(()=>resumeInvoiceArchive(new Response(csv.slice(1)),file));
 await assert.rejects(()=>resumeInvoiceArchive(new Response(Uint8Array.of(255)),{...file,byteLength:1}));
});
test('oversized archive responses cancel the stream before accumulating the entire payload',async()=>{
 const file=await resumeMeta();let cancelled=false;
 const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(file.byteLength+1))},cancel(){cancelled=true}});
 await assert.rejects(()=>resumeInvoiceArchive(new Response(stream),file),/expected size/);assert.equal(cancelled,true);
});
