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


import {parseSupplierReturn} from '../.sites-runtime/shared/food-return.mjs';
const returnInput=receivingRevision=>({receivingRevision,returnReference:'RETURN-1',returnDate:'2026-09-28',accepted:5,rejected:10,reason:'Fictional damaged goods',evidence:'Fictional signed pickup ticket 1',confirmed:true});
async function setup(t){const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),invoice=ok(await f.call('buyer','fooditem.invoice',invoiceInput,base)),receipt=ok(await f.call('manager','fooditem.receive',receivingInput(invoice.revision),invoice));return {...f,base,invoice,receipt};}
const history=async f=>ok(await f.get('owner',{view:'history',recordId:f.base.recordId})).entries;
test('actual returns require dated evidence and separate accepted/rejected limits; snapshots are server owned',()=>{
 const at='2026-09-29T01:00:00Z',item=parseFoodItem(rawItem,source),invoice=parseInvoiceLine(invoiceInput,item,at,'buyer','America/New_York'),receipt=parseReceiving(receivingInput(2),invoice,{entries:0,accepted:0,rejected:0},at,'manager','America/New_York'),empty={entries:0,accepted:0,rejected:0};
 const r=parseSupplierReturn({...returnInput(3),by:'forged',receiving:{},acceptedSupplierPacks:999},receipt,empty,at,'manager','America/New_York');assert.equal(r.by,'manager');assert.equal(r.acceptedSupplierPacks,.125);assert.equal(r.rejectedSupplierPacks,.25);receipt.invoice.sku.packCount=99;assert.equal(r.receiving.invoice.sku.packCount,8);
 for(const change of [{receivingRevision:0},{accepted:''},{accepted:-1},{accepted:Infinity},{rejected:null},{accepted:0,rejected:0},{accepted:31},{rejected:11},{returnDate:'2026-09-27'},{returnDate:'2026-09-29'},{returnDate:'2026-02-30'},{returnReference:''},{reason:''},{evidence:''},{confirmed:false}])assert.throws(()=>parseSupplierReturn({...returnInput(3),...change},receipt,empty,at,'manager','America/New_York'));
 assert.throws(()=>parseSupplierReturn(returnInput(3),receipt,{entries:1,accepted:26,rejected:0},at,'manager','America/New_York'));
 assert.throws(()=>parseSupplierReturn(returnInput(3),receipt,{entries:1,accepted:0,rejected:1},at,'manager','America/New_York'));
});
test('return saves preserve physical count, current prices, credits, original receiving and daily workspace payload',async t=>{
 const f=await setup(t),before=ok(await f.view('owner')).records[0];
 const daily=async()=>{const r=await handleWorkspace(new Request('https://test.example/api/workspace?locationId=a',{headers:f.headers('owner')}),f.db);assert.equal(r.status,200);return r.text()};const dailyBefore=await daily();
 const changed=ok(await f.call('buyer','fooditem.configure',{item:{...rawItem,vendorSkus:rawItem.vendorSkus.map(s=>({...s,packCount:4}))},reason:'Current catalog changed'},f.receipt));
 const configured=ok(await f.view('owner')).records[0];ok(await f.call('manager','fooditem.return',{...returnInput(f.receipt.revision),by:'owner',receiving:{}},changed));
 const after=ok(await f.view('owner')).records[0];assert.deepEqual(after.data,configured.data);assert.equal(after.data.count,before.data.count);assert.equal(await daily(),dailyBefore);
 const entries=await history(f),returned=entries.at(-1).event.supplierReturn;assert.equal(returned.receiving.invoice.sku.packCount,8);assert.equal(returned.by,'manager');
 assert.deepEqual(entries.find(e=>e.revision===f.invoice.revision).invoiceReceiving,{entries:1,accepted:30,rejected:10});assert.deepEqual(entries.find(e=>e.revision===f.invoice.revision).invoiceCredits,{entries:0,amountCents:0,quantity:0});assert.deepEqual(entries.find(e=>e.revision===f.receipt.revision).receivingReturns,{entries:1,accepted:5,rejected:10});
});
test('duplicate references and category overreturns cannot silently replace real receiving',async t=>{
 const f=await setup(t),one=ok(await f.call('manager','fooditem.return',{...returnInput(3),returnReference:' RETURN  A ',accepted:4,rejected:2},f.receipt));
 assert.equal((await f.call('buyer','fooditem.return',{...returnInput(3),returnReference:'return a',accepted:1,rejected:0},one)).status,409);
 assert.equal((await f.call('manager','fooditem.return',{...returnInput(3),accepted:27,rejected:0},one)).status,409);
 assert.equal((await f.call('manager','fooditem.return',{...returnInput(3),accepted:0,rejected:9},one)).status,409);
 const all=ok(await f.call('buyer','fooditem.return',{...returnInput(3),accepted:26,rejected:8},one));
 assert.equal((await f.call('owner','fooditem.return',{...returnInput(3),returnReference:'THIRD',accepted:.01,rejected:0},all)).status,409);
 assert.equal((await f.call('owner','fooditem.receive-void',{receivingRevision:3,reason:'Would erase source'},all)).status,409);
 assert.equal((await f.call('owner','fooditem.invoice-void',{invoiceRevision:2,reason:'Would erase invoice'},all)).status,409);
});
test('void corrections retain evidence, reopen only their quantities, and protect source chain',async t=>{
 const f=await setup(t),saved=ok(await f.call('buyer','fooditem.return',returnInput(3),f.receipt));
 assert.equal((await f.call('manager','fooditem.return-void',{returnRevision:saved.revision,reason:'Not my entry'},saved)).status,403);
 const voided=ok(await f.call('owner','fooditem.return-void',{returnRevision:saved.revision,reason:'Wrong pickup ticket'},saved));
 assert.equal((await f.call('owner','fooditem.return-void',{returnRevision:saved.revision,reason:'Repeated'},voided)).status,409);
 let entries=await history(f);assert.equal(entries.find(e=>e.revision===saved.revision).event.supplierReturn.evidence,'Fictional signed pickup ticket 1');assert.equal(entries.find(e=>e.revision===saved.revision).supplierReturnVoided.reason,'Wrong pickup ticket');assert.deepEqual(entries.find(e=>e.revision===3).receivingReturns,{entries:0,accepted:0,rejected:0});
 const resaved=ok(await f.call('manager','fooditem.return',returnInput(3),voided)),revoided=ok(await f.call('manager','fooditem.return-void',{returnRevision:resaved.revision,reason:'Corrected wrong source'},resaved));
 const sourceVoided=ok(await f.call('buyer','fooditem.receive-void',{receivingRevision:3,reason:'Incorrect delivery source'},revoided));
 assert.equal((await f.call('manager','fooditem.return',returnInput(3),sourceVoided)).status,409);
 ok(await f.call('owner','fooditem.invoice-void',{invoiceRevision:2,reason:'Invalid invoice source'},sourceVoided));
});
test('return access is restaurant, item and dataset scoped and obeys current revocation',async t=>{
 const f=await setup(t);
 for(const actor of ['foreign','worker','foh'])assert.equal((await f.call(actor,'fooditem.return',returnInput(3),f.receipt)).status,403);
 for(const rev of [1,2,999])assert.equal((await f.call('manager','fooditem.return',returnInput(rev),f.receipt)).status,404);
 const other=ok(await f.call('owner','fooditem.import',importInput([{...rawItem,controlNumber:'OTHER'}])));assert.equal((await f.call('manager','fooditem.return',returnInput(3),other)).status,404);
 assert.equal((await f.get('owner',{view:'history',recordId:f.base.recordId,dataset:'operating'})).status,404);
 await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='manager'").run();assert.equal((await f.call('manager','fooditem.return',returnInput(3),f.receipt)).status,403);
 ok(await f.call('buyer','fooditem.return',returnInput(3),f.receipt));
});
test('return totals and corrections resolve beyond visible history pages',async t=>{
 const f=await setup(t);let current=ok(await f.call('manager','fooditem.return',{...returnInput(3),accepted:1,rejected:0},f.receipt));const firstReturn=current;
 for(let n=0;n<23;n++)current=ok(await f.call('manager','fooditem.return',{...returnInput(3),returnReference:'LATER-'+n,accepted:1,rejected:0},current));
 let page=ok(await f.get('owner',{view:'history',recordId:f.base.recordId}));assert.equal(page.entries.length,20);assert.ok(page.next);assert.deepEqual(page.entries.find(e=>e.revision===3).receivingReturns,{entries:24,accepted:24,rejected:0});
 current=ok(await f.call('owner','fooditem.return-void',{returnRevision:firstReturn.revision,reason:'Off-page correction'},current));
 page=ok(await f.get('owner',{view:'history',recordId:f.base.recordId}));assert.equal(page.entries.find(e=>e.revision===firstReturn.revision).supplierReturnVoided.revision,current.revision);assert.deepEqual(page.entries.find(e=>e.revision===3).receivingReturns,{entries:23,accepted:23,rejected:0});
 assert.equal((await f.call('manager','fooditem.return',{...returnInput(3),returnReference:'TOO-MUCH',accepted:8,rejected:0},current)).status,409);
});
test('failed return and correction transactions roll back every write and exact retries save once',async t=>{
 const f=await setup(t);let current=f.receipt;
 for(const [action,input] of [['fooditem.return',returnInput(3)],['fooditem.return-void',{returnRevision:4,reason:'Wrong reference'}]]){
  const requestId=crypto.randomUUID(),before=ok(await f.view('owner')).records[0],foodRevision=ok(await f.get('owner')).revision,audit=(await f.db.prepare('SELECT count(*) AS n FROM audit_events').first()).n;
  await f.db.prepare("CREATE TRIGGER reject_return_test BEFORE INSERT ON food_history BEGIN SELECT RAISE(ABORT,'test failure'); END").run();
  assert.equal((await f.call('manager',action,input,current,{requestId})).status,503);assert.deepEqual(ok(await f.view('owner')).records[0],before);assert.equal(ok(await f.get('owner')).revision,foodRevision);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM audit_events').first()).n,audit);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM food_receipts WHERE request_id=?').bind(requestId).first()).n,0);
  await f.db.prepare('DROP TRIGGER reject_return_test').run();const saved=ok(await f.call('manager',action,input,current,{requestId}));assert.deepEqual(ok(await f.call('manager',action,input,current,{requestId})),saved);assert.equal((await f.call('manager',action,{...input,reason:'Different'},current,{requestId})).status,409);current=saved;
 }
 assert.equal((await history(f)).length,5);
});
test('concurrent returns and source voids cannot overreturn or orphan evidence',async t=>{
 const f=await setup(t),input={...returnInput(3),accepted:30,rejected:10};
 const results=await Promise.all(['manager','buyer'].map((actor,n)=>f.call(actor,'fooditem.return',{...input,returnReference:'RACE-'+n},f.receipt)));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);const current=results.find(r=>r.status===200).data;
 assert.equal((await f.call('owner','fooditem.return',returnInput(3),f.receipt)).status,409);
 assert.equal((await f.call('owner','fooditem.receive-void',{receivingRevision:3,reason:'Invalid source removal'},current)).status,409);
 const second=await setup(t),races=await Promise.all([second.call('manager','fooditem.return',returnInput(3),second.receipt),second.call('owner','fooditem.receive-void',{receivingRevision:3,reason:'Race correction'},second.receipt)]);assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
 const entries=await history(second);assert.equal(entries.filter(e=>e.event.supplierReturn||e.event.receivingVoid).length,1);
});
