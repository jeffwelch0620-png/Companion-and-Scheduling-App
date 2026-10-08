import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runPositionWeek,openPositionDatabase} from './all-position-week-fixture.mjs';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {handleFood} from '../.sites-runtime/shared/food-service.mjs';
import {handleFoodWorkflows} from '../.sites-runtime/shared/food-workflow-service.mjs';
import {handleFoodTransfers} from '../.sites-runtime/shared/food-transfer-service.mjs';
import {handleCompanionChat} from '../.sites-runtime/shared/companion-chat.mjs';

// Functional QA groupings, not newly approved operating job titles. Detailed
// commissary training and real recipe pulls remain source-connection work.
const scenarios=[
 ['Missing count','One count is unknown; do not silently treat it as zero.'],
 ['Changed count','A recount changes the source after a plan was generated.'],
 ['Short production','Ingredient shortage prevents the full planned quantity.'],
 ['Partial delivery','Some dispatched goods remain pending; do not mark them missing yet.'],
 ['Rejected goods','A final receipt separates accepted, rejected and missing goods.'],
 ['Retry after interruption','Repeat the same save safely and reject stale extra taps.'],
 ['Destination boundary','A configured route does not authorize Papa’s or general personnel access.'],
].map(([title,detail])=>({title,detail,nextAction:'Use current saved Food records, communicate the unresolved exception and require independent follow-through.'}));
export const commissaryProfiles=['Commissary Production Cook','Commissary Manager'].map(position=>({id:'comm-'+(position.includes('Manager')?'manager':'production-cook'),restaurant:'comm',position,area:'BOH',capabilities:position.includes('Manager')?['tasks.manage']:[],opening:['Review the released daily and bulk prep work, current recipes and previous unfinished work.'],service:['Keep counts, planned production, actual production, dispatch and destination receipt as separate saved facts.','Report shortages and unresolved exceptions rather than inventing a recipe, vessel conversion or completed delivery.'],closing:['Record actual quantities and shortages, restore the assigned production area and hand unfinished work to the named manager.','Request independent closing verification before departure.'],dailyScenarios:scenarios}));
fs.mkdirSync('evidence/all-position-week',{recursive:true});fs.writeFileSync('evidence/all-position-week/commissary-profiles.json',JSON.stringify(commissaryProfiles,null,2)+'\n');
for(const profile of commissaryProfiles)test(`${profile.position}: seven durable opening, production-support, curveball and closing days`,async()=>{
 const result=await runPositionWeek(profile);result.provenance={kind:'Functional commissary QA grouping from agreed prep/transfer architecture; detailed approved position guide not recovered.'};
 fs.mkdirSync('evidence/all-position-week',{recursive:true});fs.writeFileSync(`evidence/all-position-week/${profile.id}.json`,JSON.stringify(result,null,2)+'\n');assert.equal(result.days.length,7);assert.deepEqual(result.failures,[],JSON.stringify(result.failures));
});

