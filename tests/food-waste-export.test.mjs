import test from 'node:test';import assert from 'node:assert/strict';
import {excessFixture,rawItem,importInput} from './food-excess-fixture.mjs';
import {handleFood} from '../.sites-runtime/shared/food-service.mjs';
import {wasteExportCsv} from '../.sites-runtime/shared/food-waste-export.mjs';
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
const range={view:'waste-export',from:'2026-09-28',through:'2026-09-28',revision:'1'};
const waste=(extra={})=>({at:'2026-09-28T12:00:00Z',by:'owner',quantity:0.25,reason:'spoilage',note:'Fictional checked observation',pack:{purchaseUnit:'case',packCount:8,unitQty:5,unitUOM:'lb'},item:{title:'Original beef',controlNumber:'BEEF',storageArea:'Walk-in'},cost:{estimatedCents:2313,currency:'USD',basis:'catalog-at-entry',sku:rawItem.vendorSkus[0],issues:[]},...extra});
async function seed(f,events){const base=ok(await f.call('owner','fooditem.import',importInput([rawItem])));await f.db.batch(events.map((event,n)=>f.db.prepare('INSERT INTO food_history(location_id,record_id,revision,actor_id,at,event) VALUES(?,?,?,?,?,?)').bind('a',base.recordId,n+2,'owner',event.waste?.at??'2026-09-30T12:00:00Z',JSON.stringify(event))));return base;}
// A small RFC4180 parser for assertions; quoted commas/newlines must retain their column.
function rows(csv){let out=[],row=[],value='',quoted=false;for(let i=1;i<csv.length;i++){const c=csv[i];if(c==='"'){if(quoted&&csv[i+1]==='"'){value+='"';i++}else quoted=!quoted;}else if(c===','&&!quoted){row.push(value);value=''}else if(c==='\r'&&csv[i+1]==='\n'&&!quoted){row.push(value);out.push(row);row=[];value='';i++;}else value+=c;}const [head,...body]=out;return body.map(r=>{assert.equal(r.length,head.length);return Object.fromEntries(head.map((h,i)=>[h,r[i]]))});}

test('waste export includes all selected entries beyond page 20 and original unit/name evidence',async t=>{
 const f=await excessFixture(t);await seed(f,Array.from({length:26},()=>({waste:waste()})));
 const page=ok(await f.get('manager',{...range,view:'waste'}));assert.equal(page.entries.length,20);assert.equal(page.totals.entries,26);
 const full=ok(await f.get('manager',range));assert.equal(full.kind,'waste-export');assert.equal(full.complete,true);assert.equal(full.next,null);assert.equal(full.entries.length,26);assert.equal(full.dataset,'demo');assert.equal(full.locationId,'a');assert.equal(new Set(full.entries.map(e=>e.sequence)).size,26);
 const csv=rows(wasteExportCsv(full));assert.equal(csv.length,27);assert.equal(csv[0].row_type,'report');assert.equal(csv[0].report_known_subtotal_usd,'601.38');assert.equal(csv[1].item_name,'Original beef');assert.equal(csv[1].item_name_basis,'entry snapshot');assert.equal(csv[1].purchase_unit,'case');assert.equal(csv[1].report_known_subtotal_usd,'');assert.equal(csv[1].included_known_cost_usd,'23.13');
});

test('export keeps true zero, unknown cost, legacy, void and invalid-price evidence separate',async t=>{
 const f=await excessFixture(t),zero=waste();zero.cost.estimatedCents=0;zero.cost.sku={...zero.cost.sku,price:0};const unknown=waste();unknown.cost.estimatedCents=null;unknown.cost.issues=['Price missing'];const legacy=waste({item:undefined,cost:undefined});const invoice=waste();invoice.cost.sku={...invoice.cost.sku,priceSource:{invoiceRevision:90}};
 await seed(f,[{waste:zero},{waste:unknown},{waste:legacy},{waste:waste()},{waste:invoice},{wasteVoid:{wasteRevision:5,reason:'Wrong entry',at:'2026-09-30T12:00:00Z',by:'owner'}},{invoiceVoid:{invoiceRevision:90,reason:'Wrong source',at:'2026-09-30T12:00:00Z',by:'owner'}}]);
 const full=ok(await f.get('buyer',range)),csv=rows(wasteExportCsv(full));assert.deepEqual(full.totals,{entries:5,voided:1,active:4,costed:1,uncosted:3,knownEstimatedCents:0});assert.equal(csv[0].report_known_subtotal_usd,'0.00');assert.equal(csv[1].included_known_cost_usd,'0.00');assert.equal(csv[2].included_known_cost_usd,'');assert.equal(csv[2].cost_issues,'Price missing');assert.equal(csv[3].cost_status,'no historical cost snapshot');assert.equal(csv[3].item_name_basis,'current catalog fallback');assert.equal(csv[4].entry_status,'voided');assert.equal(csv[4].original_estimated_cost_usd,'23.13');assert.equal(csv[4].included_known_cost_usd,'');assert.equal(csv[5].cost_status,'source invoice voided');assert.equal(csv[5].included_known_cost_usd,'');
});

