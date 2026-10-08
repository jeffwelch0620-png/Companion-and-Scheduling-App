import test from 'node:test';import assert from 'node:assert/strict';
import {excessFixture,rawItem,importInput,invoiceInput,receivingInput,excessInput} from './food-excess-fixture.mjs';
import {parseExcessReturn} from '../.sites-runtime/shared/food-excess-return.mjs';
import {handleFood} from '../.sites-runtime/shared/food-service.mjs';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data};
const pickup=(excessRevision,extra={})=>({excessRevision,returnReference:'PICKUP-1',returnDate:'2026-09-28',quantity:2,invoiceUnit:'lb',reason:'Fictional overdelivery collected',evidence:'Fictional signed pickup ticket',confirmed:true,...extra});
async function setup(t,quantity=5){const f=await excessFixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),invoice=ok(await f.call('buyer','fooditem.invoice',invoiceInput,base)),receipt=ok(await f.call('manager','fooditem.receive',receivingInput(2),invoice)),extra=ok(await f.call('manager','fooditem.excess',{...excessInput(2),quantity},receipt));return {...f,base,invoice,receipt,extra}}
const history=async f=>ok(await f.get('owner',{view:'history',recordId:f.base.recordId})).entries;
test('pickup validation uses actual dates, original units, separate positive quantities and explicit physical-return evidence',()=>{
 const source={invoice:{quantity:80,supplierPackQuantity:2,invoiceUnit:'lb',sku:{packCount:8}},quantity:5,observedDate:'2026-09-28',invoiceRevision:2,deliveryReference:'EXTRA'},empty={entries:0,quantity:0},at='2026-09-29T01:00:00Z';
 const parsed=parseExcessReturn({...pickup(4),by:'forged',excess:{},supplierPacks:999},source,empty,at,'manager','America/New_York');assert.equal(parsed.by,'manager');assert.equal(parsed.supplierPacks,.05);source.invoice.sku.packCount=99;assert.equal(parsed.excess.invoice.sku.packCount,8);
 for(const change of [{excessRevision:0},{quantity:0},{quantity:-1},{quantity:''},{quantity:true},{quantity:null},{quantity:Infinity},{quantity:1000001},{quantity:6},{invoiceUnit:'case'},{invoiceUnit:null},{reason:''},{evidence:''},{returnReference:''},{confirmed:false},{returnDate:'2026-09-27'},{returnDate:'2026-09-29'},{returnDate:'2026-02-30'}])assert.throws(()=>parseExcessReturn(pickup(4,change),source,empty,at,'manager','America/New_York'));
 assert.throws(()=>parseExcessReturn(pickup(4),source,{entries:1,quantity:4},at,'manager','America/New_York'));
 assert.throws(()=>parseExcessReturn(pickup(4,{quantity:1e-16}),{...source,quantity:1e-18},empty,at,'manager','America/New_York'));
 assert.equal(parseExcessReturn(pickup(4,{quantity:.1}),{...source,quantity:.3},{entries:1,quantity:.2},at,'manager','America/New_York').quantity,.1);
});
test('partial extra pickup preserves original packs, invoice/receiving, stock, credits, ordinary returns and daily payload',async t=>{
 const f=await setup(t),daily=async()=>await (await handleWorkspace(new Request('https://test.example/api/workspace?locationId=a',{headers:f.headers('owner')}),f.db)).text(),beforeDaily=await daily();
 const current=ok(await f.call('buyer','fooditem.configure',{item:{...rawItem,vendorSkus:rawItem.vendorSkus.map(s=>({...s,packCount:4}))},reason:'Current pack correction'},f.extra)),before=ok(await f.view('owner')).records[0];
 ok(await f.call('manager','fooditem.excess-return',{...pickup(4),by:'owner',excess:{}},current));assert.deepEqual(ok(await f.view('owner')).records[0].data,before.data);assert.equal(await daily(),beforeDaily);
 const entries=await history(f),invoice=entries.find(e=>e.revision===2),receipt=entries.find(e=>e.revision===3),extra=entries.find(e=>e.revision===4),saved=entries.at(-1).event.excessReturn;
 assert.equal(saved.excess.invoice.sku.packCount,8);assert.equal(saved.by,'manager');assert.deepEqual(extra.excessReturned,{entries:1,quantity:2});assert.deepEqual(invoice.invoiceExcess,{entries:1,quantity:5});assert.deepEqual(invoice.invoiceExcessReturns,{entries:1,quantity:2});assert.deepEqual(invoice.invoiceReceiving,{entries:1,accepted:70,rejected:10});assert.deepEqual(invoice.invoiceCredits,{entries:0,quantity:0,amountCents:0});assert.deepEqual(receipt.receivingReturns,{entries:0,accepted:0,rejected:0});
 const q=ok(await f.get('buyer',{view:'receiving',filter:'excess'}));assert.equal(q.entries[0].extraReturned,2);assert.equal(q.entries[0].extraReturnEntries,1);assert.equal(q.entries[0].extraQuantity,5);assert.equal(q.entries[0].remaining,0);
});
test('duplicate pickup references and cumulative limits are scoped to the exact extra observation',async t=>{
 const f=await setup(t),first=ok(await f.call('manager','fooditem.excess-return',pickup(4,{returnReference:' Pickup  A '}),f.extra));
 assert.equal((await f.call('buyer','fooditem.excess-return',pickup(4,{returnReference:'pickup a',quantity:1}),first)).status,409);
 assert.equal((await f.call('manager','fooditem.excess-return',pickup(4,{quantity:4}),first)).status,409);
 const all=ok(await f.call('buyer','fooditem.excess-return',pickup(4,{quantity:3}),first));assert.equal((await f.call('owner','fooditem.excess-return',pickup(4,{returnReference:'Third',quantity:.01}),all)).status,409);
 const another=ok(await f.call('manager','fooditem.excess',{...excessInput(2),deliveryReference:'EXTRA-TWO',quantity:1},all));ok(await f.call('manager','fooditem.excess-return',pickup(another.revision,{quantity:1}),another));
 const e=await history(f);assert.deepEqual(e.find(x=>x.revision===2).invoiceExcessReturns,{entries:3,quantity:6});assert.equal(ok(await f.get('owner',{view:'receiving',filter:'excess'})).entries[0].extraReturned,6);
});
test('pickup voids retain facts, restore only their available quantity and protect the complete source chain',async t=>{
 const f=await setup(t),saved=ok(await f.call('buyer','fooditem.excess-return',pickup(4),f.extra));
 for(const [action,input] of [['fooditem.excess-void',{excessRevision:4}],['fooditem.receive-void',{receivingRevision:3}],['fooditem.invoice-void',{invoiceRevision:2}]])assert.equal((await f.call('owner',action,{...input,reason:'Wrong source'},saved)).status,409);
 assert.equal((await f.call('manager','fooditem.excess-return-void',{returnRevision:5,reason:'Not my record'},saved)).status,403);assert.equal((await f.call('owner','fooditem.excess-return-void',{returnRevision:5,reason:''},saved)).status,400);
 const voided=ok(await f.call('owner','fooditem.excess-return-void',{returnRevision:5,reason:'Wrong pickup quantity'},saved));assert.equal((await f.call('owner','fooditem.excess-return-void',{returnRevision:5,reason:'Twice'},voided)).status,409);
 let e=await history(f);assert.equal(e.find(x=>x.revision===5).event.excessReturn.quantity,2);assert.equal(e.find(x=>x.revision===5).excessReturnVoided.reason,'Wrong pickup quantity');assert.deepEqual(e.find(x=>x.revision===4).excessReturned,{entries:0,quantity:0});
 const replaced=ok(await f.call('manager','fooditem.excess-return',pickup(4,{quantity:5}),voided)),corrected=ok(await f.call('manager','fooditem.excess-return-void',{returnRevision:replaced.revision,reason:'Incorrect source association'},replaced)),source=ok(await f.call('owner','fooditem.excess-void',{excessRevision:4,reason:'Incorrect extra record'},corrected));
 assert.equal((await f.call('manager','fooditem.excess-return',pickup(4),source)).status,409);const receiveVoid=ok(await f.call('owner','fooditem.receive-void',{receivingRevision:3,reason:'Incorrect source'},source));ok(await f.call('owner','fooditem.invoice-void',{invoiceRevision:2,reason:'Incorrect source'},receiveVoid));
});
test('pickups enforce restaurant, role, item and event-type boundaries including revoked membership',async t=>{
 const f=await setup(t);for(const actor of ['foreign','worker','foh'])assert.equal((await f.call(actor,'fooditem.excess-return',pickup(4),f.extra)).status,403);
 for(const rev of [1,2,3,999])assert.equal((await f.call('manager','fooditem.excess-return',pickup(rev),f.extra)).status,404);
 const other=ok(await f.call('owner','fooditem.import',importInput([{...rawItem,controlNumber:'OTHER'}])));assert.equal((await f.call('manager','fooditem.excess-return',pickup(4),other)).status,404);
 await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='manager'").run();assert.equal((await f.call('manager','fooditem.excess-return',pickup(4),f.extra)).status,403);
 const saved=ok(await f.call('buyer','fooditem.excess-return',pickup(4),f.extra)),credit=ok(await f.call('buyer','fooditem.credit',{invoiceRevision:2,creditNumber:'FICTIONAL-CREDIT',lineReference:'1',creditDate:'2026-09-28',sourceNote:'Fictional issued credit for invoiced goods',reason:'returned',quantity:2,amount:'5.00',confirmed:true},saved));assert.equal((await f.call('owner','fooditem.return-credit',{returnRevision:saved.revision,creditRevision:credit.revision,quantity:1,note:'Cannot treat excess pickup as invoiced return',confirmed:true},credit)).status,404);
 assert.equal(ok(await f.get('owner',{view:'receiving',filter:'excess',dataset:'operating'})).total,0);assert.equal((await f.get('owner',{view:'history',recordId:f.base.recordId,dataset:'operating'})).status,404);
});
test('off-page pickup voids update whole-history observation, invoice and delivery-queue totals',async t=>{
 const f=await setup(t,30);let current=f.extra;for(let n=0;n<24;n++)current=ok(await f.call('manager','fooditem.excess-return',pickup(4,{returnReference:'PICKUP-'+n,quantity:1}),current));
 let e=await history(f);assert.equal(e.length,20);assert.deepEqual(e.find(x=>x.revision===4).excessReturned,{entries:24,quantity:24});
 current=ok(await f.call('owner','fooditem.excess-return-void',{returnRevision:5,reason:'Off-page correction'},current));e=await history(f);assert.equal(e.find(x=>x.revision===5).excessReturnVoided.revision,current.revision);assert.deepEqual(e.find(x=>x.revision===2).invoiceExcessReturns,{entries:23,quantity:23});
 const q=ok(await f.get('owner',{view:'receiving',filter:'excess'}));assert.equal(q.entries[0].extraReturned,23);assert.equal(q.entries[0].extraReturnEntries,23);assert.equal((await f.call('manager','fooditem.excess-return',pickup(4,{returnReference:'TOO-MUCH',quantity:8}),current)).status,409);
});
test('pickup and void transactions roll back on failure; exact retry creates one event',async t=>{
 const f=await setup(t);let current=f.extra;
 for(const [action,input] of [['fooditem.excess-return',pickup(4)],['fooditem.excess-return-void',{returnRevision:5,reason:'Wrong ticket'}]]){
  const requestId=crypto.randomUUID(),before=ok(await f.view('owner')).records[0],revision=ok(await f.get('owner')).revision,audit=(await f.db.prepare('SELECT count(*) n FROM audit_events').first()).n;
  await f.db.prepare("CREATE TRIGGER reject_pickup BEFORE INSERT ON food_history BEGIN SELECT RAISE(ABORT,'fixture failure'); END").run();assert.equal((await f.call('manager',action,input,current,{requestId})).status,503);assert.deepEqual(ok(await f.view('owner')).records[0],before);assert.equal(ok(await f.get('owner')).revision,revision);assert.equal((await f.db.prepare('SELECT count(*) n FROM audit_events').first()).n,audit);assert.equal((await f.db.prepare('SELECT count(*) n FROM food_receipts WHERE request_id=?').bind(requestId).first()).n,0);
  await f.db.prepare('DROP TRIGGER reject_pickup').run();const saved=ok(await f.call('manager',action,input,current,{requestId}));assert.deepEqual(ok(await f.call('manager',action,input,current,{requestId})),saved);assert.equal((await f.call('manager',action,{...input,evidence:'Changed'},current,{requestId})).status,409);current=saved;
 }
 assert.equal((await history(f)).length,6);
});
test('concurrent pickups cannot exceed recorded extras or survive a winning source void',async t=>{
 const f=await setup(t),race=await Promise.all(['manager','buyer'].map((actor,n)=>f.call(actor,'fooditem.excess-return',pickup(4,{returnReference:'RACE-'+n,quantity:4}),f.extra)));assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
 const g=await setup(t),sourceRace=await Promise.all([g.call('manager','fooditem.excess-return',pickup(4),g.extra),g.call('owner','fooditem.excess-void',{excessRevision:4,reason:'Incorrect source'},g.extra)]);assert.deepEqual(sourceRace.map(r=>r.status).sort(),[200,409]);assert.equal((await history(g)).filter(e=>e.event.excessReturn||e.event.excessVoid).length,1);
});
test('current membership guard prevents a pickup when access is revoked just before commit',async t=>{
 const f=await setup(t);let revoked=false;const wrapper={withSession:()=>wrapper,prepare:sql=>f.db.prepare(sql),batch:async statements=>{if(!revoked&&statements.length>3){revoked=true;await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='manager'").run()}return f.db.batch(statements)}};
 const response=await handleFood(new Request('https://test.example/api/food',{method:'POST',headers:{...f.headers('manager'),Origin:'https://test.example','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),locationId:'a',recordId:f.base.recordId,expectedRevision:f.extra.revision,action:'fooditem.excess-return',input:pickup(4)})}),wrapper);assert.equal(revoked,true);assert.notEqual(response.status,200);assert.equal((await history(f)).filter(e=>e.event.excessReturn).length,0);
});
