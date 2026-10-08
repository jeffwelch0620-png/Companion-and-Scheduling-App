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

test('delivery queue separates pending quantities, rejected goods and voids without summing different units',async t=>{
 const f=await fixture(t);assert.deepEqual(ok(await f.get('owner',{view:'receiving'})).totals,{active:0,pending:0,rejected:0,voided:0,excess:0,unreplaced:0,replacements:0});
 const base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),first=ok(await f.call('buyer','fooditem.invoice',invoiceInput,base));
 const partial=ok(await f.call('manager','fooditem.receive',receivingInput(first.revision),first));
 const second=ok(await f.call('buyer','fooditem.invoice',{...invoiceInput,invoiceNumber:'PACK-INVOICE',quantity:2,unitBasis:'supplier-pack',invoiceUnit:'case'},partial));
 const complete=ok(await f.call('manager','fooditem.receive',{...receivingInput(second.revision),accepted:2,rejected:0,rejectionReason:''},second));
 const third=ok(await f.call('buyer','fooditem.invoice',{...invoiceInput,invoiceNumber:'VOID-INVOICE'},complete));
 ok(await f.call('buyer','fooditem.invoice-void',{invoiceRevision:third.revision,reason:'Wrong source'},third));
 const pending=ok(await f.get('manager',{view:'receiving'}));assert.deepEqual(pending.totals,{active:2,pending:1,rejected:1,voided:1,excess:0,unreplaced:1,replacements:0});assert.equal(pending.total,1);assert.equal(pending.entries[0].remaining,40);assert.equal(pending.entries[0].invoice.invoiceUnit,'lb');
 const rejected=ok(await f.get('buyer',{view:'receiving',filter:'rejected'}));assert.equal(rejected.entries[0].invoiceRevision,first.revision);
 const all=ok(await f.get('owner',{view:'receiving',filter:'all'}));assert.equal(all.total,3);assert.equal(all.entries[0].voided,true);assert.equal(all.entries[1].remaining,0);assert.equal(all.entries[1].invoice.invoiceUnit,'case');
 assert.equal('totalQuantity'in all.totals,false);assert.equal('totalQuantity'in all,false);
});

test('delivery queue finds exact identifiers, supports current catalog names and retains original invoice packs',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),invoice=ok(await f.call('buyer','fooditem.invoice',{...invoiceInput,invoiceNumber:"Special's % invoice"},base));
 ok(await f.call('buyer','fooditem.configure',{item:{...rawItem,name:'Corrected Beef',vendorSkus:rawItem.vendorSkus.map(s=>({...s,packCount:4,vendor:'New Supplier'}))},reason:'New catalog definition'},invoice));
 for(const q of ['corrected beef','BEEF','demo supplier',"Special's % invoice"]){const queue=ok(await f.get('manager',{view:'receiving',q}));assert.equal(queue.total,1);assert.equal(queue.entries[0].currentTitle,'Corrected Beef');assert.equal(queue.entries[0].invoice.sku.packCount,8);}
 for(const q of ['_does_not_match_',"' OR 1=1 --",'New Supplier'])assert.equal(ok(await f.get('owner',{view:'receiving',q})).total,0);
});

test('delivery queue keyset pages have no duplicates, carry full totals and reject a changed snapshot',async t=>{
 const f=await fixture(t);let current=ok(await f.call('owner','fooditem.import',importInput([rawItem])));const invoices=[];
 for(let n=0;n<27;n++){current=ok(await f.call('buyer','fooditem.invoice',{...invoiceInput,lineReference:String(n)},current));invoices.push(current)}
 const first=ok(await f.get('owner',{view:'receiving'}));assert.equal(first.total,27);assert.equal(first.entries.length,20);assert.ok(first.next);
 const last=ok(await f.get('owner',{view:'receiving',before:String(first.next),revision:String(first.revision)}));assert.equal(last.entries.length,7);assert.equal(last.total,27);assert.equal(last.next,null);assert.equal(new Set([...first.entries,...last.entries].map(e=>e.sequence)).size,27);
 assert.equal((await f.get('owner',{view:'receiving',before:String(first.next)})).status,409);
 current=ok(await f.call('manager','fooditem.receive',receivingInput(invoices[0].revision),current));
 assert.equal((await f.get('owner',{view:'receiving',before:String(first.next),revision:String(first.revision)})).status,409);
 const check=ok(await f.get('owner',{view:'receiving',q:'demo-100',filter:'rejected'}));assert.equal(check.total,1);assert.equal(check.entries[0].remaining,40);
 ok(await f.call('manager','fooditem.receive-void',{receivingRevision:current.revision,reason:'Wrong delivery quantity'},current));
 const fresh=ok(await f.get('owner',{view:'receiving',filter:'all'}));assert.deepEqual(fresh.totals,{active:27,pending:27,rejected:0,voided:0,excess:0,unreplaced:0,replacements:0});
});

test('delivery queue and focused item/history stay in the selected restaurant and dataset with current permissions',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),invoice=ok(await f.call('buyer','fooditem.invoice',invoiceInput,base));
 const other=ok(await f.call('owner','fooditem.import',importInput([{...rawItem,controlNumber:'ANOTHER'}])));
 const queue=ok(await f.get('manager',{view:'receiving'})),entry=queue.entries[0];assert.equal(entry.recordId,base.recordId);assert.equal(entry.invoiceRevision,invoice.revision);
 const focused=ok(await f.get('manager',{itemId:entry.recordId}));assert.equal(focused.total,1);assert.equal(focused.records.length,1);assert.equal(focused.records[0].id,base.recordId);assert.notEqual(focused.records[0].id,other.recordId);
 const history=ok(await f.get('manager',{view:'history',recordId:entry.recordId,after:String(entry.sequence-1)}));assert.equal(history.entries[0].revision,invoice.revision);
 assert.equal(ok(await f.get('manager',{view:'receiving',dataset:'operating'})).total,0);assert.equal((await f.get('manager',{itemId:entry.recordId,dataset:'operating'})).status,404);
 for(const actor of ['foh','worker','foreign']){assert.equal((await f.get(actor,{view:'receiving'})).status,403);assert.equal((await f.get(actor,{itemId:entry.recordId})).status,403)}
 for(const params of [{filter:'unknown'},{before:'NaN'},{before:'-1'},{before:'1.5'},{q:'x'.repeat(101)}])assert.equal((await f.get('owner',{view:'receiving',...params})).status,400);
 await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='manager'").run();assert.equal((await f.get('manager',{view:'receiving'})).status,403);
});

test('delivery queue remains bounded across a large retained history and cannot expand the daily response',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),invoice=ok(await f.call('buyer','fooditem.invoice',invoiceInput,base));
 const daily=async()=>{const r=await handleWorkspace(new Request('https://test.example/api/workspace?locationId=a',{headers:f.headers('owner')}),f.db);assert.equal(r.status,200);return r.text()};const before=await daily();
 await f.db.prepare(`WITH RECURSIVE n(x) AS (VALUES(3) UNION ALL SELECT x+1 FROM n WHERE x<1002) INSERT INTO food_history(location_id,record_id,revision,actor_id,at,event)
 SELECT location_id,record_id,x,actor_id,at,json_set(event,'$.invoiceLine.lineReference',CAST(x AS TEXT)) FROM n CROSS JOIN food_history WHERE record_id=? AND revision=?`).bind(base.recordId,invoice.revision).run();
 const queue=ok(await f.get('owner',{view:'receiving'}));assert.equal(queue.total,1001);assert.equal(queue.entries.length,20);assert.ok(queue.next);assert.ok(Buffer.byteLength(JSON.stringify(queue))<45000);assert.equal(await daily(),before);
 t.diagnostic(JSON.stringify({invoiceLines:queue.total,pageEntries:queue.entries.length,pageBytes:Buffer.byteLength(JSON.stringify(queue))}));
});

test('receiving validates actual quantities and dates and snapshots the original invoice units',()=>{
 const invoice=parseInvoiceLine(invoiceInput,parseFoodItem(rawItem,source),'2026-09-28T12:00:00Z','buyer','America/New_York'),used={entries:0,accepted:0,rejected:0};
 const entry=parseReceiving({...receivingInput(2),by:'forged',invoice:{},acceptedSupplierPacks:99},invoice,used,'2026-09-28T12:00:00Z','manager','America/New_York');
 assert.equal(entry.acceptedSupplierPacks,.75);assert.equal(entry.rejectedSupplierPacks,.25);assert.equal(entry.by,'manager');assert.equal(entry.invoice.invoiceUnit,'lb');
 invoice.sku.packCount=99;assert.equal(entry.invoice.sku.packCount,8);
 for(const patch of [{invoiceRevision:0},{deliveryReference:''},{accepted:''},{accepted:false},{accepted:-1},{accepted:NaN},{rejected:''},{rejected:1000001},{accepted:0,rejected:0},{rejectionReason:''},{confirmed:false},{receivedDate:'2026-09-29'},{receivedDate:'2026-02-30'}])assert.throws(()=>parseReceiving({...receivingInput(2),...patch},invoice,used,'2026-09-28T12:00:00Z','manager','America/New_York'));
 assert.equal(parseReceiving({...receivingInput(2),rejected:0,rejectionReason:''},invoice,used,'2026-09-28T12:00:00Z','manager','America/New_York').rejected,0);
 const packs=parseInvoiceLine({...invoiceInput,quantity:2,unitBasis:'supplier-pack',invoiceUnit:'case'},parseFoodItem(rawItem,source),'2026-09-28T12:00:00Z','buyer','America/New_York');
 assert.equal(parseReceiving({...receivingInput(2),accepted:1,rejected:0,rejectionReason:''},packs,used,'2026-09-28T12:00:00Z','manager','America/New_York').acceptedSupplierPacks,1);
});

