import test from 'node:test';
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


import {parseSupplierReturn} from '../.sites-runtime/shared/food-return.mjs';
const returnInput=receivingRevision=>({receivingRevision,returnReference:'RETURN-1',returnDate:'2026-09-28',accepted:5,rejected:10,reason:'Fictional damaged goods',evidence:'Fictional signed pickup ticket 1',confirmed:true});
async function setup(t){const f=await fixture(t),base=ok(await f.call('owner','fooditem.import',importInput([rawItem]))),invoice=ok(await f.call('buyer','fooditem.invoice',invoiceInput,base)),receipt=ok(await f.call('manager','fooditem.receive',receivingInput(invoice.revision),invoice));return {...f,base,invoice,receipt};}
const history=async f=>ok(await f.get('owner',{view:'history',recordId:f.base.recordId})).entries;

import {parseReturnCredit} from '../.sites-runtime/shared/food-return-credit.mjs';
const matchInput=(returnRevision,creditRevision)=>({returnRevision,creditRevision,quantity:5,note:'Fictional credit document references the pickup ticket',confirmed:true});
async function ready(t){const f=await setup(t),returned=ok(await f.call('manager','fooditem.return',returnInput(3),f.receipt)),credit=ok(await f.call('buyer','fooditem.credit',creditInput(2),returned));return {...f,returned,credit};}

const queue=async(f,params={},actor='buyer')=>ok(await f.get(actor,{view:'returns',...params}));
test('return review empty state, validation and read-only access leave the catalog and audit untouched',async t=>{
 const f=await fixture(t),empty=await queue(f);assert.deepEqual(empty.totals,{active:0,unmatched:0,matched:0,voided:0});assert.deepEqual(empty.entries,[]);assert.equal(empty.total,0);assert.equal(empty.next,null);
 for(const params of [{filter:'paid'},{before:'-1'},{before:'1.5'},{q:'x'.repeat(101)},{dataset:'unknown'}])assert.equal((await f.get('buyer',{view:'returns',...params})).status,400);
 const g=await ready(t),before=ok(await g.view('owner')),counts=await g.db.prepare('SELECT (SELECT count(*) FROM audit_events) AS audit,(SELECT count(*) FROM food_receipts) AS receipts,(SELECT count(*) FROM food_history) AS history').first();
 await queue(g);await queue(g,{},'manager');assert.deepEqual(ok(await g.view('owner')),before);assert.deepEqual(await g.db.prepare('SELECT (SELECT count(*) FROM audit_events) AS audit,(SELECT count(*) FROM food_receipts) AS receipts,(SELECT count(*) FROM food_history) AS history').first(),counts);
});

test('review follows partial and complete quantity matching, then reopens on retained match correction',async t=>{
 const f=await ready(t);let page=await queue(f);assert.deepEqual(page.totals,{active:1,unmatched:1,matched:0,voided:0});assert.equal(page.entries[0].quantity,15);assert.equal(page.entries[0].remaining,15);assert.equal(page.entries[0].matches,0);
 let current=ok(await f.call('buyer','fooditem.return-credit',matchInput(4,5),f.credit));page=await queue(f);assert.equal(page.entries[0].remaining,10);assert.equal(page.entries[0].matched,5);assert.equal(page.entries[0].matches,1);
 const correction=ok(await f.call('buyer','fooditem.return-credit-void',{matchRevision:current.revision,reason:'Replace with full checked quantity'},current));current=ok(await f.call('buyer','fooditem.return-credit',{...matchInput(4,5),quantity:15},correction));
 page=await queue(f);assert.equal(page.total,0);assert.deepEqual(page.totals,{active:1,unmatched:0,matched:1,voided:0});const matched=await queue(f,{filter:'matched'});assert.equal(matched.entries[0].remaining,0);assert.equal(matched.entries[0].matched,15);assert.equal(matched.entries[0].matches,1);
 current=ok(await f.call('buyer','fooditem.return-credit-void',{matchRevision:current.revision,reason:'Review original association'},current));page=await queue(f);assert.equal(page.entries[0].remaining,15);assert.equal(page.entries[0].matched,0);
 current=ok(await f.call('manager','fooditem.return-void',{returnRevision:4,reason:'Wrong pickup record'},current));page=await queue(f);assert.equal(page.total,0);assert.deepEqual(page.totals,{active:0,unmatched:0,matched:0,voided:1});const voided=await queue(f,{filter:'voided'});assert.equal(voided.entries[0].quantity,15);assert.equal(voided.entries[0].voided,true);assert.equal(voided.entries[0].returned.evidence,returnInput(3).evidence);assert.equal((await queue(f,{filter:'all'})).total,1);
});

