import test from 'node:test';
test('issue quantities and net amounts are independent checked facts; blanks stay unknown and explicit zero stays zero',()=>{
 const invoice=parseInvoiceLine(invoiceInput,parseFoodItem(rawItem,source),'2026-09-29T12:00:00Z','buyer','America/New_York');
 const parse=extra=>parseClaim({...claimInput(2),...extra},invoice,'2026-09-29T12:00:00Z','buyer','America/New_York');
 for(const extra of [{},{quantity:'',amount:''},{quantity:null,amount:null}])assert.equal(parse(extra).impact,undefined);
 assert.deepEqual(parse({quantity:'20.5',quantityUnit:'lbs'}).impact,{quantity:20.5,unit:'lb'});
 assert.deepEqual(parse({amount:'0.00'}).impact,{amountCents:0});
 assert.deepEqual(parse({amount:'35.57'}).impact,{amountCents:3557});
 // A supplied amount is deliberately not prorated from the line's price or quantity.
 assert.deepEqual(parse({quantity:'20',quantityUnit:'lb',amount:'35.57'}).impact,{quantity:20,unit:'lb',amountCents:3557});
 assert.deepEqual(parse({quantity:80,quantityUnit:'lb',amount:200}).impact,{quantity:80,unit:'lb',amountCents:20000});
 assert.equal(parse({impact:{quantity:99,unit:'case',amountCents:9999}}).impact,undefined);
});
test('issue impact rejects wrong units, excess quantities/amounts and malformed numbers without guessing conversions',()=>{
 const invoice=parseInvoiceLine(invoiceInput,parseFoodItem(rawItem,source),'2026-09-29T12:00:00Z','buyer','America/New_York');
 const parse=extra=>parseClaim({...claimInput(2),...extra},invoice,'2026-09-29T12:00:00Z','buyer','America/New_York');
 for(const quantity of [0,-1,80.01,Infinity,NaN,true,[],{},' ','1,000','NaN'])assert.throws(()=>parse({quantity,quantityUnit:'lb'}));
 for(const quantityUnit of [undefined,null,'case','oz','kg','each',12])assert.throws(()=>parse({quantity:1,quantityUnit}));
 for(const amount of [-1,200.01,Infinity,NaN,true,[],{},' ','$1','1,000','1e2','1.001'])assert.throws(()=>parse({amount}));
 // Zero-value invoice can still have a quantity question, but not an invented positive net amount.
 const free={...invoice,lineTotalCents:0};
 assert.deepEqual(parseClaim({...claimInput(2),quantity:1,quantityUnit:'lb',amount:'0'},free,'2026-09-29T12:00:00Z','buyer','America/New_York').impact,{quantity:1,unit:'lb',amountCents:0});
 assert.throws(()=>parseClaim({...claimInput(2),amount:1},free,'2026-09-29T12:00:00Z','buyer','America/New_York'));
});
test('issue impact retains original invoice units through catalog edits, internal closure and explicit correction history',async t=>{
 const f=await setup(t),before=ok(await f.view('owner')).records[0];
 let current=ok(await f.call('buyer','fooditem.claim',{...claimInput(2),quantity:20,quantityUnit:'lb',amount:'35.57',invoice:{quantity:999,invoiceUnit:'case'}},f.invoice));
 const firstRevision=current.revision;
 current=ok(await f.call('owner','fooditem.configure',{item:{...before.data,name:'Changed catalog',restaurantId:'demo_diner',vendorSkus:before.data.vendorSkus.map(s=>({...s,purchaseUnit:'bag',packCount:2}))},reason:'Fictional catalog change'},current));
 current=ok(await f.call('buyer','fooditem.claim-update',{...updateInput(firstRevision,'closed'),quantity:1,amount:'1',impact:{quantity:1}},current));
 const original=(await history(f)).find(e=>e.revision===firstRevision);
 assert.deepEqual(original.event.supplierClaim.impact,{quantity:20,unit:'lb',amountCents:3557});
 assert.equal(original.event.supplierClaim.invoice.sku.purchaseUnit,'case');
 let queue=ok(await f.get('owner',{view:'claims',filter:'closed'}));
 assert.deepEqual(queue.entries[0].claim.impact,original.event.supplierClaim.impact);
 assert.equal(queue.entries[0].latest.state,'closed');
 current=ok(await f.call('buyer','fooditem.claim-update',{...updateInput(firstRevision,'cancelled'),note:'Corrected original checked quantity'},current));
 current=ok(await f.call('buyer','fooditem.claim',{...claimInput(2),reference:'CORRECTED-IMPACT',quantity:10,quantityUnit:'lb',amount:'20.00'},current));
 const entries=await history(f);assert.equal(entries.find(e=>e.revision===firstRevision).claimLatest.state,'cancelled');
 assert.deepEqual(entries.find(e=>e.revision===firstRevision).event.supplierClaim.impact,{quantity:20,unit:'lb',amountCents:3557});
 assert.deepEqual(entries.find(e=>e.revision===current.revision).event.supplierClaim.impact,{quantity:10,unit:'lb',amountCents:2000});
 assert.deepEqual(entries.find(e=>e.revision===2).invoiceCredits,{entries:0,amountCents:0,quantity:0});
 assert.deepEqual(ok(await f.view('owner')).records[0].data.count,before.data.count);
});
test('structured issue saves preserve scope, rollback and exact retry behavior; no invoice, credit or price changes',async t=>{
 const f=await setup(t),input={...claimInput(2),quantity:20,quantityUnit:'lb',amount:'35.57'},before=ok(await f.view('owner')).records[0];
 for(const actor of ['manager','worker','foh','foreign'])assert.equal((await f.call(actor,'fooditem.claim',input,f.invoice)).status,403);
 assert.equal((await f.call('buyer','fooditem.claim',{...input,quantityUnit:'case'},f.invoice)).status,400);
 assert.equal((await f.call('buyer','fooditem.claim',{...input,amount:'200.01'},f.invoice)).status,400);
 const requestId=crypto.randomUUID();
 await f.db.prepare("CREATE TRIGGER reject_impact BEFORE INSERT ON food_history BEGIN SELECT RAISE(ABORT,'fixture rollback'); END").run();
 assert.equal((await f.call('buyer','fooditem.claim',input,f.invoice,{requestId})).status,503);
 assert.deepEqual(ok(await f.view('owner')).records[0],before);
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM food_receipts WHERE request_id=?').bind(requestId).first()).n,0);
 await f.db.prepare('DROP TRIGGER reject_impact').run();
 const saved=ok(await f.call('buyer','fooditem.claim',input,f.invoice,{requestId}));
 assert.deepEqual(ok(await f.call('buyer','fooditem.claim',input,f.invoice,{requestId})),saved);
 const entries=await history(f);assert.equal(entries.filter(e=>e.event.supplierClaim).length,1);
 assert.deepEqual(entries.find(e=>e.event.supplierClaim).event.supplierClaim.impact,{quantity:20,unit:'lb',amountCents:3557});
 assert.equal(entries.find(e=>e.revision===2).event.invoiceLine.lineTotalCents,20000);
 assert.deepEqual(entries.find(e=>e.revision===2).invoiceCredits,{entries:0,amountCents:0,quantity:0});
 const after=ok(await f.view('owner')).records[0];assert.deepEqual(after.data.count,before.data.count);assert.deepEqual(after.data.vendorSkus,before.data.vendorSkus);
 assert.equal(ok(await f.get('owner',{view:'claims',dataset:'operating'})).total,0);
 assert.equal(ok(await f.get('foreign',{view:'claims',locationId:'b'})).total,0);
});
test('supplier-pack issues keep fractional cases; unknown and checked impacts coexist without cross-unit totals',async t=>{
 const f=await setup(t);
 const legacy=ok(await f.call('buyer','fooditem.claim',claimInput(2),f.invoice));
 const second=ok(await f.call('buyer','fooditem.invoice',{...invoiceInput,invoiceNumber:'CASE-INVOICE',quantity:2,invoiceUnit:'case',unitBasis:'supplier-pack'},legacy));
 const saved=ok(await f.call('buyer','fooditem.claim',{...claimInput(second.revision),reference:'CASE-ISSUE',quantity:.5,quantityUnit:'cases',amount:'35.57'},second));
 const q=ok(await f.get('owner',{view:'claims'}));assert.equal(q.total,2);
 assert.deepEqual(q.entries.find(e=>e.claimRevision===saved.revision).claim.impact,{quantity:.5,unit:'case',amountCents:3557});
 assert.equal(q.entries.find(e=>e.claimRevision===legacy.revision).claim.impact,undefined);
 assert.deepEqual(Object.keys(q.totals).sort(),['cancelled','closed','due','pending']);
});
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {handleFood} from '../.sites-runtime/shared/food-service.mjs';
import {parseFoodItem,parseFoodRecipe} from '../.sites-runtime/shared/food.mjs';
import {foodItemCost,foodRecipeCost,foodShortfall} from '../.sites-runtime/shared/food-model.mjs';
import {jeffDemo} from './food-fixture.mjs';
import {parseInvoiceLine,invoiceUnit} from '../.sites-runtime/shared/food-invoice.mjs';
import {wasteCost} from '../.sites-runtime/shared/food-waste.mjs';
import {parseCredit} from '../.sites-runtime/shared/food-credit.mjs';
import {parseReceiving} from '../.sites-runtime/shared/food-receiving.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
const source={dataset:'demo',sourceRestaurantId:'demo_diner',label:'Fabricated fixture',importedAt:'2026-09-28T12:00:00Z',importedBy:'owner'};
export const rawItem={restaurantId:'demo_diner',name:'Demo beef',controlNumber:'BEEF',storageArea:'Walk-in',purchaseUnit:'case',packCount:8,unitQty:5,unitUOM:'lb',portionSize:6,portionUOM:'oz',par:4,currentStock:99,lastCounted:'2026-09-28',vendorSkus:[{id:'sku1',vendor:'Demo supplier',vendorSku:'1',purchaseUnit:'case',packCount:8,unitQty:5,unitUOM:'lb',price:92.5,priceUpdatedAt:'2026-09-28',preferred:true,available:true}]};
const rawRecipe={restaurantId:'demo_diner',id:'burger',name:'Demo burger',recipeType:'menu',yieldQty:1,yieldUOM:'each',lines:[{sourceType:'item',controlNumber:'BEEF',qty:1}]};
const importInput=rows=>({dataset:'demo',sourceRestaurantId:'demo_diner',sourceLabel:'Fabricated test fixture',destinationLocationId:'a',confirmed:true,rows});
async function fixture(t){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync(`drizzle/${file}`,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const loc of ['a','b'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(loc,loc,'America/New_York').run();
 for(const [id,area,caps,loc='a'] of [['owner','Executive',['location.manage']],['manager','BOH',['tasks.manage']],['buyer','FOH',['orders.review']],['foh','FOH',['tasks.manage']],['worker','BOH',[]],['foreign','BOH',['location.manage'],'b']])await db.prepare('INSERT INTO memberships(id,email,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?)').bind(id,id+'@example.test',loc,id,area,'Manager',JSON.stringify(caps),'[]').run();
 const headers=id=>({'oai-authenticated-user-id':id+'-identity','oai-authenticated-user-email':id+'@example.test'});
 const call=async(id,action,input={},record,extra={})=>{const response=await handleFood(new Request('https://test.example/api/food',{method:'POST',headers:{...headers(id),Origin:'https://test.example','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),locationId:'a',action,input,...(record?{recordId:record.recordId??record.id,expectedRevision:record.revision}:{}),...extra})}),db);return {status:response.status,data:await response.json()}};
 const get=async(actor,params={})=>{const r=await handleFood(new Request('https://test.example/api/food?'+new URLSearchParams({locationId:'a',dataset:'demo',...params}),{headers:headers(actor)}),db);return {status:r.status,data:await r.json()}};
 const view=async(actor,loc='a')=>{const items=await get(actor,{locationId:loc}),recipes=await get(actor,{locationId:loc,kind:'foodrecipe'});return items.status===200?{...items,data:{...items.data,records:[...items.data.records,...recipes.data.records]}}:items};return {db,call,view,get,headers};
}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
const invoiceInput={skuId:'sku1',invoiceNumber:'DEMO-100',lineReference:'1',invoiceDate:'2026-09-28',sourceNote:'Fictional test invoice, page 1',quantity:80,unitBasis:'measure',invoiceUnit:'lbs',lineTotal:'200.00',confirmed:true};
const priceInput=invoiceRevision=>({invoiceRevision,reason:'Checked current supplier price against invoice',confirmed:true});
const creditInput=invoiceRevision=>({invoiceRevision,creditNumber:'CREDIT-1',lineReference:'1',creditDate:'2026-09-28',sourceNote:'Fictional issued supplier credit document page 1',reason:'returned',quantity:20,amount:'50.00',confirmed:true});
const receivingInput=invoiceRevision=>({invoiceRevision,deliveryReference:'DEMO-TICKET-1',receivedDate:'2026-09-28',accepted:30,rejected:10,rejectionReason:'Package damaged at delivery',note:'Fictional receiving fixture',confirmed:true});

import {parseClaim,parseClaimUpdate} from '../.sites-runtime/shared/food-claim.mjs';
const claimInput=invoiceRevision=>({invoiceRevision,reference:'DEMO-ISSUE-1',openedDate:'2026-09-28',followUpDate:'2026-09-29',reason:'shortage',details:'Fictional ticket notes missing goods; needs purchasing follow-up. No supplier contacted.',confirmed:true});
const updateInput=(claimRevision,state='pending')=>({claimRevision,state,followUpDate:'2026-09-30',note:'Fictional follow-up evidence'});
async function setup(t){const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),invoice=ok(await f.call('buyer','fooditem.invoice',invoiceInput,base));return {...f,base,invoice};}
const history=async f=>ok(await f.get('owner',{view:'history',recordId:f.base.recordId})).entries;

test('supplier issues validate dates, evidence and original invoice snapshots',()=>{
 const item=parseFoodItem(rawItem,source),at='2026-09-29T03:00:00Z',invoice=parseInvoiceLine(invoiceInput,item,at,'buyer','America/New_York'),input=claimInput(2);
 const c=parseClaim(input,invoice,at,'buyer','America/New_York');assert.notEqual(c.invoice,invoice);assert.equal(c.invoice.quantity,80);assert.equal(c.by,'buyer');
 for(const invalid of [{confirmed:false},{reference:' '},{reason:'made-up'},{details:''},{invoiceRevision:1.1},{openedDate:'2026-09-29'},{openedDate:'2026-09-27'},{followUpDate:'2026-09-27'},{followUpDate:'2026-02-30'}])assert.throws(()=>parseClaim({...input,...invalid},invoice,at,'buyer','America/New_York'));
 for(const invalid of [{claimRevision:0},{state:'paid'},{note:''},{followUpDate:''}])assert.throws(()=>parseClaimUpdate({...updateInput(3),...invalid},at,'buyer'));
 assert.equal(parseClaimUpdate({...updateInput(3,'closed'),followUpDate:'malformed'},at,'buyer').followUpDate,'');
});
test('pending follow-up, internal close, reopen and cancelled corrections retain source and updates without changing credits, stock or costs',async t=>{
 const f=await setup(t),before=ok(await f.view('owner')).records[0];let current=ok(await f.call('buyer','fooditem.claim',{...claimInput(2),invoice:{quantity:999},by:'spoof'},f.invoice));
 assert.equal((await f.call('buyer','fooditem.claim',claimInput(2),current)).status,409);
 const original=current;current=ok(await f.call('buyer','fooditem.claim-update',updateInput(3),current));current=ok(await f.call('buyer','fooditem.claim-update',updateInput(3,'closed'),current));
 assert.equal((await f.call('buyer','fooditem.claim-update',updateInput(3,'closed'),current)).status,409);
 let entries=await history(f);assert.equal(entries.find(e=>e.revision===2).invoiceClaim.latest.state,'closed');assert.equal(entries.find(e=>e.revision===3).event.supplierClaim.invoice.quantity,80);
 assert.equal((await f.call('buyer','fooditem.invoice-void',{invoiceRevision:2,reason:'Orphan test'},current)).status,409);
 current=ok(await f.call('buyer','fooditem.claim-update',{...updateInput(3),note:'Reopened with retained original outcome'},current));current=ok(await f.call('owner','fooditem.claim-update',updateInput(3,'cancelled'),current));
 assert.equal((await f.call('buyer','fooditem.claim-update',updateInput(3),current)).status,409);
 const corrected=ok(await f.call('buyer','fooditem.claim',{...claimInput(2),reference:'CORRECTED'},current));entries=await history(f);assert.equal(entries.find(e=>e.revision===3).claimLatest.state,'cancelled');assert.equal(entries.find(e=>e.revision===2).invoiceClaim.revision,corrected.revision);assert.equal(entries.filter(e=>e.event.claimUpdate).length,4);
 const after=ok(await f.view('owner')).records[0];assert.deepEqual(after.data.count,before.data.count);assert.deepEqual(after.data.vendorSkus,before.data.vendorSkus);assert.deepEqual(entries.find(e=>e.revision===2).invoiceCredits,{entries:0,amountCents:0,quantity:0});assert.equal(entries.find(e=>e.revision===original.revision).event.supplierClaim.by,'buyer');
});
test('cancelled issues permit source correction but voided invoices and wrong item/store sources reject new issues',async t=>{
 const f=await setup(t),c=ok(await f.call('buyer','fooditem.claim',claimInput(2),f.invoice)),cancelled=ok(await f.call('buyer','fooditem.claim-update',updateInput(c.revision,'cancelled'),c)),v=ok(await f.call('buyer','fooditem.invoice-void',{invoiceRevision:2,reason:'Correct invoice'},cancelled));
 assert.equal((await f.call('buyer','fooditem.claim',claimInput(2),v)).status,409);assert.equal((await f.call('buyer','fooditem.claim-update',updateInput(2),v)).status,404);
 const other=ok(await f.call('owner','fooditem.import',importInput([{...rawItem,controlNumber:'OTHER'}])));assert.equal((await f.call('buyer','fooditem.claim',claimInput(2),other)).status,404);
});
test('only purchasing reviewers change supplier issues; role/store/dataset boundaries and revoked access apply',async t=>{
 const f=await setup(t);for(const actor of ['manager','worker','foh','foreign'])assert.equal((await f.call(actor,'fooditem.claim',claimInput(2),f.invoice)).status,403);
 const c=ok(await f.call('buyer','fooditem.claim',claimInput(2),f.invoice));for(const actor of ['manager','worker','foh','foreign'])assert.equal((await f.call(actor,'fooditem.claim-update',updateInput(c.revision),c)).status,403);
 assert.equal(ok(await f.get('manager',{view:'claims'})).total,1);for(const actor of ['worker','foh','foreign'])assert.equal((await f.get(actor,{view:'claims'})).status,403);
 assert.equal(ok(await f.get('owner',{view:'claims',dataset:'operating'})).total,0);assert.equal(ok(await f.get('foreign',{view:'claims',locationId:'b'})).total,0);
 await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='buyer'").run();assert.equal((await f.call('buyer','fooditem.claim-update',updateInput(c.revision),c)).status,403);ok(await f.call('owner','fooditem.claim-update',updateInput(c.revision),c));
});
test('queue searches original supplier and invoice evidence, filters latest full-history status, and pages with revision guard',async t=>{
 const f=await setup(t);let current=f.invoice;const claims=[];
 for(let n=0;n<24;n++){if(n)current=ok(await f.call('buyer','fooditem.invoice',{...invoiceInput,invoiceNumber:'PAGE-'+n},current));current=ok(await f.call('buyer','fooditem.claim',{...claimInput(current.revision),reference:'CASE-'+n,followUpDate:n===0?'2099-01-01':'2026-09-28'},current));claims.push(current);}
 const q={view:'claims'},first=ok(await f.get('owner',q));assert.equal(first.entries.length,20);assert.equal(first.total,24);assert.equal(first.totals.due,23);assert.ok(first.next);
 const second=ok(await f.get('owner',{...q,before:String(first.next),revision:String(first.revision),day:first.today}));assert.equal((await f.get('owner',{...q,before:String(first.next),revision:String(first.revision),day:'2026-01-01'})).status,409);assert.equal(second.entries.length,4);assert.equal(new Set([...first.entries,...second.entries].map(e=>e.sequence)).size,24);assert.equal(second.next,null);
 assert.equal((await f.get('owner',{...q,before:String(first.next)})).status,409);assert.equal((await f.get('owner',{...q,filter:'bad'})).status,400);
 current=ok(await f.call('buyer','fooditem.claim-update',updateInput(claims[0].revision,'closed'),current));assert.equal((await f.get('owner',{...q,before:String(first.next),revision:String(first.revision),day:first.today})).status,409);
 let entries=await history(f);assert.equal(entries.find(e=>e.revision===claims[0].revision).claimLatest.state,'closed');assert.equal(entries.find(e=>e.revision===2).invoiceClaim.latest.state,'closed');
 let page=ok(await f.get('owner',{...q,filter:'closed',q:' demo-100 '}));assert.equal(page.total,1);assert.equal(page.entries[0].latest.state,'closed');assert.equal(page.entries[0].claim.invoice.sku.packCount,8);
 assert.equal(ok(await f.get('owner',{...q,q:'DEMO SUPPLIER'})).total,23);assert.equal(ok(await f.get('owner',{...q,filter:'due'})).total,23);
 current=ok(await f.call('owner','fooditem.claim-update',updateInput(claims[0].revision,'cancelled'),current));assert.equal(ok(await f.get('owner',{...q,filter:'cancelled'})).total,1);assert.equal(ok(await f.get('owner',{...q,filter:'all'})).total,24);
});
test('issue saves and follow-ups are atomic and exact retries safe; concurrent creation and source void have one winner',async t=>{
 const f=await setup(t);let current=f.invoice;
 for(const [action,input] of [['fooditem.claim',claimInput(2)],['fooditem.claim-update',updateInput(3)]]){
 const requestId=crypto.randomUUID(),before=ok(await f.view('owner')).records[0],rev=ok(await f.get('owner')).revision;
 await f.db.prepare("CREATE TRIGGER reject_claim BEFORE INSERT ON food_history BEGIN SELECT RAISE(ABORT,'test failure'); END").run();assert.equal((await f.call('buyer',action,input,current,{requestId})).status,503);assert.deepEqual(ok(await f.view('owner')).records[0],before);assert.equal(ok(await f.get('owner')).revision,rev);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM food_receipts WHERE request_id=?').bind(requestId).first()).n,0);
 await f.db.prepare('DROP TRIGGER reject_claim').run();const saved=ok(await f.call('buyer',action,input,current,{requestId}));assert.deepEqual(ok(await f.call('buyer',action,input,current,{requestId})),saved);current=saved;}
 const updates=await Promise.all(['buyer','owner'].map(actor=>f.call(actor,'fooditem.claim-update',updateInput(3),current)));assert.deepEqual(updates.map(r=>r.status).sort(),[200,409]);
 const g=await setup(t),races=await Promise.all(['buyer','owner'].map(actor=>g.call(actor,'fooditem.claim',claimInput(2),g.invoice)));assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
 const h=await setup(t),sources=await Promise.all([h.call('buyer','fooditem.claim',claimInput(2),h.invoice),h.call('owner','fooditem.invoice-void',{invoiceRevision:2,reason:'Race source'},h.invoice)]);assert.deepEqual(sources.map(r=>r.status).sort(),[200,409]);
});

test('mid-read membership or Food revision changes reject stale supplier issue pages',async t=>{
 for(const change of ['membership','food']){
 const f=await setup(t);ok(await f.call('buyer','fooditem.claim',claimInput(2),f.invoice));let changed=false;
 const wrapped={withSession:()=>wrapped,prepare:(...args)=>f.db.prepare(...args),batch:async statements=>{const result=await f.db.batch(statements);if(statements.length===3&&result[0].results[0]&&'pending'in result[0].results[0]&&!changed){changed=true;await f.db.prepare(change==='membership'?"UPDATE memberships SET revision=revision+1 WHERE id='buyer'":"UPDATE food_state SET revision=revision+1 WHERE location_id='a'").run();}return result;}};
 const response=await handleFood(new Request('https://test.example/api/food?locationId=a&dataset=demo&view=claims',{headers:f.headers('buyer')}),wrapped);assert.equal(response.status,409);assert.equal(changed,true);
 }
});
test('large supplier issue histories stay bounded and do not enlarge daily workspace data; source units survive catalog corrections',async t=>{
 const f=await setup(t);let current=ok(await f.call('buyer','fooditem.claim',claimInput(2),f.invoice));
 const item=ok(await f.view('owner')).records[0];current=ok(await f.call('owner','fooditem.configure',{item:{...item.data,name:'Renamed demo item',restaurantId:'demo_diner',vendorSkus:item.data.vendorSkus.map(s=>({...s,packCount:2}))},reason:'Fictional new catalog pack'},current));
 let first=ok(await f.get('owner',{view:'claims'}));assert.equal(first.entries[0].currentTitle,'Renamed demo item');assert.equal(first.entries[0].claim.invoice.sku.packCount,8);
 const daily=async()=>{const r=await handleWorkspace(new Request('https://test.example/api/workspace?locationId=a',{headers:f.headers('owner')}),f.db);assert.equal(r.status,200);return r.text();},before=await daily();
 const original=JSON.parse((await f.db.prepare('SELECT event FROM food_history WHERE location_id=? AND record_id=? AND revision=3').bind('a',f.base.recordId).first()).event);
 // Synthetic immutable history load only; these are not operating invoices or claims.
 await f.db.prepare(`WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<2500)
 INSERT INTO food_history(location_id,record_id,revision,actor_id,at,event)
 SELECT 'a',?,n+4,'buyer','2026-09-29T12:00:00Z',json_set(?,'$.supplierClaim.reference','CAPACITY-'||n,'$.supplierClaim.invoiceRevision',n+10000) FROM numbers`).bind(f.base.recordId,JSON.stringify(original)).run();
 first=ok(await f.get('owner',{view:'claims'}));assert.equal(first.total,2501);assert.equal(first.entries.length,20);assert.ok(Buffer.byteLength(JSON.stringify(first))<64000);assert.equal(await daily(),before);
 const next=ok(await f.get('owner',{view:'claims',before:String(first.next),revision:String(first.revision),day:first.today}));assert.equal(next.entries.length,20);assert.equal(new Set([...first.entries,...next.entries].map(e=>e.sequence)).size,40);
});