test('receiving persists original packs after catalog changes without changing stock, cost or credits',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),counted=ok(await f.call('manager','fooditem.count',{quantity:3,note:'Physical count',confirmed:true},base));
 const invoice=ok(await f.call('buyer','fooditem.invoice',invoiceInput,counted)),changed=ok(await f.call('buyer','fooditem.configure',{item:{...rawItem,vendorSkus:rawItem.vendorSkus.map(s=>({...s,packCount:4,price:150}))},reason:'New catalog pack'},invoice));
 const before=ok(await f.view('owner')).records[0],input={...receivingInput(invoice.revision),acceptedSupplierPacks:999,invoice:{}},requestId=crypto.randomUUID();
 const saved=ok(await f.call('manager','fooditem.receive',input,changed,{requestId}));assert.deepEqual(ok(await f.call('manager','fooditem.receive',input,changed,{requestId})),saved);
 const after=ok(await f.view('owner')).records[0];assert.deepEqual(after.data,before.data);
 const entries=ok(await f.get('buyer',{view:'history',recordId:base.recordId})).entries,receipt=entries.at(-1).event.receiving,original=entries.find(e=>e.revision===invoice.revision);
 assert.equal(receipt.invoice.sku.packCount,8);assert.equal(receipt.acceptedSupplierPacks,.75);assert.equal(receipt.by,'manager');assert.deepEqual(original.invoiceReceiving,{entries:1,accepted:30,rejected:10});assert.equal(original.invoiceCredits.entries,0);
 assert.equal((await f.call('buyer','fooditem.invoice-void',{invoiceRevision:invoice.revision,reason:'Wrong invoice'},saved)).status,409);
});

test('partial deliveries enforce the remaining invoice quantity and duplicate references across exact retries',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),invoice=ok(await f.call('buyer','fooditem.invoice',invoiceInput,base));
 const first=ok(await f.call('manager','fooditem.receive',receivingInput(invoice.revision),invoice));
 assert.equal((await f.call('manager','fooditem.receive',{...receivingInput(invoice.revision),deliveryReference:' demo-ticket-1 ',accepted:1,rejected:0},first)).status,409);
 assert.equal((await f.call('manager','fooditem.receive',{...receivingInput(invoice.revision),deliveryReference:'SECOND',accepted:41,rejected:0},first)).status,409);
 const second=ok(await f.call('manager','fooditem.receive',{...receivingInput(invoice.revision),deliveryReference:'SECOND',accepted:40,rejected:0},first));
 assert.equal((await f.call('manager','fooditem.receive',{...receivingInput(invoice.revision),deliveryReference:'THIRD',accepted:1,rejected:0},second)).status,409);
 const original=ok(await f.get('owner',{view:'history',recordId:base.recordId})).entries.find(e=>e.revision===invoice.revision);assert.deepEqual(original.invoiceReceiving,{entries:2,accepted:70,rejected:10});
});

test('receiving corrections preserve originals, resolve off-page voids and reopen invoice balance',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),invoice=ok(await f.call('buyer','fooditem.invoice',invoiceInput,base)),first=ok(await f.call('manager','fooditem.receive',receivingInput(invoice.revision),invoice));
 let current=first;
 for(let n=0;n<21;n++)current=ok(await f.call('manager','fooditem.count',{quantity:n,note:'Unrelated physical count',confirmed:true},current));
 current=ok(await f.call('manager','fooditem.receive-void',{receivingRevision:first.revision,reason:'Wrong receiving tally'},current));
 const page=ok(await f.get('owner',{view:'history',recordId:base.recordId}));assert.equal(page.entries.length,20);assert.ok(page.next);assert.equal(page.entries.find(e=>e.revision===first.revision).receivingVoided.reason,'Wrong receiving tally');assert.deepEqual(page.entries.find(e=>e.revision===invoice.revision).invoiceReceiving,{entries:0,accepted:0,rejected:0});
 assert.equal((await f.call('owner','fooditem.receive-void',{receivingRevision:first.revision,reason:'Again'},current)).status,409);
 current=ok(await f.call('manager','fooditem.receive',{...receivingInput(invoice.revision),accepted:80,rejected:0},current));
 const check=ok(await f.get('owner',{view:'history',recordId:base.recordId}));assert.deepEqual(check.entries.find(e=>e.revision===invoice.revision).invoiceReceiving,{entries:1,accepted:80,rejected:0});
 current=ok(await f.call('buyer','fooditem.receive-void',{receivingRevision:current.revision,reason:'Wrong source invoice'},current));
 current=ok(await f.call('buyer','fooditem.invoice-void',{invoiceRevision:invoice.revision,reason:'Incorrect source invoice'},current));
 assert.equal((await f.call('manager','fooditem.receive',receivingInput(invoice.revision),current)).status,409);
});

test('receiving is restaurant-scoped, rejects false source references and restricts correction authority',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),invoice=ok(await f.call('buyer','fooditem.invoice',invoiceInput,base));
 for(const actor of ['foh','worker','foreign'])assert.equal((await f.call(actor,'fooditem.receive',receivingInput(invoice.revision),invoice)).status,403);
 assert.equal((await f.call('manager','fooditem.receive',receivingInput(base.revision),invoice)).status,404);
 const other=ok(await f.call('owner','fooditem.import',importInput([{...rawItem,controlNumber:'OTHER'}])));assert.equal((await f.call('manager','fooditem.receive',receivingInput(invoice.revision),other)).status,404);
 const received=ok(await f.call('buyer','fooditem.receive',receivingInput(invoice.revision),invoice));
 assert.equal((await f.call('manager','fooditem.receive-void',{receivingRevision:received.revision,reason:'Not my receipt'},received)).status,403);
 assert.equal((await f.get('owner',{view:'history',recordId:base.recordId,dataset:'operating'})).status,404);
 await f.db.prepare("UPDATE memberships SET position='Dishwasher' WHERE id='manager'").run();assert.equal((await f.call('manager','fooditem.receive',{...receivingInput(invoice.revision),deliveryReference:'SECOND'},received)).status,403);
 await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='buyer'").run();assert.equal((await f.call('buyer','fooditem.receive-void',{receivingRevision:received.revision,reason:'Revoked'},received)).status,403);
 ok(await f.call('owner','fooditem.receive-void',{receivingRevision:received.revision,reason:'Checked original'},received));
});

test('concurrent receiving and failed writes are atomic; retry cannot duplicate a delivery',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),invoice=ok(await f.call('buyer','fooditem.invoice',invoiceInput,base));
 const requestId=crypto.randomUUID(),input=receivingInput(invoice.revision);
 await f.db.prepare("CREATE TRIGGER reject_delivery_test BEFORE INSERT ON food_history WHEN json_extract(NEW.event,'$.receiving') IS NOT NULL BEGIN SELECT RAISE(ABORT,'test failure'); END").run();
 assert.equal((await f.call('manager','fooditem.receive',input,invoice,{requestId})).status,503);
 assert.equal(ok(await f.view('owner')).records[0].revision,invoice.revision);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM food_receipts').first()).n,2);
 await f.db.prepare('DROP TRIGGER reject_delivery_test').run();
 const saved=ok(await f.call('manager','fooditem.receive',input,invoice,{requestId}));assert.deepEqual(ok(await f.call('manager','fooditem.receive',input,invoice,{requestId})),saved);
 assert.equal((await f.call('manager','fooditem.receive',{...input,accepted:1},invoice,{requestId})).status,409);
 const responses=await Promise.all([f.call('manager','fooditem.receive',{...input,deliveryReference:'SECOND'},saved),f.call('buyer','fooditem.receive',{...input,deliveryReference:'THIRD'},saved)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
 assert.deepEqual(ok(await f.get('owner',{view:'history',recordId:base.recordId})).entries.find(e=>e.revision===invoice.revision).invoiceReceiving,{entries:2,accepted:60,rejected:20});
});

test('supplier credit validation uses original units and a deep invoice snapshot, never client amounts or current packs',()=>{
 const item=parseFoodItem(rawItem,source),line=parseInvoiceLine(invoiceInput,item,'2026-09-28T12:00:00Z','buyer','America/New_York'),empty={entries:0,amountCents:0,quantity:0};
 const credit=parseCredit({...creditInput(2),amountCents:1,supplierPackQuantity:99,invoice:{},by:'forged'},line,empty,'2026-09-28T12:00:00Z','buyer','America/New_York');
 assert.equal(credit.amountCents,5000);assert.equal(credit.supplierPackQuantity,.5);assert.equal(credit.invoice.invoiceUnit,'lb');assert.equal(credit.by,'buyer');line.sku.packCount=99;assert.equal(credit.invoice.sku.packCount,8);
 for(const input of [{amount:'-1'},{amount:0},{amount:'1.001'},{amount:1000001},{quantity:''},{quantity:-1},{quantity:NaN},{invoiceRevision:0},{confirmed:false},{creditNumber:''},{sourceNote:''},{reason:'unknown'},{creditDate:'2026-09-27'},{creditDate:'2026-09-29'},{creditDate:'2026-02-30'},{reason:'price',quantity:1}])assert.throws(()=>parseCredit({...creditInput(2),...input},line,empty,'2026-09-28T12:00:00Z','buyer','America/New_York'));
 const price=parseCredit({...creditInput(2),reason:'price',quantity:'',amount:'1.00'},line,empty,'2026-09-28T12:00:00Z','buyer','America/New_York');assert.equal(price.quantity,0);assert.equal(price.supplierPackQuantity,0);
});

test('issued supplier credit persists with remaining amount, original units and unchanged physical stock and prices',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),counted=ok(await f.call('manager','fooditem.count',{quantity:3,note:'Physical stock',confirmed:true},base));
 const saved=ok(await f.call('buyer','fooditem.invoice',invoiceInput,counted)),before=ok(await f.view('owner')).records[0];
 const changed=ok(await f.call('buyer','fooditem.configure',{item:{...rawItem,vendorSkus:rawItem.vendorSkus.map(s=>({...s,packCount:4,price:150}))},reason:'New supplier pack'},saved));
 const input={...creditInput(saved.revision),amountCents:1,supplierPackQuantity:999},requestId=crypto.randomUUID();
 const credit=ok(await f.call('buyer','fooditem.credit',input,changed,{requestId}));assert.deepEqual(ok(await f.call('buyer','fooditem.credit',input,changed,{requestId})),credit);
 const item=ok(await f.view('owner')).records[0];assert.deepEqual(item.data.count,before.data.count);assert.equal(item.data.vendorSkus[0].price,150);
 const entries=ok(await f.get('manager',{view:'history',recordId:base.recordId})).entries,original=entries.find(e=>e.revision===saved.revision),event=entries.at(-1).event.invoiceCredit;
 assert.deepEqual(original.invoiceCredits,{entries:1,amountCents:5000,quantity:20});assert.equal(event.invoice.sku.packCount,8);assert.equal(event.invoice.lineTotalCents,20000);assert.equal(event.supplierPackQuantity,.5);
 assert.equal((await f.call('buyer','fooditem.invoice-apply',priceInput(saved.revision),credit)).status,409);
 assert.equal((await f.call('buyer','fooditem.invoice-void',{invoiceRevision:saved.revision,reason:'Incorrect entry'},credit)).status,409);
});

