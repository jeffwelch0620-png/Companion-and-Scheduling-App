import test from 'node:test';import assert from 'node:assert/strict';
import {excessFixture,rawItem,importInput,invoiceInput,receivingInput,excessInput} from './food-excess-fixture.mjs';
import {parseExcessBilling,excessBillingIssue} from '../.sites-runtime/shared/food-excess-billing.mjs';
import {handleFood} from '../.sites-runtime/shared/food-service.mjs';
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data};
export const billingInput=(excessRevision=4,invoiceRevision=5,extra={})=>({excessRevision,invoiceRevision,quantity:2,note:'Fictional supplier invoice identifies extra delivery TICKET-1',confirmed:true,...extra});
export async function billingFixture(t,extraQuantity=5,billQuantity=4){const f=await excessFixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),original=ok(await f.call('buyer','fooditem.invoice',invoiceInput,base)),receipt=ok(await f.call('manager','fooditem.receive',receivingInput(2),original)),extra=ok(await f.call('manager','fooditem.excess',{...excessInput(2),quantity:extraQuantity},receipt)),bill=ok(await f.call('buyer','fooditem.invoice',{...invoiceInput,invoiceNumber:'BILL-EXTRA',quantity:billQuantity,lineTotal:'10.00'},extra));return {...f,base,original,receipt,extra,bill}}
const history=async f=>ok(await f.get('owner',{view:'history',recordId:f.base.recordId})).entries;
test('billing quantity validation retains trusted originals and rejects units, supplier, date, malformed and tiny overmatches',()=>{
 const invoice={dataset:'demo',quantity:5,invoiceUnit:'lb',unitBasis:'measure',invoiceDate:'2026-09-28',sku:{id:'sku1',vendor:'Demo',vendorSku:'ABC',purchaseUnit:'case',packCount:8,unitQty:5,unitUOM:'lb'}},extra={invoice,invoiceRevision:2,quantity:3,observedDate:'2026-09-28'},empty={entries:0,quantity:0},at='2026-09-29T12:00:00Z';
 const saved=parseExcessBilling({...billingInput(),by:'fake',invoice:{},excess:{}},extra,invoice,empty,empty,at,'buyer');invoice.sku.packCount=9;assert.equal(saved.invoice.sku.packCount,8);assert.equal(saved.by,'buyer');
 for(const change of [{quantity:true},{quantity:null},{quantity:''},{quantity:0},{quantity:-1},{quantity:Infinity},{quantity:1000001},{quantity:4},{excessRevision:0},{invoiceRevision:2},{note:''},{confirmed:false}])assert.throws(()=>parseExcessBilling(billingInput(4,5,change),extra,invoice,empty,empty,at,'buyer'));
 for(const change of [{dataset:'operating'},{invoiceDate:'2026-09-27'},{invoiceUnit:'case'},{unitBasis:'supplier-pack'},{sku:{...invoice.sku,id:'sku2'}},{sku:{...invoice.sku,vendor:'Other'}},{sku:{...invoice.sku,vendorSku:'Other'}}])assert.ok(excessBillingIssue(extra,{...invoice,...change},5));
 assert.throws(()=>parseExcessBilling(billingInput(4,5,{quantity:1e-16}),{...extra,quantity:1e-18},invoice,empty,empty,at,'buyer'));
 assert.throws(()=>parseExcessBilling(billingInput(),extra,invoice,empty,{entries:1,quantity:4},at,'buyer'));
 assert.equal(parseExcessBilling(billingInput(4,5,{quantity:.1}),{...extra,quantity:.3},invoice,{entries:1,quantity:.2},empty,at,'buyer').quantity,.1);
 const packs={...invoice,unitBasis:'supplier-pack',invoiceUnit:'case'};assert.ok(excessBillingIssue({...extra,invoice:packs},{...packs,sku:{...packs.sku,packCount:7}},5));
});
test('checked partial billing preserves quantities, prices, receiving and actual pickups while snapshots remain historical',async t=>{
 const f=await billingFixture(t),before=ok(await f.view('owner')).records[0].data;
 const match=ok(await f.call('buyer','fooditem.excess-billing',{...billingInput(),by:'owner'},f.bill));assert.deepEqual(ok(await f.view('owner')).records[0].data,before);
 const pickup=ok(await f.call('manager','fooditem.excess-return',{excessRevision:4,returnReference:'ACTUAL',returnDate:'2026-09-28',quantity:5,invoiceUnit:'lb',reason:'Fictional pickup',evidence:'Fictional handoff',confirmed:true},match));
 ok(await f.call('owner','fooditem.configure',{item:{...rawItem,vendorSkus:rawItem.vendorSkus.map(s=>({...s,packCount:4}))},reason:'Later catalog correction'},pickup));
 const e=await history(f);assert.equal(e.find(x=>x.revision===6).event.excessBilling.invoice.sku.packCount,8);assert.equal(e.find(x=>x.revision===6).event.excessBilling.by,'buyer');assert.deepEqual(e.find(x=>x.revision===4).excessBilled,{entries:1,quantity:2});assert.deepEqual(e.find(x=>x.revision===4).excessReturned,{entries:1,quantity:5});assert.deepEqual(e.find(x=>x.revision===5).invoiceExtraBilling,{entries:1,quantity:2});assert.deepEqual(e.find(x=>x.revision===5).invoiceReceiving,{entries:0,accepted:0,rejected:0});
});
test('billing caps both sides across observations, rejects duplicate pairs and allows corrected associations',async t=>{
 const f=await billingFixture(t);let current=ok(await f.call('buyer','fooditem.excess-billing',billingInput(),f.bill));
 assert.equal((await f.call('owner','fooditem.excess-billing',billingInput(4,5,{quantity:1}),current)).status,409);
 const extra=ok(await f.call('manager','fooditem.excess',{...excessInput(2),deliveryReference:'OTHER-EXTRA',quantity:3},current));assert.equal((await f.call('buyer','fooditem.excess-billing',billingInput(extra.revision,5,{quantity:3}),extra)).status,409);
 current=ok(await f.call('buyer','fooditem.excess-billing',billingInput(extra.revision,5),extra));assert.equal((await f.call('owner','fooditem.excess-billing',billingInput(4,5,{quantity:.1}),current)).status,409);
 const bill2=ok(await f.call('buyer','fooditem.invoice',{...invoiceInput,invoiceNumber:'BILL-2',quantity:4,lineTotal:'8.00'},current));assert.equal((await f.call('buyer','fooditem.excess-billing',billingInput(4,bill2.revision,{quantity:4}),bill2)).status,409);ok(await f.call('buyer','fooditem.excess-billing',billingInput(4,bill2.revision,{quantity:3}),bill2));
});
test('reasoned void retains original match and protects both invoice and extra source until corrected',async t=>{
 const f=await billingFixture(t),match=ok(await f.call('buyer','fooditem.excess-billing',billingInput(),f.bill));
 for(const [action,input] of [['fooditem.invoice-void',{invoiceRevision:5}],['fooditem.excess-void',{excessRevision:4}],['fooditem.invoice-void',{invoiceRevision:2}]])assert.equal((await f.call('owner',action,{...input,reason:'Incorrect source'},match)).status,409);
 assert.equal((await f.call('manager','fooditem.excess-billing-void',{matchRevision:6,reason:'Not permitted'},match)).status,403);
 assert.equal((await f.call('buyer','fooditem.excess-billing-void',{matchRevision:6,reason:''},match)).status,400);
 const voided=ok(await f.call('owner','fooditem.excess-billing-void',{matchRevision:6,reason:'Wrong association'},match));assert.equal((await f.call('buyer','fooditem.excess-billing-void',{matchRevision:6,reason:'Twice'},voided)).status,409);
 const e=await history(f);assert.equal(e.find(x=>x.revision===6).event.excessBilling.quantity,2);assert.equal(e.find(x=>x.revision===6).excessBillingVoided.reason,'Wrong association');assert.deepEqual(e.find(x=>x.revision===4).excessBilled,{entries:0,quantity:0});assert.deepEqual(e.find(x=>x.revision===5).invoiceExtraBilling,{entries:0,quantity:0});
 const corrected=ok(await f.call('buyer','fooditem.excess-billing',billingInput(4,5,{quantity:3}),voided));assert.equal(corrected.revision,8);
 const v=ok(await f.call('owner','fooditem.excess-billing-void',{matchRevision:8,reason:'Wrong document'},corrected)),invoice=ok(await f.call('owner','fooditem.invoice-void',{invoiceRevision:5,reason:'Wrong invoice'},v));assert.equal((await f.call('buyer','fooditem.excess-billing',billingInput(),invoice)).status,409);
});
test('restaurant, role, item, source type and dataset checks apply to billing writes and picker',async t=>{
 const f=await billingFixture(t);for(const actor of ['manager','foh','worker','foreign']){assert.equal((await f.call(actor,'fooditem.excess-billing',billingInput(),f.bill)).status,403);assert.equal((await f.get(actor,{view:'extra-billing',recordId:f.base.recordId,excessRevision:'4'})).status,403)}
 for(const [a,b] of [[2,5],[4,3],[999,5]])assert.equal((await f.call('buyer','fooditem.excess-billing',billingInput(a,b),f.bill)).status,404);
 const other=ok(await f.call('owner','fooditem.import',importInput([{...rawItem,controlNumber:'OTHER'}])));assert.equal((await f.call('buyer','fooditem.excess-billing',billingInput(),other)).status,404);
 assert.equal((await f.get('buyer',{view:'extra-billing',recordId:f.base.recordId,excessRevision:'4',dataset:'operating'})).status,404);
 await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='buyer'").run();assert.equal((await f.call('buyer','fooditem.excess-billing',billingInput(),f.bill)).status,403);
});
test('picker pages original documents, labels incompatible units and invalidates stale pages; off-page matches/voids affect totals',async t=>{
 const f=await billingFixture(t,30,30);let current=f.bill;for(let n=0;n<23;n++){current=ok(await f.call('buyer','fooditem.invoice',{...invoiceInput,invoiceNumber:'BILL-'+n,quantity:1,lineTotal:'1.00'},current));current=ok(await f.call('buyer','fooditem.excess-billing',billingInput(4,current.revision,{quantity:1}),current));}
 const bad=ok(await f.call('buyer','fooditem.invoice',{...invoiceInput,invoiceNumber:'CASE-INVOICE',quantity:1,unitBasis:'supplier-pack',invoiceUnit:'case',lineTotal:'1.00'},current));
 const page=ok(await f.get('buyer',{view:'extra-billing',recordId:f.base.recordId,excessRevision:'4'}));assert.equal(page.entries.length,20);assert.ok(page.next);assert.equal(page.matched,23);assert.match(page.entries[0].issue,/units/);assert.equal(page.entries[1].matched,1);
 const second=ok(await f.get('buyer',{view:'extra-billing',recordId:f.base.recordId,excessRevision:'4',before:String(page.next),revision:String(page.revision)}));assert.equal(second.entries.length,5);assert.equal(new Set([...page.entries,...second.entries].map(e=>e.sequence)).size,25);
 current=ok(await f.call('owner','fooditem.excess-billing-void',{matchRevision:7,reason:'First match incorrect'},bad));assert.equal((await f.get('buyer',{view:'extra-billing',recordId:f.base.recordId,excessRevision:'4',before:String(page.next),revision:String(page.revision)})).status,409);
 const e=await history(f);assert.deepEqual(e.find(x=>x.revision===4).excessBilled,{entries:22,quantity:22});assert.equal(e.find(x=>x.revision===7).excessBillingVoided.reason,'First match incorrect');
});
test('billing transaction failures roll back all records and exact request retry saves one match or void',async t=>{
 const f=await billingFixture(t);let current=f.bill;for(const [action,input] of [['fooditem.excess-billing',billingInput()],['fooditem.excess-billing-void',{matchRevision:6,reason:'Wrong association'}]]){
  const requestId=crypto.randomUUID(),before=ok(await f.view('owner')).records[0],revision=ok(await f.get('owner')).revision;
  await f.db.prepare("CREATE TRIGGER reject_billing BEFORE INSERT ON food_history BEGIN SELECT RAISE(ABORT,'fixture failure'); END").run();assert.equal((await f.call('buyer',action,input,current,{requestId})).status,503);assert.deepEqual(ok(await f.view('owner')).records[0],before);assert.equal(ok(await f.get('owner')).revision,revision);
  await f.db.prepare('DROP TRIGGER reject_billing').run();const saved=ok(await f.call('buyer',action,input,current,{requestId}));assert.deepEqual(ok(await f.call('buyer',action,input,current,{requestId})),saved);assert.equal((await f.call('buyer',action,{...input,note:'Different'},current,{requestId})).status,409);current=saved;
 }assert.equal((await history(f)).length,7);
});
test('concurrent billing matches and source corrections cannot commit against one stale revision',async t=>{
 const f=await billingFixture(t),race=await Promise.all(['owner','buyer'].map(actor=>f.call(actor,'fooditem.excess-billing',billingInput(4,5,{quantity:3}),f.bill)));assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
 const g=await billingFixture(t),source=await Promise.all([g.call('buyer','fooditem.excess-billing',billingInput(),g.bill),g.call('owner','fooditem.invoice-void',{invoiceRevision:5,reason:'Incorrect invoice'},g.bill)]);assert.deepEqual(source.map(r=>r.status).sort(),[200,409]);
});
test('access revoked immediately before commit blocks billing and leaves no association',async t=>{
 const f=await billingFixture(t);let revoked=false;const wrapper={withSession:()=>wrapper,prepare:sql=>f.db.prepare(sql),batch:async statements=>{if(!revoked&&statements.length>3){revoked=true;await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='buyer'").run()}return f.db.batch(statements)}};
 const response=await handleFood(new Request('https://test.example/api/food',{method:'POST',headers:{...f.headers('buyer'),Origin:'https://test.example','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),locationId:'a',recordId:f.base.recordId,expectedRevision:f.bill.revision,action:'fooditem.excess-billing',input:billingInput()})}),wrapper);assert.equal(revoked,true);assert.notEqual(response.status,200);assert.equal((await history(f)).filter(e=>e.event.excessBilling).length,0);
});
