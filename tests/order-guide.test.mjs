import test from 'node:test';import assert from 'node:assert/strict';
import {guideLayouts,guideMaxBytes,readOrderGuide,reviewOrderGuide} from '../.sites-runtime/shared/food-order-guide.mjs';
const header=guideLayouts.berts.join(',')+'\r\n';
const row=(sku='001',name='Fictional food',vendor='Test Foods',count='',order='',unit='CS',other=vendor)=>[sku,name,vendor,count,order,unit,other].join(',')+'\r\n';
const item=(id='one',unit='case',vendor='Test Foods',sku='001',extra={})=>({id,revision:1,data:{title:'Catalog title',controlNumber:id,active:true,needsReview:false,vendorSkus:[{id:'pack',vendor,vendorSku:sku,purchaseUnit:unit,packCount:2,unitQty:5,unitUOM:'lb',available:true,...extra}]}});
test('both observed guide layouts retain row references and old quantities without inventing stock or pars',()=>{
 const table=readOrderGuide('\uFEFF'+header+',Cooler,,,,,\r\n'+row('001','Fictional food','Test Foods','0.5','2')+row('002','Another','Test Foods','','0')+'\r\n');
 assert.equal(table.layout,'berts');assert.equal(table.sections,1);assert.equal(table.blankRows,1);assert.deepEqual(table.rows.map(r=>[r.row,r.sku,r.oldCount,r.oldOrder]),[[3,'001','0.5','2'],[4,'002','','0']]);assert.equal(table.rows[0].section,'Cooler');
 const rudds=readOrderGuide(guideLayouts.rudds.join(',')+'\n001,0,Fictional food,Brand,100,10,2/5 LB,EA,Test Foods\n');assert.equal(rudds.rows[0].pack,'2/5 LB');assert.equal(rudds.rows[0].oldOrder,'0');assert.equal(rudds.rows[0].oldCount,'');assert.equal('price' in rudds.rows[0],false);assert.equal('par'in rudds.rows[0],false);assert.equal('count'in rudds.rows[0],false);
});
test('quoted commas, newlines and escaped quotes stay in their original cells; malformed CSV fails',()=>{
 const table=readOrderGuide(header+row('001','"Fictional, \"\"label\"\"\nsecond line"'));assert.equal(table.rows[0].description,'Fictional, "label"\nsecond line');assert.equal(table.rows[0].row,2);
 for(const bad of [header+'"unclosed',header+'"closed"junk,x',header+'00"1,x',header+'001,short',header+row()+'a,b,c,d,e,f,g,h,i,j'])assert.throws(()=>readOrderGuide(bad));
});
test('notes remain sections only when no other cells are populated, duplicates and conflicting providers remain visible',()=>{
 const t=readOrderGuide(header+',Section,,,,,\n'+row('','Name-only note','Test Foods','','1')+row('001','One','Test Foods','','','CS','Different')+row('001','Same SKU again'));
 assert.equal(t.sections,1);assert.equal(t.rows.length,3);assert.match(t.rows[0].issues.join(' '),/SKU/);assert.match(t.rows[1].issues.join(' '),/Provider/);for(const r of t.rows.slice(1))assert.match(r.issues.join(' '),/rows 4, 5/);
});
test('exact supplier and SKU match does not infer identity from similar names or merge leading-zero identifiers',()=>{
 const t=readOrderGuide(header+row('001')+row('1')+row('002','Catalog title'));
 const r=reviewOrderGuide(t,[item('first','case',' TEST   FOODS ','001'),item('other-vendor','case','Other Foods','1')]);assert.deepEqual(r.entries.map(e=>e.status),['check-pack','unmatched','unmatched']);assert.equal(r.entries[0].matches[0].itemId,'first');
});
test('same SKU on two items, unavailable packs and purchase-unit conflicts never become an automatic match',()=>{
 const t=readOrderGuide(header+row());assert.equal(reviewOrderGuide(t,[item(),item('two','case','Test Foods','001',{available:false})]).entries[0].status,'ambiguous');
 assert.equal(reviewOrderGuide(t,[item('ea','each')]).entries[0].status,'unit-conflict');assert.equal(reviewOrderGuide(t,[item('unknown','pack')]).entries[0].status,'unit-conflict');
 const r=reviewOrderGuide(t,[item('off','CS','Test Foods','001',{available:false})]);assert.equal(r.entries[0].status,'check-pack');assert.equal(r.entries[0].matches[0].available,false);assert.equal('price'in r.entries[0].matches[0],false);
});
test('missing, formula and unsupported-unit source rows cannot be marked matched even when the catalog shares an identifier',()=>{
 const t=readOrderGuide(header+row('=001')+row('002','Food','Test Foods','','','BOX')+row('003','','Test Foods')+row('004','Food','Test Foods','','','constructor'));
 const r=reviewOrderGuide(t,[]);assert.equal(r.totals['source-issue'],4);assert.equal(r.totals.unmatched,0);
});
test('bounded source parsing rejects changed layouts, oversized cells and too many rows',()=>{
 for(const csv of ['',header,'SKU,Food\n1,x',header+'x'.repeat(guideMaxBytes),header+row('001','x'.repeat(1001)),header+Array(501).fill(row()).join('')])assert.throws(()=>readOrderGuide(csv));
 assert.equal(readOrderGuide(header+Array.from({length:500},(_,n)=>row(String(n))).join('')).rows.length,500);
});
test('catalog match review has no effects on source definitions and bounds ambiguous fanout',()=>{
 const t=readOrderGuide(header+row()),items=[item()],before=JSON.stringify({t,items});reviewOrderGuide(t,items);assert.equal(JSON.stringify({t,items}),before);
 assert.throws(()=>reviewOrderGuide(t,Array.from({length:41},(_,n)=>item(String(n)))),/40/);
 assert.throws(()=>reviewOrderGuide(t,Array(5001).fill(item())),/large/);
});