test('Commissary: seven persisted days of real count, prep production, dispatch and Bert/Rudd receiving commands with boundary attacks',async()=>{
 const RealDate=Date,dir=fs.mkdtempSync(path.join(os.tmpdir(),'jmax-comm-food-week-')),file=path.join(dir,'comm.sqlite');let store=openPositionDatabase(file),now=RealDate.parse('2026-10-08T12:00:00-04:00');
 globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 const receipt={id:'comm-specialized-food-week',restaurant:'comm',position:'Commissary scoped Food coordination',days:[],failures:[],limits:['Fictional Food items and grants installed once; actual authenticated app handlers thereafter.','No real ingredient depletion, inventory posting, physical production/delivery/quality check or Jeff hosted recipe pull is claimed.','Source recipes, production, transport and receipts stay distinct; saved stock does not change in this local workflow.']};
 const req=(actor,route,loc,body,query='')=>new Request(`https://comm-week.example/api/${route}?locationId=${loc}&dataset=demo${query}`,{headers:{'oai-authenticated-user-id':actor+'-identity','oai-authenticated-user-email':actor+'@example.test',Origin:'https://comm-week.example','Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 const call=async(handler,actor,loc,body,route='food/workflows',query='')=>{const r=await handler(req(actor,route,loc,body,query),store.db);return {status:r.status,data:await r.json()};};
 const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
 const cmd=(handler,actor,loc,action,input={},record,requestId=crypto.randomUUID(),route)=>call(handler,actor,loc,{requestId,locationId:loc,action,input:{dataset:'demo',...input},...(record?{recordId:record.recordId??record.id,expectedRevision:record.revision}:{})},route);
 const food=(actor,loc,action,input,record)=>cmd(handleFood,actor,loc,action,input,record,undefined,'food');
 const workflow=(actor,loc,action,input,record,rid)=>cmd(handleFoodWorkflows,actor,loc,action,input,record,rid);
 const transfer=(actor,loc,action,input,record,rid)=>cmd(handleFoodTransfers,actor,loc,action,input,record,rid,'food/transfers');
 const getTransfer=(actor,loc,record)=>call(handleFoodTransfers,actor,loc,undefined,'food/transfers','&recordId='+encodeURIComponent(record.recordId??record.id)).then(ok);
 const state=()=>JSON.stringify(Object.fromEntries(['records','food_state','food_records','food_workflows','food_workflow_events','food_transfers','food_transfer_events','food_receipts'].map(t=>[t,store.sqlite.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()])));
 const check=async(day,phase,fn)=>{try{await fn();day.checks.push({phase,status:'passed'});}catch(e){const failure={day:day.day,phase,error:String(e.message)};receipt.failures.push(failure);day.checks.push({...failure,status:'failed'});}};
 try{
  for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())store.sqlite.exec(fs.readFileSync('drizzle/'+f,'utf8').replaceAll('--> statement-breakpoint',''));
  for(const loc of ['comm','berts','rudds','papa']){store.sqlite.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').run(loc,'Fictional '+loc,'America/New_York');store.sqlite.prepare('INSERT INTO food_state(location_id) VALUES(?)').run(loc);}
  for(const loc of ['comm','berts','rudds','papa'])store.sqlite.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?,?)').run('production-'+loc,'production@example.test','production-identity',loc,'Fictional production','BOH','Commissary Manager','["tasks.manage","orders.review","location.manage"]','[]');
  store.sqlite.prepare('INSERT INTO restaurant_access(auth_user_id,kind,home_location_id) VALUES(?,?,?)').run('production-identity','commissary','comm');
  for(const loc of ['berts','rudds','papa'])store.sqlite.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?,?)').run('local-'+loc,'local-'+loc+'@example.test','local-'+loc+'-identity',loc,'Fictional local manager','BOH','BOH Manager','["tasks.manage","orders.review","location.manage"]','[]');
  const imported={};
  for(const loc of ['comm','berts','rudds'])imported[loc]=ok(await food(loc==='comm'?'production':'local-'+loc,loc,'fooditem.import',{sourceRestaurantId:'fixture-'+loc,sourceLabel:'Fictional seven-day Food workflow',destinationLocationId:loc,confirmed:true,rows:[{restaurantId:'fixture-'+loc,name:'Fictional ranch vessel',controlNumber:'RANCH',purchaseUnit:'vessel',packCount:1,unitQty:5,unitUOM:'gal',portionSize:1,portionUOM:'gal',par:6,active:true,countActive:true,needsReview:false,vendorSkus:[]}]}));
  const definition=ok(await workflow('production','comm','definition.save',{foodRecordId:imported.comm.recordId,foodRevision:imported.comm.revision,track:'bulk',countUnit:'vessel',par:6,reviewNote:'Fictional reviewed vessel; number is vessels, not gallons.',confirmed:true}));
  for(const loc of ['berts','rudds','papa'])store.sqlite.prepare('INSERT INTO food_transfer_routes(source_id,destination_id,dataset,active) VALUES(?,?,?,1)').run('comm',loc,'demo');
  // Initial legacy transfer deliberately violates today's scope, so reads and
  // retries must not leak it even if an older installation permitted the route.
  const legacy={id:'legacy-papa',sequence:1,revision:1,sourceId:'comm',destinationId:'papa',sourceName:'Commissary',destinationName:'PAPA_PRIVATE_NAME',dataset:'demo',status:'sent',dispatch:{reference:'PAPA_PRIVATE_REFERENCE',quantity:1,dispatchedAt:new Date(now).toISOString(),recordedAt:new Date(now).toISOString(),by:'production-comm',byName:'Production',note:'PRIVATE_PAPA_NOTE',item:{id:imported.comm.recordId,revision:1,title:'PAPA_PRIVATE_PRODUCT',controlNumber:'RANCH',pack:{purchaseUnit:'vessel',packCount:1,unitQty:5,unitUOM:'gal'}}},receipt:null,parcels:[{id:'legacy-parcel',tripReference:'Private trip',parcelReference:'Private parcel',quantity:1,departedAt:new Date(now).toISOString(),recorded:{by:'production-comm',byName:'Production',at:new Date(now).toISOString()},note:'Private'}]};
  store.sqlite.prepare('INSERT INTO food_transfers(id,source_id,destination_id,dataset,reference_key,revision,status,data,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(legacy.id,'comm','papa','demo','legacy',1,'sent',JSON.stringify(legacy),new Date(now).toISOString());
  store.sqlite.prepare('INSERT INTO food_transfer_events(transfer_id,revision,event) VALUES(?,?,?)').run(legacy.id,1,JSON.stringify({revision:1,action:'sent',at:new Date(now).toISOString(),by:'production-comm',byName:'Production',reason:'PRIVATE_PAPA_NOTE'}));
  const initialCatalog=JSON.stringify(store.sqlite.prepare('SELECT * FROM food_records ORDER BY id').all()),savedIds=[];
  for(let n=1;n<=7;n++){
   const day={day:n,scenario:scenarios[n-1],checks:[]};receipt.days.push(day);
   await check(day,'reopen same saved database and recover all previous Food events',async()=>{if(n>1){const before=state();store.close();store=openPositionDatabase(file);assert.equal(state(),before);for(const id of savedIds)assert.ok(store.sqlite.prepare('SELECT id FROM food_transfers WHERE id=?').get(id));}});
   await check(day,'only Bert and Rudd scoped Food is readable, not Papa or general workspaces',async()=>{
    for(const loc of ['berts','rudds']){assert.equal((await call(handleFoodWorkflows,'production',loc)).status,200);assert.equal((await call(handleWorkspace,'production',loc,undefined,'workspace')).status,403);assert.equal((await call(handleFood,'production',loc,undefined,'food')).status,403);assert.equal((await workflow('production',loc,'definition.save',{})).status,403);assert.equal((await workflow('production',loc,'plan.assign',{})).status,403);}
    assert.equal((await call(handleFoodWorkflows,'production','papa')).status,403);assert.equal((await call(handleFoodTransfers,'production','papa',undefined,'food/transfers')).status,403);
    let providerCalls=0;const denied=await handleCompanionChat(req('production','companion','berts'),store.db,{},async()=>{providerCalls++;return Response.json({});},()=>now,'workforce');assert.equal(denied.status,403);assert.equal(providerCalls,0);
   });
   const date=new Date(now).toISOString().slice(0,10),targetDate=new Date(now+86400000).toISOString().slice(0,10);let plan;
   await check(day,'current bulk count produces reviewed plan; unknown count and stale recount cannot release',async()=>{
    let count=ok(await workflow('production','comm','count.create',{track:'bulk',businessDate:date}));
    count=ok(await workflow('production','comm','count.save',{lines:[{definitionId:definition.recordId,quantity:n===1?null:1,note:'Observed current vessel count'}]},count));count=ok(await workflow('production','comm','count.submit',{confirmed:true},count));
    plan=ok(await workflow('production','comm','plan.generate',{countId:count.recordId,countRevision:count.revision,targetDate}));
    if(n===1||n===2){const before=state();if(n===1){assert.equal((await workflow('production','comm','plan.release',{confirmed:true},plan)).status,409);assert.equal(state(),before);}
     count=ok(await workflow('production','comm','count.reopen',{reason:'Recount missing or changed vessel quantity'},count));count=ok(await workflow('production','comm','count.save',{lines:[{definitionId:definition.recordId,quantity:1,note:'Recounted quantity'}]},count));count=ok(await workflow('production','comm','count.submit',{confirmed:true},count));const stale=state();assert.equal((await workflow('production','comm','plan.release',{confirmed:true},plan)).status,409);assert.equal(state(),stale);plan=ok(await workflow('production','comm','plan.generate',{countId:count.recordId,countRevision:count.revision,targetDate},plan));}
    plan=ok(await workflow('production','comm','plan.release',{confirmed:true},plan));
    const rid='comm-production-day-'+n,previous=plan,input={definitionId:definition.recordId,quantity:n===3?4:5,note:n===3?'Ingredient shortage: one planned vessel could not be produced.':'Actual fictional production recorded separately from dispatch.',confirmed:true};plan=ok(await workflow('production','comm','plan.complete',input,previous,rid));assert.deepEqual(ok(await workflow('production','comm','plan.complete',input,previous,rid)),plan);
    const detail=ok(await call(handleFoodWorkflows,'production','comm',undefined,'food/workflows','&recordId='+plan.recordId));assert.equal(detail.record.lines[0].completedQty,n===3?4:5);assert.equal(detail.record.lines[0].plannedQty,5);if(n===3)assert.match(detail.record.lines[0].completionNote,/shortage/);
   });
   await check(day,'dispatch and cumulative receiving retain partial missing rejected and correction evidence',async()=>{
    for(const loc of ['berts','rudds']){
     const actor='local-'+loc,at=new Date(now).toISOString(),input={destinationId:loc,itemId:imported.comm.recordId,itemRevision:imported.comm.revision,reference:`DAY-${n}-${loc}`,quantity:5,dispatchedAt:at,note:'Fictional goods physically dispatched for software rehearsal.',confirmed:true},rid=`dispatch-${n}-${loc}`;
     let sent=ok(await transfer('production','comm','transfer.dispatch',input,undefined,rid));assert.deepEqual(ok(await transfer('production','comm','transfer.dispatch',input,undefined,rid)),sent);savedIds.push(sent.recordId);
     if(n===4){sent=ok(await transfer(actor,loc,'transfer.receive',{accepted:2,rejected:0,missing:0,receivedAt:at,complete:false,note:'First parcel only',reason:'',confirmed:true},sent));const partial=await getTransfer('production','comm',sent);assert.equal(partial.transfer.status,'sent');assert.equal(partial.transfer.receipt.missing,0);sent=ok(await transfer(actor,loc,'transfer.check-progress',{accepted:5,rejected:0,missing:0,receivedAt:at,complete:true,note:'Remaining goods arrived',reason:'',confirmed:true},sent));}
     else{const bad=n===5;sent=ok(await transfer(actor,loc,'transfer.receive',{accepted:bad?3:5,rejected:bad?1:0,missing:bad?1:0,receivedAt:at,complete:true,note:'Count and condition checked in fixture',reason:bad?'One vessel rejected and one not delivered.':'',confirmed:true},sent));}
     if(n===6){const original=sent;sent=ok(await transfer(actor,loc,'transfer.correct-receipt',{accepted:4,rejected:0,missing:1,receivedAt:at,complete:true,note:'Reasoned recount',reason:'One not delivered',correctionReason:'Recount identified one missing vessel',confirmed:true},sent));assert.equal((await transfer(actor,loc,'transfer.correct-receipt',{accepted:5,rejected:0,missing:0,receivedAt:at,confirmed:true,correctionReason:'Stale extra tap'},original)).status,409);}
     const result=await getTransfer('production','comm',sent);assert.equal(result.transfer.status,'received');assert.equal(result.transfer.receipt.accepted,n===5?3:n===6?4:5);assert.equal(result.transfer.receipt.missing,n===5||n===6?1:0);assert.equal(result.transfer.dispatch.quantity,5);assert.ok(result.events.length>=2);if(n===6)assert.ok(result.events.some(e=>e.action==='receipt-corrected'));
    }
    assert.equal(JSON.stringify(store.sqlite.prepare('SELECT * FROM food_records ORDER BY id').all()),initialCatalog,'Local count, production and transfer records must not pretend to post stock.');
   });
   await check(day,'configured Papa route and legacy transfer cannot bypass explicit commissary scope',async()=>{
    const before=state();const rejected=await transfer('production','comm','transfer.dispatch',{destinationId:'papa',itemId:imported.comm.recordId,itemRevision:imported.comm.revision,reference:'PAPA-ATTACK-'+n,quantity:1,dispatchedAt:new Date(now).toISOString(),note:'Adversarial scope test',confirmed:true});assert.equal(rejected.status,403,JSON.stringify(rejected.data));assert.equal(state(),before);
    assert.equal((await call(handleFoodTransfers,'production','comm',undefined,'food/transfers','&recordId=legacy-papa')).status,403);
    assert.equal((await transfer('production','comm','transfer.void',{reason:'Cannot mutate Papa data'},legacy)).status,403);assert.equal(state(),before);
    const list=ok(await call(handleFoodTransfers,'production','comm',undefined,'food/transfers','&view=outgoing&status=all'));assert.ok(!JSON.stringify(list).includes('PAPA_PRIVATE'));assert.equal(list.routes.some(r=>r.id==='papa'),false);assert.equal(list.total,n*2);assert.equal(list.entries.length,n*2);
    const manifest=ok(await call(handleFoodTransfers,'production','comm',undefined,'food/transfers','&manifest=1&view=outgoing&trip=Private%20trip&date=2026-10-08'));assert.equal(manifest.counts.transfers,0);assert.deepEqual(manifest.entries,[]);assert.ok(!JSON.stringify(manifest).includes('PAPA_PRIVATE'));assert.equal(state(),before);
   });
   now+=86400000;
  }
  const before=state();store.close();store=openPositionDatabase(file);assert.equal(state(),before);receipt.finalReopen=true;receipt.savedTransfers=savedIds.length;receipt.initialSeeds=1;receipt.operationalReseeds=0;
 }catch(e){receipt.failures.push({day:0,phase:'fixture or final recovery',error:String(e.stack)});}finally{globalThis.Date=RealDate;store.close();fs.rmSync(dir,{recursive:true,force:true});fs.mkdirSync('evidence/all-position-week',{recursive:true});fs.writeFileSync('evidence/all-position-week/comm-specialized-food-week.json',JSON.stringify(receipt,null,2)+'\n');}
 assert.equal(receipt.days.length,7);assert.deepEqual(receipt.failures,[],JSON.stringify(receipt.failures));
});
