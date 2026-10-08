import test from 'node:test';import assert from 'node:assert/strict';
import {excessFixture,rawItem,importInput} from './food-excess-fixture.mjs';
import {handleFood} from '../.sites-runtime/shared/food-service.mjs';
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
const range={view:'waste-items',from:'2026-09-28',through:'2026-09-28',revision:'1'};
const waste=(extra={})=>({at:'2026-09-28T12:00:00Z',by:'owner',quantity:0.25,reason:'spoilage',note:'Fictional checked observation',pack:{purchaseUnit:'case',packCount:8,unitQty:5,unitUOM:'lb'},item:{title:'Original beef',controlNumber:'BEEF',storageArea:'Walk-in'},cost:{estimatedCents:2313,currency:'USD',basis:'catalog-at-entry',sku:rawItem.vendorSkus[0],issues:[]},...extra});
async function seed(f,events){const base=ok(await f.call('owner','fooditem.import',importInput([rawItem])));await f.db.batch(events.map((event,n)=>f.db.prepare('INSERT INTO food_history(location_id,record_id,revision,actor_id,at,event) VALUES(?,?,?,?,?,?)').bind('a',base.recordId,n+2,'owner',event.waste?.at??'2026-09-30T12:00:00Z',JSON.stringify(event))));return base;}