test('supplier credits enforce remaining money and quantity independently across partial and price adjustments',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),saved=ok(await f.call('buyer','fooditem.invoice',invoiceInput,base));
 const first=ok(await f.call('buyer','fooditem.credit',creditInput(saved.revision),saved));
 assert.equal((await f.call('buyer','fooditem.credit',{...creditInput(saved.revision),creditNumber:'CREDIT-2',amount:'150.01',quantity:1},first)).status,409);
 assert.equal((await f.call('buyer','fooditem.credit',{...creditInput(saved.revision),creditNumber:'CREDIT-2',amount:'1.00',quantity:61},first)).status,409);
 const second=ok(await f.call('buyer','fooditem.credit',{...creditInput(saved.revision),creditNumber:'CREDIT-2',amount:'100.00',quantity:60,reason:'shortage'},first));
 const third=ok(await f.call('buyer','fooditem.credit',{...creditInput(saved.revision),creditNumber:'CREDIT-3',amount:'50.00',quantity:'',reason:'price'},second));
 const original=ok(await f.get('buyer',{view:'history',recordId:base.recordId})).entries.find(e=>e.revision===saved.revision);assert.deepEqual(original.invoiceCredits,{entries:3,amountCents:20000,quantity:80});
 assert.equal((await f.call('buyer','fooditem.credit',{...creditInput(saved.revision),creditNumber:'CREDIT-4',amount:'.01',quantity:'',reason:'price'},third)).status,400);
 assert.equal((await f.call('buyer','fooditem.credit',{...creditInput(saved.revision),creditNumber:'CREDIT-4',amount:'0.01',quantity:'',reason:'price'},third)).status,409);
});

test('credit access, original-source scope, duplicates and stale revisions cannot bypass invoice reconciliation',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),saved=ok(await f.call('buyer','fooditem.invoice',invoiceInput,base));
 for(const actor of ['manager','foh','worker','foreign'])assert.equal((await f.call(actor,'fooditem.credit',creditInput(saved.revision),saved)).status,403);
 for(const rev of [1,999])assert.equal((await f.call('buyer','fooditem.credit',creditInput(rev),saved)).status,404);
 assert.equal((await f.call('buyer','fooditem.credit',creditInput(saved.revision),base)).status,409);
 const credit=ok(await f.call('buyer','fooditem.credit',creditInput(saved.revision),saved));
 const other=ok(await f.call('owner','fooditem.import',importInput([{...rawItem,controlNumber:'SECOND'}]))),otherInvoice=ok(await f.call('buyer','fooditem.invoice',{...invoiceInput,lineReference:'2'},other));
 assert.equal((await f.call('buyer','fooditem.credit',{...creditInput(otherInvoice.revision),creditNumber:' credit-1 ',lineReference:' 1 '},otherInvoice)).status,409);
 const operating=ok(await f.call('owner','fooditem.import',{...importInput([{...rawItem,name:'Beef',restaurantId:'actual'}]),dataset:'operating',sourceRestaurantId:'actual'})),operatingInvoice=ok(await f.call('buyer','fooditem.invoice',invoiceInput,operating));
 ok(await f.call('buyer','fooditem.credit',creditInput(operatingInvoice.revision),operatingInvoice));
 assert.equal((await f.get('owner',{view:'history',recordId:base.recordId,dataset:'operating'})).status,404);
 const voided=ok(await f.call('buyer','fooditem.invoice-void',{invoiceRevision:otherInvoice.revision,reason:'Wrong line'},otherInvoice));
 assert.equal((await f.call('buyer','fooditem.credit',{...creditInput(otherInvoice.revision),creditNumber:'NEW'},voided)).status,409);
 for(const actor of ['manager','foh','worker','foreign'])assert.equal((await f.call(actor,'fooditem.credit-void',{creditRevision:credit.revision,reason:'Wrong'},credit)).status,403);
 await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='buyer'").run();assert.equal((await f.get('buyer',{view:'history',recordId:base.recordId})).status,403);
});

test('credit corrections retain originals across history pages, release amounts and duplicate keys, and gate invoice voids',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),saved=ok(await f.call('buyer','fooditem.invoice',invoiceInput,base));
 let latest=saved;const credits=[];
 for(let n=0;n<22;n++){latest=ok(await f.call('buyer','fooditem.credit',{...creditInput(saved.revision),creditNumber:'C-'+n,reason:'price',quantity:'',amount:'1.00'},latest));credits.push(latest)}
 const h=ok(await f.get('buyer',{view:'history',recordId:base.recordId}));assert.equal(h.entries.length,20);assert.ok(h.next);assert.equal(h.entries[1].invoiceCredits.amountCents,2200);
 assert.equal((await f.call('buyer','fooditem.credit-void',{creditRevision:credits[0].revision,reason:''},latest)).status,400);
 assert.equal((await f.call('buyer','fooditem.credit-void',{creditRevision:saved.revision,reason:'Wrong kind'},latest)).status,404);
 const input={creditRevision:credits[0].revision,reason:'Wrong amount'},requestId=crypto.randomUUID();latest=ok(await f.call('buyer','fooditem.credit-void',input,latest,{requestId}));
 assert.equal((await f.call('buyer','fooditem.credit-void',input,latest)).status,409);
 const again=ok(await f.get('buyer',{view:'history',recordId:base.recordId}));assert.equal(again.entries[1].invoiceCredits.amountCents,2100);assert.equal(again.entries.find(e=>e.revision===credits[0].revision).creditVoided.reason,'Wrong amount');
 const corrected=ok(await f.call('buyer','fooditem.credit',{...creditInput(saved.revision),creditNumber:'C-0',reason:'price',quantity:'',amount:'2.00'},latest));
 assert.equal(ok(await f.get('buyer',{view:'history',recordId:base.recordId})).entries[1].invoiceCredits.amountCents,2300);
 assert.equal((await f.call('buyer','fooditem.invoice-void',{invoiceRevision:saved.revision,reason:'Incorrect original'},corrected)).status,409);
});

test('credit saves and voids are atomic, exact retries are safe and concurrent credits cannot over-credit',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),saved=ok(await f.call('buyer','fooditem.invoice',invoiceInput,base));
 const input=creditInput(saved.revision),requestId=crypto.randomUUID();
 await f.db.prepare("CREATE TRIGGER reject_credit BEFORE INSERT ON food_history WHEN json_type(NEW.event,'$.invoiceCredit')='object' BEGIN SELECT RAISE(ABORT,'test'); END").run();
 assert.equal((await f.call('buyer','fooditem.credit',input,saved,{requestId})).status,503);
 assert.equal(ok(await f.get('owner',{view:'history',recordId:base.recordId})).entries[1].invoiceCredits.entries,0);assert.equal(ok(await f.view('owner')).records[0].revision,saved.revision);
 await f.db.prepare('DROP TRIGGER reject_credit').run();const first=ok(await f.call('buyer','fooditem.credit',input,saved,{requestId}));assert.deepEqual(ok(await f.call('buyer','fooditem.credit',input,saved,{requestId})),first);
 assert.equal((await f.call('buyer','fooditem.credit',{...input,amount:'60.00'},saved,{requestId})).status,409);
 const results=await Promise.all(['A','B'].map(creditNumber=>f.call('buyer','fooditem.credit',{...input,creditNumber,reason:'price',quantity:'',amount:'150.00'},first)));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const current=ok(await f.view('owner')).records[0],voidInput={creditRevision:first.revision,reason:'Incorrect amount'},voidId=crypto.randomUUID();
 await f.db.prepare("CREATE TRIGGER reject_credit_void BEFORE INSERT ON food_history WHEN json_type(NEW.event,'$.creditVoid')='object' BEGIN SELECT RAISE(ABORT,'test'); END").run();
 assert.equal((await f.call('buyer','fooditem.credit-void',voidInput,current,{requestId:voidId})).status,503);
 assert.equal(ok(await f.get('owner',{view:'history',recordId:base.recordId})).entries[1].invoiceCredits.amountCents,20000);
 await f.db.prepare('DROP TRIGGER reject_credit_void').run();const voided=ok(await f.call('buyer','fooditem.credit-void',voidInput,current,{requestId:voidId}));assert.deepEqual(ok(await f.call('buyer','fooditem.credit-void',voidInput,current,{requestId:voidId})),voided);
 assert.equal(ok(await f.get('owner',{view:'history',recordId:base.recordId})).entries[1].invoiceCredits.amountCents,15000);
});

test('reviewed invoice price updates dated supplier and recipe costs, retains evidence/count and retries exactly once',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem])));
 ok(await f.call('owner','foodrecipe.import',importInput([rawRecipe])));
 const counted=ok(await f.call('manager','fooditem.count',{quantity:3,note:'Physical stock',confirmed:true},base));
 const before=ok(await f.view('owner')).records[0],saved=ok(await f.call('buyer','fooditem.invoice',invoiceInput,counted));
 const input={...priceInput(saved.revision),price:1,priceDate:'2000-01-01',by:'owner'},requestId=crypto.randomUUID();
 const applied=ok(await f.call('buyer','fooditem.invoice-apply',input,saved,{requestId}));
 assert.deepEqual(ok(await f.call('buyer','fooditem.invoice-apply',input,saved,{requestId})),applied);
 assert.equal((await f.call('buyer','fooditem.invoice-apply',input,applied)).status,409);
 const after=ok(await f.view('owner')).records[0];assert.equal(after.data.vendorSkus[0].price,100);assert.equal(after.data.vendorSkus[0].priceUpdatedAt,'2026-09-28');assert.deepEqual(after.data.vendorSkus[0].priceSource,{invoiceRevision:saved.revision,appliedRevision:applied.revision});assert.deepEqual(after.data.count,before.data.count);
 const recipes=ok(await f.get('owner',{kind:'foodrecipe'}));assert.equal(recipes.costs[recipes.records[0].id].total,100/(640/6));
 const entries=ok(await f.get('manager',{view:'history',recordId:base.recordId})).entries,original=entries.find(e=>e.revision===saved.revision);
 assert.equal(original.event.invoiceLine.sku.price,92.5);assert.equal(original.invoicePriceApplied.by,'buyer');assert.equal(original.invoicePriceApplied.price,100);assert.equal(entries.at(-1).event.definition.before.vendorSkus[0].price,92.5);
});

