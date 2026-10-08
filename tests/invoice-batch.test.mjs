import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareInvoiceBatch,advanceInvoiceBatch} from '../.sites-runtime/shared/invoice-batch.mjs';
const file={kind:'csv',fileName:'fictional.csv',sha256:'a'.repeat(64),byteLength:400};
const entry=(n,itemId='item-a')=>({row:{recordNumber:n,vendor:'Fixture',vendorSku:'001',invoiceNumber:'INV',lineReference:String(n),invoiceDate:'2026-01-01',quantity:'2',unitBasis:'supplier-pack',invoiceUnit:'case',lineTotal:'10.00'},saved:{state:'not-recorded',differences:[]},status:'ready',matches:[{itemId,itemRevision:3,skuId:'pack',title:'Fixture item',controlNumber:'F1',label:'Fixture case',quantity:2,unit:'case',price:5}]});
const review={locationId:'a',dataset:'demo',revision:10,checkedAt:'2026-01-02T12:00:00Z',entries:[entry(2),entry(3),entry(4,'item-b')]};
const choices=review.entries.map(e=>({recordNumber:e.row.recordNumber,itemId:e.matches[0].itemId,skuId:'pack'}));
const prepare=(r=review,c=choices,note='Fixture source checked',confirmed=true)=>prepareInvoiceBatch(r,file,c,note,confirmed);
const ok=c=>Response.json({recordId:c.recordId,revision:c.expectedRevision+1,foodRevision:11,added:0,existing:0});
test('group requires explicit confirmation, reference, 1-25 unique unrecorded compatible selections',()=>{
 assert.throws(()=>prepare(review,choices,'',true));assert.throws(()=>prepare(review,choices,'source',false));assert.throws(()=>prepare(review,[]));
 assert.throws(()=>prepare(review,[choices[0],choices[0]]));assert.throws(()=>prepare(review,Array(26).fill(choices[0])));
 for(const state of ['recorded','conflict','unchecked'])assert.throws(()=>prepare({...review,entries:[{...entry(2),saved:{state}}]},[choices[0]]));
 assert.throws(()=>prepare({...review,entries:[{...entry(2),matches:[{...entry(2).matches[0],issue:'Unknown conversion'}]}]},[choices[0]]));
 assert.throws(()=>prepare(review,[{...choices[0],itemId:'foreign'}]));
});
test('explicit ambiguous item choices remain possible and take a detached source-order snapshot',()=>{
 const ambiguous={...entry(2),status:'choose-item',matches:[...entry(2).matches,{...entry(2).matches[0],itemId:'chosen-other'}]};
 const r={...review,entries:[ambiguous,entry(3)]};const batch=prepare(r,[choices[1],{...choices[0],itemId:'chosen-other'}]);
 assert.deepEqual(batch.lines.map(l=>l.row.recordNumber),[2,3]);assert.equal(batch.lines[0].match.itemId,'chosen-other');
 r.entries[0].row.lineTotal='999';assert.equal(batch.lines[0].row.lineTotal,'10.00');
});
test('same item revisions advance only from confirmed responses, different items retain reviewed revisions',async()=>{
 let batch=prepare(),calls=[];
 const send=async c=>{calls.push(structuredClone(c));return ok(c)};
 for(let n=0;n<3;n++)batch=await advanceInvoiceBatch(batch,send,()=>`request-${n}`);
 assert.deepEqual(calls.map(c=>[c.recordId,c.expectedRevision]),[['item-a',3],['item-a',4],['item-b',3]]);
 assert.ok(batch.lines.every(l=>l.state==='saved'));assert.equal(calls[0].action,'fooditem.invoice');assert.deepEqual(calls[0].input.fileSource.row,review.entries[0].row);
 await advanceInvoiceBatch(batch,send);assert.equal(calls.length,3);
});
test('lost response keeps exact request body and ID; deliberate retry then continues with confirmed version',async()=>{
 let batch=prepare(),first;
 batch=await advanceInvoiceBatch(batch,async c=>{first=structuredClone(c);throw Error('response lost after commit')},()=> 'stable-id');
 assert.equal(batch.lines[0].state,'uncertain');assert.equal(batch.lines[1].state,'queued');assert.equal(batch.revisions['item-a'],3);
 batch=await advanceInvoiceBatch(batch,async c=>{assert.deepEqual(c,first);return ok(c)},()=>{throw Error('No new request ID on retry')});
 assert.equal(batch.lines[0].state,'saved');assert.equal(batch.revisions['item-a'],4);
 batch=await advanceInvoiceBatch(batch,async c=>{assert.equal(c.expectedRevision,4);return ok(c)},()=> 'next-id');assert.equal(batch.lines[1].state,'saved');
});
test('403 and 409 stop the group and leave already saved and unsent lines distinct',async()=>{
 for(const status of [403,409]){
  let batch=await advanceInvoiceBatch(prepare(),async c=>ok(c));
  batch=await advanceInvoiceBatch(batch,async()=>Response.json({error:'Access or record changed'},{status}));
  assert.deepEqual(batch.lines.map(l=>l.state),['saved','rejected','queued']);
  await advanceInvoiceBatch(batch,async()=>{throw Error('Rejected group must not continue')});
 }
});
test('server failures, invalid JSON and mismatched successful receipts stay uncertain',async()=>{
 for(const response of [Response.json({error:'Unavailable'},{status:503}),new Response('bad JSON',{status:400}),Response.json({recordId:'other',revision:4,foodRevision:11,added:0,existing:0}),Response.json({recordId:'item-a',revision:99,foodRevision:11,added:0,existing:0})]){
  const batch=await advanceInvoiceBatch(prepare(),async()=>response);assert.equal(batch.lines[0].state,'uncertain');assert.equal(batch.lines[1].state,'queued');assert.equal(batch.revisions['item-a'],3);
 }
});
test('duplicate source identities and inconsistent reviewed item versions fail before any writer call',()=>{
 assert.throws(()=>prepare({...review,entries:[entry(2),{...entry(3),row:{...entry(3).row,lineReference:'2'}}]},choices.slice(0,2)));
 assert.throws(()=>prepare({...review,entries:[entry(2),{...entry(3),matches:[{...entry(3).matches[0],itemRevision:4}]}]},choices.slice(0,2)));
});
