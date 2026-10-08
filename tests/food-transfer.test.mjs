import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {handleFoodTransfers} from '../.sites-runtime/shared/food-transfer-service.mjs';
import {handleFood} from '../.sites-runtime/shared/food-service.mjs';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {transferPending} from '../.sites-runtime/shared/food-transfer.mjs';
import {destinationPackRatio} from '../.sites-runtime/shared/food-transfer-match.mjs';
import {receiptUnitQuantities} from '../.sites-runtime/shared/food-transfer-receipt-units.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
const raw={restaurantId:'source-a',name:'Fictional flour',controlNumber:'FLOUR',purchaseUnit:'bag',packCount:1,unitQty:25,unitUOM:'lb',active:true,needsReview:false,vendorSkus:[]};
const sent={dataset:'demo',destinationId:'b',reference:'TR-1',quantity:4,dispatchedAt:'2026-09-28T12:00:00Z',confirmed:true,note:'Fictional transfer'};
const received={dataset:'demo',accepted:2,rejected:1,missing:1,receivedAt:'2026-09-28T13:00:00Z',reason:'One torn bag and one not delivered',note:'Fictional test',confirmed:true};
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
async function fixture(t){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const loc of ['a','b','c'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(loc,'Test '+loc,'America/New_York').run();
 for(const [id,loc,area,caps] of [['owner','a','BOH',['location.manage']],['sender','a','BOH',['tasks.manage']],['receiver','b','BOH',['tasks.manage']],['other','b','BOH',['tasks.manage']],['reviewer','b','BOH',['orders.review']],['outsider','c','BOH',['location.manage']],['foh','a','FOH',['tasks.manage']],['worker','a','BOH',[]]])
  await db.prepare('INSERT INTO memberships(id,email,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?)').bind(id,id+'@example.test',loc,id,area,'Manager',JSON.stringify(caps),'[]').run();
 const headers=actor=>({'oai-authenticated-user-id':actor+'-identity','oai-authenticated-user-email':actor+'@example.test'});
 const call=async(actor,loc,action,input=sent,record,extra={})=>{const r=await handleFoodTransfers(new Request('https://test.example/api/food/transfers',{method:'POST',headers:{...headers(actor),Origin:'https://test.example','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),locationId:loc,action,input,...(record?{recordId:record.recordId??record.id,expectedRevision:record.revision}:{}),...extra})}),db);return {status:r.status,data:await r.json()};};
 const get=async(actor,loc,params={})=>{const r=await handleFoodTransfers(new Request('https://test.example/api/food/transfers?'+new URLSearchParams({locationId:loc,dataset:'demo',...params}),{headers:headers(actor)}),db);return {status:r.status,data:await r.json()};};
 const r=await handleFood(new Request('https://test.example/api/food',{method:'POST',headers:{...headers('owner'),Origin:'https://test.example','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),locationId:'a',action:'fooditem.import',input:{dataset:'demo',sourceRestaurantId:'source-a',sourceLabel:'Fictional fixture',destinationLocationId:'a',confirmed:true,rows:[raw]}})}),db);
 const item=await r.json();assert.equal(r.status,200,JSON.stringify(item));
 const dispatch={...sent,itemId:item.recordId,itemRevision:item.revision};
 const route=async()=>db.prepare("INSERT INTO food_transfer_routes(source_id,destination_id,dataset,active) VALUES('a','b','demo',1)").run();
 const destination=async(overrides={},loc='b',ds='demo')=>{
  const original=await db.prepare('SELECT data FROM food_records WHERE id=?').bind(item.recordId).first();
  const recordId=crypto.randomUUID(),data={...JSON.parse(original.data),title:'Fictional destination flour',controlNumber:recordId,purchaseUnit:'tub',packCount:1,unitQty:10,unitUOM:'lb',...overrides};data.source={...data.source,dataset:ds,sourceRestaurantId:'source-'+loc};
  await db.prepare("INSERT INTO food_records(id,location_id,kind,dataset,source_restaurant_id,source_key,title,storage_area,owner_id,area,revision,data,updated_at) VALUES(?,?,'fooditem',?,?,?,?,?,'reviewer','BOH',1,?,?)").bind(recordId,loc,ds,data.source.sourceRestaurantId,data.controlNumber,data.title,'Walk-in',JSON.stringify(data),'2026-09-28T12:00:00Z').run();
  return {recordId,revision:1,data};
 };
 return {db,call,get,headers,item,dispatch,route,destination};
}


const parcelInput={dataset:'demo',tripReference:'Trip 1',parcelReference:'Parcel A',quantity:2,departedAt:'2026-09-28T12:00:00Z',note:'Fictional transport only',confirmed:true};
const arrivalInput=id=>({dataset:'demo',parcelId:id,arrivedAt:'2026-09-28T13:00:00Z',note:'Entire parcel arrived; quality unchecked',confirmed:true});
async function parcelFixture(t){const f=await fixture(t);await f.route();const s=ok(await f.call('sender','a','transfer.dispatch',f.dispatch));const p=ok(await f.call('sender','a','transfer.parcel-depart',parcelInput,s));const d=ok(await f.get('sender','a',{recordId:s.recordId}));return {...f,s,p,parcel:d.transfer.parcels[0]};}

test('parcel departures and arrivals retain identities without changing receiving, catalogs or daily workspace',async t=>{
 const f=await fixture(t);await f.route();
 const daily=async()=>{const r=await handleWorkspace(new Request('https://test.example/api/workspace?locationId=a',{headers:f.headers('owner')}),f.db);assert.equal(r.status,200);return r.text();};
 const beforeDaily=await daily(),before=(await f.db.prepare('SELECT id,data FROM food_records').all()).results;
 const s=ok(await f.call('sender','a','transfer.dispatch',f.dispatch)),p=ok(await f.call('sender','a','transfer.parcel-depart',{...parcelInput,by:'forged',arrival:{arrivedAt:'forged'},id:'forged'},s));
 const d=ok(await f.get('receiver','b',{recordId:s.recordId})),parcel=d.transfer.parcels[0];assert.notEqual(parcel.id,'forged');assert.equal(parcel.recorded.by,'sender');assert.equal(parcel.arrival,undefined);
 const a=ok(await f.call('receiver','b','transfer.parcel-arrive',arrivalInput(parcel.id),p));
 const arrived=ok(await f.get('sender','a',{recordId:s.recordId}));assert.equal(arrived.transfer.status,'sent');assert.equal(arrived.transfer.receipt,null);assert.equal(arrived.transfer.parcels[0].arrival.by,'receiver');assert.equal(arrived.events[1].action,'parcel-departed');assert.equal(arrived.events[2].action,'parcel-arrived');assert.equal('receipt'in arrived.events[2],false);assert.equal(arrived.events[1].parcel.arrival,undefined);
 const queue=ok(await f.get('receiver','b'));assert.equal('parcels'in queue.entries[0],false);assert.deepEqual(queue.entries[0].parcelTotals,{records:1,departed:2,arrived:2,awaitingArrival:0,unassigned:2});
 ok(await f.call('receiver','b','transfer.receive',{...received,accepted:1,rejected:1,missing:0,complete:false},a));assert.equal((ok(await f.get('sender','a',{recordId:s.recordId}))).transfer.parcels[0].arrival.by,'receiver');
 assert.deepEqual((await f.db.prepare('SELECT id,data FROM food_records').all()).results,before);assert.equal(await daily(),beforeDaily);
});

test('parcel records enforce location, role, dataset, authority and exact transfer revision',async t=>{
 const f=await parcelFixture(t);
 for(const [actor,loc,status]of [['receiver','b',403],['outsider','c',404],['worker','a',403],['foh','a',403]])assert.equal((await f.call(actor,loc,'transfer.parcel-depart',{...parcelInput,parcelReference:'B'},f.p)).status,status);
 assert.equal((await f.call('sender','a','transfer.parcel-arrive',arrivalInput(f.parcel.id),f.p)).status,403);
 assert.equal((await f.call('receiver','b','transfer.parcel-arrive',{...arrivalInput(f.parcel.id),dataset:'operating'},f.p)).status,404);
 assert.equal((await f.call('receiver','b','transfer.parcel-arrive',arrivalInput('not-a-parcel'),f.p)).status,404);
 assert.equal((await f.call('receiver','b','transfer.parcel-arrive',arrivalInput(f.parcel.id),f.s)).status,409);
 assert.equal((await f.call('owner','a','transfer.void',{dataset:'demo',reason:'Incorrect dispatch'},f.p)).status,409);
 assert.equal((await f.call('receiver','b','transfer.parcel-void',{dataset:'demo',parcelId:f.parcel.id,reason:'Wrong parcel'},f.p)).status,403);
 const a=ok(await f.call('receiver','b','transfer.parcel-arrive',arrivalInput(f.parcel.id),f.p));
 assert.equal((await f.call('other','b','transfer.parcel-reopen',{dataset:'demo',parcelId:f.parcel.id,reason:'Not my arrival'},a)).status,403);
 assert.equal((await f.call('owner','a','transfer.parcel-void',{dataset:'demo',parcelId:f.parcel.id,reason:'Destination checked'},a)).status,409);
});

test('parcel allocation and timestamps reject overfill, duplicate references, spoofed units and unconfirmed facts',async t=>{
 const f=await parcelFixture(t);
 assert.equal((await f.call('sender','a','transfer.parcel-depart',{...parcelInput,tripReference:' trip  1 ',parcelReference:' parcel a '},f.p)).status,409);
 for(const bad of [{quantity:0},{quantity:-1},{quantity:''},{quantity:Infinity},{confirmed:false},{tripReference:''},{parcelReference:''},{departedAt:'2026-09-28T11:00:00Z'},{departedAt:'2099-01-01T00:00:00Z'},{note:'x'.repeat(1001)}])assert.equal((await f.call('sender','a','transfer.parcel-depart',{...parcelInput,parcelReference:'B',...bad},f.p)).status,400,JSON.stringify(bad));
 assert.equal((await f.call('sender','a','transfer.parcel-depart',{...parcelInput,parcelReference:'B',quantity:2.01},f.p)).status,409);
 for(const bad of [{confirmed:false},{arrivedAt:'2026-09-28T11:59:00Z'},{arrivedAt:'2099-01-01T00:00:00Z'}])assert.equal((await f.call('receiver','b','transfer.parcel-arrive',{...arrivalInput(f.parcel.id),...bad},f.p)).status,400);
 const b=ok(await f.call('sender','a','transfer.parcel-depart',{...parcelInput,parcelReference:'B',quantity:2},f.p));
 assert.equal((await f.call('sender','a','transfer.parcel-depart',{...parcelInput,parcelReference:'C',quantity:0.1},b)).status,409);
 const history=ok(await f.get('sender','a',{recordId:f.s.recordId}));assert.equal(history.transfer.dispatch.item.pack.purchaseUnit,'bag');assert.equal(history.transfer.parcels.reduce((n,p)=>n+p.quantity,0),4);
});

test('reasoned parcel reopen and void retain prior evidence, release allocation and permit a checked replacement',async t=>{
 const f=await parcelFixture(t),a=ok(await f.call('receiver','b','transfer.parcel-arrive',arrivalInput(f.parcel.id),f.p));
 assert.equal((await f.call('reviewer','b','transfer.parcel-reopen',{dataset:'demo',parcelId:f.parcel.id,reason:''},a)).status,400);
 const reopened=ok(await f.call('reviewer','b','transfer.parcel-reopen',{dataset:'demo',parcelId:f.parcel.id,reason:'Wrong parcel identifier was checked'},a));
 const voided=ok(await f.call('owner','a','transfer.parcel-void',{dataset:'demo',parcelId:f.parcel.id,reason:'Correcting the departure reference'},reopened));
 assert.equal((await f.call('receiver','b','transfer.parcel-arrive',arrivalInput(f.parcel.id),voided)).status,409);
 const replacement=ok(await f.call('sender','a','transfer.parcel-depart',parcelInput,voided));
 const d=ok(await f.get('sender','a',{recordId:f.s.recordId}));assert.equal(d.transfer.parcels.length,2);assert.ok(d.transfer.parcels[0].void);assert.equal(d.transfer.parcels[1].void,undefined);assert.equal(d.events[2].parcel.arrival.by,'receiver');assert.equal(d.events[3].action,'parcel-reopened');assert.equal(d.events[3].reason,'Wrong parcel identifier was checked');assert.equal(d.events[4].parcel.void.by,'owner');assert.equal(d.transfer.receipt,null);
 const cleared=ok(await f.call('sender','a','transfer.parcel-void',{dataset:'demo',parcelId:d.transfer.parcels[1].id,reason:'Duplicate draft'},replacement));
 const whole=ok(await f.call('owner','a','transfer.void',{dataset:'demo',reason:'Incorrect original transfer'},cleared));
 assert.equal((await f.call('sender','a','transfer.parcel-depart',parcelInput,whole)).status,409);
});

test('parcel commands roll back atomically, retry exactly and allow one allocation winner',async t=>{
 const f=await parcelFixture(t),requestId=crypto.randomUUID();
 await f.db.prepare("CREATE TRIGGER reject_parcel BEFORE INSERT ON food_transfer_events WHEN NEW.revision=3 BEGIN SELECT RAISE(ABORT,'fixture'); END").run();
 assert.equal((await f.call('receiver','b','transfer.parcel-arrive',arrivalInput(f.parcel.id),f.p,{requestId})).status,503);
 assert.equal(ok(await f.get('sender','a',{recordId:f.s.recordId})).transfer.parcels[0].arrival,undefined);
 await f.db.prepare('DROP TRIGGER reject_parcel').run();
 const a=ok(await f.call('receiver','b','transfer.parcel-arrive',arrivalInput(f.parcel.id),f.p,{requestId}));assert.deepEqual(ok(await f.call('receiver','b','transfer.parcel-arrive',arrivalInput(f.parcel.id),f.p,{requestId})),a);
 assert.equal((await f.call('receiver','b','transfer.parcel-arrive',{...arrivalInput(f.parcel.id),note:'changed'},f.p,{requestId})).status,409);
 const race=await Promise.all(['B','C'].map(parcelReference=>f.call('sender','a','transfer.parcel-depart',{...parcelInput,parcelReference},a)));assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
 const d=ok(await f.get('sender','a',{recordId:f.s.recordId}));assert.equal(d.transfer.parcels.length,2);assert.equal(d.events.length,4);
});

test('parcel commits recheck membership and simultaneous receipt updates do not erase one another',async t=>{
 const f=await parcelFixture(t);let once=false;const wrapped={withSession:()=>wrapped,prepare:sql=>f.db.prepare(sql),batch:async statements=>{if(!once&&statements.length===8){once=true;await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='receiver'").run();}return f.db.batch(statements)}};
 const r=await handleFoodTransfers(new Request('https://test.example/api/food/transfers',{method:'POST',headers:{...f.headers('receiver'),Origin:'https://test.example','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),locationId:'b',recordId:f.s.recordId,expectedRevision:f.p.revision,action:'transfer.parcel-arrive',input:arrivalInput(f.parcel.id)})}),wrapped);assert.equal(r.status,403);
 assert.equal(ok(await f.get('sender','a',{recordId:f.s.recordId})).transfer.revision,f.p.revision);
 const results=await Promise.all([f.call('other','b','transfer.parcel-arrive',arrivalInput(f.parcel.id),f.p),f.call('reviewer','b','transfer.receive',received,f.p)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const current=ok(await f.get('sender','a',{recordId:f.s.recordId}));
 if(!current.transfer.receipt)ok(await f.call('reviewer','b','transfer.receive',received,current.transfer));else ok(await f.call('other','b','transfer.parcel-arrive',arrivalInput(f.parcel.id),current.transfer));
 const final=ok(await f.get('sender','a',{recordId:f.s.recordId}));assert.equal(final.transfer.parcels[0].arrival.by,'other');assert.equal(final.transfer.receipt.accepted,2);
});

test('50 parcel records cap growth, list responses stay small and history spans pages without lost evidence',async t=>{
 const f=await fixture(t);await f.route();const s=ok(await f.call('sender','a','transfer.dispatch',{...f.dispatch,quantity:100}));let current=s;
 for(let i=0;i<50;i++)current=ok(await f.call('sender','a','transfer.parcel-depart',{...parcelInput,quantity:1,parcelReference:'P'+i,note:'n'.repeat(1000)},current));
 assert.equal((await f.call('sender','a','transfer.parcel-depart',{...parcelInput,parcelReference:'limit'},current)).status,409);
 const d=ok(await f.get('sender','a',{recordId:s.recordId}));assert.equal(d.transfer.parcels.length,50);assert.equal(d.events.length,20);assert.ok(d.next);
 const list=ok(await f.get('receiver','b'));assert.equal(list.entries[0].parcelTotals.departed,50);assert.equal(list.entries[0].parcels,undefined);assert.ok(JSON.stringify(list).length<5000);
 let next=d.next,count=d.events.length;while(next!==null){const page=ok(await f.get('sender','a',{recordId:s.recordId,after:next,revision:current.revision}));count+=page.events.length;next=page.next;}assert.equal(count,51);
 const arrived=ok(await f.call('receiver','b','transfer.parcel-arrive',arrivalInput(d.transfer.parcels[0].id),current));assert.equal(arrived.revision,52);
 assert.equal((await f.get('sender','a',{recordId:s.recordId,after:d.next,revision:current.revision})).status,409);
});


const matchInput=item=>({dataset:'demo',itemId:item.recordId,itemRevision:item.revision,reason:'Checked product identity and both packs against the transfer slip',confirmed:true});
const destinationReceipt={...received,quantityBasis:'destination',accepted:5,rejected:2.5,missing:2.5};
async function matchedReceiptFixture(t){const f=await fixture(t);await f.route();const target=await f.destination(),s=ok(await f.call('sender','a','transfer.dispatch',f.dispatch)),m=ok(await f.call('reviewer','b','transfer.match-item',matchInput(target),s));return {...f,target,s,m};}

test('receiving in destination packs retains entered evidence and original totals without changing inventory',async t=>{
 const f=await matchedReceiptFixture(t),before=(await f.db.prepare('SELECT id,data FROM food_records ORDER BY id').all()).results;
 const result=ok(await f.call('receiver','b','transfer.receive',{...destinationReceipt,quantitySource:{basis:'forged'},destinationUnitsPerDispatchUnit:999},f.m));
 const d=ok(await f.get('sender','a',{recordId:f.s.recordId})),r=d.transfer.receipt;
 assert.deepEqual([r.accepted,r.rejected,r.missing],[2,1,1]);assert.equal(d.transfer.status,'received');assert.equal(r.by,'receiver');
 assert.equal(r.quantitySource.basis,'destination');assert.equal(r.quantitySource.accepted,5);assert.equal(r.quantitySource.rejected,2.5);assert.equal(r.quantitySource.missing,2.5);assert.equal(r.quantitySource.destinationUnitsPerDispatchUnit,2.5);assert.equal(r.quantitySource.item.id,f.target.recordId);assert.equal(r.quantitySource.item.revision,1);assert.equal(r.quantitySource.item.pack.purchaseUnit,'tub');assert.equal(r.quantitySource.matchAt,d.transfer.destinationMatch.at);assert.deepEqual(d.events.at(-1).receipt,r);
 const cleared=ok(await f.call('reviewer','b','transfer.clear-item-match',{dataset:'demo',reason:'Recheck the catalog link only'},result));
 const afterClear=ok(await f.get('receiver','b',{recordId:f.s.recordId}));assert.deepEqual(afterClear.transfer.receipt,r);assert.equal(afterClear.transfer.destinationMatch,null);
 ok(await f.call('receiver','b','transfer.correct-receipt',{...received,accepted:3,rejected:0,missing:1,correctionReason:'Recounted in original bags'},cleared));
 const corrected=ok(await f.get('sender','a',{recordId:f.s.recordId}));assert.equal(corrected.transfer.receipt.quantitySource,undefined);assert.deepEqual(corrected.events[2].receipt,r);assert.deepEqual((await f.db.prepare('SELECT id,data FROM food_records ORDER BY id').all()).results,before);
});

test('destination-unit progress keeps cumulative arrivals and reasoned corrections in dispatch units',async t=>{
 const f=await matchedReceiptFixture(t),open={...destinationReceipt,accepted:2.5,rejected:0,missing:0,complete:false,reason:''};
 const first=ok(await f.call('receiver','b','transfer.receive',open,f.m));
 assert.equal((await f.call('other','b','transfer.check-progress',{...open,accepted:1.25},first)).status,409);
 const progress=ok(await f.call('other','b','transfer.check-progress',{...open,accepted:5,rejected:2.5,reason:'One bag rejected'},first));
 const d=ok(await f.get('sender','a',{recordId:f.s.recordId}));assert.equal(d.transfer.status,'sent');assert.equal(transferPending(d.transfer.dispatch,d.transfer.receipt),1);assert.equal(d.transfer.receipt.quantitySource.accepted,5);
 assert.equal((await f.call('receiver','b','transfer.correct-receipt',{...open,correctionReason:'Not my check'},progress)).status,403);
 const final=ok(await f.call('other','b','transfer.check-progress',destinationReceipt,progress));
 const corrected=ok(await f.call('reviewer','b','transfer.correct-receipt',{...destinationReceipt,accepted:7.5,rejected:0,correctionReason:'Rechecked the goods'},final));
 const end=ok(await f.get('receiver','b',{recordId:corrected.recordId}));assert.equal(end.transfer.receipt.accepted,3);assert.equal(end.events[3].receipt.accepted,2);assert.equal(end.events[3].receipt.complete,false);assert.equal(end.events[4].receipt.quantitySource.accepted,5);
});

test('destination-unit entry rejects unavailable or stale matches and preserves role, store, dataset and validation boundaries',async t=>{
 const f=await matchedReceiptFixture(t);
 for(const [actor,loc,status]of [['sender','a',403],['outsider','c',404],['foh','a',403],['worker','a',403]])assert.equal((await f.call(actor,loc,'transfer.receive',destinationReceipt,f.m)).status,status);
 assert.equal((await f.call('receiver','b','transfer.receive',{...destinationReceipt,dataset:'operating'},f.m)).status,404);
 for(const bad of [{quantityBasis:'guessed'},{accepted:''},{accepted:-1},{accepted:1000001},{accepted:5.001},{confirmed:false},{missing:0},{reason:''}])assert.equal((await f.call('receiver','b','transfer.receive',{...destinationReceipt,...bad},f.m)).status,400,JSON.stringify(bad));
 await f.db.prepare('UPDATE food_records SET revision=2 WHERE id=?').bind(f.target.recordId).run();
 assert.equal((await f.call('receiver','b','transfer.receive',destinationReceipt,f.m)).status,409);
 await f.db.prepare('DELETE FROM food_records WHERE id=?').bind(f.target.recordId).run();
 assert.equal((await f.call('receiver','b','transfer.receive',destinationReceipt,f.m)).status,409);
 const cleared=ok(await f.call('reviewer','b','transfer.clear-item-match',{dataset:'demo',reason:'Item unavailable'},f.m));
 assert.equal((await f.call('receiver','b','transfer.receive',destinationReceipt,cleared)).status,409);
 ok(await f.call('receiver','b','transfer.receive',received,cleared));assert.equal(ok(await f.get('receiver','b',{recordId:f.s.recordId})).transfer.receipt.quantitySource,undefined);
});

test('converted receipt commits recheck the target revision and receiver membership',async t=>{
 const f=await matchedReceiptFixture(t);
 const attempt=async change=>{let once=false;const wrapped={withSession:()=>wrapped,prepare:sql=>f.db.prepare(sql),batch:async statements=>{if(!once&&statements.length===8){once=true;await change()}return f.db.batch(statements)}};
 return handleFoodTransfers(new Request('https://test.example/api/food/transfers',{method:'POST',headers:{...f.headers('receiver'),Origin:'https://test.example','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),locationId:'b',recordId:f.s.recordId,expectedRevision:f.m.revision,action:'transfer.receive',input:destinationReceipt})}),wrapped);};
 assert.equal((await attempt(()=>f.db.prepare('UPDATE food_records SET revision=2 WHERE id=?').bind(f.target.recordId).run())).status,409);
 await f.db.prepare('UPDATE food_records SET revision=1 WHERE id=?').bind(f.target.recordId).run();
 assert.equal((await attempt(()=>f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='receiver'").run())).status,403);
 const d=ok(await f.get('sender','a',{recordId:f.s.recordId}));assert.equal(d.transfer.receipt,null);assert.equal(d.events.length,2);
});

test('converted checks roll back together and exact retries keep the original source snapshot',async t=>{
 const f=await matchedReceiptFixture(t),requestId=crypto.randomUUID();
 await f.db.prepare("CREATE TRIGGER reject_converted BEFORE INSERT ON food_transfer_events WHEN NEW.revision=3 BEGIN SELECT RAISE(ABORT,'fixture'); END").run();
 assert.equal((await f.call('receiver','b','transfer.receive',destinationReceipt,f.m,{requestId})).status,503);assert.equal(ok(await f.get('sender','a',{recordId:f.s.recordId})).transfer.receipt,null);
 await f.db.prepare('DROP TRIGGER reject_converted').run();
 const saved=ok(await f.call('receiver','b','transfer.receive',destinationReceipt,f.m,{requestId}));
 await f.db.prepare('UPDATE food_records SET revision=2 WHERE id=?').bind(f.target.recordId).run();
 assert.deepEqual(ok(await f.call('receiver','b','transfer.receive',destinationReceipt,f.m,{requestId})),saved);
 assert.equal((await f.call('receiver','b','transfer.receive',{...destinationReceipt,accepted:7.5,rejected:0},f.m,{requestId})).status,409);
 const d=ok(await f.get('receiver','b',{recordId:f.s.recordId}));assert.equal(d.events.length,3);assert.equal(d.transfer.receipt.quantitySource.item.revision,1);
});

test('receipt conversion supports fractional packs and rejects malformed or overflowing conversions',()=>{
 const d={item:{pack:{purchaseUnit:'bag',packCount:1,unitQty:1,unitUOM:'lb'}}};
 const m={item:{pack:{purchaseUnit:'tub',packCount:1,unitQty:3,unitUOM:'lb'}},destinationUnitsPerDispatchUnit:1/3,at:'2026-09-28T12:00:00Z'};
 const converted=receiptUnitQuantities({quantityBasis:'destination',accepted:'0.5',rejected:0,missing:0},d,m);assert.equal(converted.accepted,1.5);assert.equal(converted.quantitySource.accepted,0.5);assert.notEqual(converted.quantitySource.item,m.item);
 assert.throws(()=>receiptUnitQuantities({quantityBasis:'destination',accepted:1000000,rejected:0,missing:0},d,m),/outside/);
 assert.throws(()=>receiptUnitQuantities({quantityBasis:'destination',accepted:1,rejected:0,missing:0},d,{...m,destinationUnitsPerDispatchUnit:1}),/conversion needs review/);
 for(const bad of [null,true,'',Infinity,NaN])assert.throws(()=>receiptUnitQuantities({accepted:bad,rejected:0,missing:0},d),/quantity/);
 assert.deepEqual(receiptUnitQuantities({accepted:1,rejected:0,missing:0},d),{accepted:1,rejected:0,missing:0,quantitySource:undefined});
});
test('destination matching normalizes compatible packs while retaining original facts and untouched catalogs',async t=>{
 const f=await fixture(t);await f.route();const target=await f.destination(),s=ok(await f.call('sender','a','transfer.dispatch',f.dispatch));
 const before=await f.db.prepare('SELECT id,data FROM food_records ORDER BY id').all();
 const first=ok(await f.call('receiver','b','transfer.receive',{...received,accepted:1,rejected:0,missing:0,complete:false,reason:''},s));
 const result=ok(await f.call('reviewer','b','transfer.match-item',matchInput(target),first));
 for(const [actor,loc] of [['sender','a'],['receiver','b']]){
  const d=ok(await f.get(actor,loc,{recordId:s.recordId}));assert.equal(d.destinationMatchReview,'current');assert.equal(d.transfer.destinationMatch.destinationUnitsPerDispatchUnit,2.5);assert.equal(d.transfer.destinationMatch.item.pack.purchaseUnit,'tub');assert.equal(d.transfer.dispatch.item.pack.unitQty,25);assert.equal(d.transfer.receipt.accepted,1);assert.equal(d.transfer.status,'sent');assert.equal(d.events.at(-1).action,'item-matched');assert.equal('receipt'in d.events.at(-1),false);
 }
 assert.deepEqual((await f.db.prepare('SELECT id,data FROM food_records ORDER BY id').all()).results,before.results);
 const final=ok(await f.call('receiver','b','transfer.check-progress',{...received,accepted:3,rejected:1,missing:0,complete:true},result));
 const d=ok(await f.get('reviewer','b',{recordId:final.recordId}));assert.equal(d.transfer.destinationMatch.item.id,target.recordId);assert.equal(d.transfer.receipt.accepted,3);assert.equal(d.transfer.status,'received');
});

test('matching requires destination purchasing access and exact restaurant/dataset/item/transfer revisions',async t=>{
 const f=await fixture(t);await f.route();const target=await f.destination(),foreign=await f.destination({},'c'),operating=await f.destination({},'b','operating'),s=ok(await f.call('sender','a','transfer.dispatch',f.dispatch));
 for(const [actor,loc,status]of [['sender','a',403],['owner','a',403],['receiver','b',403],['other','b',403],['outsider','c',404],['worker','a',403]])assert.equal((await f.call(actor,loc,'transfer.match-item',matchInput(target),s)).status,status);
 for(const item of [foreign,operating,{recordId:f.item.recordId,revision:1}])assert.equal((await f.call('reviewer','b','transfer.match-item',matchInput(item),s)).status,404);
 assert.equal((await f.call('reviewer','b','transfer.match-item',{...matchInput(target),itemRevision:2},s)).status,409);
 assert.equal((await f.call('reviewer','b','transfer.match-item',matchInput(target),{...s,revision:99})).status,409);
 for(const bad of [{confirmed:false},{reason:''}])assert.equal((await f.call('reviewer','b','transfer.match-item',{...matchInput(target),...bad},s)).status,400);
 assert.equal((await f.call('reviewer','b','transfer.match-item',{...matchInput(target),dataset:'operating'},s)).status,404);
 const recipe=await f.destination();await f.db.prepare("UPDATE food_records SET kind='foodrecipe' WHERE id=?").bind(recipe.recordId).run();assert.equal((await f.call('reviewer','b','transfer.match-item',matchInput(recipe),s)).status,404);
});

test('unknown or incompatible count packs are blocked while compatible measures use the original dispatch',async t=>{
 const f=await fixture(t);await f.route();const s=ok(await f.call('sender','a','transfer.dispatch',f.dispatch));
 for(const invalid of [{active:false},{countActive:false},{needsReview:true},{packCount:null},{unitQty:null},{unitUOM:'gal'},{unitUOM:'each'},{purchaseUnit:''}]){const target=await f.destination(invalid);assert.equal((await f.call('reviewer','b','transfer.match-item',matchInput(target),s)).status,400,JSON.stringify(invalid));}
 const target=await f.destination({unitQty:160,unitUOM:'oz'});
 await f.db.prepare("UPDATE food_records SET data=json_set(data,'$.unitQty',50),revision=revision+1 WHERE id=?").bind(f.item.recordId).run();
 ok(await f.call('reviewer','b','transfer.match-item',{...matchInput(target),destinationUnitsPerDispatchUnit:999,item:{title:'forged',pack:{unitQty:999}}},s));
 const d=ok(await f.get('reviewer','b',{recordId:s.recordId}));assert.equal(d.transfer.destinationMatch.destinationUnitsPerDispatchUnit,2.5);assert.equal(d.transfer.destinationMatch.item.title,target.data.title);assert.equal(d.transfer.dispatch.item.pack.unitQty,25);
 assert.throws(()=>destinationPackRatio(d.transfer.dispatch,{...target.data,unitQty:Number.MIN_VALUE}));
});

test('catalog changes flag a historical match; reasoned replacement and clearing retain every prior snapshot',async t=>{
 const f=await fixture(t);await f.route();const target=await f.destination(),s=ok(await f.call('sender','a','transfer.dispatch',f.dispatch));
 const first=ok(await f.call('reviewer','b','transfer.match-item',matchInput(target),s));
 assert.equal((await f.call('reviewer','b','transfer.match-item',matchInput(target),first)).status,409);
 await f.db.prepare("UPDATE food_records SET data=json_set(data,'$.unitQty',5,'$.title','Renamed destination'),revision=revision+1 WHERE id=?").bind(target.recordId).run();
 const stale=ok(await f.get('sender','a',{recordId:s.recordId}));assert.equal(stale.destinationMatchReview,'changed');assert.equal(stale.transfer.destinationMatch.item.title,target.data.title);assert.equal(stale.transfer.destinationMatch.destinationUnitsPerDispatchUnit,2.5);
 const second=ok(await f.call('reviewer','b','transfer.match-item',matchInput({...target,revision:2}),first));
 const d=ok(await f.get('receiver','b',{recordId:s.recordId}));assert.equal(d.destinationMatchReview,'current');assert.equal(d.transfer.destinationMatch.destinationUnitsPerDispatchUnit,5);assert.equal(d.events[1].destinationMatch.destinationUnitsPerDispatchUnit,2.5);
 assert.equal((await f.call('receiver','b','transfer.clear-item-match',{dataset:'demo',reason:'Wrong product'},second)).status,403);
 assert.equal((await f.call('reviewer','b','transfer.clear-item-match',{dataset:'demo',reason:''},second)).status,400);
 const cleared=ok(await f.call('reviewer','b','transfer.clear-item-match',{dataset:'demo',reason:'Wrong product identity; retain original evidence'},second));
 const history=ok(await f.get('sender','a',{recordId:s.recordId}));assert.equal(history.destinationMatchReview,'unmatched');assert.equal(history.transfer.destinationMatch,null);assert.equal(history.events.length,4);assert.equal(history.events.at(-1).action,'item-match-cleared');assert.equal(history.events[2].destinationMatch.item.title,'Renamed destination');
 assert.equal((await f.call('reviewer','b','transfer.clear-item-match',{dataset:'demo',reason:'Already cleared'},cleared)).status,409);
});

test('removed destination item remains a labeled snapshot and matches cannot change a voided transfer',async t=>{
 const f=await fixture(t);await f.route();const target=await f.destination(),s=ok(await f.call('sender','a','transfer.dispatch',f.dispatch));
 const matched=ok(await f.call('reviewer','b','transfer.match-item',matchInput(target),s));
 await f.db.prepare('DELETE FROM food_records WHERE id=?').bind(target.recordId).run();
 const d=ok(await f.get('sender','a',{recordId:s.recordId}));assert.equal(d.destinationMatchReview,'unavailable');assert.equal(d.transfer.destinationMatch.item.id,target.recordId);
 const v=ok(await f.call('owner','a','transfer.void',{dataset:'demo',reason:'Incorrect dispatch record'},matched));
 assert.equal((await f.call('reviewer','b','transfer.clear-item-match',{dataset:'demo',reason:'Remove'},v)).status,409);
});

test('match retries, transaction rollback and concurrent reviewers preserve one checked result',async t=>{
 const f=await fixture(t);await f.route();const target=await f.destination(),other=await f.destination({unitQty:5}),s=ok(await f.call('sender','a','transfer.dispatch',f.dispatch)),requestId=crypto.randomUUID();
 await f.db.prepare("CREATE TRIGGER reject_match BEFORE INSERT ON food_transfer_events WHEN NEW.revision=2 BEGIN SELECT RAISE(ABORT,'fixture'); END").run();
 assert.equal((await f.call('reviewer','b','transfer.match-item',matchInput(target),s,{requestId})).status,503);assert.equal(ok(await f.get('receiver','b',{recordId:s.recordId})).destinationMatchReview,'unmatched');
 await f.db.prepare('DROP TRIGGER reject_match').run();
 const first=ok(await f.call('reviewer','b','transfer.match-item',matchInput(target),s,{requestId}));assert.deepEqual(ok(await f.call('reviewer','b','transfer.match-item',matchInput(target),s,{requestId})),first);
 assert.equal((await f.call('reviewer','b','transfer.match-item',matchInput(other),s,{requestId})).status,409);
 const race=await Promise.all([f.call('reviewer','b','transfer.match-item',matchInput(other),first),f.call('reviewer','b','transfer.clear-item-match',{dataset:'demo',reason:'Recheck identity'},first)]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
 assert.equal(ok(await f.get('receiver','b',{recordId:s.recordId})).events.length,3);
});

test('changed destination pack or revoked reviewer at commit prevents a match',async t=>{
 const f=await fixture(t);await f.route();const target=await f.destination(),s=ok(await f.call('sender','a','transfer.dispatch',f.dispatch));
 const attempt=async change=>{let applied=false;const binding={withSession:()=>binding,prepare:sql=>f.db.prepare(sql),batch:async statements=>{if(!applied&&statements.length===8){applied=true;await change()}return f.db.batch(statements)}};return handleFoodTransfers(new Request('https://test.example/api/food/transfers',{method:'POST',headers:{...f.headers('reviewer'),Origin:'https://test.example','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),locationId:'b',recordId:s.recordId,expectedRevision:s.revision,action:'transfer.match-item',input:matchInput(target)})}),binding);};
 assert.equal((await attempt(()=>f.db.prepare('UPDATE food_records SET revision=revision+1 WHERE id=?').bind(target.recordId).run())).status,409);
 target.revision=2;
 assert.equal((await attempt(()=>f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='reviewer'").run())).status,403);
 const d=ok(await f.get('receiver','b',{recordId:s.recordId}));assert.equal(d.transfer.revision,1);assert.equal(d.events.length,1);assert.equal(d.destinationMatchReview,'unmatched');
});
test('transfer requires configured route, preserves original pack, and each side owns its factual action',async t=>{
 const f=await fixture(t);assert.equal((await f.call('sender','a','transfer.dispatch',f.dispatch)).status,403);await f.route();
 const before=await f.db.prepare('SELECT data FROM food_records WHERE id=?').bind(f.item.recordId).first();
 const draft=ok(await f.call('sender','a','transfer.dispatch',f.dispatch)),out=ok(await f.get('sender','a',{view:'outgoing'}));assert.equal(out.entries.length,1);assert.equal(ok(await f.get('receiver','b')).entries[0].id,draft.recordId);
 assert.equal((await f.call('sender','a','transfer.receive',received,draft)).status,403);
 assert.equal((await f.call('receiver','b','transfer.void',{dataset:'demo',reason:'Not mine'},draft)).status,403);
 const done=ok(await f.call('receiver','b','transfer.receive',received,draft));
 const detail=ok(await f.get('sender','a',{recordId:done.recordId}));assert.equal(detail.transfer.status,'received');assert.deepEqual([detail.transfer.receipt.accepted,detail.transfer.receipt.rejected,detail.transfer.receipt.missing],[2,1,1]);assert.equal(detail.transfer.dispatch.item.pack.unitQty,25);assert.equal(detail.events.length,2);
 assert.deepEqual(await f.db.prepare('SELECT data FROM food_records WHERE id=?').bind(f.item.recordId).first(),before);
 assert.equal((await f.db.prepare("SELECT count(*) AS n FROM food_records WHERE location_id='b'").first()).n,0);
 assert.equal((await f.call('owner','a','transfer.void',{dataset:'demo',reason:'Wrong dispatch'},done)).status,409);
});
test('transfer receipt validation and corrections retain prior evidence and require accountable reviewer',async t=>{
 const f=await fixture(t);await f.route();const s=ok(await f.call('sender','a','transfer.dispatch',f.dispatch));
 for(const input of [{...received,accepted:''},{...received,accepted:-1},{...received,missing:0},{...received,missing:2},{...received,reason:''},{...received,receivedAt:'2099-01-01T12:00:00Z'},{...received,receivedAt:'2026-09-27T12:00:00Z'},{...received,confirmed:false}])assert.equal((await f.call('receiver','b','transfer.receive',input,s)).status,400);
 const first=ok(await f.call('receiver','b','transfer.receive',received,s));
 const correction={...received,accepted:3,rejected:0,missing:1,reason:'One still missing',correctionReason:'Rechecked the package'};
 assert.equal((await f.call('other','b','transfer.correct-receipt',correction,first)).status,403);
 assert.equal((await f.call('reviewer','b','transfer.correct-receipt',{...correction,correctionReason:''},first)).status,400);
 const final=ok(await f.call('reviewer','b','transfer.correct-receipt',correction,first)),detail=ok(await f.get('sender','a',{recordId:final.recordId}));
 assert.equal(detail.events[1].receipt.rejected,1);assert.equal(detail.events[2].reason,'Rechecked the package');assert.equal(detail.transfer.receipt.accepted,3);
 assert.equal((await f.call('receiver','b','transfer.receive',received,final)).status,409);
});
test('transfer duplicate prevention, exact retries, stale writes and void history are consistent',async t=>{
 const f=await fixture(t);await f.route();const requestId=crypto.randomUUID(),s=ok(await f.call('sender','a','transfer.dispatch',f.dispatch,null,{requestId}));
 assert.deepEqual(ok(await f.call('sender','a','transfer.dispatch',f.dispatch,null,{requestId})),s);
 assert.equal((await f.call('sender','a','transfer.dispatch',{...f.dispatch,quantity:3},null,{requestId})).status,409);
 assert.equal((await f.call('sender','a','transfer.dispatch',{...f.dispatch,reference:'  tr-1  '})).status,409);
 assert.equal((await f.call('receiver','b','transfer.receive',received,{...s,revision:99})).status,409);
 const voided=ok(await f.call('owner','a','transfer.void',{dataset:'demo',reason:'Wrong destination; record only'},s));
 assert.equal((await f.call('receiver','b','transfer.receive',received,voided)).status,409);
 assert.equal(ok(await f.get('receiver','b',{status:'voided'})).entries[0].status,'voided');
 const replacement=ok(await f.call('sender','a','transfer.dispatch',f.dispatch));assert.notEqual(replacement.recordId,s.recordId);
});
test('transfer rejects foreign and cross-dataset access, stale items, unsafe methods and revoked membership',async t=>{
 const f=await fixture(t);await f.route();const s=ok(await f.call('sender','a','transfer.dispatch',f.dispatch));
 for(const actor of ['foh','worker']){assert.equal((await f.get(actor,'a')).status,403);assert.equal((await f.call(actor,'a','transfer.dispatch',{...f.dispatch,reference:actor})).status,403);}
 assert.equal((await f.get('outsider','c',{recordId:s.recordId})).status,404);assert.equal((await f.get('outsider','a')).status,403);
 assert.equal((await f.get('receiver','b',{recordId:s.recordId,dataset:'operating'})).status,404);
 assert.equal((await f.call('receiver','b','transfer.receive',{...received,dataset:'operating'},s)).status,404);
 assert.equal((await f.call('sender','a','transfer.dispatch',{...f.dispatch,destinationId:'a'})).status,400);
 assert.equal((await f.call('sender','a','transfer.dispatch',{...f.dispatch,itemRevision:99})).status,409);
 for(const params of [{status:'bogus'},{view:'bogus'},{before:'-1'},{before:'NaN'}])assert.equal((await f.get('sender','a',params)).status,400);
 await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='receiver'").run();assert.equal((await f.get('receiver','b',{recordId:s.recordId})).status,403);
 const post=await handleFoodTransfers(new Request('https://test.example/api/food/transfers',{method:'POST',headers:{...f.headers('owner'),'Content-Type':'application/json'},body:'{}'}),f.db);assert.equal(post.status,403);
});
test('transfer atomic rollback and concurrent destination receipt versus sender void allow one winner',async t=>{
 const f=await fixture(t);await f.route();
 await f.db.prepare("CREATE TRIGGER reject_transfer BEFORE INSERT ON food_transfer_events BEGIN SELECT RAISE(ABORT,'fixture'); END").run();
 const requestId=crypto.randomUUID();assert.equal((await f.call('sender','a','transfer.dispatch',f.dispatch,null,{requestId})).status,503);
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM food_transfers').first()).n,0);
 await f.db.prepare('DROP TRIGGER reject_transfer').run();const s=ok(await f.call('sender','a','transfer.dispatch',f.dispatch,null,{requestId}));
 const results=await Promise.all([f.call('receiver','b','transfer.receive',received,s),f.call('sender','a','transfer.void',{dataset:'demo',reason:'Incorrect dispatch entry'},s)]);
 assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===409).length,1);
 const detail=ok(await f.get('sender','a',{recordId:s.recordId}));assert.equal(detail.transfer.revision,2);assert.equal(detail.events.length,2);
});
test('transfer queue stays bounded, detects destination updates and leaves daily payload unchanged',async t=>{
 const f=await fixture(t);await f.route();const daily=async()=>{const r=await handleWorkspace(new Request('https://test.example/api/workspace?locationId=a',{headers:f.headers('owner')}),f.db);assert.equal(r.status,200);return r.text();};const initial=await daily();let first;
 for(let n=0;n<24;n++){const r=ok(await f.call('sender','a','transfer.dispatch',{...f.dispatch,reference:'page-'+n}));first??=r;}
 const p=ok(await f.get('sender','a',{view:'outgoing'}));assert.equal(p.entries.length,20);assert.ok(p.next);const tail=ok(await f.get('sender','a',{view:'outgoing',before:p.next,revision:p.revision}));assert.equal(tail.entries.length,4);assert.equal(new Set([...p.entries,...tail.entries].map(t=>t.id)).size,24);
 ok(await f.call('receiver','b','transfer.receive',received,first));assert.equal((await f.get('sender','a',{view:'outgoing',before:p.next,revision:p.revision})).status,409);
 assert.equal(await daily(),initial);
});

test('transfer transaction rechecks route and current membership, and receipt retries stay idempotent',async t=>{
 const f=await fixture(t);await f.route();
 const intercept=async(command,change)=>{
  let invoked=false;
  const wrapped={withSession:()=>wrapped,prepare:sql=>f.db.prepare(sql),batch:async statements=>{if(!invoked&&statements.length===8){invoked=true;await change()}return f.db.batch(statements)}};
  const r=await handleFoodTransfers(new Request('https://test.example/api/food/transfers',{method:'POST',headers:{...f.headers('sender'),Origin:'https://test.example','Content-Type':'application/json'},body:JSON.stringify(command)}),wrapped);return {status:r.status,data:await r.json()};
 };
 const cmd={requestId:crypto.randomUUID(),locationId:'a',action:'transfer.dispatch',input:f.dispatch};
 assert.equal((await intercept(cmd,()=>f.db.prepare("UPDATE food_transfer_routes SET active=0").run())).status,409);
 await f.db.prepare("UPDATE food_transfer_routes SET active=1").run();
 assert.equal((await intercept({...cmd,requestId:crypto.randomUUID()},()=>f.db.prepare("UPDATE memberships SET revision=revision+1,active=0 WHERE id='sender'").run())).status,403);
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM food_transfers').first()).n,0);
 const s=ok(await f.call('owner','a','transfer.dispatch',f.dispatch)),requestId=crypto.randomUUID();
 const first=ok(await f.call('receiver','b','transfer.receive',received,s,{requestId}));assert.deepEqual(ok(await f.call('receiver','b','transfer.receive',received,s,{requestId})),first);
 const history=ok(await f.get('receiver','b',{recordId:s.recordId}));assert.equal(history.events.length,2);
 await f.db.prepare("UPDATE food_transfer_routes SET active=0").run();
 const corrected=ok(await f.call('reviewer','b','transfer.correct-receipt',{...received,correctionReason:'Clarified after route disabled'},first));assert.equal(corrected.revision,3);
});

const partial={...received,accepted:1,rejected:0,missing:0,complete:false,reason:'',note:'First arrival'};

test('transfer review separates pending, rejected, final missing, clean and voided records',async t=>{
 const f=await fixture(t);await f.route();const send=reference=>f.call('sender','a','transfer.dispatch',{...f.dispatch,reference}).then(ok);
 await send('No check');const staged=await send('Still arriving');ok(await f.call('receiver','b','transfer.receive',partial,staged));
 const rejected=await send('Damaged arrival');ok(await f.call('receiver','b','transfer.receive',{...partial,rejected:1,reason:'Damaged bag'},rejected));
 const missing=await send('Final shortage');const final=ok(await f.call('receiver','b','transfer.receive',{...received,accepted:3,rejected:0},missing));
 const clear=await send('Accepted');ok(await f.call('receiver','b','transfer.receive',{...received,accepted:4,rejected:0,missing:0,reason:''},clear));
 const voided=await send('Wrong record');ok(await f.call('sender','a','transfer.void',{dataset:'demo',reason:'Duplicate slip'},voided));
 const all=ok(await f.get('receiver','b',{status:'all'}));assert.equal(all.total,6);assert.deepEqual(all.totals,{open:3,final:2,differences:2,voided:1});
 const differences=ok(await f.get('receiver','b',{status:'differences'}));assert.equal(differences.total,2);assert.deepEqual(differences.entries.map(r=>r.dispatch.reference).sort(),['Damaged arrival','Final shortage']);
 const row=await f.db.prepare('SELECT data FROM food_transfers WHERE id=?').bind(missing.recordId).first();const legacy=JSON.parse(row.data);delete legacy.receipt.complete;await f.db.prepare('UPDATE food_transfers SET data=? WHERE id=?').bind(JSON.stringify(legacy),missing.recordId).run();
 assert.equal(ok(await f.get('receiver','b',{status:'differences'})).total,2);
 ok(await f.call('receiver','b','transfer.correct-receipt',{...received,accepted:4,rejected:0,missing:0,reason:'',correctionReason:'Recounted all bags'},final));
 const changed=ok(await f.get('sender','a',{view:'outgoing',status:'differences'}));assert.equal(changed.total,1);assert.equal(changed.entries[0].id,rejected.recordId);
 const history=ok(await f.get('receiver','b',{recordId:missing.recordId}));assert.equal(history.events[1].receipt.missing,1);assert.equal(history.transfer.receipt.missing,0);
});
test('transfer search is literal, bounded and uses dispatch identity rather than notes or renamed catalog',async t=>{
 const f=await fixture(t);await f.route();const s=ok(await f.call('sender','a','transfer.dispatch',{...f.dispatch,reference:"Trip 25%_ O'Brien",note:'private-comment-only'}));
 const item=await f.db.prepare('SELECT data FROM food_records WHERE id=?').bind(f.item.recordId).first();const renamed=JSON.parse(item.data);renamed.title='Replacement name';await f.db.prepare('UPDATE food_records SET title=?,data=? WHERE id=?').bind(renamed.title,JSON.stringify(renamed),f.item.recordId).run();
 for(const q of ['  FLOUR  ','25%_',"o'brien",'Test a']){const p=ok(await f.get('receiver','b',{status:'all',q}));assert.equal(p.total,1);assert.equal(p.entries[0].id,s.recordId);assert.equal(p.query,q.trim().toLowerCase());}
 for(const q of ['%__','private-comment-only','Replacement name',"' OR 1=1 --"]){const p=ok(await f.get('receiver','b',{status:'all',q}));assert.equal(p.total,0);assert.deepEqual(p.totals,{open:0,final:0,differences:0,voided:0});}
 assert.equal((await f.get('receiver','b',{q:'x'.repeat(101)})).status,400);
 assert.equal((await f.get('receiver','b',{status:'differences OR 1=1'})).status,400);
 assert.equal(ok(await f.get('receiver','b',{status:'differences',q:'FLOUR'})).total,0);
});
test('transfer review pages 1001 records within role, store and dataset boundaries and leaves daily payload unchanged',async t=>{
 const f=await fixture(t);await f.route();const daily=async()=>{const r=await handleWorkspace(new Request('https://test.example/api/workspace?locationId=a',{headers:f.headers('owner')}),f.db);assert.equal(r.status,200);return r.text()};const initial=await daily();
 const seed=ok(await f.call('sender','a','transfer.dispatch',{...f.dispatch,reference:'Review batch seed'}));
 const source=await f.db.prepare('SELECT data FROM food_transfers WHERE id=?').bind(seed.recordId).first();const template=JSON.parse(source.data);
 for(let start=0;start<1000;start+=50){const statements=[];for(let n=start;n<start+50;n++){const id=crypto.randomUUID(),data={...template,id,dispatch:{...template.dispatch,reference:'Review batch '+n}};statements.push(f.db.prepare('INSERT INTO food_transfers(id,source_id,destination_id,dataset,reference_key,revision,status,data,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,'a','b','demo','review-'+n,1,'sent',JSON.stringify(data),'2026-09-28T12:00:00Z'));}await f.db.batch(statements);}
 const first=ok(await f.get('receiver','b',{q:'Review batch',status:'all'}));assert.equal(first.total,1001);assert.equal(first.totals.open,1001);assert.equal(first.entries.length,20);assert.ok(JSON.stringify(first).length<30000);
 const ids=new Set(first.entries.map(r=>r.id));let next=first.next,pages=1;
 while(next!==null){const p=ok(await f.get('receiver','b',{q:'Review batch',status:'all',before:next,revision:first.revision}));assert.equal(p.total,1001);assert.ok(p.entries.length<=20);for(const row of p.entries){assert.ok(!ids.has(row.id));ids.add(row.id)}next=p.next;pages++;}
 assert.equal(ids.size,1001);assert.equal(pages,51);
 assert.equal(ok(await f.get('sender','a',{view:'outgoing',status:'all'})).total,1001);
 assert.equal(ok(await f.get('receiver','b',{view:'outgoing',status:'all'})).total,0);
 assert.equal(ok(await f.get('receiver','b',{dataset:'operating',status:'all'})).total,0);
 assert.equal(ok(await f.get('outsider','c',{status:'all'})).total,0);
 for(const actor of ['foh','worker'])assert.equal((await f.get(actor,'a',{view:'outgoing',status:'all'})).status,403);
 ok(await f.call('receiver','b','transfer.receive',received,seed));assert.equal((await f.get('receiver','b',{before:first.next,revision:first.revision})).status,409);assert.equal(await daily(),initial);
});
test('transfer review rejects state or access changes occurring during the read',async t=>{
 const f=await fixture(t);await f.route();ok(await f.call('sender','a','transfer.dispatch',f.dispatch));
 const readDuring=async change=>{let once=false;const wrapped={withSession:()=>wrapped,prepare:sql=>f.db.prepare(sql),batch:async statements=>{const rows=await f.db.batch(statements);if(!once&&statements.length===4){once=true;await change()}return rows}};return handleFoodTransfers(new Request('https://test.example/api/food/transfers?locationId=b&dataset=demo&status=all',{headers:f.headers('receiver')}),wrapped)};
 assert.equal((await readDuring(()=>f.db.prepare("UPDATE food_state SET revision=revision+1 WHERE location_id='b'").run())).status,409);
 assert.equal((await readDuring(()=>f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='receiver'").run())).status,403);
});

test('staged transfer checks keep pending separate from missing and preserve cumulative evidence for both restaurants',async t=>{
 const f=await fixture(t);await f.route();const before=await f.db.prepare('SELECT data FROM food_records WHERE id=?').bind(f.item.recordId).first();
 const s=ok(await f.call('sender','a','transfer.dispatch',f.dispatch));
 const first=ok(await f.call('receiver','b','transfer.receive',partial,s));
 const open=ok(await f.get('sender','a',{recordId:s.recordId}));assert.equal(open.transfer.status,'sent');assert.equal(transferPending(open.transfer.dispatch,open.transfer.receipt),3);assert.equal(open.transfer.receipt.missing,0);
 assert.equal(ok(await f.get('other','b')).entries.length,1);assert.equal(ok(await f.get('other','b',{status:'received'})).entries.length,0);
 assert.equal((await f.call('owner','a','transfer.void',{dataset:'demo',reason:'Tried to void after arrival'},first)).status,409);
 assert.equal((await f.call('receiver','b','transfer.receive',partial,first)).status,409);
 const second=ok(await f.call('other','b','transfer.check-progress',{...partial,accepted:2,rejected:1,reason:'One damaged bag',receivedAt:'2026-09-28T14:00:00Z'},first));
 const final=ok(await f.call('receiver','b','transfer.check-progress',{...received,complete:true,receivedAt:'2026-09-28T15:00:00Z'},second));
 const d=ok(await f.get('sender','a',{recordId:final.recordId}));assert.equal(d.transfer.status,'received');assert.equal(transferPending(d.transfer.dispatch,d.transfer.receipt),0);assert.deepEqual(d.events.map(e=>e.action),['sent','receipt-progress','receipt-progress','received']);assert.deepEqual(d.events.slice(1).map(e=>[e.receipt.accepted,e.receipt.rejected,e.receipt.missing]),[[1,0,0],[2,1,0],[2,1,1]]);
 assert.equal(d.events[1].receipt.by,'receiver');assert.equal(d.events[2].receipt.by,'other');assert.equal(ok(await f.get('receiver','b')).entries.length,0);assert.equal(ok(await f.get('receiver','b',{status:'received'})).entries.length,1);
 assert.deepEqual(await f.db.prepare('SELECT data FROM food_records WHERE id=?').bind(f.item.recordId).first(),before);assert.equal((await f.db.prepare("SELECT count(*) AS n FROM food_records WHERE location_id='b'").first()).n,0);
});
test('partial checks validate open versus final status, cumulative monotonicity, time, fractions and accountable corrections',async t=>{
 const f=await fixture(t);await f.route();const s=ok(await f.call('sender','a','transfer.dispatch',f.dispatch));
 for(const input of [{...partial,complete:'false'},{...partial,complete:null},{...partial,missing:1},{...partial,accepted:0},{...partial,accepted:4},{...partial,accepted:5},{...partial,accepted:true},{...partial,accepted:-1},{...partial,rejected:1,reason:''}])assert.equal((await f.call('receiver','b','transfer.receive',input,s)).status,400,JSON.stringify(input));
 const p=ok(await f.call('receiver','b','transfer.receive',{...partial,accepted:0.5},s));
 assert.equal((await f.call('other','b','transfer.check-progress',{...partial,accepted:0.25},p)).status,409);
 assert.equal((await f.call('other','b','transfer.check-progress',{...partial,accepted:0.5},p)).status,400);
 assert.equal((await f.call('other','b','transfer.check-progress',{...partial,receivedAt:'2026-09-28T12:30:00Z'},p)).status,400);
 // Normalized instants permit offsets while still enforcing chronological order.
 const next=ok(await f.call('other','b','transfer.check-progress',{...partial,accepted:1.5,receivedAt:'2026-09-28T10:00:00-04:00'},p));
 const final=ok(await f.call('other','b','transfer.check-progress',{...partial,accepted:4,complete:true,receivedAt:'2026-09-28T15:00:00Z'},next));
 assert.equal((await f.call('receiver','b','transfer.check-progress',partial,final)).status,409);
});
test('reasoned receipt corrections can reopen final and legacy checks while retaining original observations',async t=>{
 const f=await fixture(t);await f.route();const s=ok(await f.call('sender','a','transfer.dispatch',f.dispatch));
 const first=ok(await f.call('receiver','b','transfer.receive',received,s));
 // Simulate the exact older format with no completeness field; it remains final.
 await f.db.prepare("UPDATE food_transfers SET data=json_remove(data,'$.receipt.complete') WHERE id=?").bind(s.recordId).run();
 const legacy=ok(await f.get('receiver','b',{recordId:s.recordId}));assert.equal(transferPending(legacy.transfer.dispatch,legacy.transfer.receipt),0);
 assert.equal((await f.call('other','b','transfer.correct-receipt',{...partial,correctionReason:'Late trip confirmed'},first)).status,403);
 assert.equal((await f.call('reviewer','b','transfer.correct-receipt',{...partial,correctionReason:''},first)).status,400);
 const reopened=ok(await f.call('reviewer','b','transfer.correct-receipt',{...partial,correctionReason:'Earlier final check was premature'},first));
 assert.equal((await f.call('receiver','b','transfer.correct-receipt',{...partial,correctionReason:'Not current recorder'},reopened)).status,403);
 const done=ok(await f.call('other','b','transfer.check-progress',{...partial,accepted:4,complete:true},reopened));
 const d=ok(await f.get('sender','a',{recordId:done.recordId}));assert.equal(d.events[1].receipt.missing,1);assert.equal(d.events[2].reason,'Earlier final check was premature');assert.equal(d.events[2].receipt.complete,false);assert.equal(d.transfer.receipt.accepted,4);
});
test('staged arrivals use exact retry receipts, roll back atomically and permit one concurrent winner',async t=>{
 const f=await fixture(t);await f.route();const s=ok(await f.call('sender','a','transfer.dispatch',f.dispatch)),requestId=crypto.randomUUID();
 await f.db.prepare("CREATE TRIGGER reject_stage BEFORE INSERT ON food_transfer_events WHEN NEW.revision=2 BEGIN SELECT RAISE(ABORT,'fixture'); END").run();
 assert.equal((await f.call('receiver','b','transfer.receive',partial,s,{requestId})).status,503);assert.equal(ok(await f.get('receiver','b',{recordId:s.recordId})).transfer.receipt,null);
 await f.db.prepare('DROP TRIGGER reject_stage').run();const p=ok(await f.call('receiver','b','transfer.receive',partial,s,{requestId}));assert.deepEqual(ok(await f.call('receiver','b','transfer.receive',partial,s,{requestId})),p);
 assert.equal((await f.call('receiver','b','transfer.receive',{...partial,accepted:2},s,{requestId})).status,409);
 const race=await Promise.all([f.call('receiver','b','transfer.check-progress',{...partial,accepted:2},p),f.call('other','b','transfer.check-progress',{...partial,accepted:3},p)]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
 const d=ok(await f.get('sender','a',{recordId:s.recordId}));assert.equal(d.events.length,3);assert.equal(d.transfer.revision,3);assert.ok([2,3].includes(d.transfer.receipt.accepted));
});
test('staged checks recheck destination access at commit and preserve endpoint and dataset boundaries',async t=>{
 const f=await fixture(t);await f.route();const s=ok(await f.call('sender','a','transfer.dispatch',f.dispatch));const p=ok(await f.call('receiver','b','transfer.receive',partial,s));
 assert.equal((await f.call('sender','a','transfer.check-progress',{...partial,accepted:2},p)).status,403);assert.equal((await f.call('outsider','c','transfer.check-progress',{...partial,accepted:2},p)).status,404);assert.equal((await f.call('other','b','transfer.check-progress',{...partial,accepted:2,dataset:'operating'},p)).status,404);
 let invoked=false;const wrapped={withSession:()=>wrapped,prepare:sql=>f.db.prepare(sql),batch:async statements=>{if(!invoked&&statements.length===8){invoked=true;await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='other'").run()}return f.db.batch(statements)}};
 const r=await handleFoodTransfers(new Request('https://test.example/api/food/transfers',{method:'POST',headers:{...f.headers('other'),Origin:'https://test.example','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),locationId:'b',recordId:s.recordId,expectedRevision:p.revision,action:'transfer.check-progress',input:{...partial,accepted:2}})}),wrapped);assert.equal(r.status,403);assert.equal(ok(await f.get('receiver','b',{recordId:s.recordId})).transfer.revision,2);
 await f.db.prepare('UPDATE food_transfer_routes SET active=0').run();ok(await f.call('receiver','b','transfer.check-progress',{...partial,accepted:2},p));
});
test('many staged arrivals keep current row and daily payload bounded and invalidate historical cursors',async t=>{
 const f=await fixture(t);await f.route();const daily=async()=>{const r=await handleWorkspace(new Request('https://test.example/api/workspace?locationId=a',{headers:f.headers('owner')}),f.db);assert.equal(r.status,200);return r.text()};const initial=await daily();
 const s=ok(await f.call('sender','a','transfer.dispatch',{...f.dispatch,quantity:30}));let p=ok(await f.call('receiver','b','transfer.receive',partial,s));const before=await f.db.prepare('SELECT length(data) AS n FROM food_transfers WHERE id=?').bind(s.recordId).first();
 for(let accepted=2;accepted<=23;accepted++)p=ok(await f.call('receiver','b','transfer.check-progress',{...partial,accepted},p));
 const first=ok(await f.get('receiver','b',{recordId:s.recordId}));assert.equal(first.events.length,20);assert.ok(first.next);const tail=ok(await f.get('receiver','b',{recordId:s.recordId,after:first.next,revision:p.revision}));assert.equal(tail.events.length,4);assert.equal(new Set([...first.events,...tail.events].map(e=>e.revision)).size,24);
 const after=await f.db.prepare('SELECT length(data) AS n FROM food_transfers WHERE id=?').bind(s.recordId).first();assert.ok(after.n-before.n<50);assert.equal(await daily(),initial);
 ok(await f.call('receiver','b','transfer.check-progress',{...partial,accepted:30,complete:true},p));assert.equal((await f.get('receiver','b',{recordId:s.recordId,after:first.next,revision:p.revision})).status,409);
});
