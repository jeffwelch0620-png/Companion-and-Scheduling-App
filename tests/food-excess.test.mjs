import test from 'node:test';import assert from 'node:assert/strict';
import {excessFixture,rawItem,importInput,invoiceInput,receivingInput,excessInput} from './food-excess-fixture.mjs';
import {parseExcess} from '../.sites-runtime/shared/food-excess.mjs';
import {parseFoodItem} from '../.sites-runtime/shared/food.mjs';
import {parseInvoiceLine} from '../.sites-runtime/shared/food-invoice.mjs';
import {handleFood} from '../.sites-runtime/shared/food-service.mjs';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data};
async function setup(t,receive=true){const f=await excessFixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),invoice=ok(await f.call('buyer','fooditem.invoice',invoiceInput,base)),receipt=receive?ok(await f.call('manager','fooditem.receive',receivingInput(invoice.revision),invoice)):invoice;return {...f,base,invoice,receipt}}
const history=async f=>ok(await f.get('owner',{view:'history',recordId:f.base.recordId})).entries;
test('extra goods require positive original-unit quantities, dated evidence and explicit same-item confirmation',()=>{
 const at='2026-09-29T01:00:00Z',item=parseFoodItem(rawItem,{dataset:'demo',sourceRestaurantId:'demo_diner',label:'Fixture',importedAt:at,importedBy:'owner'}),invoice=parseInvoiceLine(invoiceInput,item,at,'buyer','America/New_York'),used={entries:1,accepted:70,rejected:10};
 const extra=parseExcess({...excessInput(2),invoice:{},by:'fake',supplierPacks:999},invoice,used,at,'manager','America/New_York');assert.equal(extra.supplierPacks,.125);assert.equal(extra.by,'manager');invoice.sku.packCount=99;used.accepted=0;assert.equal(extra.invoice.sku.packCount,8);assert.equal(extra.receivingAtEntry.accepted,70);
 for(const change of [{invoiceRevision:0},{quantity:0},{quantity:-1},{quantity:''},{quantity:null},{quantity:true},{quantity:Infinity},{quantity:1000001},{invoiceUnit:'case'},{invoiceUnit:null},{confirmed:false},{evidence:''},{goodsLocation:''},{deliveryReference:''},{observedDate:'2026-09-29'},{observedDate:'2026-02-30'}])assert.throws(()=>parseExcess({...excessInput(2),...change},extra.invoice,extra.receivingAtEntry,at,'manager','America/New_York'));
 assert.throws(()=>parseExcess(excessInput(2),extra.invoice,{entries:1,accepted:69,rejected:10},at,'manager','America/New_York'),/Complete/);
 assert.equal(parseExcess({...excessInput(2),invoiceUnit:'lbs'},extra.invoice,extra.receivingAtEntry,at,'manager','America/New_York').invoiceUnit,'lb');
});
test('extra observations preserve original pack, invoice receiving, stock, price, credits and daily payload',async t=>{
 const f=await setup(t),daily=async()=>await (await handleWorkspace(new Request('https://test.example/api/workspace?locationId=a',{headers:f.headers('owner')}),f.db)).text(),beforeDaily=await daily();
 const configured=ok(await f.call('buyer','fooditem.configure',{item:{...rawItem,vendorSkus:rawItem.vendorSkus.map(s=>({...s,packCount:4}))},reason:'Current catalog pack correction'},f.receipt)),before=ok(await f.view('owner')).records[0];
 ok(await f.call('manager','fooditem.excess',{...excessInput(2),invoice:{},by:'fake'},configured));const after=ok(await f.view('owner')).records[0];assert.deepEqual(after.data,before.data);assert.equal(await daily(),beforeDaily);
 const entries=await history(f),invoice=entries.find(e=>e.revision===2),extra=entries.at(-1).event.excess;assert.equal(extra.invoice.sku.packCount,8);assert.equal(extra.by,'manager');assert.deepEqual(invoice.invoiceReceiving,{entries:1,accepted:70,rejected:10});assert.deepEqual(invoice.invoiceExcess,{entries:1,quantity:5});assert.deepEqual(invoice.invoiceCredits,{entries:0,quantity:0,amountCents:0});
});
test('invoice completion and original source guards prevent orphan observations and duplicate references',async t=>{
 const f=await setup(t,false);assert.equal((await f.call('manager','fooditem.excess',excessInput(2),f.invoice)).status,409);
 const partial=ok(await f.call('manager','fooditem.receive',{...receivingInput(2),accepted:69},f.invoice));assert.equal((await f.call('manager','fooditem.excess',excessInput(2),partial)).status,409);
 const complete=ok(await f.call('manager','fooditem.receive',{...receivingInput(2),deliveryReference:'REMAINDER',accepted:1,rejected:0},partial)),saved=ok(await f.call('manager','fooditem.excess',{...excessInput(2),deliveryReference:' Extra  Ticket '},complete));
 assert.equal((await f.call('buyer','fooditem.excess',{...excessInput(2),deliveryReference:'extra ticket'},saved)).status,409);
 for(const action of ['fooditem.invoice-void','fooditem.receive-void'])assert.equal((await f.call('owner',action,{invoiceRevision:2,receivingRevision:3,reason:'Source correction'},saved)).status,409);
 assert.equal((await f.call('owner','fooditem.excess',excessInput(999),saved)).status,404);
});
test('reasoned voids retain original facts, permit replacement and unblock source corrections',async t=>{
 const f=await setup(t),saved=ok(await f.call('buyer','fooditem.excess',excessInput(2),f.receipt));assert.equal((await f.call('manager','fooditem.excess-void',{excessRevision:4,reason:'Not recorder'},saved)).status,403);
 assert.equal((await f.call('owner','fooditem.excess-void',{excessRevision:4,reason:''},saved)).status,400);
 const voided=ok(await f.call('owner','fooditem.excess-void',{excessRevision:4,reason:'Wrong amount'},saved));assert.equal((await f.call('owner','fooditem.excess-void',{excessRevision:4,reason:'Twice'},voided)).status,409);
 let entries=await history(f);assert.equal(entries.find(e=>e.revision===4).event.excess.quantity,5);assert.equal(entries.find(e=>e.revision===4).excessVoided.reason,'Wrong amount');assert.deepEqual(entries.find(e=>e.revision===2).invoiceExcess,{entries:0,quantity:0});
 const replacement=ok(await f.call('manager','fooditem.excess',{...excessInput(2),quantity:2},voided)),again=ok(await f.call('manager','fooditem.excess-void',{excessRevision:replacement.revision,reason:'Wrong invoice'},replacement)),source=ok(await f.call('owner','fooditem.receive-void',{receivingRevision:3,reason:'Incorrect receipt'},again)),invoiceVoid=ok(await f.call('owner','fooditem.invoice-void',{invoiceRevision:2,reason:'Incorrect invoice'},source));
 assert.equal((await f.call('manager','fooditem.excess',excessInput(2),invoiceVoid)).status,409);
});
test('restaurant, role, item, dataset and current membership isolate extra delivery evidence',async t=>{
 const f=await setup(t);for(const actor of ['foreign','worker','foh']){assert.equal((await f.call(actor,'fooditem.excess',excessInput(2),f.receipt)).status,403);assert.equal((await f.get(actor,{view:'receiving',filter:'excess'})).status,403)}
 const other=ok(await f.call('owner','fooditem.import',importInput([{...rawItem,controlNumber:'OTHER'}])));assert.equal((await f.call('manager','fooditem.excess',excessInput(2),other)).status,404);
 assert.equal((await f.get('owner',{view:'history',recordId:f.base.recordId,dataset:'operating'})).status,404);assert.equal(ok(await f.get('owner',{view:'receiving',filter:'excess',dataset:'operating'})).total,0);
 await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='manager'").run();assert.equal((await f.call('manager','fooditem.excess',excessInput(2),f.receipt)).status,403);ok(await f.call('buyer','fooditem.excess',excessInput(2),f.receipt));
});
test('whole-history extra totals, off-page correction and receiving filter never consume invoice quantities',async t=>{
 const f=await setup(t);let current=f.receipt;for(let n=0;n<24;n++)current=ok(await f.call('manager','fooditem.excess',{...excessInput(2),deliveryReference:'EXTRA-'+n,quantity:1},current));
 let entries=await history(f);assert.equal(entries.length,20);assert.deepEqual(entries.find(e=>e.revision===2).invoiceExcess,{entries:24,quantity:24});
 current=ok(await f.call('owner','fooditem.excess-void',{excessRevision:4,reason:'Off page correction'},current));entries=await history(f);assert.equal(entries.find(e=>e.revision===4).excessVoided.revision,current.revision);assert.deepEqual(entries.find(e=>e.revision===2).invoiceExcess,{entries:23,quantity:23});
 const queue=ok(await f.get('owner',{view:'receiving',filter:'excess',q:'demo-100'}));assert.equal(queue.total,1);assert.equal(queue.totals.excess,1);assert.equal(queue.entries[0].extraQuantity,23);assert.equal(queue.entries[0].remaining,0);assert.equal(queue.entries[0].accepted,70);assert.equal(queue.entries[0].rejected,10);assert.equal(ok(await f.get('owner',{view:'receiving',filter:'pending'})).total,0);
 assert.equal((await f.get('owner',{view:'receiving',filter:'excess',before:'99',revision:String(queue.revision-1)})).status,409);
});
test('failed save and void transactions roll back and exact retries create one retained event',async t=>{
 const f=await setup(t);let current=f.receipt;
 for(const [action,input] of [['fooditem.excess',excessInput(2)],['fooditem.excess-void',{excessRevision:4,reason:'Correction'}]]){
  const requestId=crypto.randomUUID(),before=ok(await f.view('owner')).records[0],rev=ok(await f.get('owner')).revision,audit=(await f.db.prepare('SELECT count(*) n FROM audit_events').first()).n;
  await f.db.prepare("CREATE TRIGGER reject_extra BEFORE INSERT ON food_history BEGIN SELECT RAISE(ABORT,'fixture failure'); END").run();assert.equal((await f.call('manager',action,input,current,{requestId})).status,503);assert.deepEqual(ok(await f.view('owner')).records[0],before);assert.equal(ok(await f.get('owner')).revision,rev);assert.equal((await f.db.prepare('SELECT count(*) n FROM audit_events').first()).n,audit);assert.equal((await f.db.prepare('SELECT count(*) n FROM food_receipts WHERE request_id=?').bind(requestId).first()).n,0);
  await f.db.prepare('DROP TRIGGER reject_extra').run();const saved=ok(await f.call('manager',action,input,current,{requestId}));assert.deepEqual(ok(await f.call('manager',action,input,current,{requestId})),saved);assert.equal((await f.call('manager',action,{...input,evidence:'Changed'},current,{requestId})).status,409);current=saved;
 }
 assert.equal((await history(f)).length,5);
});
test('concurrent extra observations and receipt corrections cannot orphan source evidence',async t=>{
 const f=await setup(t),race=await Promise.all([f.call('manager','fooditem.excess',excessInput(2),f.receipt),f.call('owner','fooditem.receive-void',{receivingRevision:3,reason:'Correct source'},f.receipt)]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);assert.equal((await history(f)).filter(e=>e.event.excess||e.event.receivingVoid).length,1);
 const g=await setup(t),dupes=await Promise.all(['manager','buyer'].map(actor=>g.call(actor,'fooditem.excess',excessInput(2),g.receipt)));assert.deepEqual(dupes.map(r=>r.status).sort(),[200,409]);
});
test('delivery queue withholds data if reader authority is revoked during its storage read',async t=>{
 const f=await setup(t);ok(await f.call('manager','fooditem.excess',excessInput(2),f.receipt));let changed=false;
 const wrapped={withSession:()=>wrapped,prepare:sql=>f.db.prepare(sql),batch:async statements=>{const result=await f.db.batch(statements);if(!changed&&result.length===3&&result[0].results[0]?.active!==undefined){changed=true;await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='manager'").run()}return result}};
 const response=await handleFood(new Request('https://test.example/api/food?locationId=a&dataset=demo&view=receiving&filter=excess',{headers:f.headers('manager')}),wrapped);assert.equal(changed,true);assert.equal(response.status,403);assert.doesNotMatch(await response.text(),/Fictional counted/);
});
