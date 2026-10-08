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

import {parseReturnCredit} from '../.sites-runtime/shared/food-return-credit.mjs';
const matchInput=(returnRevision,creditRevision)=>({returnRevision,creditRevision,quantity:5,note:'Fictional credit document references the pickup ticket',confirmed:true});
async function ready(t){const f=await setup(t),returned=ok(await f.call('manager','fooditem.return',returnInput(3),f.receipt)),credit=ok(await f.call('buyer','fooditem.credit',creditInput(2),returned));return {...f,returned,credit};}
test('matching validates evidence and original invoice relationship; server owns document labels',()=>{
 const at='2026-09-29T12:00:00Z',invoice=parseInvoiceLine(invoiceInput,parseFoodItem(rawItem,source),at,'buyer','America/New_York'),receipt=parseReceiving(receivingInput(2),invoice,{entries:0,accepted:0,rejected:0},at,'manager','America/New_York'),returned=parseSupplierReturn(returnInput(3),receipt,{entries:0,accepted:0,rejected:0},at,'manager','America/New_York'),credit=parseCredit(creditInput(2),invoice,{entries:0,amountCents:0,quantity:0},at,'buyer','America/New_York'),empty={entries:0,quantity:0};
 const m=parseReturnCredit({...matchInput(4,5),creditNumber:'FORGED',by:'forged',invoiceUnit:'gallons'},returned,credit,empty,empty,at,'buyer');assert.equal(m.creditNumber,'CREDIT-1');assert.equal(m.invoiceUnit,'lb');assert.equal(m.by,'buyer');assert.equal('amountCents'in m,false);
 for(const change of [{quantity:0},{quantity:''},{quantity:-1},{quantity:NaN},{quantity:16},{returnRevision:0},{creditRevision:0},{note:''},{confirmed:false}])assert.throws(()=>parseReturnCredit({...matchInput(4,5),...change},returned,credit,empty,empty,at,'buyer'));
 for(const changed of [{...credit,reason:'price'},{...credit,reason:'shortage'},{...credit,invoiceRevision:99}])assert.throws(()=>parseReturnCredit(matchInput(4,5),returned,changed,empty,empty,at,'buyer'));
 assert.throws(()=>parseReturnCredit(matchInput(4,5),returned,credit,{entries:1,quantity:11},empty,at,'buyer'));assert.throws(()=>parseReturnCredit(matchInput(4,5),returned,credit,empty,{entries:1,quantity:16},at,'buyer'));
});
test('partial credit associations preserve original money, counts and physical return evidence',async t=>{
 const f=await ready(t),before=ok(await f.view('owner')).records[0];ok(await f.call('buyer','fooditem.return-credit',matchInput(f.returned.revision,f.credit.revision),f.credit));
 const after=ok(await f.view('owner')).records[0];assert.deepEqual(after.data,before.data);
 const entries=await history(f),match=entries.at(-1).event.returnCredit;assert.equal(match.quantity,5);assert.equal(match.creditNumber,'CREDIT-1');assert.deepEqual(entries.find(e=>e.revision===4).returnMatched,{entries:1,quantity:5});assert.deepEqual(entries.find(e=>e.revision===5).creditMatched,{entries:1,quantity:5});assert.equal(entries.find(e=>e.revision===5).event.invoiceCredit.amountCents,5000);assert.equal(entries.find(e=>e.revision===4).event.supplierReturn.accepted,5);
 const choices=ok(await f.get('buyer',{view:'return-credits',recordId:f.base.recordId,returnRevision:'4'}));assert.equal(choices.returnQuantity,15);assert.equal(choices.matchedQuantity,5);assert.equal(choices.entries[0].matched,5);assert.equal(choices.entries[0].amountCents,5000);
});
test('matches cannot reuse either side beyond its quantity across multiple returns and credits',async t=>{
 const f=await ready(t);let current=ok(await f.call('buyer','fooditem.return-credit',{...matchInput(4,5),quantity:12},f.credit));
 const otherReturn=ok(await f.call('manager','fooditem.return',{...returnInput(3),returnReference:'R2',accepted:20,rejected:0},current));
 assert.equal((await f.call('buyer','fooditem.return-credit',{...matchInput(otherReturn.revision,5),quantity:9},otherReturn)).status,409);
 current=ok(await f.call('buyer','fooditem.return-credit',{...matchInput(otherReturn.revision,5),quantity:8},otherReturn));
 const credit2=ok(await f.call('buyer','fooditem.credit',{...creditInput(2),creditNumber:'C2'},current));
 assert.equal((await f.call('buyer','fooditem.return-credit',{...matchInput(4,credit2.revision),quantity:4},credit2)).status,409);
 current=ok(await f.call('buyer','fooditem.return-credit',{...matchInput(4,credit2.revision),quantity:3},credit2));
 assert.equal((await f.call('buyer','fooditem.return-credit',{...matchInput(4,5),quantity:1},current)).status,409);
});
test('voided associations retain source evidence and prevent orphaned returns and credits until corrected',async t=>{
 const f=await ready(t),m=ok(await f.call('buyer','fooditem.return-credit',matchInput(4,5),f.credit));
 for(const [action,input] of [['fooditem.return-void',{returnRevision:4,reason:'Would orphan'}],['fooditem.credit-void',{creditRevision:5,reason:'Would orphan'}]])assert.equal((await f.call('owner',action,input,m)).status,409);
 const v=ok(await f.call('owner','fooditem.return-credit-void',{matchRevision:m.revision,reason:'Wrong credit reference'},m));assert.equal((await f.call('buyer','fooditem.return-credit-void',{matchRevision:m.revision,reason:'Repeated'},v)).status,409);
 let entries=await history(f);assert.equal(entries.find(e=>e.revision===m.revision).returnCreditVoided.reason,'Wrong credit reference');assert.equal(entries.find(e=>e.revision===m.revision).event.returnCredit.note,matchInput(4,5).note);assert.deepEqual(entries.find(e=>e.revision===4).returnMatched,{entries:0,quantity:0});
 const replacement=ok(await f.call('buyer','fooditem.return-credit',matchInput(4,5),v)),removed=ok(await f.call('buyer','fooditem.return-credit-void',{matchRevision:replacement.revision,reason:'Correct original association'},replacement)),creditVoid=ok(await f.call('buyer','fooditem.credit-void',{creditRevision:5,reason:'Invalid credit'},removed));
 assert.equal((await f.call('buyer','fooditem.return-credit',matchInput(4,5),creditVoid)).status,409);assert.equal(ok(await f.get('buyer',{view:'return-credits',recordId:f.base.recordId,returnRevision:'4'})).entries.length,0);
 const returnVoid=ok(await f.call('owner','fooditem.return-void',{returnRevision:4,reason:'Invalid pickup'},creditVoid));assert.equal((await f.get('buyer',{view:'return-credits',recordId:f.base.recordId,returnRevision:'4'})).status,409);assert.equal((await f.call('buyer','fooditem.return-credit',matchInput(4,5),returnVoid)).status,409);
});
test('matching is purchasing-only, rejects wrong item/invoice and respects membership revocation',async t=>{
 const f=await ready(t);for(const actor of ['manager','worker','foh','foreign'])assert.equal((await f.call(actor,'fooditem.return-credit',matchInput(4,5),f.credit)).status,403);
 for(const actor of ['worker','foh','foreign'])assert.equal((await f.get(actor,{view:'return-credits',recordId:f.base.recordId,returnRevision:'4'})).status,403);
 assert.equal((await f.get('buyer',{view:'return-credits',recordId:f.base.recordId,returnRevision:'4',dataset:'operating'})).status,404);
 const another=ok(await f.call('owner','fooditem.import',importInput([{...rawItem,controlNumber:'ANOTHER'}])));assert.equal((await f.call('buyer','fooditem.return-credit',matchInput(4,5),another)).status,404);
 const secondInvoice=ok(await f.call('buyer','fooditem.invoice',{...invoiceInput,invoiceNumber:'SECOND'},f.credit)),secondCredit=ok(await f.call('buyer','fooditem.credit',{...creditInput(secondInvoice.revision),creditNumber:'SECOND-CREDIT'},secondInvoice));assert.equal((await f.call('buyer','fooditem.return-credit',matchInput(4,secondCredit.revision),secondCredit)).status,400);
 await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='buyer'").run();assert.equal((await f.call('buyer','fooditem.return-credit',matchInput(4,5),secondCredit)).status,403);ok(await f.call('owner','fooditem.return-credit',matchInput(4,5),secondCredit));
});
test('eligible credit pages are bounded, exclude other credit reasons and reject stale continuation',async t=>{
 const f=await setup(t),returned=ok(await f.call('manager','fooditem.return',returnInput(3),f.receipt));let current=returned;
 for(let n=0;n<24;n++)current=ok(await f.call('buyer','fooditem.credit',{...creditInput(2),creditNumber:'PAGED-'+n,quantity:1,amount:'1.00'},current));
 current=ok(await f.call('buyer','fooditem.credit',{...creditInput(2),creditNumber:'SHORT',reason:'shortage',quantity:1,amount:'1.00'},current));current=ok(await f.call('buyer','fooditem.credit',{...creditInput(2),creditNumber:'PRICE',reason:'price',quantity:0,amount:'1.00'},current));
 const params={view:'return-credits',recordId:f.base.recordId,returnRevision:String(returned.revision)},first=ok(await f.get('buyer',params));assert.equal(first.entries.length,20);assert.ok(first.next);assert.equal(first.entries.some(c=>['SHORT','PRICE'].includes(c.creditNumber)),false);
 const last=ok(await f.get('buyer',{...params,before:String(first.next),revision:String(first.revision)}));assert.equal(last.entries.length,4);assert.equal(last.next,null);assert.equal(new Set([...first.entries,...last.entries].map(c=>c.revision)).size,24);
 assert.equal((await f.get('buyer',{...params,before:String(first.next)})).status,409);
 ok(await f.call('buyer','fooditem.return-credit',{...matchInput(returned.revision,first.entries[0].revision),quantity:1},current));assert.equal((await f.get('buyer',{...params,before:String(first.next),revision:String(first.revision)})).status,409);
});
test('matching totals and void markers include changes beyond the visible history page',async t=>{
 const f=await setup(t);let current=ok(await f.call('manager','fooditem.return',{...returnInput(3),accepted:30,rejected:10},f.receipt));const returned=current;const credits=[];
 for(let n=0;n<23;n++){current=ok(await f.call('buyer','fooditem.credit',{...creditInput(2),creditNumber:'HISTORY-'+n,quantity:1,amount:'1.00'},current));credits.push(current);current=ok(await f.call('buyer','fooditem.return-credit',{...matchInput(returned.revision,current.revision),quantity:1},current));}
 let entries=await history(f);assert.equal(entries.length,20);assert.deepEqual(entries.find(e=>e.revision===4).returnMatched,{entries:23,quantity:23});assert.deepEqual(entries.find(e=>e.revision===5).creditMatched,{entries:1,quantity:1});
 const v=ok(await f.call('owner','fooditem.return-credit-void',{matchRevision:6,reason:'Off-page correction'},current));entries=await history(f);assert.equal(entries.find(e=>e.revision===6).returnCreditVoided.revision,v.revision);assert.deepEqual(entries.find(e=>e.revision===4).returnMatched,{entries:22,quantity:22});assert.deepEqual(entries.find(e=>e.revision===5).creditMatched,{entries:0,quantity:0});
});
test('matching and void are atomic, exact retry is safe, concurrent matches and source voids have one winner',async t=>{
 const f=await ready(t);let current=f.credit;
 for(const [action,input] of [['fooditem.return-credit',matchInput(4,5)],['fooditem.return-credit-void',{matchRevision:6,reason:'Test correction'}]]){
  const requestId=crypto.randomUUID(),before=ok(await f.view('owner')).records[0],revision=ok(await f.get('owner')).revision,audit=(await f.db.prepare('SELECT count(*) AS n FROM audit_events').first()).n;
  await f.db.prepare("CREATE TRIGGER reject_match_test BEFORE INSERT ON food_history BEGIN SELECT RAISE(ABORT,'test failure'); END").run();assert.equal((await f.call('buyer',action,input,current,{requestId})).status,503);assert.deepEqual(ok(await f.view('owner')).records[0],before);assert.equal(ok(await f.get('owner')).revision,revision);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM audit_events').first()).n,audit);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM food_receipts WHERE request_id=?').bind(requestId).first()).n,0);
  await f.db.prepare('DROP TRIGGER reject_match_test').run();const saved=ok(await f.call('buyer',action,input,current,{requestId}));assert.deepEqual(ok(await f.call('buyer',action,input,current,{requestId})),saved);current=saved;
 }
 const races=await Promise.all(['buyer','owner'].map(actor=>f.call(actor,'fooditem.return-credit',{...matchInput(4,5),quantity:15},current)));assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
 const g=await ready(t),sourceRace=await Promise.all([g.call('buyer','fooditem.return-credit',matchInput(4,5),g.credit),g.call('owner','fooditem.credit-void',{creditRevision:5,reason:'Race source correction'},g.credit)]);assert.deepEqual(sourceRace.map(r=>r.status).sort(),[200,409]);
});