test('invoice price application rejects permission, source, stale, confirmation and older-price violations',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),saved=ok(await f.call('buyer','fooditem.invoice',invoiceInput,base));
 for(const actor of ['manager','foh','worker','foreign'])assert.equal((await f.call(actor,'fooditem.invoice-apply',priceInput(saved.revision),saved)).status,403);
 for(const input of [{...priceInput(saved.revision),confirmed:false},{...priceInput(saved.revision),reason:''},{...priceInput(0)}])assert.equal((await f.call('buyer','fooditem.invoice-apply',input,saved)).status,400);
 for(const rev of [1,999])assert.equal((await f.call('buyer','fooditem.invoice-apply',priceInput(rev),saved)).status,404);
 assert.equal((await f.call('buyer','fooditem.invoice-apply',priceInput(saved.revision),base)).status,409);
 const changed=ok(await f.call('buyer','fooditem.configure',{item:{...rawItem,vendorSkus:[{...rawItem.vendorSkus[0],packCount:4}]},reason:'Verified supplier pack'},saved));
 assert.equal((await f.call('buyer','fooditem.invoice-apply',priceInput(saved.revision),changed)).status,409);
 const older=ok(await f.call('buyer','fooditem.invoice',{...invoiceInput,lineReference:'2',invoiceDate:'2026-09-27'},changed));
 assert.equal((await f.call('buyer','fooditem.invoice-apply',priceInput(older.revision),older)).status,409);
 const voided=ok(await f.call('buyer','fooditem.invoice-void',{invoiceRevision:saved.revision,reason:'Wrong pack'},older));
 assert.equal((await f.call('buyer','fooditem.invoice-apply',priceInput(saved.revision),voided)).status,409);
});

test('voiding a currently applied invoice explicitly clears its price and invalidates costs without touching stock',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem])));
 ok(await f.call('owner','foodrecipe.import',importInput([rawRecipe])));
 const counted=ok(await f.call('manager','fooditem.count',{quantity:3,note:'Stock',confirmed:true},base)),saved=ok(await f.call('buyer','fooditem.invoice',invoiceInput,counted));
 const applied=ok(await f.call('buyer','fooditem.invoice-apply',priceInput(saved.revision),saved));
 const input={invoiceRevision:saved.revision,reason:'Incorrect invoice amount'};
 assert.equal((await f.call('buyer','fooditem.invoice-void',input,applied)).status,400);
 ok(await f.call('buyer','fooditem.invoice-void',{...input,confirmPriceClear:true},applied));
 const item=ok(await f.view('owner')).records[0];assert.equal(item.data.vendorSkus[0].price,null);assert.equal(item.data.vendorSkus[0].priceUpdatedAt,'');assert.equal(item.data.vendorSkus[0].priceSource,undefined);assert.equal(item.data.count.quantity,3);
 const recipes=ok(await f.get('owner',{kind:'foodrecipe'}));assert.equal(recipes.costs[recipes.records[0].id].total,null);
 const entries=ok(await f.get('buyer',{view:'history',recordId:base.recordId})).entries;assert.deepEqual(entries.find(e=>e.revision===saved.revision).invoiceVoided.clearedSkuIds,['sku1']);assert.equal(entries.at(-1).event.definition.before.vendorSkus[0].price,100);
});

test('invoice price provenance survives unrelated corrections, cannot be forged and never clears a newer price',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([{...rawItem,vendorSkus:[{...rawItem.vendorSkus[0],priceSource:{invoiceRevision:99,appliedRevision:100}}]}])));
 assert.equal(ok(await f.view('owner')).records[0].data.vendorSkus[0].priceSource,undefined);
 const first=ok(await f.call('buyer','fooditem.invoice',invoiceInput,base)),applied=ok(await f.call('buyer','fooditem.invoice-apply',priceInput(first.revision),first));
 let item=ok(await f.view('owner')).records[0];
 let current=ok(await f.call('buyer','fooditem.configure',{item:{...item.data,name:'Updated item name',storageArea:'Freezer',vendorSkus:item.data.vendorSkus.map(s=>({...s,priceSource:{invoiceRevision:999,appliedRevision:999}}))},reason:'Moved item'},applied));
 item=ok(await f.view('owner')).records[0];assert.equal(item.data.vendorSkus[0].priceSource.invoiceRevision,first.revision);
 const second=ok(await f.call('buyer','fooditem.invoice',{...invoiceInput,lineReference:'2',lineTotal:240},current));current=ok(await f.call('buyer','fooditem.invoice-apply',priceInput(second.revision),second));
 current=ok(await f.call('buyer','fooditem.invoice-void',{invoiceRevision:first.revision,reason:'Original source wrong'},current));item=ok(await f.view('owner')).records[0];assert.equal(item.data.vendorSkus[0].price,120);assert.equal(item.data.vendorSkus[0].priceSource.invoiceRevision,second.revision);
 current=ok(await f.call('buyer','fooditem.configure',{item:{...item.data,name:item.data.title,vendorSkus:item.data.vendorSkus.map(s=>({...s,price:130,priceSource:{invoiceRevision:second.revision,appliedRevision:999}}))},reason:'Verified later catalog correction'},current));
 assert.equal(ok(await f.view('owner')).records[0].data.vendorSkus[0].priceSource,undefined);
 ok(await f.call('buyer','fooditem.invoice-void',{invoiceRevision:second.revision,reason:'Old source incorrect'},current));assert.equal(ok(await f.view('owner')).records[0].data.vendorSkus[0].price,130);
});

test('invoice price apply and source void roll back state, costs, history, audit and receipt on failure',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem])));let current=ok(await f.call('buyer','fooditem.invoice',invoiceInput,base));const sourceRevision=current.revision;
 for(const [action,input] of [['fooditem.invoice-apply',priceInput(sourceRevision)],['fooditem.invoice-void',{invoiceRevision:sourceRevision,reason:'Wrong amount',confirmPriceClear:true}]]){
  const before=ok(await f.view('owner')).records[0],requestId=crypto.randomUUID(),audit=(await f.db.prepare('SELECT count(*) AS n FROM audit_events').first()).n;
  await f.db.prepare("CREATE TRIGGER reject_price_test BEFORE INSERT ON food_history BEGIN SELECT RAISE(ABORT,'test failure'); END").run();
  assert.equal((await f.call('buyer',action,input,current,{requestId})).status,503);assert.deepEqual(ok(await f.view('owner')).records[0],before);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM audit_events').first()).n,audit);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM food_receipts WHERE request_id=?').bind(requestId).first()).n,0);
  await f.db.prepare('DROP TRIGGER reject_price_test').run();const old=current;current=ok(await f.call('buyer',action,input,old,{requestId}));assert.deepEqual(ok(await f.call('buyer',action,input,old,{requestId})),current);
 }
 assert.equal(ok(await f.get('buyer',{view:'history',recordId:base.recordId})).entries.length,4);
});

