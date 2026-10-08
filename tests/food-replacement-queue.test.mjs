import test from 'node:test';import assert from 'node:assert/strict';
import {excessFixture,rawItem,importInput,invoiceInput,receivingInput} from './food-excess-fixture.mjs';
import {handleFood} from '../.sites-runtime/shared/food-service.mjs';import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data};
const replacement=(receivingRevision,quantity,deliveryReference='R1')=>({receivingRevision,quantity,deliveryReference,receivedDate:'2026-09-28',invoiceUnit:'lb',evidence:'Fictional checked replacement ticket',confirmed:true});
const queue=async(f,filter='all',params={},actor='manager')=>ok(await f.get(actor,{view:'receiving',filter,...params}));
async function setup(t){const f=await excessFixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),invoice=ok(await f.call('buyer','fooditem.invoice',invoiceInput,base)),receipt=ok(await f.call('manager','fooditem.receive',receivingInput(invoice.revision),invoice));return {...f,base,invoice,receipt};}

test('delivery replacement queue tracks partial and full arrivals and reasoned correction without changing original receiving or credits',async t=>{
 const f=await setup(t);let q=await queue(f,'unreplaced');assert.equal(q.total,1);assert.equal(q.entries[0].replacementRemaining,10);assert.equal(q.totals.replacements,0);
 const partial=ok(await f.call('manager','fooditem.replacement',replacement(3,4),f.receipt));q=await queue(f,'replacements');assert.equal(q.total,1);assert.equal(q.entries[0].replacementQuantity,4);assert.equal(q.entries[0].replacementRemaining,6);assert.equal(q.totals.unreplaced,1);assert.equal(q.entries[0].accepted,70);assert.equal(q.entries[0].remaining,0);assert.equal(q.entries[0].rejected,10);
 const full=ok(await f.call('buyer','fooditem.replacement',replacement(3,6,'R2'),partial));q=await queue(f,'unreplaced');assert.equal(q.total,0);assert.equal(q.totals.rejected,1);assert.equal(q.totals.replacements,1);assert.equal((await queue(f,'rejected')).entries[0].replacementRemaining,0);
 ok(await f.call('owner','fooditem.replacement-void',{replacementRevision:full.revision,reason:'Wrong arrival'},full));q=await queue(f,'unreplaced');assert.equal(q.entries[0].replacementRemaining,6);assert.equal(q.entries[0].replacementEntries,1);
 const history=ok(await f.get('owner',{view:'history',recordId:f.base.recordId}));assert.equal(history.entries.find(e=>e.revision===2).invoiceCredits.amountCents,0);assert.equal(ok(await f.view('owner')).records[0].data.count,null);
 assert.equal('totalQuantity' in q,false);assert.equal('replacementQuantity' in q.totals,false);
});

test('replacement queue joins each original receipt and invoice once without mixing records or invoice units',async t=>{
 const f=await excessFixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),invoice=ok(await f.call('buyer','fooditem.invoice',invoiceInput,base));
 const first=ok(await f.call('manager','fooditem.receive',{...receivingInput(2),accepted:30,rejected:10},invoice));let current=ok(await f.call('manager','fooditem.receive',{...receivingInput(2),deliveryReference:'T2',accepted:20,rejected:20},first));const second=current;
 current=ok(await f.call('manager','fooditem.replacement',replacement(first.revision,4),current));current=ok(await f.call('manager','fooditem.replacement',replacement(second.revision,12,'R2'),current));
 const caseInvoice=ok(await f.call('buyer','fooditem.invoice',{...invoiceInput,invoiceNumber:'CASES',quantity:2,unitBasis:'supplier-pack',invoiceUnit:'case'},current));current=ok(await f.call('manager','fooditem.receive',{...receivingInput(caseInvoice.revision),accepted:1,rejected:1},caseInvoice));
 const other=ok(await f.call('owner','fooditem.import',importInput([{...rawItem,controlNumber:'OTHER'}])));const otherInvoice=ok(await f.call('buyer','fooditem.invoice',{...invoiceInput,invoiceNumber:'OTHER'},other));let otherReceipt=ok(await f.call('manager','fooditem.receive',receivingInput(otherInvoice.revision),otherInvoice));ok(await f.call('manager','fooditem.replacement',replacement(otherReceipt.revision,10),otherReceipt));
 const q=await queue(f,'all');assert.equal(q.total,3);assert.equal(q.totals.unreplaced,2);assert.equal(q.totals.replacements,2);
 const a=q.entries.find(e=>e.recordId===base.recordId&&e.invoiceRevision===2);assert.equal(a.replacementQuantity,16);assert.equal(a.replacementEntries,2);assert.equal(a.replacementRemaining,14);assert.equal(a.rejected,30);assert.equal(a.receipts,2);
 const c=q.entries.find(e=>e.invoice.invoiceNumber==='CASES');assert.equal(c.replacementQuantity,0);assert.equal(c.replacementRemaining,1);assert.equal(c.invoice.invoiceUnit,'case');
 const b=q.entries.find(e=>e.recordId===other.recordId);assert.equal(b.replacementQuantity,10);assert.equal(b.replacementRemaining,0);
});

