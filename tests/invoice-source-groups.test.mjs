import test from 'node:test';
import assert from 'node:assert/strict';
import {invoiceSourceGroups,invoiceSourceKey,invoiceSourceEntries} from '../.sites-runtime/shared/invoice-source-groups.mjs';
import {readInvoiceCsv,invoiceCsvColumns} from '../.sites-runtime/shared/food-invoice-csv.mjs';
const entry=(n,patch={},saved='not-recorded',status='ready')=>({row:{recordNumber:n,vendor:'Fixture Supplier',vendorSku:'007',invoiceNumber:'INV-001',lineReference:String(n),invoiceDate:'2026-09-29',quantity:'1',unitBasis:'supplier-pack',invoiceUnit:'case',lineTotal:'10.00',...patch},saved:{state:saved,differences:[]},status,matches:[]});
test('source invoice identity normalizes spacing/case but preserves supplier and invoice distinctions',()=>{
 const rows=[entry(2),entry(3,{vendor:'  fixture   SUPPLIER ',invoiceNumber:' inv-001 '}),entry(4,{vendor:'Another supplier'}),entry(5,{invoiceNumber:'INV-002'})],groups=invoiceSourceGroups(rows);
 assert.equal(groups.length,3);assert.deepEqual(groups.map(g=>g.entries.length),[2,1,1]);assert.equal(groups[0].vendor,'Fixture Supplier');assert.equal(invoiceSourceKey(rows[0]),invoiceSourceKey(rows[1]));
});
test('all 250 source lines contribute exact cents beyond display pages without adding unlike quantities',()=>{
 const csv=invoiceCsvColumns.join(',')+'\n'+Array.from({length:250},(_,i)=>`Fixture Supplier,007,INV-001,${i+1},2026-09-29,${i+1},${i%2?'measure':'supplier-pack'},${i%2?'lb':'case'},${i===0?'0':i%2?'0.10':'0.20'}`).join('\n');
 const rows=readInvoiceCsv(csv).map(row=>({...entry(row.recordNumber),row})),g=invoiceSourceGroups(rows)[0];assert.equal(g.entries.length,250);assert.equal(g.netCents,3730);assert.equal(g.quantity,undefined);assert.equal(g.unrecorded,250);assert.equal(g.attention,0);
});
test('saved matching state and source attention remain distinct including changed and unchecked rows',()=>{
 const g=invoiceSourceGroups([entry(2,{},'recorded','unmatched'),entry(3,{},'conflict'),entry(4,{},'unchecked'),entry(5,{},'not-recorded','choose-item'),entry(6,{},'not-recorded','needs-review'),entry(7,{},'not-recorded','unmatched'),entry(8)])[0];
 assert.deepEqual([g.recorded,g.conflicts,g.unchecked,g.unrecorded,g.matchingIssues,g.attention],[1,1,1,4,3,5]);assert.equal(g.netCents,7000);assert.deepEqual(invoiceSourceEntries([g],'',true).map(e=>e.row.recordNumber),[3,4,5,6,7]);
});
test('conflicting invoice dates remain one identity and surface all its lines in attention view',()=>{
 const rows=[entry(2,{invoiceDate:'2026-09-29'},'recorded'),entry(3,{invoiceDate:'2026-09-28'}),entry(4,{invoiceNumber:'INV-2'})],before=structuredClone(rows),groups=invoiceSourceGroups(rows);
 assert.deepEqual(groups[0].dates,['2026-09-28','2026-09-29']);assert.equal(groups[0].attention,2);assert.equal(groups[0].matchingIssues,0);assert.deepEqual(invoiceSourceEntries(groups,'',true).map(e=>e.row.recordNumber),[2,3]);assert.deepEqual(rows,before);
});
test('invoice and attention filters intersect, preserve source row order and never leak unknown selection',()=>{
 const groups=invoiceSourceGroups([entry(7),entry(3,{invoiceNumber:'B'},'conflict'),entry(2),entry(6,{invoiceNumber:'B'})]);
 assert.deepEqual(invoiceSourceEntries(groups,'',false).map(e=>e.row.recordNumber),[2,3,6,7]);assert.deepEqual(invoiceSourceEntries(groups,groups[1].key,true).map(e=>e.row.recordNumber),[3]);assert.deepEqual(invoiceSourceEntries(groups,'unknown',false),[]);assert.deepEqual(invoiceSourceGroups([]),[]);
});
test('source-file scope is independent and maximum parsed line amounts remain exact',()=>{
 const a=invoiceSourceGroups(Array.from({length:250},(_,i)=>entry(i+2,{lineTotal:'1000000.00'})))[0];assert.equal(a.netCents,25000000000);assert.equal(Number.isSafeInteger(a.netCents),true);
 const b=invoiceSourceGroups([entry(2,{lineTotal:'0.00'})])[0];assert.equal(b.netCents,0);assert.equal(b.entries.length,1);assert.equal(a.entries.length,250);
});
