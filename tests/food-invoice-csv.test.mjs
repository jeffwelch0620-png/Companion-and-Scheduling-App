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
test('CSV reads BOM, CRLF, quoted commas, escaped quotes and multiline fields while preserving supplier codes and record numbers',()=>{
 const rows=readInvoiceCsv('\uFEFF'+csvHeader+'\r\n\r\n"Demo, ""Supplier""\nNorth",001,INV-1,1,2026-09-28,2,supplier-pack,case,0.00\r\n');
 assert.equal(rows.length,1);assert.equal(rows[0].recordNumber,3);assert.equal(rows[0].vendor,'Demo, "Supplier"\nNorth');assert.equal(rows[0].vendorSku,'001');assert.equal(rows[0].lineTotal,'0.00');
 assert.equal(readInvoiceCsv(csvText)[0].quantity,'80');
});
test('CSV rejects malformed structure, unsupported headings, ambiguous numbers, invalid dates and duplicate source lines',()=>{
 for(const csv of ['',csvHeader,csvHeader+'\n',csvText.replace('vendor_sku','supplier_code'),csvText.replace('Demo supplier','"unfinished'),csvText.replace('Demo supplier','"x"bad'),csvText.replace('Demo supplier','x"bad'),csvText.replace(',80,',',1e2,'),csvText.replace(',80,',',-1,'),csvText.replace(',80,',',0,'),csvText.replace(',80,',',1000001,'),csvText.replace('200.00','1.001'),csvText.replace('200.00','$200'),csvText.replace('200.00','1000001'),csvText.replace('2026-09-28','2026-02-30'),csvText.replace('measure','mystery'),csvText.replace('Demo supplier,1','Demo supplier,'),csvText.replace('200.00','200.00,extra'),csvText+csvData.replace('Demo supplier',' demo SUPPLIER ')])assert.throws(()=>readInvoiceCsv(csv),csv);
});
test('CSV bounds byte size, rows and blank records before any storage or catalog mutation',()=>{
 const lines=n=>csvHeader+'\n'+Array.from({length:n},(_,i)=>csvData.replace('DEMO-100','INV-'+i)).join('\n');
 assert.equal(readInvoiceCsv(lines(250)).length,250);assert.throws(()=>readInvoiceCsv(lines(251)));
 assert.throws(()=>readInvoiceCsv('x'.repeat(invoiceCsvMaxBytes+1)));assert.throws(()=>readInvoiceCsv(csvText+'\n'.repeat(513)));
});
test('CSV selection requires explicit supplier/SKU match and exact reviewed source values; malformed provenance is rejected',()=>{
 const item=parseFoodItem(rawItem,source),sku=item.vendorSkus[0],input={...invoiceInput,fileSource:fileSource()};
 const parsed=parseInvoiceLine(input,item,at,'buyer','America/New_York');assert.deepEqual(parsed.fileSource,input.fileSource);assert.notEqual(parsed.fileSource,input.fileSource);
 assert.equal(csvMatchesSupplier({...input.fileSource.row,vendor:' DEMO  supplier ',vendorSku:' 1 '},sku),true);assert.equal(csvMatchesSupplier({...input.fileSource.row,vendorSku:'01'},sku),false);
 for(const patch of [{skuId:'missing'},{invoiceNumber:'OTHER'},{lineReference:'2'},{invoiceDate:'2026-09-27'},{quantity:81},{unitBasis:'supplier-pack'},{invoiceUnit:'oz'},{lineTotal:201}])assert.throws(()=>parseInvoiceLine({...input,...patch},item,at,'buyer','America/New_York'));
 for(const patch of [{kind:'pdf'},{fileName:'../file.csv'},{fileName:'file.pdf'},{fileName:'bad\n.csv'},{byteLength:0},{byteLength:invoiceCsvMaxBytes+1},{sha256:'bad'},{row:{...input.fileSource.row,recordNumber:1}},{row:{...input.fileSource.row,recordNumber:513}},{row:{...input.fileSource.row,vendorSku:'other'}},{row:{...input.fileSource.row,vendor:'other'}},{row:{...input.fileSource.row,lineTotal:200}}])assert.throws(()=>parseInvoiceLine({...input,fileSource:{...input.fileSource,...patch}},item,at,'buyer','America/New_York'));
 assert.throws(()=>parseInvoiceLine({...input,fileSource:null},item,at,'buyer','America/New_York'));
 assert.equal(parseInvoiceLine(invoiceInput,item,at,'buyer','America/New_York').fileSource,undefined);
});
test('reviewed CSV capture retains selected row and file identity through save, retry and void without changing stock or catalog prices',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),before=ok(await f.view('owner')).records[0],requestId=crypto.randomUUID(),input={...invoiceInput,fileSource:fileSource()};
 const saved=ok(await f.call('buyer','fooditem.invoice',input,base,{requestId}));assert.deepEqual(ok(await f.call('buyer','fooditem.invoice',input,base,{requestId})),saved);
 assert.equal((await f.call('buyer','fooditem.invoice',input,saved)).status,409);
 assert.equal((await f.call('buyer','fooditem.invoice',{...input,fileSource:{...input.fileSource,sha256:'b'.repeat(64)}},base,{requestId})).status,409);
 const after=ok(await f.view('owner')).records[0];assert.deepEqual(after.data.count,before.data.count);assert.deepEqual(after.data.vendorSkus,before.data.vendorSkus);
 let entries=ok(await f.get('buyer',{view:'history',recordId:base.recordId})).entries;assert.deepEqual(entries.at(-1).event.invoiceLine.fileSource,input.fileSource);assert.equal(entries.at(-1).event.invoiceLine.by,'buyer');
 ok(await f.call('buyer','fooditem.invoice-void',{invoiceRevision:saved.revision,reason:'Correct source line'},saved));entries=ok(await f.get('buyer',{view:'history',recordId:base.recordId})).entries;assert.deepEqual(entries.find(e=>e.revision===saved.revision).event.invoiceLine.fileSource,input.fileSource);
});
test('CSV provenance cannot bypass purchaser, item, restaurant, revision or source confirmation checks',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),input={...invoiceInput,fileSource:fileSource()};
 for(const actor of ['manager','foh','worker','foreign'])assert.equal((await f.call(actor,'fooditem.invoice',input,base)).status,403);
 for(const patch of [{confirmed:false},{sourceNote:''},{fileSource:{...fileSource(),row:{...fileSource().row,vendorSku:'other'}}},{quantity:79}])assert.equal((await f.call('buyer','fooditem.invoice',{...input,...patch},base)).status,400);
 const other=ok(await f.call('owner','fooditem.import',importInput([{...rawItem,controlNumber:'OTHER',vendorSkus:[{...rawItem.vendorSkus[0],vendorSku:'OTHER'}]}])));assert.equal((await f.call('buyer','fooditem.invoice',input,other)).status,400);
 const saved=ok(await f.call('buyer','fooditem.invoice',input,base));assert.equal((await f.call('buyer','fooditem.invoice',{...input,invoiceNumber:'OTHER'},base)).status,409);
 assert.equal(ok(await f.get('buyer',{dataset:'operating'})).total,0);assert.equal((await f.get('foreign',{view:'history',recordId:base.recordId,locationId:'b'})).status,404);
 assert.equal(saved.revision,2);
});
test('CSV source write failure rolls back row, history, audit and retry receipt together',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),before=ok(await f.view('owner')),requestId=crypto.randomUUID(),input={...invoiceInput,fileSource:fileSource()};
 await f.db.prepare("CREATE TRIGGER fail_csv BEFORE INSERT ON food_history WHEN json_type(NEW.event,'$.invoiceLine.fileSource')='object' BEGIN SELECT RAISE(ABORT,'test failure'); END").run();
 assert.equal((await f.call('buyer','fooditem.invoice',input,base,{requestId})).status,503);assert.deepEqual(ok(await f.view('owner')),before);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM food_receipts WHERE request_id=?').bind(requestId).first()).n,0);
 await f.db.prepare('DROP TRIGGER fail_csv').run();ok(await f.call('buyer','fooditem.invoice',input,base,{requestId}));
 const entries=ok(await f.get('owner',{view:'history',recordId:base.recordId})).entries;assert.equal(entries.filter(e=>e.event.invoiceLine).length,1);
});