test('invoice price races have one winner; original history receives off-page application',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),saved=ok(await f.call('buyer','fooditem.invoice',invoiceInput,base));let current=saved;
 for(let n=0;n<21;n++)current=ok(await f.call('manager','fooditem.count',{quantity:n,note:'History fixture',confirmed:true},current));
 const races=await Promise.all(['buyer','owner'].map(actor=>f.call(actor,'fooditem.invoice-apply',priceInput(saved.revision),current)));assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
 let first=ok(await f.get('manager',{view:'history',recordId:base.recordId}));assert.equal(first.entries.length,20);assert.equal(first.entries[1].invoicePriceApplied.price,100);assert.equal(first.entries[1].invoicePriceApplied.revision,current.revision+1);
 const f2=await fixture(t),b=ok(await f2.call('owner','fooditem.import',importInput([rawItem]))),s=ok(await f2.call('buyer','fooditem.invoice',invoiceInput,b));
 const conflict=await Promise.all([f2.call('buyer','fooditem.invoice-apply',priceInput(s.revision),s),f2.call('owner','fooditem.invoice-void',{invoiceRevision:s.revision,reason:'Wrong line'},s)]);assert.deepEqual(conflict.map(r=>r.status).sort(),[200,409]);
 const data=ok(await f2.view('owner')).records[0].data;if(conflict[1].status===200)assert.equal(data.vendorSkus[0].price,92.5);else assert.equal(data.vendorSkus[0].price,100);
});
test('invoice normalization handles pack, weight, volume and count measures without guessing families',()=>{
 const item=parseFoodItem(rawItem,source),parse=(patch={},value=item)=>parseInvoiceLine({...invoiceInput,...patch},value,'2026-09-29T01:00:00Z','buyer','America/New_York');
 let line=parse();assert.equal(line.supplierPackQuantity,2);assert.equal(line.pricePerSupplierPack,100);assert.equal(line.invoiceUnit,'lb');
 line=parse({unitBasis:'supplier-pack',invoiceUnit:'CS',quantity:2});assert.equal(line.supplierPackQuantity,2);assert.equal(line.pricePerSupplierPack,100);
 assert.equal(parse({invoiceUnit:'oz',quantity:1280}).supplierPackQuantity,2);
 for(const [u,qty,sku] of [['qt',16,{packCount:2,unitQty:1,unitUOM:'gal'}],['each',48,{packCount:2,unitQty:12,unitUOM:'each'}]])assert.equal(parse({invoiceUnit:u,quantity:qty},{...item,vendorSkus:[{...item.vendorSkus[0],...sku}]}).supplierPackQuantity,2);
 assert.equal(parse({lineTotal:0}).pricePerSupplierPack,0);
 for(const patch of [{quantity:''},{quantity:0},{quantity:-1},{quantity:true},{quantity:1000001},{lineTotal:'1.001'},{lineTotal:'$200'},{lineTotal:'1e2'},{lineTotal:-1},{lineTotal:1000001},{invoiceDate:'2026-09-29'},{invoiceDate:'2026-02-30'},{skuId:'missing'},{confirmed:false},{invoiceNumber:''},{lineReference:''},{sourceNote:''},{invoiceUnit:'gal'},{invoiceUnit:'constructor'},{unitBasis:'other'},{unitBasis:'supplier-pack',invoiceUnit:'each'}])assert.throws(()=>parse(patch),JSON.stringify(patch));
 for(const patch of [{active:false},{needsReview:true},{vendorSkus:[{...item.vendorSkus[0],available:false}]},{vendorSkus:[{...item.vendorSkus[0],unitQty:null}]},{vendorSkus:[{...item.vendorSkus[0],purchaseUnit:''}]}])assert.throws(()=>parse({}, {...item,...patch}));
 assert.equal(invoiceUnit('constructor'),'constructor');assert.equal(invoiceUnit('  Fluid   ounces '),'fl oz');
});
test('reviewed invoice line persists normalized price and attribution, leaving catalog price and stock intact; safe retry',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),count=ok(await f.call('manager','fooditem.count',{quantity:3,note:'Fixture',confirmed:true},base));
 const before=ok(await f.view('owner')).records[0];
 for(const actor of ['manager','foh','worker','foreign'])assert.equal((await f.call(actor,'fooditem.invoice',invoiceInput,count)).status,403);
 const requestId=crypto.randomUUID(),input={...invoiceInput,sku:{price:0,purchaseUnit:'each'},by:'owner',at:'2000-01-01T00:00:00Z'};
 const saved=ok(await f.call('buyer','fooditem.invoice',input,count,{requestId}));assert.deepEqual(ok(await f.call('buyer','fooditem.invoice',input,count,{requestId})),saved);
 assert.equal((await f.call('buyer','fooditem.invoice',{...input,lineTotal:250},count,{requestId})).status,409);
 const after=ok(await f.view('buyer')).records[0];assert.deepEqual(after.data.vendorSkus,before.data.vendorSkus);assert.deepEqual(after.data.count,before.data.count);
 const line=ok(await f.get('manager',{view:'history',recordId:base.recordId})).entries.at(-1).event.invoiceLine;assert.equal(line.by,'buyer');assert.notEqual(line.at,input.at);assert.equal(line.sku.price,92.5);assert.equal(line.sku.purchaseUnit,'case');assert.equal(line.pricePerSupplierPack,100);assert.equal(line.lineTotalCents,20000);
 assert.equal((await f.call('manager','fooditem.invoice-void',{invoiceRevision:saved.revision,reason:'No reviewer permission'},saved)).status,403);
});
test('invoice duplicate detection spans items, keeps datasets/stores separate and permits corrected capture only after void',async t=>{
 const f=await fixture(t);ok(await f.call('owner','fooditem.import',importInput([rawItem,{...rawItem,controlNumber:'SECOND'}])));
 const [first,second]=ok(await f.view('buyer')).records;const saved=ok(await f.call('buyer','fooditem.invoice',invoiceInput,first));
 assert.equal((await f.call('owner','fooditem.invoice',{...invoiceInput,invoiceNumber:' demo-100 ',lineReference:' 1 '},second)).status,409);
 const remote=ok(await f.call('foreign','fooditem.import',{...importInput([rawItem]),destinationLocationId:'b'},undefined,{locationId:'b'}));
 assert.equal((await f.call('owner','fooditem.invoice',invoiceInput,remote)).status,404);
 ok(await f.call('foreign','fooditem.invoice',invoiceInput,remote,{locationId:'b'}));
 const real=ok(await f.call('owner','fooditem.import',{...importInput([{...rawItem,name:'Beef',restaurantId:'real-a'}]),dataset:'operating',sourceRestaurantId:'real-a'}));
 ok(await f.call('owner','fooditem.invoice',invoiceInput,real));
 const voided=ok(await f.call('buyer','fooditem.invoice-void',{invoiceRevision:saved.revision,reason:'Wrong item'},saved));
 ok(await f.call('owner','fooditem.invoice',{...invoiceInput,lineTotal:'210.00'},second));
 assert.equal((await f.call('buyer','fooditem.invoice-void',{invoiceRevision:saved.revision,reason:'Again'},voided)).status,409);
 assert.equal(ok(await f.get('buyer',{view:'history',recordId:first.id})).entries.at(-2).invoiceVoided.reason,'Wrong item');
});
test('invoice void preserves original supplier pack after correction and annotates earlier pages',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),saved=ok(await f.call('buyer','fooditem.invoice',invoiceInput,base));
 let current=ok(await f.call('buyer','fooditem.configure',{item:{...rawItem,vendorSkus:[{...rawItem.vendorSkus[0],packCount:4}]},reason:'Actual corrected pack'},saved));
 for(let n=0;n<21;n++)current=ok(await f.call('manager','fooditem.count',{quantity:n,confirmed:true,note:'Paging fixture'},current));
 for(const input of [{invoiceRevision:1,reason:'Not an invoice'},{invoiceRevision:999,reason:'Another item'},{invoiceRevision:2,reason:''}])assert.ok([400,404].includes((await f.call('buyer','fooditem.invoice-void',input,current)).status));
 const result=await Promise.all(['buyer','owner'].map(actor=>f.call(actor,'fooditem.invoice-void',{invoiceRevision:saved.revision,reason:'Incorrect pack on entry'},current)));assert.deepEqual(result.map(r=>r.status).sort(),[200,409]);
 const history=ok(await f.get('manager',{view:'history',recordId:base.recordId}));assert.equal(history.entries.length,20);assert.ok(history.next);
 const entry=history.entries.find(e=>e.revision===2);assert.equal(entry.event.invoiceLine.sku.packCount,8);assert.equal(entry.event.invoiceLine.pricePerSupplierPack,100);assert.equal(entry.invoiceVoided.reason,'Incorrect pack on entry');
 const now=ok(await f.view('buyer')).records[0];assert.equal(now.data.vendorSkus[0].packCount,4);assert.equal(now.data.count.quantity,20);
});
test('invoice writes and voids roll back history, state and receipts together and retry exactly once',async t=>{
 const f=await fixture(t);let current=ok(await f.call('owner','fooditem.import',importInput([rawItem])));
 for(const [action,input] of [['fooditem.invoice',invoiceInput],['fooditem.invoice-void',{invoiceRevision:2,reason:'Duplicate source line'}]]){
  const requestId=crypto.randomUUID(),before=ok(await f.view('owner')).records[0];
  await f.db.prepare("CREATE TRIGGER reject_invoice_test BEFORE INSERT ON food_history BEGIN SELECT RAISE(ABORT,'test failure'); END").run();
  assert.equal((await f.call('buyer',action,input,current,{requestId})).status,503);assert.deepEqual(ok(await f.view('owner')).records[0],before);
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM food_receipts WHERE request_id=?').bind(requestId).first()).n,0);
  await f.db.prepare('DROP TRIGGER reject_invoice_test').run();current=ok(await f.call('buyer',action,input,current,{requestId}));
 }
 const entries=ok(await f.get('buyer',{view:'history',recordId:current.recordId})).entries;assert.equal(entries.length,3);assert.equal(entries[1].invoiceVoided.revision,3);
});
test('concurrent duplicate invoice capture on different items has only one winner',async t=>{
 const f=await fixture(t);ok(await f.call('owner','fooditem.import',importInput([rawItem,{...rawItem,controlNumber:'SECOND'}])));const items=ok(await f.view('buyer')).records;
 const results=await Promise.all(items.map(item=>f.call('buyer','fooditem.invoice',invoiceInput,item)));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const histories=await Promise.all(items.map(item=>f.get('buyer',{view:'history',recordId:item.id})));assert.equal(histories.flatMap(r=>ok(r).entries).filter(e=>e.event.invoiceLine).length,1);
});
const wasteInput={quantity:.25,reason:'spoilage',note:'Discarded during walk-in check',confirmed:true};
test('waste keeps physical count unchanged, snapshots units, and uses authenticated attribution with safe retry',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),counted=ok(await f.call('manager','fooditem.count',{quantity:3,note:'Physical count',confirmed:true},base));
 const count=ok(await f.view('manager')).records[0].data.count;
 for(const patch of [{quantity:''},{quantity:0},{quantity:-1},{quantity:true},{quantity:1000001},{reason:'constructor'},{reason:'other',note:''},{confirmed:false}])assert.equal((await f.call('manager','fooditem.waste',{...wasteInput,...patch},counted)).status,400);
 const requestId=crypto.randomUUID(),input={...wasteInput,at:'2000-01-01T00:00:00Z',by:'owner',pack:{purchaseUnit:'each'},cost:9999};
 const saved=ok(await f.call('manager','fooditem.waste',input,counted,{requestId}));assert.deepEqual(ok(await f.call('manager','fooditem.waste',input,counted,{requestId})),saved);
 assert.equal((await f.call('manager','fooditem.waste',{...input,quantity:2},counted,{requestId})).status,409);
 assert.deepEqual(ok(await f.view('manager')).records[0].data.count,count);
 const history=ok(await f.get('manager',{view:'history',recordId:base.recordId}));assert.equal(history.entries.length,3);
 const event=history.entries[2].event;assert.equal(event.waste.quantity,.25);assert.equal(event.waste.by,'manager');assert.notEqual(event.waste.at,input.at);assert.equal(event.waste.pack.purchaseUnit,'case');assert.equal(event.waste.pack.packCount,8);assert.equal(event.waste.cost.estimatedCents,2313);assert.equal(event.count,undefined);
});

test('waste costing converts count-to-supplier units, preserves genuine zero and does not depend on portions',()=>{
 const base=parseFoodItem(rawItem,source),at='2026-09-29T01:00:00Z',cost=(item,q=1)=>wasteCost(item,q,at,'America/New_York');
 assert.equal(cost({...base,portionSize:null,portionUOM:''},.25).estimatedCents,2313);
 assert.equal(cost({...base,packCount:1,unitQty:16,unitUOM:'oz'}).estimatedCents,231);
 assert.equal(cost({...base,packCount:1,unitQty:1,unitUOM:'kg'}).estimatedCents,510);
 assert.equal(cost({...base,vendorSkus:[{...base.vendorSkus[0],price:0}]}).estimatedCents,0);
 for(const patch of [{needsReview:true},{packCount:null},{unitUOM:'gal'},{vendorSkus:[]},{vendorSkus:[{...base.vendorSkus[0],price:null}]},{vendorSkus:[{...base.vendorSkus[0],priceUpdatedAt:''}]},{vendorSkus:[{...base.vendorSkus[0],priceUpdatedAt:'2026-09-29'}]},{vendorSkus:[{...base.vendorSkus[0],available:false}]},{vendorSkus:[base.vendorSkus[0],{...base.vendorSkus[0],id:'two'}]}]){const result=cost({...base,...patch});assert.equal(result.estimatedCents,null);assert.ok(result.issues.length);}
 assert.equal(cost({...base,packCount:1000000,unitQty:1000000,vendorSkus:[{...base.vendorSkus[0],packCount:1,unitQty:.0001,price:1000000}]},1000000).estimatedCents,null);
 const saved=cost(base);base.vendorSkus[0].price=1;assert.equal(saved.sku.price,92.5);
});