test('review keeps original units and supplier references after catalog corrections and searches exact evidence',async t=>{
 const f=await ready(t);const item=ok(await f.view('owner')).records[0];
 ok(await f.call('owner','fooditem.configure',{reason:'Fictional new pack and title',item:{...rawItem,name:'Renamed demo beef',packCount:3,unitQty:1,unitUOM:'kg',purchaseUnit:'bag',vendorSkus:rawItem.vendorSkus.map(v=>({...v,vendor:'New catalog supplier',packCount:3,unitQty:1,unitUOM:'kg',purchaseUnit:'bag'}))}},item));
 for(const q of ['return-1','DEMO-TICKET-1','demo-100','DEMO SUPPLIER','Renamed demo beef','BEEF']){const p=await queue(f,{q});assert.equal(p.total,1,q);assert.equal(p.entries[0].returned.receiving.invoice.invoiceUnit,'lb');assert.equal(p.entries[0].returned.receiving.invoice.sku.packCount,8);assert.equal(p.entries[0].returned.receiving.invoice.sku.vendor,'Demo supplier');assert.equal(p.entries[0].currentTitle,'Renamed demo beef');}
 assert.equal((await queue(f,{q:'New catalog supplier'})).total,0);assert.equal((await queue(f,{q:"' OR 1=1 --"})).total,0);assert.equal((await queue(f,{q:'unknown'})).totals.active,0);
 const p=await queue(f),target=p.entries[0],history=ok(await f.get('buyer',{view:'history',recordId:target.recordId,after:String(target.sequence-1)}));assert.equal(history.entries[0].revision,target.returnRevision);assert.equal(history.entries[0].event.supplierReturn.returnReference,'RETURN-1');
});

test('return pages are bounded with whole-search totals and reject stale continuation',async t=>{
 const f=await setup(t);let current=f.receipt;for(let n=0;n<25;n++)current=ok(await f.call('manager','fooditem.return',{...returnInput(3),returnReference:'PAGE-'+n,accepted:1,rejected:0},current));
 const first=await queue(f);assert.equal(first.total,25);assert.equal(first.totals.unmatched,25);assert.equal(first.entries.length,20);assert.ok(first.next);const last=await queue(f,{before:String(first.next),revision:String(first.revision)});assert.equal(last.entries.length,5);assert.equal(last.total,25);assert.equal(last.next,null);assert.equal(new Set([...first.entries,...last.entries].map(e=>e.sequence)).size,25);
 assert.equal((await f.get('buyer',{view:'returns',before:String(first.next)})).status,409);
 ok(await f.call('manager','fooditem.return-void',{returnRevision:first.entries[0].returnRevision,reason:'Incorrect pickup'},current));assert.equal((await f.get('buyer',{view:'returns',before:String(first.next),revision:String(first.revision)})).status,409);assert.equal((await queue(f)).total,24);assert.equal((await queue(f,{filter:'all'})).total,25);
});

test('return review isolates restaurant and operating/demo datasets and rejects revoked or non-food access',async t=>{
 const f=await ready(t);for(const actor of ['worker','foh','foreign'])assert.equal((await f.get(actor,{view:'returns'})).status,403);
 assert.equal((await queue(f,{dataset:'operating'})).total,0);assert.equal((await queue(f,{locationId:'b'},'foreign')).total,0);assert.equal((await f.get('buyer',{view:'returns',locationId:'b'})).status,403);
 await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='buyer'").run();assert.equal((await f.get('buyer',{view:'returns'})).status,403);assert.equal((await queue(f,{},'manager')).total,1);
});

