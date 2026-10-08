import test from 'node:test';import assert from 'node:assert/strict';
import {excessFixture,rawItem,importInput,invoiceInput,receivingInput} from './food-excess-fixture.mjs';
import {parseReplacement} from '../.sites-runtime/shared/food-replacement.mjs';
import {handleFood} from '../.sites-runtime/shared/food-service.mjs';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data};
const input=(extra={})=>({receivingRevision:3,deliveryReference:'REPLACEMENT-1',receivedDate:'2026-09-28',quantity:4,invoiceUnit:'lb',evidence:'Fictional checked arrival of identical goods',confirmed:true,...extra});
async function setup(t,rejected=10){const f=await excessFixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),invoice=ok(await f.call('buyer','fooditem.invoice',invoiceInput,base)),receipt=ok(await f.call('manager','fooditem.receive',{...receivingInput(2),accepted:80-rejected,rejected},invoice));return {...f,base,invoice,receipt};}
const history=async f=>ok(await f.get('owner',{view:'history',recordId:f.base.recordId})).entries;
test('replacement validation checks rejected quantities, explicit original units, actual local dates and immutable snapshots',()=>{
 const source={receivedDate:'2026-09-28',rejected:10,invoice:{quantity:80,supplierPackQuantity:2,invoiceUnit:'lb',sku:{packCount:8}}},at='2026-09-29T01:00:00Z',empty={entries:0,quantity:0};
 const saved=parseReplacement({...input(),by:'forged',receiving:{},supplierPacks:999},source,empty,at,'manager','America/New_York');assert.equal(saved.by,'manager');assert.equal(saved.supplierPacks,.1);source.invoice.sku.packCount=5;assert.equal(saved.receiving.invoice.sku.packCount,8);
 for(const change of [{quantity:0},{quantity:11},{quantity:-1},{quantity:''},{quantity:true},{quantity:null},{quantity:Infinity},{quantity:1000001},{invoiceUnit:'case'},{receivedDate:'2026-09-27'},{receivedDate:'2026-09-29'},{receivedDate:'2026-02-30'},{evidence:''},{deliveryReference:''},{receivingRevision:0},{confirmed:false}])assert.throws(()=>parseReplacement(input(change),source,empty,at,'manager','America/New_York'));
 assert.throws(()=>parseReplacement(input(),{...source,rejected:0},empty,at,'manager','America/New_York'));
 assert.throws(()=>parseReplacement(input({quantity:1e-16}),{...source,rejected:1e-18},empty,at,'manager','America/New_York'));
 assert.equal(parseReplacement(input({quantity:.1}),{...source,rejected:.3},{entries:1,quantity:.2},at,'manager','America/New_York').quantity,.1);
});
test('accepted replacements preserve original receipt/pack, counts, credit balances and daily workspace',async t=>{
 const f=await setup(t),daily=async()=>await (await handleWorkspace(new Request('https://test.example/api/workspace?locationId=a',{headers:f.headers('owner')}),f.db)).text(),beforeDaily=await daily();
 const configured=ok(await f.call('buyer','fooditem.configure',{item:{...rawItem,vendorSkus:rawItem.vendorSkus.map(s=>({...s,packCount:4}))},reason:'Current pack changed'},f.receipt)),before=ok(await f.view('owner')).records[0].data;
 ok(await f.call('manager','fooditem.replacement',{...input(),by:'owner',receiving:{}},configured));assert.deepEqual(ok(await f.view('owner')).records[0].data,before);assert.equal(await daily(),beforeDaily);
 const entries=await history(f),invoice=entries.find(e=>e.revision===2),receipt=entries.find(e=>e.revision===3),saved=entries.at(-1).event.replacement;
 assert.equal(saved.receiving.invoice.sku.packCount,8);assert.equal(saved.by,'manager');assert.deepEqual(receipt.receivingReplacements,{entries:1,quantity:4});assert.deepEqual(invoice.invoiceReceiving,{entries:1,accepted:70,rejected:10});assert.deepEqual(invoice.invoiceCredits,{entries:0,quantity:0,amountCents:0});assert.deepEqual(receipt.receivingReturns,{entries:0,accepted:0,rejected:0});
});
test('replacement references and cumulative quantities are guarded; original source cannot be removed until correction',async t=>{
 const f=await setup(t),first=ok(await f.call('manager','fooditem.replacement',input({deliveryReference:' Refill  One '}),f.receipt));
 assert.equal((await f.call('buyer','fooditem.replacement',input({deliveryReference:'refill one',quantity:1}),first)).status,409);
 assert.equal((await f.call('manager','fooditem.replacement',input({quantity:7}),first)).status,409);
 const all=ok(await f.call('buyer','fooditem.replacement',input({quantity:6}),first));assert.equal((await f.call('owner','fooditem.replacement',input({deliveryReference:'third',quantity:.01}),all)).status,409);
 for(const [action,key,rev] of [['fooditem.receive-void','receivingRevision',3],['fooditem.invoice-void','invoiceRevision',2]])assert.equal((await f.call('owner',action,{[key]:rev,reason:'Wrong original'},all)).status,409);
 assert.equal((await f.call('manager','fooditem.replacement-void',{replacementRevision:all.revision,reason:'Not my entry'},all)).status,403);
 let current=ok(await f.call('owner','fooditem.replacement-void',{replacementRevision:all.revision,reason:'Wrong amount'},all));
 assert.equal((await f.call('owner','fooditem.replacement-void',{replacementRevision:all.revision,reason:'Twice'},current)).status,409);
 current=ok(await f.call('manager','fooditem.replacement-void',{replacementRevision:first.revision,reason:'Wrong ticket'},current));
 const entries=await history(f);assert.deepEqual(entries.find(e=>e.revision===3).receivingReplacements,{entries:0,quantity:0});assert.equal(entries.find(e=>e.revision===4).event.replacement.quantity,4);assert.equal(entries.find(e=>e.revision===4).replacementVoided.reason,'Wrong ticket');
 current=ok(await f.call('owner','fooditem.receive-void',{receivingRevision:3,reason:'Wrong source'},current));assert.equal((await f.call('manager','fooditem.replacement',input(),current)).status,409);ok(await f.call('owner','fooditem.invoice-void',{invoiceRevision:2,reason:'Wrong invoice'},current));
});
test('replacement writes respect restaurant, role, source event and dataset boundaries',async t=>{
 const f=await setup(t);for(const actor of ['foreign','worker','foh'])assert.equal((await f.call(actor,'fooditem.replacement',input(),f.receipt)).status,403);
 for(const revision of [1,2,999])assert.equal((await f.call('manager','fooditem.replacement',input({receivingRevision:revision}),f.receipt)).status,404);
 const other=ok(await f.call('owner','fooditem.import',importInput([{...rawItem,controlNumber:'OTHER'}])));assert.equal((await f.call('manager','fooditem.replacement',input(),other)).status,404);
 assert.equal((await f.get('owner',{view:'history',recordId:f.base.recordId,dataset:'operating'})).status,404);
 await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='manager'").run();assert.equal((await f.call('manager','fooditem.replacement',input(),f.receipt)).status,403);
 const g=await setup(t,0);assert.equal((await g.call('manager','fooditem.replacement',input(),g.receipt)).status,400);
});
test('whole-history replacement totals and voids remain correct beyond visible history pages',async t=>{
 const f=await setup(t,30);let current=f.receipt;for(let n=0;n<24;n++)current=ok(await f.call('manager','fooditem.replacement',input({quantity:1,deliveryReference:'R-'+n}),current));
 let e=await history(f);assert.equal(e.length,20);assert.deepEqual(e.find(x=>x.revision===3).receivingReplacements,{entries:24,quantity:24});
 current=ok(await f.call('owner','fooditem.replacement-void',{replacementRevision:4,reason:'Off-page correction'},current));e=await history(f);assert.equal(e.find(x=>x.revision===4).replacementVoided.revision,current.revision);assert.deepEqual(e.find(x=>x.revision===3).receivingReplacements,{entries:23,quantity:23});
 assert.equal((await f.call('manager','fooditem.replacement',input({deliveryReference:'Too much',quantity:8}),current)).status,409);
});
test('replacement and void are transactional and exact retry is idempotent',async t=>{
 const f=await setup(t);let current=f.receipt;
 for(const [action,fields] of [['fooditem.replacement',input()],['fooditem.replacement-void',{replacementRevision:4,reason:'Wrong arrival'}]]){
  const requestId=crypto.randomUUID(),before=ok(await f.view('owner')).records[0],revision=ok(await f.get('owner')).revision;
  await f.db.prepare("CREATE TRIGGER reject_replacement BEFORE INSERT ON food_history BEGIN SELECT RAISE(ABORT,'fixture failure'); END").run();assert.equal((await f.call('manager',action,fields,current,{requestId})).status,503);assert.deepEqual(ok(await f.view('owner')).records[0],before);assert.equal(ok(await f.get('owner')).revision,revision);assert.equal((await f.db.prepare('SELECT count(*) n FROM food_receipts WHERE request_id=?').bind(requestId).first()).n,0);
  await f.db.prepare('DROP TRIGGER reject_replacement').run();const saved=ok(await f.call('manager',action,fields,current,{requestId}));assert.deepEqual(ok(await f.call('manager',action,fields,current,{requestId})),saved);assert.equal((await f.call('manager',action,{...fields,evidence:'Changed'},current,{requestId})).status,409);current=saved;
 }
 assert.equal((await history(f)).length,5);
});
test('concurrent replacements or source void permit only one winning revision',async t=>{
 const f=await setup(t),race=await Promise.all(['manager','buyer'].map((actor,n)=>f.call(actor,'fooditem.replacement',input({deliveryReference:'RACE-'+n,quantity:7}),f.receipt)));assert.deepEqual(race.map(x=>x.status).sort(),[200,409]);
 const g=await setup(t),sourceRace=await Promise.all([g.call('manager','fooditem.replacement',input(),g.receipt),g.call('owner','fooditem.receive-void',{receivingRevision:3,reason:'Wrong source'},g.receipt)]);assert.deepEqual(sourceRace.map(x=>x.status).sort(),[200,409]);
});
test('membership revoked just before commit prevents a replacement record',async t=>{
 const f=await setup(t);let revoked=false;const wrapper={withSession:()=>wrapper,prepare:sql=>f.db.prepare(sql),batch:async statements=>{if(!revoked&&statements.length>3){revoked=true;await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='manager'").run()}return f.db.batch(statements)}};
 const response=await handleFood(new Request('https://test.example/api/food',{method:'POST',headers:{...f.headers('manager'),Origin:'https://test.example','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),locationId:'a',recordId:f.base.recordId,expectedRevision:f.receipt.revision,action:'fooditem.replacement',input:input()})}),wrapper);assert.equal(revoked,true);assert.notEqual(response.status,200);assert.equal((await history(f)).filter(e=>e.event.replacement).length,0);
});