// Historical report fixtures must not depend on the machine's current date.
async function dateWasteReportFixture(db){
 const at='2026-09-29T12:00:00.000Z';
 await db.prepare("UPDATE food_history SET at=?,event=json_set(event,'$.waste.at',?) WHERE json_type(event,'$.waste')='object'").bind(at,at).run();
}

test('waste report separates known subtotal, true zero, uncosted, legacy and voided observations across later corrections',async t=>{
 const f=await fixture(t);ok(await f.call('owner','fooditem.import',importInput([rawItem,{...rawItem,controlNumber:'MISSING',vendorSkus:[{...rawItem.vendorSkus[0],price:null}]},{...rawItem,controlNumber:'ZERO',vendorSkus:[{...rawItem.vendorSkus[0],price:0}]}])));
 const [base,missing,zero]=ok(await f.view('manager')).records;
 let current=ok(await f.call('manager','fooditem.waste',wasteInput,base));const first=current;
 current=ok(await f.call('manager','fooditem.waste',{...wasteInput,quantity:1},current));const voidRevision=current.revision;
 current=ok(await f.call('manager','fooditem.waste-void',{wasteRevision:voidRevision,reason:'Mistaken entry'},current));
 current=ok(await f.call('manager','fooditem.waste',{...wasteInput,reason:'overproduction'},current));
 await f.db.prepare("UPDATE food_history SET event=json_remove(event,'$.waste.cost','$.waste.item') WHERE record_id=? AND revision=?").bind(base.id,current.revision).run();
 ok(await f.call('manager','fooditem.waste',wasteInput,missing));ok(await f.call('manager','fooditem.waste',{...wasteInput,reason:'dropped'},zero));
 ok(await f.call('buyer','fooditem.configure',{item:{...rawItem,name:'Later name',packCount:2,vendorSkus:[{...rawItem.vendorSkus[0],price:150}]},reason:'Later definition'},current));
 await dateWasteReportFixture(f.db);
 const report=ok(await f.get('manager',{view:'waste',from:'2026-09-28',through:'2026-09-29'}));assert.deepEqual(report.totals,{entries:5,voided:1,active:4,costed:2,uncosted:2,knownEstimatedCents:2313});assert.equal(report.next,null);
 assert.equal(report.entries[0].waste.item.title,rawItem.name);assert.equal(report.entries[0].currentTitle,'Later name');assert.equal(report.entries[0].waste.cost.sku.price,92.5);assert.equal(report.entries[0].waste.pack.packCount,8);
 assert.equal(report.reasons.find(r=>r.reason==='dropped').knownEstimatedCents,0);assert.equal(report.reasons.find(r=>r.reason==='dropped').costed,1);
 assert.equal(ok(await f.view('manager')).records[0].data.count,null);
 const entry=ok(await f.get('manager',{view:'history',recordId:base.id})).entries.find(e=>e.revision===first.revision);assert.equal(entry.event.waste.cost.estimatedCents,2313);
});

test('waste keeps entry-time price while later voided invoice sources become uncosted without rewriting evidence',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),line=ok(await f.call('buyer','fooditem.invoice',invoiceInput,base));
 const priced=ok(await f.call('buyer','fooditem.invoice-apply',priceInput(line.revision),line)),wasted=ok(await f.call('manager','fooditem.waste',{...wasteInput,quantity:.5},priced));
 let item=ok(await f.view('owner')).records[0];const corrected=ok(await f.call('buyer','fooditem.configure',{item:{...item.data,name:item.data.title,vendorSkus:item.data.vendorSkus.map(s=>({...s,price:140}))},reason:'Later verified price'},wasted));
 await dateWasteReportFixture(f.db);
 let report=ok(await f.get('manager',{view:'waste',from:'2026-09-28',through:'2026-09-29'}));assert.equal(report.totals.knownEstimatedCents,5000);
 ok(await f.call('buyer','fooditem.invoice-void',{invoiceRevision:line.revision,reason:'Earlier source invalid'},corrected));
 report=ok(await f.get('manager',{view:'waste',from:'2026-09-28',through:'2026-09-29'}));assert.equal(report.totals.costed,0);assert.equal(report.totals.uncosted,1);assert.equal(report.entries[0].priceSourceVoided,true);assert.equal(report.entries[0].waste.cost.estimatedCents,5000);
 const entry=ok(await f.get('manager',{view:'history',recordId:base.recordId})).entries.find(e=>e.revision===wasted.revision);assert.equal(entry.wastePriceSourceVoided,true);assert.equal(entry.event.waste.cost.estimatedCents,5000);assert.equal(ok(await f.view('owner')).records[0].data.vendorSkus[0].price,140);
});

test('waste report respects restaurant-local DST date boundaries, dataset and access; invalid ranges rejected',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem])));let current=base;
 for(const at of ['2026-11-01T03:59:59.000Z','2026-11-01T04:00:00.000Z','2026-11-02T04:59:59.000Z','2026-11-02T05:00:00.000Z']){current=ok(await f.call('manager','fooditem.waste',wasteInput,current));await f.db.prepare("UPDATE food_history SET at=?,event=json_set(event,'$.waste.at',?) WHERE record_id=? AND revision=?").bind(at,at,base.recordId,current.revision).run();}
 const params={view:'waste',from:'2026-11-01',through:'2026-11-01'},report=ok(await f.get('manager',params));assert.equal(report.totals.entries,2);assert.equal(report.timezone,'America/New_York');assert.equal(report.totals.knownEstimatedCents,4626);
 assert.equal(ok(await f.get('buyer',{...params,dataset:'operating'})).totals.entries,0);assert.equal(ok(await f.get('foreign',{...params,locationId:'b'})).totals.entries,0);
 for(const actor of ['worker','foh','foreign'])assert.equal((await f.get(actor,params)).status,403);
 for(const patch of [{from:'2026-02-30'},{through:'2026-10-31'},{through:'2026-12-02'},{after:'-1'}])assert.equal((await f.get('manager',{...params,...patch})).status,400);
 await f.db.prepare('UPDATE memberships SET active=0 WHERE id=?').bind('manager').run();assert.equal((await f.get('manager',params)).status,403);
});

