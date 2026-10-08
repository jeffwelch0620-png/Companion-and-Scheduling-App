import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,ok} from './maintenance-meter-fixture.mjs';
import {handleFood} from '../.sites-runtime/shared/food-service.mjs';
import {handleFoodWorkflows} from '../.sites-runtime/shared/food-workflow-service.mjs';
import {handleWorkspace,workspace} from '../.sites-runtime/shared/service.mjs';
import {resolveFoodOrder} from '../.sites-runtime/shared/food-order-bridge.mjs';
import {localDate,nextDate} from '../.sites-runtime/shared/local-time.mjs';

const today=()=>localDate(new Date().toISOString(),'America/New_York');
async function releaseState(f,r){return {
 plan:await f.db.prepare('SELECT revision,status,data FROM food_workflows WHERE id=?').bind(r.recordId??r.id).first(),
 state:await f.db.prepare("SELECT revision,last_command FROM food_state WHERE location_id='a'").first(),
 events:await f.db.prepare('SELECT count(*) AS n FROM food_workflow_events WHERE workflow_id=?').bind(r.recordId??r.id).first(),
 receipts:await f.db.prepare("SELECT count(*) AS n FROM food_receipts WHERE location_id='a'").first(),
 audit:await f.db.prepare("SELECT count(*) AS n FROM audit_events WHERE location_id='a'").first(),
};}
async function setup(t){
 const f=await fixture(t);
 for(const [actor,caps] of [['owner',['location.manage','tasks.manage','orders.request','orders.review']],['manager',['tasks.manage','orders.request']],['othermanager',['tasks.manage','orders.review']]])await f.db.prepare('UPDATE memberships SET capabilities=? WHERE id=?').bind(JSON.stringify(caps),actor).run();
 async function request(actor,path,body){const response=await (path.startsWith('/api/food/workflows')?handleFoodWorkflows:path.startsWith('/api/food')?handleFood:handleWorkspace)(new Request('http://localhost'+path,{headers:{'oai-authenticated-user-id':actor+'-identity','oai-authenticated-user-email':actor+'@example.test',Origin:'http://localhost','Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})}),f.db);return {status:response.status,data:await response.json()};}
 const command=(actor,path,action,input={},r,extra={})=>request(actor,path,{requestId:crypto.randomUUID(),locationId:'a',action,input,...(r?{recordId:r.recordId??r.id,expectedRevision:r.revision}:{}),...extra});
 const prep=(action,input={},r,actor='owner',extra={})=>command(actor,'/api/food/workflows',action,{dataset:'demo',...input},r,extra);
 const food=(action,input={},r,actor='owner')=>command(actor,'/api/food',action,input,r);
 const order=(action,input={},r,actor='manager',extra={})=>command(actor,'/api/workspace',action,input,r,extra);
 const detail=async r=>ok(await request('owner','/api/food/workflows?'+new URLSearchParams({locationId:'a',dataset:'demo',recordId:r.recordId??r.id})));
 const raw={restaurantId:'fixture-source',name:'Fictional flour',controlNumber:'FLOUR',purchaseUnit:'bag',packCount:1,unitQty:25,unitUOM:'lb',portionSize:1,portionUOM:'lb',par:4,active:true,countActive:true,needsReview:false,vendorSkus:[{id:'sku',vendor:'Fictional supplier',vendorSku:'F1',purchaseUnit:'bag',packCount:1,unitQty:25,unitUOM:'lb',price:20,priceUpdatedAt:today(),preferred:true,available:true}]};
 const item=ok(await food('fooditem.import',{dataset:'demo',sourceRestaurantId:'fixture-source',sourceLabel:'Fictional workflow integration fixture',destinationLocationId:'a',confirmed:true,rows:[raw]}));
 const defInput={foodRecordId:item.recordId,foodRevision:item.revision,track:'daily',countUnit:'bag',par:4,reviewNote:'Fictional unit and par review',confirmed:true};
 async function draftPlan(quantity=1){const def=ok(await prep('definition.save',defInput)),c=ok(await prep('count.create',{track:'daily',businessDate:today()})),saved=ok(await prep('count.save',{lines:[{definitionId:def.recordId,quantity,note:'Fictional observation'}]},c)),submitted=ok(await prep('count.submit',{confirmed:true},saved)),plan=ok(await prep('plan.generate',{countId:submitted.recordId,countRevision:submitted.revision,targetDate:nextDate(today(),1)}));return {def,count:submitted,plan};}
 return {...f,request,prep,food,order,detail,item,raw,defInput,draftPlan};
}

test('changed prep count blocks outdated plan release through authenticated API',async t=>{
 const f=await setup(t),s=await f.draftPlan();
 let count=ok(await f.prep('count.reopen',{reason:'Correction to observed quantity'},s.count));count=ok(await f.prep('count.save',{lines:[{definitionId:s.def.recordId,quantity:2,note:'Recount'}]},count));count=ok(await f.prep('count.submit',{confirmed:true},count));
 const before=await releaseState(f,s.plan),rejected=await f.prep('plan.release',{confirmed:true},s.plan);assert.equal(rejected.status,409);assert.match(rejected.data.error,/source count changed/i);assert.deepEqual(await releaseState(f,s.plan),before);assert.equal((await f.detail(s.plan)).record.status,'draft');
 const regenerated=ok(await f.prep('plan.generate',{countId:count.recordId,countRevision:count.revision,targetDate:nextDate(today(),1)},s.plan));const released=ok(await f.prep('plan.release',{confirmed:true},regenerated));assert.equal((await f.detail(released)).record.lines[0].plannedQty,2);
});

test('changed prep definition blocks outdated plan release through authenticated API',async t=>{
 const f=await setup(t),s=await f.draftPlan();
 ok(await f.prep('definition.save',{...f.defInput,par:8,reviewNote:'Reviewed larger target'},s.def));
 const before=await releaseState(f,s.plan),rejected=await f.prep('plan.release',{confirmed:true},s.plan);assert.equal(rejected.status,409);assert.match(rejected.data.error,/definition or Food source changed/i);assert.deepEqual(await releaseState(f,s.plan),before);assert.equal((await f.detail(s.plan)).record.status,'draft');
 const history=await f.detail(s.def);assert.equal(history.history.length,2);assert.equal(history.history[0].snapshot.par,4);assert.equal(history.record.par,8);
});

test('unchanged prior-day prep count blocks release despite next-day production target and leaves all stored state unchanged',async t=>{
 const f=await setup(t),def=ok(await f.prep('definition.save',f.defInput));
 let count=ok(await f.prep('count.create',{track:'daily',businessDate:nextDate(today(),-1)}));count=ok(await f.prep('count.save',{lines:[{definitionId:def.recordId,quantity:1,note:'Historical evening count'}]},count));count=ok(await f.prep('count.submit',{confirmed:true},count));
 const plan=ok(await f.prep('plan.generate',{countId:count.recordId,countRevision:count.revision,targetDate:nextDate(today(),1)}));assert.match((await f.detail(plan)).record.blockers.join(' '),/current-day/i);
 const before=await releaseState(f,plan),rejected=await f.prep('plan.release',{confirmed:true},plan);assert.equal(rejected.status,409);assert.match(rejected.data.error,/current-day restaurant-local/i);assert.deepEqual(await releaseState(f,plan),before);assert.equal((await f.detail(count)).record.revision,count.revision);
});

test('adding an active same-track definition invalidates old plan release without partial writes',async t=>{
 const f=await setup(t),s=await f.draftPlan(),recipe=ok(await f.food('foodrecipe.import',{dataset:'demo',sourceRestaurantId:'fixture-source',sourceLabel:'Fictional prep recipe fixture',destinationLocationId:'a',confirmed:true,rows:[{restaurantId:'fixture-source',id:'DOUGH',name:'Fictional dough',recipeType:'prep',yieldQty:1,yieldUOM:'batch',lines:[{sourceType:'item',controlNumber:'FLOUR',qty:1}]}]}));
 ok(await f.prep('definition.save',{...f.defInput,foodRecordId:recipe.recordId,foodRevision:recipe.revision,countUnit:'batch',par:2}));
 const before=await releaseState(f,s.plan),rejected=await f.prep('plan.release',{confirmed:true},s.plan);assert.equal(rejected.status,409);assert.match(rejected.data.error,/definition list changed/i);assert.deepEqual(await releaseState(f,s.plan),before);
});

test('prep freshness follows the configured restaurant-local date',async t=>{
 const f=await setup(t),s=await f.draftPlan(),now=new Date().toISOString(),zone=['Pacific/Kiritimati','Etc/GMT+12'].find(z=>localDate(now,z)!==today());assert.ok(zone);
 await f.db.prepare("UPDATE locations SET timezone=?,revision=revision+1 WHERE id='a'").bind(zone).run();
 const before=await releaseState(f,s.plan),rejected=await f.prep('plan.release',{confirmed:true},s.plan);assert.equal(rejected.status,409);assert.match(rejected.data.error,/current-day restaurant-local/i);assert.deepEqual(await releaseState(f,s.plan),before);
});

test('restaurant configuration change during prep release rejects the transaction without partial writes',async t=>{
 const f=await setup(t),s=await f.draftPlan(),before=await releaseState(f,s.plan);let changed=false;
 const db={withSession:()=>db,prepare:sql=>f.db.prepare(sql),batch:async statements=>{
  if(statements.length===6&&!changed){changed=true;await f.db.prepare("UPDATE locations SET revision=revision+1 WHERE id='a'").run();}
  return f.db.batch(statements);
 }};
 const response=await handleFoodWorkflows(new Request('http://localhost/api/food/workflows',{method:'POST',headers:{'oai-authenticated-user-id':'owner-identity','oai-authenticated-user-email':'owner@example.test',Origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),locationId:'a',action:'plan.release',recordId:s.plan.recordId,expectedRevision:s.plan.revision,input:{dataset:'demo',confirmed:true}})}),db);
 assert.equal(changed,true);assert.equal(response.status,409);assert.deepEqual(await releaseState(f,s.plan),before);
});

test('null counts remain missing, explicit zero produces prep, release and completion retain source history without stock effects',async t=>{
 const f=await setup(t),before=await f.db.prepare('SELECT data,revision FROM food_records WHERE id=?').bind(f.item.recordId).first(),s=await f.draftPlan(null);
 let detail=await f.detail(s.plan);assert.equal(detail.record.lines[0].quantity,null);assert.equal(detail.record.lines[0].plannedQty,null);assert.equal(detail.record.blockers.length,1);
 assert.equal((await f.prep('plan.release',{confirmed:true},s.plan)).status,409);
 let count=ok(await f.prep('count.reopen',{reason:'Record previously missing count'},s.count));assert.equal((await f.prep('count.save',{lines:[{definitionId:s.def.recordId,quantity:'',note:''}]},count)).status,400);
 count=ok(await f.prep('count.save',{lines:[{definitionId:s.def.recordId,quantity:0,note:'Explicit zero observed'}]},count));count=ok(await f.prep('count.submit',{confirmed:true},count));
 let plan=ok(await f.prep('plan.generate',{countId:count.recordId,countRevision:count.revision,targetDate:nextDate(today(),1)},s.plan));plan=ok(await f.prep('plan.release',{confirmed:true},plan));plan=ok(await f.prep('plan.complete',{definitionId:s.def.recordId,quantity:4,note:'Made target quantity',confirmed:true},plan));
 detail=await f.detail(plan);assert.equal(detail.record.status,'completed');assert.equal(detail.record.lines[0].plannedQty,4);assert.equal(detail.record.lines[0].completedBy,'owner');assert.equal(detail.history.length,4);assert.deepEqual(await f.db.prepare('SELECT data,revision FROM food_records WHERE id=?').bind(f.item.recordId).first(),before);
});

test('prep scopes dataset and restaurant, rejects unauthorized writes, and retains idempotent revision receipts',async t=>{
 const f=await setup(t),requestId=crypto.randomUUID(),a=ok(await f.prep('definition.save',f.defInput,null,'owner',{requestId})),b=ok(await f.prep('definition.save',f.defInput,null,'owner',{requestId}));assert.deepEqual(a,b);
 assert.equal((await f.prep('definition.save',{...f.defInput,par:9},null,'owner',{requestId})).status,409);
 assert.equal((await f.prep('definition.save',f.defInput,null,'worker')).status,403);
 assert.equal((await f.prep('definition.save',f.defInput,null,'foreign')).status,403);
 assert.equal((await f.prep('definition.save',{...f.defInput,dataset:'operating'})).status,404);
 assert.equal((await f.prep('definition.retire',{reason:'Wrong revision'},{...a,revision:a.revision+1})).status,409);
 assert.equal((await f.request('foreign','/api/food/workflows?locationId=a&dataset=demo')).status,403);
 assert.equal((await f.request('owner',`/api/food/workflows?locationId=a&dataset=operating&recordId=${a.recordId}`)).status,404);
 assert.equal((await f.detail(a)).history.length,1);
});

test('food purchasing reuses shared orders, authenticates different reviewer, keeps source snapshots and never changes stock',async t=>{
 const f=await setup(t),item=ok(await f.food('fooditem.count',{quantity:1,note:'Fictional dated physical count',confirmed:true},f.item));
 const before=await f.db.prepare('SELECT data,revision FROM food_records WHERE id=?').bind(item.recordId).first();
 const input={dataset:'demo',countDate:today(),lines:[{itemId:item.recordId,itemRevision:item.revision,skuId:'sku',quantity:3}],note:'Internal supplier preparation only'},requestId=crypto.randomUUID();
 let draft=ok(await f.order('order.food-save',input,null,'manager',{requestId}));assert.deepEqual(ok(await f.order('order.food-save',input,null,'manager',{requestId})),draft);
 let record=JSON.parse((await f.db.prepare('SELECT data FROM records WHERE id=?').bind(draft.recordId).first()).data);assert.equal(record.food.vendor,'Fictional supplier');assert.equal(record.lines[0].food.count.quantity,1);assert.equal(record.lines[0].food.sku.price,20);assert.equal(record.food.totalCents,6000);
 assert.equal((await f.order('order.save',{lines:[{name:'Drop provenance',quantity:1,unit:'bag'}]},draft)).status,400);
 draft=ok(await f.order('order.submit',{},draft));assert.equal((await f.order('order.review',{approve:true,note:'Self review'},draft,'manager')).status,403);
 const returned=ok(await f.order('order.review',{approve:false,note:'Reduce amount'},draft,'othermanager'));draft=ok(await f.order('order.food-save',{...input,lines:[{...input.lines[0],quantity:2}]},returned));record=JSON.parse((await f.db.prepare('SELECT data FROM records WHERE id=?').bind(draft.recordId).first()).data);assert.equal(record.foodVersions.length,1);assert.equal(record.foodVersions[0].lines[0].quantity,3);
 draft=ok(await f.order('order.submit',{},draft));const approved=ok(await f.order('order.review',{approve:true,note:'Checked source counts and pack'},draft,'othermanager'));record=JSON.parse((await f.db.prepare('SELECT data FROM records WHERE id=?').bind(approved.recordId).first()).data);assert.equal(record.status,'approved');assert.equal(record.reviewerId,'othermanager');assert.equal(record.approvedRevision,draft.revision);assert.deepEqual(await f.db.prepare('SELECT data,revision FROM food_records WHERE id=?').bind(item.recordId).first(),before);
 const page=ok(await f.request('othermanager','/api/food/workflows?locationId=a&dataset=demo'));assert.equal(page.purchases[0].id,approved.recordId);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM food_workflows WHERE kind NOT IN (\'definition\',\'count\',\'plan\')').first()).n,0);
});

test('changed Food source blocks order submit and approval; same principal alias cannot approve',async t=>{
 const f=await setup(t);let item=ok(await f.food('fooditem.count',{quantity:1,note:'Physical count',confirmed:true},f.item));
 const input=()=>({dataset:'demo',countDate:today(),lines:[{itemId:item.recordId,itemRevision:item.revision,skuId:'sku',quantity:3}],note:'Test source guards'});
 let draft=ok(await f.order('order.food-save',input()));item=ok(await f.food('fooditem.count',{quantity:2,note:'Recount',confirmed:true},item));assert.equal((await f.order('order.submit',{},draft)).status,409);
 draft=ok(await f.order('order.food-save',input(),draft));draft=ok(await f.order('order.submit',{},draft));
 const w=(await workspace(f.db,{source:'sites',authUserId:'othermanager-identity'},'a')).value;
 await assert.rejects(()=>resolveFoodOrder(f.db,w,'manager-identity',{requestId:crypto.randomUUID(),locationId:'a',action:'order.review',recordId:draft.recordId,expectedRevision:draft.revision,input:{approve:true,note:'Alias of creator'}},new Date().toISOString()),e=>e.status===403&&/different authenticated/i.test(e.message));
 item=ok(await f.food('fooditem.count',{quantity:3,note:'Further recount',confirmed:true},item));assert.equal((await f.order('order.review',{approve:true,note:'Old sources'},draft,'othermanager')).status,409);assert.equal((await f.order('order.review',{approve:false,note:'Refresh sources'},draft,'othermanager')).status,200);
});

test('purchasing rejects stale count days, rollover approval and future supplier price dates',async t=>{
 const f=await setup(t),item=ok(await f.food('fooditem.count',{quantity:1,note:'Physical count',confirmed:true},f.item));
 const input={dataset:'demo',countDate:today(),lines:[{itemId:item.recordId,itemRevision:item.revision,skuId:'sku',quantity:3}],note:'Freshness checks'};
 assert.equal((await f.order('order.food-save',{...input,countDate:nextDate(today(),-1)})).status,400);
 let draft=ok(await f.order('order.food-save',input));draft=ok(await f.order('order.submit',{},draft));
 const w=(await workspace(f.db,{source:'sites',authUserId:'othermanager-identity'},'a')).value,command={requestId:crypto.randomUUID(),locationId:'a',action:'order.review',recordId:draft.recordId,expectedRevision:draft.revision,input:{approve:true,note:'Rollover'}};
 await assert.rejects(()=>resolveFoodOrder(f.db,w,'othermanager-identity',command,new Date(Date.now()+86400000).toISOString()),e=>e.status===409&&/no longer from today/i.test(e.message));
 const stored=JSON.parse((await f.db.prepare('SELECT data FROM food_records WHERE id=?').bind(item.recordId).first()).data);stored.vendorSkus[0].priceUpdatedAt=nextDate(today(),1);await f.db.prepare('UPDATE food_records SET data=? WHERE id=?').bind(JSON.stringify(stored),item.recordId).run();
 assert.equal((await f.order('order.food-save',input)).status,400);
});