test('item breakdown aggregates beyond the observation page and groups pack fields independent of JSON order',async t=>{
 const f=await excessFixture(t);await seed(f,[...Array.from({length:25},()=>({waste:waste()})),{waste:waste({pack:{unitUOM:'lb',unitQty:5,packCount:8,purchaseUnit:'case'}})}]);
 const entryPage=ok(await f.get('manager',{...range,view:'waste'})),r=ok(await f.get('manager',range));assert.equal(entryPage.entries.length,20);assert.equal(r.totalGroups,1);assert.equal(r.groups.length,1);assert.equal(r.groups[0].active,26);assert.equal(r.groups[0].activeQuantity,6.5);assert.equal(r.groups[0].knownEstimatedCents,60138);assert.equal(r.next,null);assert.equal(r.groups[0].title,'Original beef');assert.equal(r.groups[0].nameBasis,'entry snapshot');
});
test('changed exact packs, units, saved identity and storage remain separate with no catalog substitution',async t=>{
 const f=await excessFixture(t),base=await seed(f,[{waste:waste()},{waste:waste({pack:{purchaseUnit:'case',packCount:4,unitQty:5,unitUOM:'lb'}})},{waste:waste({pack:{purchaseUnit:'bag',packCount:8,unitQty:5,unitUOM:'lb'}})},{waste:waste({item:{title:'Renamed observation',controlNumber:'BEEF',storageArea:'Walk-in'}})},{waste:waste({item:{title:'Original beef',controlNumber:'BEEF',storageArea:'Freezer'}})},{waste:waste({item:undefined,cost:undefined})}]);
 await f.db.prepare("UPDATE food_records SET title='Current corrected name' WHERE id=?").bind(base.recordId).run();
 const r=ok(await f.get('owner',range));assert.equal(r.totalGroups,6);assert.equal(r.groups.find(g=>g.nameBasis==='current catalog fallback').title,'Current corrected name');assert.equal(r.groups.filter(g=>g.title==='Original beef').length,4);assert.equal(r.groups.reduce((s,g)=>s+g.active,0),6);assert.equal(r.groups.every(g=>g.activeQuantity===0.25),true);
});
test('item totals distinguish real zero, legacy and invalid source cost while excluding later voids',async t=>{
 const f=await excessFixture(t),zero=waste(),unknown=waste(),invalid=waste();zero.cost.estimatedCents=0;unknown.cost.estimatedCents=null;invalid.cost.sku={...invalid.cost.sku,priceSource:{invoiceRevision:90}};
 await seed(f,[{waste:zero},{waste:unknown},{waste:waste({cost:undefined})},{waste:waste()},{waste:invalid},{wasteVoid:{wasteRevision:5}},{invoiceVoid:{invoiceRevision:90}}]);
 const r=ok(await f.get('buyer',range)),g=r.groups[0];assert.equal(r.totalGroups,1);assert.equal(g.entries,5);assert.equal(g.voided,1);assert.equal(g.active,4);assert.equal(g.activeQuantity,1);assert.equal(g.costed,1);assert.equal(g.uncosted,3);assert.equal(g.knownEstimatedCents,0);
});
test('item pagination ranks known estimates over the full range without duplicated groups',async t=>{
 const f=await excessFixture(t);await seed(f,Array.from({length:25},(_,n)=>({waste:waste({item:{title:'Item '+n,controlNumber:'KEY'+n,storageArea:'Walk-in'},cost:{...waste().cost,estimatedCents:n*100}})})));
 const first=ok(await f.get('owner',range)),last=ok(await f.get('owner',{...range,after:String(first.next)}));assert.equal(first.totalGroups,25);assert.equal(first.groups.length,20);assert.equal(first.next,20);assert.equal(last.groups.length,5);assert.equal(last.next,null);assert.equal(first.groups[0].knownEstimatedCents,2400);assert.equal(last.groups.at(-1).knownEstimatedCents,0);assert.equal(new Set([...first.groups,...last.groups].map(g=>g.sequence)).size,25);
});
test('item read enforces current parent revision, page bounds, roles and dataset/restaurant isolation',async t=>{
 const f=await excessFixture(t);await seed(f,[{waste:waste()}]);
 for(const actor of ['owner','manager','buyer'])assert.equal(ok(await f.get(actor,range)).totalGroups,1);
 for(const actor of ['foh','worker','foreign'])assert.equal((await f.get(actor,range)).status,403);
 assert.equal(ok(await f.get('owner',{...range,dataset:'operating'})).totalGroups,0);assert.equal(ok(await f.get('foreign',{...range,locationId:'b',revision:'0'})).groups.length,0);
 for(const revision of ['','0','bad'])assert.equal((await f.get('owner',{...range,revision})).status,409);
 const {revision,...noRevision}=range;assert.equal((await f.get('owner',noRevision)).status,409);
 for(const after of ['1','-20','1.5','1000020','bad'])assert.equal((await f.get('owner',{...range,after})).status,400);
 assert.equal((await f.get('owner',{...range,through:'2026-11-01'})).status,400);
});
test('item grouping uses restaurant-local DST boundaries and keeps empty scope truthful',async t=>{
 const f=await excessFixture(t);assert.equal(ok(await f.get('owner',{...range,revision:'0'})).totalGroups,0);
 await seed(f,['2026-11-01T03:59:59Z','2026-11-01T04:00:00Z','2026-11-02T04:59:59Z','2026-11-02T05:00:00Z'].map(at=>({waste:waste({at})})));
 const r=ok(await f.get('owner',{...range,from:'2026-11-01',through:'2026-11-01'}));assert.equal(r.groups[0].active,2);assert.equal(r.groups[0].activeQuantity,0.5);
});
test('item combined cost overflow is unknown rather than a rounded unsafe money total',async t=>{
 const f=await excessFixture(t);await seed(f,Array.from({length:2},()=>({waste:waste({cost:{...waste().cost,estimatedCents:Number.MAX_SAFE_INTEGER}})})));const g=ok(await f.get('owner',range)).groups[0];assert.equal(g.costed,2);assert.equal(g.knownEstimatedCents,null);
});
test('item read rechecks membership, food and restaurant revision after aggregation',async t=>{
 for(const change of ["UPDATE food_state SET revision=revision+1 WHERE location_id='a'","UPDATE memberships SET active=0 WHERE id='manager'","UPDATE locations SET revision=revision+1,timezone='UTC' WHERE id='a'"]){
  const f=await excessFixture(t);await seed(f,[{waste:waste()}]);let changed=false;const wrapped={withSession(){return this},prepare:s=>f.db.prepare(s),batch:async statements=>{const result=await f.db.batch(statements);if(!changed&&result[1]?.results[0]&&Object.hasOwn(result[1].results[0],'group_sequence')){changed=true;await f.db.prepare(change).run()}return result}};
  const response=await handleFood(new Request('https://test.example/api/food?'+new URLSearchParams({locationId:'a',dataset:'demo',...range}),{headers:f.headers('manager')}),wrapped),body=await response.json();assert.equal(changed,true);assert.ok([403,409].includes(response.status),JSON.stringify(body));assert.equal('groups'in body,false);
 }
});