test('waste report paging has complete totals and rejects changed snapshots without polluting daily payload',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem])));let current=base;
 for(let i=0;i<23;i++)current=ok(await f.call('manager','fooditem.waste',wasteInput,current));
 await dateWasteReportFixture(f.db);
 const params={view:'waste',from:'2026-09-28',through:'2026-09-29'},first=ok(await f.get('manager',params));assert.equal(first.entries.length,20);assert.equal(first.totals.entries,23);assert.equal(first.totals.knownEstimatedCents,23*2313);
 const second=ok(await f.get('manager',{...params,after:String(first.next),revision:String(first.revision)}));assert.equal(second.entries.length,3);assert.equal(second.next,null);assert.deepEqual(second.totals,first.totals);assert.equal(new Set([...first.entries,...second.entries].map(e=>e.sequence)).size,23);
 assert.equal((await f.get('manager',{...params,after:String(first.next)})).status,409);
 ok(await f.call('manager','fooditem.waste-void',{wasteRevision:2,reason:'Wrong quantity'},current));assert.equal((await f.get('manager',{...params,after:String(first.next),revision:String(first.revision)})).status,409);
 const refreshed=ok(await f.get('manager',params));assert.equal(refreshed.totals.active,22);assert.equal(refreshed.totals.voided,1);assert.equal(refreshed.entries[0].voided,true);
 const response=await handleWorkspace(new Request('https://test.example/api/workspace?locationId=a',{headers:f.headers('owner')}),f.db);const daily=await response.json();assert.equal(response.status,200);assert.equal(daily.records.filter(r=>r.kind==='fooditem'||r.kind==='foodrecipe').length,0);
});
test('voids preserve the original waste and later pack changes; original history page sees an off-page void',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),wasted=ok(await f.call('manager','fooditem.waste',wasteInput,base));
 let current=ok(await f.call('buyer','fooditem.configure',{item:{...rawItem,packCount:4},reason:'Verified pack'},wasted));
 for(let n=0;n<21;n++)current=ok(await f.call('manager','fooditem.count',{quantity:n,note:'History paging fixture',confirmed:true},current));
 const before=ok(await f.get('manager',{view:'history',recordId:base.recordId}));assert.equal(before.entries.length,20);assert.ok(before.next);
 const input={wasteRevision:wasted.revision,reason:'Entered on the wrong item'},requestId=crypto.randomUUID();
 const voided=ok(await f.call('manager','fooditem.waste-void',input,current,{requestId}));assert.deepEqual(ok(await f.call('manager','fooditem.waste-void',input,current,{requestId})),voided);
 const first=ok(await f.get('manager',{view:'history',recordId:base.recordId})),entry=first.entries.find(e=>e.revision===wasted.revision);
 assert.equal(entry.event.waste.pack.packCount,8);assert.equal(entry.voided.reason,input.reason);assert.equal(entry.voided.revision,voided.revision);assert.equal(entry.voided.by,'manager');
 assert.equal(ok(await f.view('manager')).records[0].data.count.quantity,20);
 const later=ok(await f.get('manager',{view:'history',recordId:base.recordId,after:String(first.next)}));assert.equal(later.entries.at(-1).event.wasteVoid.wasteRevision,wasted.revision);
 assert.equal((await f.call('manager','fooditem.waste-void',input,voided)).status,409);
 assert.equal((await f.call('manager','fooditem.waste-void',{wasteRevision:1,reason:'Not waste'},voided)).status,404);
 assert.equal((await f.call('manager','fooditem.waste-void',{wasteRevision:wasted.revision,reason:''},voided)).status,400);
});
test('waste and void enforce current store and role, reject inactive or unitless items, and reject foreign entry references',async t=>{
 const f=await fixture(t),a=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),wasted=ok(await f.call('buyer','fooditem.waste',wasteInput,a));
 for(const actor of ['worker','foh','foreign']){assert.equal((await f.call(actor,'fooditem.waste',wasteInput,wasted)).status,403);assert.equal((await f.call(actor,'fooditem.waste-void',{wasteRevision:2,reason:'No authority'},wasted)).status,403);}
 const b=ok(await f.call('foreign','fooditem.import',{...importInput([rawItem]),destinationLocationId:'b'},undefined,{locationId:'b'}));
 assert.equal((await f.call('manager','fooditem.waste',wasteInput,b)).status,404);
 assert.equal((await f.call('foreign','fooditem.waste-void',{wasteRevision:2,reason:'Other store entry'},b,{locationId:'b'})).status,404);
 let r=ok(await f.call('owner','fooditem.configure',{item:{...rawItem,active:false},reason:'Inactive'},wasted));assert.equal((await f.call('manager','fooditem.waste',wasteInput,r)).status,400);
 r=ok(await f.call('owner','fooditem.configure',{item:{...rawItem,purchaseUnit:''},reason:'Unit unknown'},r));assert.equal((await f.call('manager','fooditem.waste',wasteInput,r)).status,400);
 await f.db.prepare('UPDATE memberships SET active=0,revision=revision+1 WHERE id=?').bind('buyer').run();assert.equal((await f.call('buyer','fooditem.waste-void',{wasteRevision:2,reason:'Old access'},r)).status,403);
});
test('waste and void roll back all state on history failure; unchanged retries recover exactly once',async t=>{
 const f=await fixture(t);let current=ok(await f.call('owner','fooditem.import',importInput([rawItem])));
 for(const [action,input] of [['fooditem.waste',wasteInput],['fooditem.waste-void',{wasteRevision:2,reason:'Mistaken entry'}]]){
  const requestId=crypto.randomUUID(),before=ok(await f.view('manager')).records[0];
  await f.db.prepare("CREATE TRIGGER reject_waste_test BEFORE INSERT ON food_history BEGIN SELECT RAISE(ABORT,'test failure'); END").run();
  assert.equal((await f.call('manager',action,input,current,{requestId})).status,503);assert.deepEqual(ok(await f.view('manager')).records[0],before);
  assert.equal((await f.db.prepare('SELECT count(*) AS n FROM food_receipts WHERE request_id=?').bind(requestId).first()).n,0);
  await f.db.prepare('DROP TRIGGER reject_waste_test').run();
  const saved=ok(await f.call('manager',action,input,current,{requestId}));assert.deepEqual(ok(await f.call('manager',action,input,current,{requestId})),saved);current=saved;
 }
 const entries=ok(await f.get('manager',{view:'history',recordId:current.recordId})).entries;assert.equal(entries.length,3);assert.equal(entries[1].voided.revision,3);
});
test('concurrent waste corrections have one winner and retain the original event',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),wasted=ok(await f.call('manager','fooditem.waste',wasteInput,base));
 const results=await Promise.all(['manager','buyer'].map(actor=>f.call(actor,'fooditem.waste-void',{wasteRevision:2,reason:'Duplicate report'},wasted)));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);const entries=ok(await f.get('owner',{view:'history',recordId:base.recordId})).entries;assert.equal(entries.length,3);assert.equal(entries[1].event.waste.quantity,.25);assert.ok(entries[1].voided);
});
test('the actual pinned Jeff fixture parses and all three recipe totals match independently calculated source packs',()=>{
 const items=jeffDemo.items.map(i=>parseFoodItem(i,source)),recipes=jeffDemo.dishes.map(r=>parseFoodRecipe(r,source));
 assert.equal(items.length,6);assert.equal(recipes.length,3);assert.ok(items.every(i=>i.count===null));
 const expected=[92.5/(8*5*16/6)+44/200,18.75/(50*16/12)+2*61/(4*5*16/4)+39.5/(6*100/5),28/(24/.25)];
 recipes.forEach((r,i)=>assert.ok(Math.abs(foodRecipeCost(r,items,recipes).total-expected[i])<1e-9));
});
test('Jeff pack conversion preserves portion math without importing a stock balance as a count',()=>{
 const item=parseFoodItem(rawItem,source),cost=foodItemCost(item);assert.equal(item.count,null);assert.equal(item.countHistory.length,0);assert.equal(cost.portionsPerPack,640/6);assert.equal(cost.costPerPortion,92.5/(640/6));assert.equal(foodShortfall(item,'2026-09-28','America/New_York').units,null);
});
test('missing price, portion, mapping review and incompatible units block cost, explicit free price is distinct',()=>{
 const item=parseFoodItem(rawItem,source);
 for(const patch of [{portionSize:null},{portionUOM:'each'},{needsReview:true},{vendorSkus:[{...item.vendorSkus[0],price:null}]},{vendorSkus:[{...item.vendorSkus[0],priceUpdatedAt:''}]},{vendorSkus:[]}])assert.equal(foodItemCost({...item,...patch}).costPerPortion,null);
 assert.equal(foodItemCost({...item,vendorSkus:[{...item.vendorSkus[0],price:0}]}).costPerPortion,0);
});
test('ambiguous preferred supplier and guessed count-pack conversions are rejected',()=>{
 const item=parseFoodItem(rawItem,source);assert.equal(foodItemCost({...item,vendorSkus:[...item.vendorSkus,{...item.vendorSkus[0],id:'second'}]}).costPerPortion,null);
 const counted={...item,count:{quantity:2,at:'2026-09-28T12:00:00Z',by:'owner',note:''}};
 assert.equal(foodShortfall(counted,'2026-09-28','America/New_York').units,2);assert.equal(foodShortfall({...counted,unitUOM:'each'},'2026-09-28','America/New_York').units,null);assert.equal(foodShortfall(counted,'2026-09-29','America/New_York').units,null);
 assert.equal(foodShortfall({...counted,count:{...counted.count,at:'2026-09-29T01:00:00Z'}},'2026-09-28','America/New_York').units,2);
});
test('nested recipe costing handles yield, missing references, cycles and source separation',()=>{
 const item=parseFoodItem(rawItem,source),prep=parseFoodRecipe({...rawRecipe,id:'mix',recipeType:'prep',yieldQty:2},source),menu=parseFoodRecipe({...rawRecipe,lines:[{sourceType:'prep',recipeId:'mix',qty:1}]},source);
 assert.equal(foodRecipeCost(menu,[item],[prep,menu]).total,foodItemCost(item).costPerPortion/2);
 assert.equal(foodRecipeCost(menu,[],[prep,menu]).total,null);
 assert.equal(foodRecipeCost(menu,[{...item,source:{...source,dataset:'operating'}}],[prep,menu]).total,null);
 const cycle={...prep,lines:[{sourceType:'prep',recipeId:'mix',qty:1}]};assert.match(foodRecipeCost(cycle,[item],[cycle]).issues.join(),/Circular/);
 assert.equal(foodRecipeCost({...menu,yieldQty:null},[item],[prep,menu]).total,null);
});
test('legacy recipe shape, malformed numbers, notes and disguised demo exports cannot pass review',()=>{
 assert.throws(()=>parseFoodRecipe({...rawRecipe,lines:undefined,recipe:[]},source));
 for(const patch of [{par:false},{packCount:-1},{portionSize:'no'},{name:'Reference Pack Size = explanatory text'},{restaurantId:'other'}])assert.throws(()=>parseFoodItem({...rawItem,...patch},source));
 assert.throws(()=>parseFoodItem(rawItem,{...source,dataset:'operating'}));
});
test('owner import is durable, idempotent, store-bound and invisible to ordinary employees',async t=>{
 const f=await fixture(t),requestId=crypto.randomUUID(),first=ok(await f.call('owner','fooditem.import',importInput([rawItem]),undefined,{requestId}));
 assert.deepEqual(ok(await f.call('owner','fooditem.import',importInput([rawItem]),undefined,{requestId})),first);
 assert.equal(ok(await f.view('manager')).records.filter(r=>r.kind==='fooditem').length,1);
 assert.equal(ok(await f.view('buyer')).records.filter(r=>r.kind==='fooditem').length,1);
 for(const actor of ['foh','worker']){assert.equal((await f.view(actor)).status,403);assert.equal((await f.call(actor,'fooditem.count',{quantity:1,note:'',confirmed:true},first)).status,403);}
 assert.equal((await f.view('foreign')).status,403);assert.equal((await f.call('foreign','fooditem.import',importInput([rawItem]))).status,403);
 assert.equal((await f.call('manager','fooditem.import',importInput([rawItem]))).status,403);
 assert.equal((await f.call('owner','fooditem.import',{...importInput([rawItem]),destinationLocationId:'b'})).status,400);
 assert.equal(ok(await f.call('owner','fooditem.import',importInput([rawItem]))).existing,1);
});
test('a bad row aborts a whole import batch and cannot change the stored restaurant mapping',async t=>{
 const f=await fixture(t);assert.equal((await f.call('owner','fooditem.import',importInput([rawItem,{...rawItem,controlNumber:'BAD',restaurantId:'b'}]))).status,400);assert.equal(ok(await f.view('owner')).records.length,0);
 ok(await f.call('owner','fooditem.import',importInput([rawItem])));
 assert.equal((await f.call('owner','fooditem.import',{...importInput([{...rawItem,controlNumber:'OTHER',restaurantId:'other'}]),sourceRestaurantId:'other'})).status,400);
});
test('blank count is rejected, zero is saved, retries are idempotent, and stale managers cannot overwrite',async t=>{
 const f=await fixture(t),r=ok(await f.call('owner','fooditem.import',importInput([rawItem])));
 assert.equal((await f.call('manager','fooditem.count',{quantity:'',note:'',confirmed:true},r)).status,400);
 const count={quantity:0,note:'Physical count',confirmed:true},requestId=crypto.randomUUID();const saved=ok(await f.call('manager','fooditem.count',count,r,{requestId}));
 assert.deepEqual(ok(await f.call('manager','fooditem.count',count,r,{requestId})),saved);
 assert.equal((await f.call('manager','fooditem.count',{...count,quantity:5},r)).status,409);
 const data=ok(await f.view('owner')).records[0].data;assert.equal(data.count.quantity,0);assert.equal(data.countHistory.length,0);assert.equal(data.count.by,'manager');assert.equal(ok(await f.get('owner',{view:'history',recordId:r.recordId})).entries.length,2);
});
test('pack correction invalidates the count, keeps history and enforces purchasing authority',async t=>{
 const f=await fixture(t),r=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),counted=ok(await f.call('manager','fooditem.count',{quantity:2,note:'Physical',confirmed:true},r));
 const correction={item:{...rawItem,packCount:4},reason:'Verified new supplier pack'};
 assert.equal((await f.call('manager','fooditem.configure',correction,counted)).status,403);
 ok(await f.call('buyer','fooditem.configure',correction,counted));const data=ok(await f.view('owner')).records[0].data;assert.equal(data.count,null);assert.equal(data.countHistory.length,0);assert.equal(data.history.length,0);const entries=ok(await f.get('owner',{view:'history',recordId:r.recordId})).entries;assert.equal(entries.length,3);assert.equal(entries[1].event.count.pack.packCount,8);assert.equal(entries[2].event.definition.before.packCount,8);assert.equal(entries[2].event.definition.before.vendorSkus[0].price,92.5);
});
test('imported recipes resolve against the persisted items and do not trust a client cost',async t=>{
 const f=await fixture(t);ok(await f.call('owner','fooditem.import',importInput([rawItem])));ok(await f.call('owner','foodrecipe.import',importInput([{...rawRecipe,totalCost:0.01}])));
 const w=ok(await f.view('manager')),item=w.records.find(r=>r.kind==='fooditem').data,recipe=w.records.find(r=>r.kind==='foodrecipe').data;assert.equal(recipe.totalCost,undefined);assert.equal(foodRecipeCost(recipe,[item],[recipe]).total,foodItemCost(item).costPerPortion);assert.equal((await f.view('worker')).status,403);const p=ok(await f.get('manager',{kind:'foodrecipe'}));assert.equal(p.costs[p.records[0].id].total,foodItemCost(item).costPerPortion);
});