test('replacement queue pages complete filtered counts and rejects cursors after off-page corrections',async t=>{
 const f=await setup(t);let current=f.receipt;for(let n=0;n<24;n++)current=ok(await f.call('manager','fooditem.replacement',replacement(3,.25,'R'+n),current));
 let q=await queue(f,'replacements');assert.equal(q.entries[0].replacementEntries,24);assert.equal(q.entries[0].replacementQuantity,6);
 for(let n=0;n<22;n++){const i=ok(await f.call('buyer','fooditem.invoice',{...invoiceInput,lineReference:String(n+2)},current));current=ok(await f.call('manager','fooditem.receive',receivingInput(i.revision),i));}
 const first=await queue(f,'unreplaced');assert.equal(first.total,23);assert.equal(first.entries.length,20);const next=await queue(f,'unreplaced',{before:String(first.next),revision:String(first.revision)});assert.equal(next.entries.length,3);assert.equal(next.total,23);assert.deepEqual(next.totals,first.totals);assert.equal(new Set([...first.entries,...next.entries].map(e=>e.sequence)).size,23);
 ok(await f.call('owner','fooditem.replacement-void',{replacementRevision:4,reason:'Off-page correction'},current));assert.equal((await f.get('owner',{view:'receiving',filter:'unreplaced',before:String(first.next),revision:String(first.revision)})).status,409);assert.equal((await f.get('owner',{view:'receiving',filter:'replacements',before:String(first.next)})).status,409);
 q=await queue(f,'replacements');assert.equal(q.entries[0].replacementQuantity,5.75);assert.equal(q.entries[0].replacementEntries,23);assert.equal(q.entries[0].replacementRemaining,4.25);
});

test('replacement queue handles fractional completion and very small unreplaced quantities without false zeros',async t=>{
 const f=await excessFixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem])));let current=base;
 for(const [n,quantity] of [[1,.3],[2,1e-18]]){
  const invoice=ok(await f.call('buyer','fooditem.invoice',{...invoiceInput,lineReference:String(n),quantity,lineTotal:'0.00'},current));const receipt=ok(await f.call('manager','fooditem.receive',{...receivingInput(invoice.revision),accepted:0,rejected:quantity},invoice));current=receipt;
  if(n===1){current=ok(await f.call('manager','fooditem.replacement',replacement(receipt.revision,.1,'DEC1'),current));current=ok(await f.call('manager','fooditem.replacement',replacement(receipt.revision,.2,'DEC2'),current));}
 }
 const q=await queue(f,'unreplaced');assert.equal(q.total,1);assert.equal(q.entries[0].replacementRemaining,1e-18);assert.equal(q.entries[0].invoice.lineReference,'2');assert.equal((await queue(f,'replacements')).entries[0].replacementRemaining,0);
});

test('replacement queue enforces current roles, restaurant and dataset and detects revoked access during a read',async t=>{
 const f=await setup(t);ok(await f.call('manager','fooditem.replacement',replacement(3,4),f.receipt));
 for(const filter of ['unreplaced','replacements']){for(const actor of ['worker','foh','foreign'])assert.equal((await f.get(actor,{view:'receiving',filter})).status,403);assert.equal((await queue(f,filter,{dataset:'operating'},'buyer')).total,0);assert.equal((await queue(f,filter,{locationId:'b'},'foreign')).total,0);}
 let changed=false;const wrapper={withSession:()=>wrapper,prepare:sql=>f.db.prepare(sql),batch:async statements=>{const result=await f.db.batch(statements);if(!changed&&statements.length===3){changed=true;await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='manager'").run()}return result}};
 const response=await handleFood(new Request('https://test.example/api/food?locationId=a&dataset=demo&view=receiving&filter=replacements',{headers:f.headers('manager')}),wrapper);assert.equal(changed,true);assert.notEqual(response.status,200);
});

test('replacement queue search retains original supplier evidence, safely matches literal text and leaves daily payload unchanged',async t=>{
 const f=await setup(t),saved=ok(await f.call('manager','fooditem.replacement',replacement(3,4),f.receipt));
 ok(await f.call('buyer','fooditem.configure',{item:{...rawItem,name:'Renamed beef',vendorSkus:rawItem.vendorSkus.map(s=>({...s,vendor:'New vendor',packCount:4}))},reason:'New catalog definition'},saved));
 const daily=async()=>await (await handleWorkspace(new Request('https://test.example/api/workspace?locationId=a',{headers:f.headers('owner')}),f.db)).text(),before=await daily();
 for(const q of ['Renamed beef','BEEF','Demo supplier','DEMO-100']){const result=await queue(f,'replacements',{q});assert.equal(result.total,1);assert.equal(result.entries[0].invoice.sku.packCount,8);assert.equal(result.entries[0].currentTitle,'Renamed beef');}
 for(const q of ['New vendor',"' OR 1=1 --",'_missing_%'])assert.equal((await queue(f,'replacements',{q})).total,0);
 assert.equal(await daily(),before);assert.ok(Buffer.byteLength(JSON.stringify(await queue(f,'all')))<5000);
});

test('replacement queue excludes corrected arrival sources and voided invoices while retaining historical originals',async t=>{
 const f=await setup(t),saved=ok(await f.call('manager','fooditem.replacement',replacement(3,4),f.receipt)),voided=ok(await f.call('owner','fooditem.replacement-void',{replacementRevision:saved.revision,reason:'Incorrect arrival'},saved));
 const receipt=ok(await f.call('owner','fooditem.receive-void',{receivingRevision:3,reason:'Incorrect original'},voided));ok(await f.call('owner','fooditem.invoice-void',{invoiceRevision:2,reason:'Incorrect invoice'},receipt));
 assert.equal((await queue(f,'replacements')).total,0);assert.equal((await queue(f,'unreplaced')).total,0);const q=await queue(f,'all');assert.equal(q.total,1);assert.equal(q.entries[0].voided,true);assert.equal(q.entries[0].replacementQuantity,0);assert.equal(q.totals.replacements,0);assert.equal(q.totals.unreplaced,0);
});
