import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFoodItem} from '../.sites-runtime/shared/food.mjs';
import {readInvoiceCsv,invoiceCsvColumns} from '../.sites-runtime/shared/food-invoice-csv.mjs';
import {reviewInvoiceCsv,invoiceCsvReviewPage} from '../.sites-runtime/shared/invoice-csv-review.mjs';
const at='2026-09-29T03:00:00Z',timezone='America/New_York';
const source={dataset:'demo',sourceRestaurantId:'demo',label:'Fictional test source',importedAt:at,importedBy:'owner'};
const raw={restaurantId:'demo',name:'Demo beef',controlNumber:'BEEF',purchaseUnit:'case',packCount:8,unitQty:5,unitUOM:'lb',portionSize:6,portionUOM:'oz',vendorSkus:[{id:'sku1',vendor:'Demo supplier',vendorSku:'001',purchaseUnit:'case',packCount:8,unitQty:5,unitUOM:'lb',price:92.5,priceUpdatedAt:'2026-09-28',preferred:true,available:true}]};
const item=()=>parseFoodItem(raw,source);
const rows=(values=['Demo supplier,001,DEMO-100,1,2026-09-28,80,measure,lbs,200.00'])=>readInvoiceCsv(invoiceCsvColumns.join(',')+'\n'+values.join('\n'));
const review=(r=rows(),i=item())=>reviewInvoiceCsv(r,i,at,timezone);

test('selected-item CSV review preserves source strings and normalizes measured quantities without changing inputs',()=>{
 const r=rows(),i=item(),before=structuredClone({r,i}),result=review(r,i);
 assert.deepEqual(result.totals,{ready:1,'choose-pack':0,'needs-review':0,unmatched:0});
 assert.equal(result.entries[0].matches[0].quantity,2);assert.equal(result.entries[0].matches[0].price,100);
 assert.equal(result.entries[0].row.vendorSku,'001');assert.equal(result.entries[0].row.quantity,'80');
 assert.deepEqual({r,i},before);
});
test('supplier and SKU matches are exact after whitespace/case normalization, not fuzzy or numeric coercion',()=>{
 const r=rows([' demo SUPPLIER ,001,INV,1,2026-09-28,1,supplier-pack,case,0.00','Demo supplier,1,INV,2,2026-09-28,1,supplier-pack,case,1','Other supplier,001,INV,3,2026-09-28,1,supplier-pack,case,1']);
 assert.deepEqual(review(r).entries.map(e=>e.status),['ready','unmatched','unmatched']);
 const unavailable=item();unavailable.vendorSkus[0].available=false;assert.equal(review(r,unavailable).totals.unmatched,3);
 const another=item();another.vendorSkus[0].vendorSku='OTHER';assert.equal(review(r,another).totals.unmatched,3);
});
test('multiple valid packs remain choices; incompatible candidates retain their review reasons',()=>{
 const i=item();i.vendorSkus.push({...i.vendorSkus[0],id:'sku2',packCount:4});
 let entry=review(rows(),i).entries[0];assert.equal(entry.status,'choose-pack');assert.deepEqual(entry.matches.map(m=>[m.quantity,m.price]),[[2,100],[4,50]]);
 i.vendorSkus[1].unitUOM='gal';entry=review(rows(),i).entries[0];assert.equal(entry.status,'ready');assert.match(entry.matches[1].issue,/same unit family/);
 i.vendorSkus[0].packCount=null;entry=review(rows(),i).entries[0];assert.equal(entry.status,'needs-review');assert.equal(entry.matches.filter(m=>m.issue).length,2);
});
test('fractional supplier packs and explicit zero net amounts are usable without invented conversions',()=>{
 const r=rows(['Demo supplier,001,INV,1,2026-09-28,0.5,supplier-pack,cs,0.00']),i=item();i.vendorSkus[0].packCount=null;
 const e=review(r,i).entries[0];assert.equal(e.status,'ready');assert.equal(e.matches[0].quantity,.5);assert.equal(e.matches[0].price,0);
 assert.equal(review(rows(['Demo supplier,001,INV,1,2026-09-28,1,supplier-pack,bag,10'])).entries[0].status,'needs-review');
});
test('unresolved or inactive items and future local business dates cannot be marked ready',()=>{
 for(const patch of [{active:false},{needsReview:true}])assert.equal(review(rows(),{...item(),...patch}).totals['needs-review'],1);
 const r=rows(['Demo supplier,001,INV,1,2026-09-29,2,supplier-pack,case,200']);
 assert.match(review(r).entries[0].matches[0].issue,/future/);
 assert.equal(reviewInvoiceCsv(r,item(),at,'UTC').entries[0].status,'ready');
});
test('250 rows remain reviewable across 13 pages with no missing or repeated records',()=>{
 const r=rows(Array.from({length:250},(_,n)=>`Demo supplier,001,INV-${n},1,2026-09-28,2,supplier-pack,case,200`)),result=review(r),seen=[];
 for(let p=0;p<13;p++){const page=invoiceCsvReviewPage(result,'all','',p);assert.equal(page.pages,13);assert.equal(page.entries.length,p===12?10:20);seen.push(...page.entries.map(e=>e.row.recordNumber));}
 assert.equal(result.totals.ready,250);assert.deepEqual(seen,r.map(r=>r.recordNumber));
 assert.throws(()=>review([...r,{...r[0],recordNumber:252}]),/250/);
});
test('row filters and literal searches include unresolved matches and clamp page changes',()=>{
 const r=rows(['Demo supplier,001,A[1],1,2026-09-28,2,supplier-pack,case,200','Other,ZZ,INV,2,2026-09-28,2,supplier-pack,case,200','Demo supplier,001,INV,3,2026-09-28,2,supplier-pack,bag,200']),result=review(r);
 assert.deepEqual(invoiceCsvReviewPage(result,'matched','',99).entries.map(e=>e.row.recordNumber),[2,4]);
 assert.deepEqual(invoiceCsvReviewPage(result,'needs-review','',0).entries.map(e=>e.row.recordNumber),[3,4]);
 assert.equal(invoiceCsvReviewPage(result,'all','[1]',0).total,1);
 assert.equal(invoiceCsvReviewPage(result,'all',' SUPPLIER ',0).total,2);
 assert.equal(invoiceCsvReviewPage(result,'all','not-found',0).total,0);
 for(const n of [-1,NaN,Infinity,1.2])assert.equal(invoiceCsvReviewPage(result,'all','',n).page,0);
 assert.deepEqual(invoiceCsvReviewPage(review([]),'all','',0),{entries:[],total:0,page:0,pages:1});
});