test('4,501 food items and 3,500 history events do not grow the daily workspace; pages have no gaps or duplicates',async t=>{
 const f=await fixture(t);
 const daily=async()=>{const r=await handleWorkspace(new Request('https://test.example/api/workspace?locationId=a',{headers:f.headers('owner')}),f.db);assert.equal(r.status,200);return await r.text()};
 const before=await daily(),base=ok(await f.call('owner','fooditem.import',importInput([rawItem])));
 await f.db.prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<4500)
 INSERT INTO food_records(id,location_id,kind,dataset,source_restaurant_id,source_key,title,storage_area,owner_id,area,revision,data,updated_at)
 SELECT 'load-'||printf('%05d',x),location_id,kind,dataset,source_restaurant_id,'LOAD-'||x,'Load item '||x,storage_area,owner_id,area,revision,json_set(data,'$.controlNumber','LOAD-'||x,'$.title','Load item '||x),updated_at FROM n CROSS JOIN food_records WHERE id=?`).bind(base.recordId).run();
 await f.db.prepare(`WITH RECURSIVE n(x) AS (VALUES(2) UNION ALL SELECT x+1 FROM n WHERE x<3501)
 INSERT INTO food_history(location_id,record_id,revision,actor_id,at,event) SELECT 'a',?,x,'owner','2026-09-28T12:00:00Z',? FROM n`).bind(base.recordId,JSON.stringify({action:'fixture-history',history:[]})).run();
 await f.db.prepare('UPDATE food_records SET revision=3501 WHERE id=?').bind(base.recordId).run();
 assert.equal(await daily(),before,'Food imports/count history must not change or enlarge the daily response');
 const seen=new Set();let after='',requests=0,maxBytes=0;
 do{const p=ok(await f.get('owner',{after}));assert.equal(p.total,4501);assert.ok(p.records.length<=20);maxBytes=Math.max(maxBytes,Buffer.byteLength(JSON.stringify(p)));for(const r of p.records){assert.ok(!seen.has(r.id));seen.add(r.id);assert.deepEqual(r.data.history,[]);assert.deepEqual(r.data.countHistory,[])}after=p.next??'';requests++;}while(after);
 assert.equal(seen.size,4501);assert.equal(requests,226);assert.ok(maxBytes<45000);
 const h=ok(await f.get('owner',{view:'history',recordId:base.recordId}));assert.equal(h.entries.length,20);assert.ok(h.next);
 const h2=ok(await f.get('owner',{view:'history',recordId:base.recordId,after:String(h.next)}));assert.equal(h2.entries.length,20);assert.ok(h2.entries[0].sequence>h.entries.at(-1).sequence);
 ok(await f.call('manager','fooditem.count',{quantity:0,note:'Beyond the previous inline history limit',confirmed:true},{...base,revision:3501}));
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM food_history WHERE record_id=?').bind(base.recordId).first()).n,3502);
 assert.equal(await daily(),before);t.diagnostic(JSON.stringify({catalogItems:seen.size,historyEvents:3502,pageRequests:requests,maxPageBytes:maxBytes,dailyBytes:Buffer.byteLength(before)}));
});

test('count and definition history is atomic when storage fails; exact retries succeed without duplicate events',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),requestId=crypto.randomUUID(),input={quantity:7,note:'Physical count',confirmed:true};
 await f.db.prepare("CREATE TRIGGER reject_food_test BEFORE INSERT ON food_history WHEN NEW.revision>1 BEGIN SELECT RAISE(ABORT,'test failure'); END").run();
 assert.equal((await f.call('manager','fooditem.count',input,base,{requestId})).status,503);
 assert.equal(ok(await f.view('owner')).records[0].data.count,null);
 assert.equal((await f.db.prepare('SELECT revision FROM food_state WHERE location_id=?').bind('a').first()).revision,1);
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM food_receipts').first()).n,1);
 await f.db.prepare('DROP TRIGGER reject_food_test').run();
 const saved=ok(await f.call('manager','fooditem.count',input,base,{requestId}));assert.deepEqual(ok(await f.call('manager','fooditem.count',input,base,{requestId})),saved);
 assert.equal((await f.call('manager','fooditem.count',{...input,quantity:8},base,{requestId})).status,409);
 assert.equal(ok(await f.get('owner',{view:'history',recordId:base.recordId})).entries.length,2);
});

test('concurrent counts cannot overwrite each other, revoked membership cannot read history, and datasets remain separate',async t=>{
 const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem])));
 const results=await Promise.all([f.call('manager','fooditem.count',{quantity:3,note:'One',confirmed:true},base),f.call('buyer','fooditem.count',{quantity:8,note:'Two',confirmed:true},base)]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(ok(await f.get('owner',{view:'history',recordId:base.recordId})).entries.length,2);
 assert.equal((await f.get('foreign',{view:'history',recordId:base.recordId})).status,403);
 assert.equal((await f.get('owner',{view:'history',recordId:base.recordId,dataset:'operating'})).status,404);
 const operating=ok(await f.call('owner','fooditem.import',{...importInput([{...rawItem,name:'Beef',restaurantId:'actual'}]),dataset:'operating',sourceRestaurantId:'actual'}));assert.notEqual(operating.recordId,base.recordId);
 assert.equal(ok(await f.get('owner',{dataset:'operating'})).items,1);assert.equal(ok(await f.get('owner')).items,1);
 await f.db.prepare('UPDATE memberships SET active=0,revision=revision+1 WHERE id=?').bind('manager').run();assert.equal((await f.get('manager',{view:'history',recordId:base.recordId})).status,403);
});

test('new food endpoint rejects cross-site changes and daily endpoint cannot write the old food store',async t=>{
 const f=await fixture(t),body={requestId:crypto.randomUUID(),locationId:'a',action:'fooditem.import',input:importInput([rawItem])};
 const request=(origin='https://test.example')=>new Request('https://test.example/api/food',{method:'POST',headers:{...f.headers('owner'),Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await handleFood(request('https://foreign.example'),f.db)).status,403);
 assert.equal((await handleWorkspace(request(),f.db)).status,400);
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM food_records').first()).n,0);
});

test('legacy migration preserves definitions, counts and correction snapshots without loading them into daily work',async t=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 const migrate=async file=>db.batch(fs.readFileSync(`drizzle/${file}`,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')&&!f.startsWith('0017')).sort())await migrate(file);
 await db.prepare("INSERT INTO locations(id,name,timezone) VALUES('a','A','UTC')").run();
 await db.prepare("INSERT INTO memberships(id,email,location_id,name,area,position,capabilities,qualifications,auth_user_id) VALUES('owner','owner@example.test','a','Owner','Executive','Owner','[\"location.manage\"]','[]','owner-identity')").run();
 const data=parseFoodItem(rawItem,source),count={quantity:2,at:source.importedAt,by:'owner',note:'original count',pack:{purchaseUnit:'case',packCount:8,unitQty:5,unitUOM:'lb'}};
 data.count=count;data.countHistory=[count];data.history=[{at:source.importedAt,actorId:'owner',action:'counted',note:'original count'}];data.definitionHistory=[{at:source.importedAt,by:'owner',reason:'old correction',before:{title:'original'}}];
 await db.prepare("INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) VALUES('legacy','a','fooditem','owner','BOH',3,?,?)").bind(JSON.stringify(data),source.importedAt).run();
 await migrate('0017_shared_workspace.sql');
 const saved=JSON.parse((await db.prepare("SELECT data FROM food_records WHERE id='legacy'").first()).data);assert.deepEqual(saved.count,count);assert.deepEqual(saved.history,[]);assert.deepEqual(saved.countHistory,[]);
 const history=JSON.parse((await db.prepare("SELECT event FROM food_history WHERE record_id='legacy'").first()).event);assert.deepEqual(history.history,data.history);assert.deepEqual(history.legacy.countHistory,data.countHistory);assert.deepEqual(history.legacy.definitionHistory,data.definitionHistory);
 assert.deepEqual(JSON.parse((await db.prepare("SELECT data FROM records WHERE id='legacy'").first()).data),data);
 const daily=await handleWorkspace(new Request('https://test.example/api/workspace?locationId=a',{headers:{'oai-authenticated-user-id':'owner-identity','oai-authenticated-user-email':'owner@example.test'}}),db);assert.equal(daily.status,200);assert.equal((await daily.json()).records.length,0);
});