test('export retains empty-scope metadata without inventing a costed zero',async t=>{
 const f=await excessFixture(t),full=ok(await f.get('owner',{...range,revision:'0'}));assert.equal(full.entries.length,0);const csv=rows(wasteExportCsv(full));assert.equal(csv.length,1);assert.equal(csv[0].restaurant_id,'a');assert.equal(csv[0].dataset,'demo');assert.equal(csv[0].start_date,'2026-09-28');assert.equal(csv[0].report_entries,'0');assert.equal(csv[0].report_known_subtotal_usd,'');assert.match(csv[0].boundary,/not booked expenses/);
});

test('export fails stale or missing revision and partial cursors before returning data',async t=>{
 const f=await excessFixture(t);await seed(f,[{waste:waste()}]);for(const revision of ['0','','bad'])assert.equal((await f.get('owner',{...range,revision})).status,409);const {revision,...without}=range;assert.equal((await f.get('owner',without)).status,409);assert.equal((await f.get('owner',{...range,after:'1'})).status,400);assert.equal((await f.get('owner',{...range,through:'2026-11-01'})).status,400);
});

test('export enforces roles, restaurant scope and separate operating/demo datasets',async t=>{
 const f=await excessFixture(t);await seed(f,[{waste:waste()}]);for(const who of ['owner','manager','buyer'])assert.equal(ok(await f.get(who,range)).entries.length,1);for(const who of ['foh','worker','foreign'])assert.equal((await f.get(who,range)).status,403);assert.equal(ok(await f.get('owner',{...range,dataset:'operating'})).entries.length,0);assert.equal(ok(await f.get('foreign',{...range,locationId:'b',revision:'0'})).entries.length,0);assert.equal((await f.get('owner',{...range,dataset:'other'})).status,400);
});

test('export respects a 25-hour restaurant-local DST day and rejects a 501-entry result',async t=>{
 const f=await excessFixture(t);await seed(f,['2026-11-01T03:59:59Z','2026-11-01T04:00:00Z','2026-11-02T04:59:59Z','2026-11-02T05:00:00Z'].map(at=>({waste:waste({at})})));assert.equal(ok(await f.get('owner',{...range,from:'2026-11-01',through:'2026-11-01'})).entries.length,2);
 const id=(await f.db.prepare('SELECT id FROM food_records LIMIT 1').first()).id;await f.db.batch(Array.from({length:501},(_,n)=>f.db.prepare('INSERT INTO food_history(location_id,record_id,revision,actor_id,at,event) VALUES(?,?,?,?,?,?)').bind('a',id,n+10,'owner','2026-09-28T12:00:00Z',JSON.stringify({waste:waste()}))));const blocked=await f.get('owner',range);assert.equal(blocked.status,413);assert.match(blocked.data.error,/no partial export/);assert.equal('entries' in blocked.data,false);
});

test('export rechecks record, membership and restaurant settings after the read',async t=>{
 for(const change of ["UPDATE food_state SET revision=revision+1 WHERE location_id='a'","UPDATE memberships SET active=0 WHERE id='manager'","UPDATE locations SET revision=revision+1,timezone='UTC' WHERE id='a'"]){
  const f=await excessFixture(t);await seed(f,[{waste:waste()}]);let changed=false;const wrapped={withSession(){return this;},prepare:s=>f.db.prepare(s),batch:async statements=>{const result=await f.db.batch(statements);if(!changed&&result[0]?.results[0]&&Object.hasOwn(result[0].results[0],'costed')){changed=true;await f.db.prepare(change).run()}return result}};
  const response=await handleFood(new Request('https://test.example/api/food?'+new URLSearchParams({locationId:'a',dataset:'demo',...range}),{headers:f.headers('manager')}),wrapped),body=await response.json();assert.ok([403,409].includes(response.status),JSON.stringify({change,changed,status:response.status,body}));assert.equal(changed,true);assert.equal('entries' in body,false);
 }
});

test('CSV quotes commas/newlines and neutralizes formula-leading source text without losing columns',async t=>{
 const f=await excessFixture(t);await seed(f,[{waste:waste({note:' =HYPERLINK("x")\nline, two',item:{title:'@SUM(A1)',controlNumber:'+001',storageArea:'Freezer'}})}]);const full=ok(await f.get('owner',range)),csv=rows(wasteExportCsv(full));assert.equal(csv[1].item_name,"'@SUM(A1)");assert.equal(csv[1].control_number,"'+001");assert.equal(csv[1].note,"' =HYPERLINK(\"x\")\nline, two");assert.equal(csv[1].quantity,'0.25');assert.throws(()=>wasteExportCsv({...full,entries:[]}));assert.throws(()=>wasteExportCsv({...full,next:23}));
});