test('return review includes off-page matches and voids, without combining separate items or units',async t=>{
 const f=await setup(t);let current=ok(await f.call('manager','fooditem.return',{...returnInput(3),accepted:30,rejected:10},f.receipt));const returned=current;let firstMatch;
 for(let n=0;n<12;n++){current=ok(await f.call('buyer','fooditem.credit',{...creditInput(2),creditNumber:'MANY-'+n,quantity:1,amount:'1.00'},current));current=ok(await f.call('buyer','fooditem.return-credit',{...matchInput(returned.revision,current.revision),quantity:1},current));firstMatch??=current;}
 let page=await queue(f);assert.equal(page.entries[0].matched,12);assert.equal(page.entries[0].remaining,28);assert.equal(page.entries[0].matches,12);
 current=ok(await f.call('buyer','fooditem.return-credit-void',{matchRevision:firstMatch.revision,reason:'Off-page correction'},current));page=await queue(f);assert.equal(page.entries[0].matched,11);assert.equal(page.entries[0].remaining,29);
 const other=ok(await f.call('owner','fooditem.import',importInput([{...rawItem,controlNumber:'OTHER',name:'Demo other item'}]))),invoice=ok(await f.call('buyer','fooditem.invoice',{...invoiceInput,invoiceNumber:'OTHER-INVOICE',quantity:2,unitBasis:'supplier-pack',invoiceUnit:'case'},other)),received=ok(await f.call('manager','fooditem.receive',{...receivingInput(invoice.revision),accepted:2,rejected:0},invoice));
 ok(await f.call('manager','fooditem.return',{...returnInput(received.revision),accepted:1,rejected:0},received));page=await queue(f);assert.equal(page.total,2);assert.deepEqual(page.entries.map(e=>[e.returned.receiving.invoice.invoiceUnit,e.remaining]),[['case',1],['lb',29]]);assert.deepEqual(Object.keys(page.totals).sort(),['active','matched','unmatched','voided']);
});

test('a membership or Food revision changed during return review cannot return a stale successful page',async t=>{
 for(const change of ['membership','food']){
  const f=await ready(t);let changed=false;const wrapped={withSession:()=>wrapped,prepare:(...args)=>f.db.prepare(...args),batch:async statements=>{const r=await f.db.batch(statements);if(statements.length===3&&r[0].results[0]&&'unmatched'in r[0].results[0]&&!changed){changed=true;await f.db.prepare(change==='membership'?"UPDATE memberships SET revision=revision+1 WHERE id='buyer'":"UPDATE food_state SET revision=revision+1 WHERE location_id='a'").run();}return r;}};
  const r=await handleFood(new Request('https://test.example/api/food?locationId=a&dataset=demo&view=returns',{headers:f.headers('buyer')}),wrapped);assert.equal(r.status,409);assert.equal(changed,true);
 }
});

test('large return history keeps 20-row responses bounded and leaves daily workspace payload unchanged',async t=>{
 const f=await ready(t);const daily=async()=>{const r=await handleWorkspace(new Request('https://test.example/api/workspace?locationId=a',{headers:f.headers('owner')}),f.db);assert.equal(r.status,200);return r.text();},before=await daily();
 const original=JSON.parse((await f.db.prepare('SELECT event FROM food_history WHERE location_id=? AND record_id=? AND revision=4').bind('a',f.base.recordId).first()).event);original.supplierReturn.accepted=.001;original.supplierReturn.rejected=0;
 await f.db.prepare(`WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<2500)
  INSERT INTO food_history(location_id,record_id,revision,actor_id,at,event)
  SELECT 'a',?,n+5,'manager','2026-09-29T12:00:00Z',json_set(?,'$.supplierReturn.returnReference','CAPACITY-'||n) FROM numbers`).bind(f.base.recordId,JSON.stringify(original)).run();
 const first=await queue(f);assert.equal(first.total,2501);assert.equal(first.totals.active,2501);assert.equal(first.entries.length,20);assert.ok(first.next);assert.ok(Buffer.byteLength(JSON.stringify(first))<64000);assert.equal(await daily(),before);
 const next=await queue(f,{before:String(first.next),revision:String(first.revision)});assert.equal(next.entries.length,20);assert.equal(next.total,2501);assert.equal(new Set([...first.entries,...next.entries].map(e=>e.sequence)).size,40);
});
