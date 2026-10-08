import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {Miniflare} from 'miniflare';

// Actual local services and disposable D1. No preview persona, remote account,
// running review server or supplier service participates in these roundtrips.
const compiled=path.resolve('.sites-runtime/module-access-baseline');
fs.mkdirSync(compiled,{recursive:true});
for(const name of fs.readdirSync('app/shared').filter(n=>n.endsWith('.ts'))){
 const js=ts.transpileModule(fs.readFileSync('app/shared/'+name,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");
 fs.writeFileSync(path.join(compiled,name.replace(/\.ts$/,'.mjs')),js);
}
const load=name=>import(pathToFileURL(path.join(compiled,name+'.mjs')));
const {handleWorkspace}=await load('service');
const {handleFood}=await load('food-service');
const {handleFoodWorkflows}=await load('food-workflow-service');
const {handleAccess}=await load('access-service');
const {localDate,nextDate}=await load('local-time');
const {buildRoleHome}=await load('role-home');
const {resolveRoleHomeTarget}=await load('role-home-target');
const {dishCheckoutCycleStatus}=await load('domain');
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/module-access-registry');
const ok=result=>{assert.equal(result.status,200,JSON.stringify(result.data));return result.data;};
const today=()=>localDate(new Date().toISOString(),'America/New_York');
const due=()=>new Date(Date.now()+86400000).toISOString();

async function fixture(t){
 let outbound=0;
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("local acceptance fixture")}}',compatibilityDate:'2026-05-22',d1Databases:['DB'],outboundService:()=>{outbound++;throw Error('No outbound service is authorized in this local acceptance fixture');}});
 t.after(async()=>{await mf.dispose();assert.equal(outbound,0);});
 const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const location of ['a','b'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(location,'Fictional restaurant '+location,'America/New_York').run();
 const members=[
  ['owner','combined','Owner',['location.manage','tasks.manage']],
  ['owner-review','combined','Owner',['location.manage','orders.review']],
  ['boh','BOH','Kitchen manager',['tasks.manage','people.manage','orders.request']],
  ['opener','BOH','Kitchen manager',['tasks.manage']],
  ['foh','FOH','Service manager',['tasks.manage','people.manage']],
  ['gm-title','BOH','General manager',['tasks.manage']],
  ['gm-operating','combined','General manager',['tasks.manage','operations.store']],
  ['gm-cap-only','combined','General manager',['operations.store']],
  ['gm-other-store','combined','General manager',['tasks.manage','operations.store'],'b'],
  ['guide-approver','BOH','Guide reviewer',['tasks.manage','standards.approve']],
  ['worker','BOH','Cook',[]],['other-worker','BOH','Cook',[]],['dish','BOH','Dishwasher',[]],['dish-pm-one','BOH','Dishwasher',[]],['dish-pm-two','BOH','Dishwasher',[]],
  ['foreign','BOH','Owner',['location.manage','tasks.manage','orders.review'],'b'],
 ];
 for(const [actor,area,position,caps,location='a'] of members)await db.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,active) VALUES(?,?,?,?,?,?,?,?,?,1)').bind(actor,actor+'@example.test',actor+'-identity',location,'Fictional '+actor,area,position,JSON.stringify(caps),JSON.stringify([position])).run();
 async function request(actor,url,body){
  const handler=url.startsWith('/api/access')?handleAccess:url.startsWith('/api/food/workflows')?handleFoodWorkflows:url.startsWith('/api/food')?handleFood:handleWorkspace;
  const response=await handler(new Request('http://localhost'+url,{headers:{'oai-authenticated-user-id':actor+'-identity','oai-authenticated-user-email':actor+'@example.test',Origin:'http://localhost','Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})}),db);
  return {status:response.status,data:await response.json()};
 }
 const command=(actor,action,input={},record,extra={},url='/api/workspace')=>request(actor,url,{requestId:crypto.randomUUID(),locationId:'a',action,input,...(record?{recordId:record.recordId??record.id,expectedRevision:record.revision}:{}),...extra});
 const view=async(actor,location='a')=>ok(await request(actor,'/api/workspace?locationId='+location));
 const record=async(actor,saved)=>(await view(actor)).records.find(r=>r.id===(saved.recordId??saved.id));
 const target=async(actor,role,saved,tab,mode='detail')=>{const w=await view(actor),item=buildRoleHome(w,role).attention.find(i=>i.recordId===(saved.recordId??saved.id));assert.ok(item,'The persisted source record must be represented in its role home');const result=resolveRoleHomeTarget(w,item);assert.equal(result.tab,tab);assert.equal(result.mode,mode);assert.equal(result.record.id,saved.recordId??saved.id);assert.equal(result.record.revision,saved.revision);return result.record;};
 const state=async()=>Object.fromEntries(await Promise.all(['records','command_receipts','audit_events','locations','food_records','food_state','food_workflows','food_workflow_events','food_receipts'].map(async table=>[table,(await db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()).results])));
 async function rejectedWithoutWrite(action,status){const before=await state(),response=await action();assert.equal(response.status,status,JSON.stringify(response.data));assert.deepEqual(await state(),before);return response;}
 return {db,request,command,view,record,target,rejectedWithoutWrite};
}
const taskInput=()=>({ownerId:'worker',title:'Fictional prep handoff',detail:'Confirm the fictional handoff and leave an update.',kind:'task',due:due()});
const logInput=(department='BOH',ownerId='boh')=>({title:'Fictional department issue',detail:'Review-only equipment example.',category:'Maintenance',priority:'routine',department,ownerId,due:due()});

test('AM checkout, accepted unfinished work and two independent PM checkouts preserve own-work scope and complete only after validation',async t=>{
 const f=await fixture(t),input={amOwnerId:'dish',pmOwnerIds:['dish-pm-one','dish-pm-two'],businessDate:today(),title:'Fictional dish station',detail:'Check racks, machine and station before checkout.',due:due()},requestId=crypto.randomUUID();
 await f.rejectedWithoutWrite(()=>f.command('dish','task.dish-cycle',input),403);
 await f.rejectedWithoutWrite(()=>f.command('foh','task.dish-cycle',input),403);
 await f.rejectedWithoutWrite(()=>f.command('foreign','task.dish-cycle',input),403);
 await f.rejectedWithoutWrite(()=>f.command('boh','task.dish-cycle',{...input,pmOwnerIds:['dish-pm-one','dish-pm-one']}),400);
 const created=ok(await f.command('gm-operating','task.dish-cycle',input,undefined,{requestId}));
 assert.deepEqual(ok(await f.command('gm-operating','task.dish-cycle',input,undefined,{requestId})),created);
 const view=await f.view('gm-operating'),checkouts=view.records.filter(r=>r.kind==='task'&&r.data.dishCheckout),cycleId=checkouts[0].data.dishCheckout.cycleId;
 assert.equal(checkouts.length,3);assert.equal(dishCheckoutCycleStatus(view,cycleId).complete,false);
 const am=checkouts.find(r=>r.ownerId==='dish'),pm1=checkouts.find(r=>r.ownerId==='dish-pm-one'),pm2=checkouts.find(r=>r.ownerId==='dish-pm-two');
 assert.deepEqual((await f.view('dish-pm-one')).records.filter(r=>r.kind==='task').map(r=>r.id),[pm1.id]);
 await f.rejectedWithoutWrite(()=>f.command('boh','task.dish-cycle',input),400);
 await f.rejectedWithoutWrite(()=>f.command('dish-pm-two','task.transition',{step:'ready',note:'Cannot close the other dishwasher'},pm1),404);
 await f.rejectedWithoutWrite(()=>f.command('dish','task.dish-pass',{incomingId:'worker',note:'Wrong person',due:due()},am),400);
 const passId=crypto.randomUUID(),passInput={incomingId:'dish-pm-one',note:'One rack remains; PM must finish and leave evidence.',due:due()};
 const passed=ok(await f.command('dish','task.dish-pass',passInput,am,{requestId:passId}));
 assert.deepEqual(ok(await f.command('dish','task.dish-pass',passInput,am,{requestId:passId})),passed);
 const refreshedAm=await f.record('dish',am),child=(await f.view('dish-pm-one')).records.find(r=>r.kind==='task'&&r.data.dishHandoff);
 assert.equal(refreshedAm.data.phase,'open');assert.deepEqual(refreshedAm.data.dishHandoffs,[child.id]);assert.equal(child.data.dishHandoff.sourceId,am.id);
 await f.rejectedWithoutWrite(()=>f.command('dish','task.transition',{step:'ready',note:'Stale AM revision'},am),409);
 await f.rejectedWithoutWrite(()=>f.command('dish-pm-one','task.transition',{step:'ready',note:'Before acceptance'},child),400);
 await f.rejectedWithoutWrite(()=>f.command('dish-pm-two','task.transition',{step:'accept',note:'Wrong incoming dishwasher'},child),404);
 const offeredCorrection=ok(await f.command('gm-operating','task.transition',{step:'fix',note:'Clarify the incoming rack requirements before acceptance.'},child));
 const accepted=ok(await f.command('dish-pm-one','task.transition',{step:'accept',note:'I received the unfinished rack work.'},offeredCorrection));
 const acceptedRecord=await f.record('dish-pm-one',accepted);assert.equal(acceptedRecord.data.phase,'correction');assert.equal(acceptedRecord.data.dishHandoff.acceptedBy,'dish-pm-one');
 await f.rejectedWithoutWrite(()=>f.command('dish-pm-one','task.transition',{step:'ready',note:'Incoming work still unfinished'},pm1),400);
 const amReady=ok(await f.command('dish','task.transition',{step:'ready',note:'AM checkout submitted; unfinished rack explicitly passed to PM.'},refreshedAm));
 const amClosed=ok(await f.command('gm-operating','task.transition',{step:'verify',note:'GM physically validated AM checkout and recorded pending PM work.'},amReady));
 assert.equal((await f.record('dish',amClosed)).data.phase,'closed');assert.equal(dishCheckoutCycleStatus(await f.view('gm-operating'),cycleId).complete,false);
 const childReady=ok(await f.command('dish-pm-one','task.transition',{step:'ready',note:'Rack finished; ready for manager check.'},accepted));
 await f.rejectedWithoutWrite(()=>f.command('dish-pm-one','task.transition',{step:'verify',note:'Cannot verify own work'},childReady),403);
 const correction=ok(await f.command('boh','task.transition',{step:'fix',note:'One tray needs another pass.'},childReady));
 const childRetry=ok(await f.command('dish-pm-one','task.transition',{step:'ready',note:'Tray corrected.'},correction));
 const childClosed=ok(await f.command('boh','task.transition',{step:'verify',note:'Remaining work physically checked.'},childRetry));
 const originalChild=await f.record('dish-pm-one',childClosed);assert.deepEqual(originalChild.data.history.map(h=>h.action),['passed','fix','accepted','ready','fix','ready','verify']);
 const pm1Ready=ok(await f.command('dish-pm-one','task.transition',{step:'ready',note:'My PM station checkout submitted.'},pm1));
 ok(await f.command('boh','task.transition',{step:'verify',note:'First PM dishwasher checked independently.'},pm1Ready));
 const stillPending=dishCheckoutCycleStatus(await f.view('gm-operating'),cycleId);assert.equal(stillPending.complete,false);assert.deepEqual(stillPending.pendingCheckoutIds,[pm2.id]);
 await f.rejectedWithoutWrite(()=>f.command('dish-pm-one','task.transition',{step:'ready',note:'Cannot submit colleague checkout'},pm2),404);
 const pm2Ready=ok(await f.command('dish-pm-two','task.transition',{step:'ready',note:'My own PM checkout submitted separately.'},pm2));
 const verifyId=crypto.randomUUID(),verifyInput={step:'verify',note:'Second PM dishwasher checked independently.'};
 const pm2Closed=ok(await f.command('gm-operating','task.transition',verifyInput,pm2Ready,{requestId:verifyId}));
 assert.deepEqual(ok(await f.command('gm-operating','task.transition',verifyInput,pm2Ready,{requestId:verifyId})),pm2Closed);
 const finalView=await f.view('gm-operating');assert.equal(dishCheckoutCycleStatus(finalView,cycleId).complete,true);
 const second=await f.record('dish-pm-two',pm2Closed);assert.deepEqual(second.data.history.map(h=>h.actorId),['gm-operating','dish-pm-two','gm-operating']);
 assert.equal(dishCheckoutCycleStatus({...finalView,records:finalView.records.filter(r=>r.id!==pm2.id)},cycleId).complete,false);
 assert.deepEqual(dishCheckoutCycleStatus({...finalView,records:finalView.records.filter(r=>r.id!==pm2.id)},cycleId).missingIds,['dish-pm-two']);
 assert.equal(dishCheckoutCycleStatus({...finalView,records:finalView.records.filter(r=>r.id!==child.id)},cycleId).complete,false);
 assert.deepEqual(dishCheckoutCycleStatus({...finalView,records:finalView.records.filter(r=>r.id!==child.id)},cycleId).unavailableHandoffIds,[child.id]);
 for(const patch of [{ownerId:'worker'},{data:{...originalChild.data,dishHandoff:{...originalChild.data.dishHandoff,sourceId:'wrong-source'}}},{data:{...originalChild.data,dishHandoff:{...originalChild.data.dishHandoff,acceptedBy:'dish-pm-two'}}},{data:{...originalChild.data,dishHandoff:{...originalChild.data.dishHandoff,businessDate:nextDate(today())}}}]){
   const invalid=dishCheckoutCycleStatus({...finalView,records:finalView.records.map(r=>r.id===child.id?{...r,...patch}:r)},cycleId);
   assert.equal(invalid.complete,false);assert.equal(invalid.coverageComplete,false);assert.deepEqual(invalid.invalidHandoffIds,[child.id]);
 }
 for(const patch of [{...pm2.data.dishCheckout,businessDate:nextDate(today())},{...pm2.data.dishCheckout,shift:'AM'},{...pm2.data.dishCheckout,participantIds:['dish','dish-pm-one','other-worker']},{...pm2.data.dishCheckout,participantIds:'oops'}])assert.equal(dishCheckoutCycleStatus({...finalView,records:finalView.records.map(r=>r.id===pm2.id?{...r,data:{...r.data,dishCheckout:patch}}:r)},cycleId).coverageComplete,false);
 assert.equal(dishCheckoutCycleStatus({...finalView,records:finalView.records.map(r=>r.id===am.id?{...r,data:{...r.data,dishCheckout:{...r.data.dishCheckout,participantIds:'oops'}}}:r)},cycleId).complete,false);
 assert.equal(dishCheckoutCycleStatus({...finalView,records:finalView.records.map(r=>r.id===pm2.id?{...r,area:'FOH'}:r)},cycleId).complete,false);
 const lateSource=ok(await f.command('gm-operating','task.dish-cycle',{...input,businessDate:nextDate(today())}));
 const lateAM=(await f.view('dish')).records.find(r=>r.kind==='task'&&r.data.dishCheckout?.businessDate===nextDate(today()));
 const latePM=(await f.view('dish-pm-one')).records.find(r=>r.kind==='task'&&r.data.dishCheckout?.businessDate===nextDate(today()));
 const lateReady=ok(await f.command('dish-pm-one','task.transition',{step:'ready',note:'PM work already done'},latePM));
 ok(await f.command('boh','task.transition',{step:'verify',note:'PM checked before late offer'},lateReady));
 await f.rejectedWithoutWrite(()=>f.command('dish','task.dish-pass',passInput,lateAM),400);
 assert.ok(lateSource);
 const notices=(await f.view('gm-operating')).records.filter(r=>r.kind==='message'&&r.data.title.includes('verification'));
 assert.ok(notices.some(r=>r.data.recipients.includes('gm-operating')),'An explicitly authorized GM receives checkout-review notices');
});

test('frontline can reopen and report its own task ready; completion still needs an authorized different person',async t=>{
 const f=await fixture(t),created=ok(await f.command('boh','task.create',taskInput()));
 assert.equal((await f.record('worker',created)).data.phase,'open');
 await f.target('worker','frontline',created,'Legacy duties');
 assert.equal(await f.record('other-worker',created),undefined);
 await f.rejectedWithoutWrite(()=>f.command('worker','task.transition',{step:'verify',note:'Forbidden self verification'},created),403);
 await f.rejectedWithoutWrite(()=>f.command('other-worker','task.transition',{step:'ready',note:'Not my task'},created),404);
 await f.rejectedWithoutWrite(()=>f.command('foh','task.transition',{step:'verify',note:'Wrong department'},created),404);
 const ready=ok(await f.command('worker','task.transition',{step:'ready',note:'Fictional work ready for physical verification'},created));
 const view=await f.view('boh');assert.equal(view.records.find(r=>r.id===created.recordId).data.phase,'verification');
 assert.ok(buildRoleHome(view,'department-manager').attention.some(i=>i.recordId===created.recordId));
 const verified=ok(await f.command('boh','task.transition',{step:'verify',note:'Fictional manager check completed'},ready));
 const saved=await f.record('worker',verified);assert.equal(saved.id,created.recordId);assert.equal(saved.data.phase,'closed');assert.deepEqual(saved.data.history.map(h=>h.action),['assigned','ready','verify']);
});

test('manager assigns and reassigns ordinary Dishwasher work, with independent verification and unchanged denied saves',async t=>{
 const f=await fixture(t);
 const created=ok(await f.command('boh','task.create',{...taskInput(),ownerId:'dish'}));
 const assigned=await f.target('dish','frontline',created,'Legacy duties');
 assert.equal(assigned.locationId,'a');assert.equal(assigned.ownerId,'dish');
 await f.rejectedWithoutWrite(()=>f.command('foh','task.create',{...taskInput(),ownerId:'dish'}),403);
 await f.rejectedWithoutWrite(()=>f.command('foreign','task.create',{...taskInput(),ownerId:'dish'}),403);
 await f.rejectedWithoutWrite(()=>f.command('boh','task.create',{...taskInput(),ownerId:'dish',kind:'issue'}),400);
 await f.rejectedWithoutWrite(()=>f.command('boh','task.create',{...taskInput(),ownerId:'dish',kind:'handoff',incomingId:'worker'}),400);
 await f.rejectedWithoutWrite(()=>f.command('other-worker','task.transition',{step:'ready',note:'Not my work'},created),404);
 await f.rejectedWithoutWrite(()=>f.command('dish','task.transition',{step:'verify',note:'Self approval'},created),403);
 const ready=ok(await f.command('dish','task.transition',{step:'ready',note:'Rack check ready for manager verification'},created));
 await f.rejectedWithoutWrite(()=>f.command('boh','task.transition',{step:'verify',note:'Stale edit'},created),409);
 const verified=ok(await f.command('boh','task.transition',{step:'verify',note:'Manager physically checked the result'},ready));
 const saved=await f.record('dish',verified);
 assert.equal(saved.locationId,'a');assert.equal(saved.data.phase,'closed');assert.deepEqual(saved.data.history.map(h=>h.action),['assigned','ready','verify']);
 assert.deepEqual(saved.data.history.map(h=>h.actorId),['boh','dish','boh']);
 const initial=ok(await f.command('boh','task.create',taskInput()));
 const reassigned=ok(await f.command('boh','task.reassign',{ownerId:'dish',note:'Move the ordinary rack check to dish'},initial));
 assert.equal((await f.record('dish',reassigned)).ownerId,'dish');assert.equal(await f.record('worker',reassigned),undefined);
 const issue=ok(await f.command('boh','task.create',{...taskInput(),kind:'issue'}));
 await f.rejectedWithoutWrite(()=>f.command('boh','task.reassign',{ownerId:'dish',note:'Invalid issue assignment'},issue),400);
});

test('Dishwasher can read and reply to its own Inbox conversation, while other people cannot open it',async t=>{
 const f=await fixture(t),sent=ok(await f.command('boh','message.send',{recipients:['dish'],title:'Fictional dish handoff',body:'Please reply when the sample rack check is understood.'}));
 assert.ok(await f.record('dish',sent));assert.equal(await f.record('other-worker',sent),undefined);
 await f.target('dish','frontline',sent,'Inbox');
 await f.rejectedWithoutWrite(()=>f.command('other-worker','message.reply',{text:'Private conversation'},sent),404);
 ok(await f.command('dish','message.read',{},sent));
 const reply=ok(await f.command('dish','message.reply',{text:'Fictional reply: understood.'},sent));
 const reopened=await f.record('boh',reply);assert.equal(reopened.data.replies[0].actorId,'dish');assert.equal(reopened.data.replies[0].text,'Fictional reply: understood.');
 await f.rejectedWithoutWrite(()=>f.command('dish','managerlog.create',logInput()),403);
 assert.equal((await f.request('foreign','/api/workspace?locationId=a')).status,403);
});

test('a visible automatic task notice can be read but cannot be replied to as a conversation',async t=>{
 const f=await fixture(t);ok(await f.command('boh','task.create',taskInput()));
 const notice=(await f.view('worker')).records.find(r=>r.kind==='message'&&r.data.automated);assert.ok(notice);
 await f.rejectedWithoutWrite(()=>f.command('worker','message.reply',{text:'Reply to automatic notice'},notice),400);
 ok(await f.command('worker','message.read',{},notice));
 assert.ok((await f.record('worker',notice)).data.readBy.includes('worker'));
});

test('department Manager Log persists through acceptance and cross-account note with department and restaurant denials',async t=>{
 const f=await fixture(t),created=ok(await f.command('boh','managerlog.create',logInput()));
 assert.ok(await f.record('opener',created));assert.equal(await f.record('foh',created),undefined);
 await f.target('opener','department-manager',created,'Manager Log','issue');
 await f.rejectedWithoutWrite(()=>f.command('foh','managerlog.note',{note:'Wrong department'},created),404);
 await f.rejectedWithoutWrite(()=>f.command('foreign','managerlog.note',{note:'Wrong restaurant'},created),403);
 await f.rejectedWithoutWrite(()=>f.command('opener','managerlog.accept',{note:'Not assigned to me'},created),403);
 const accepted=ok(await f.command('boh','managerlog.accept',{note:'I own the next step'},created));
 const noted=ok(await f.command('opener','managerlog.note',{note:'Fictional opening manager update'},accepted));
 const reopened=await f.record('owner',noted);assert.equal(reopened.id,created.recordId);assert.equal(reopened.data.acceptedBy,'boh');assert.equal(reopened.data.history.at(-1).actorId,'opener');
 await f.rejectedWithoutWrite(()=>f.command('boh','managerlog.note',{note:'Stale source'},created),409);
 const front=ok(await f.command('foh','managerlog.create',logInput('FOH','foh')));
 assert.ok(await f.record('owner',front));assert.equal(await f.record('boh',front),undefined);
});

test('General manager job title alone does not grant restaurant-wide operational or administration access',async t=>{
 const f=await fixture(t),back=ok(await f.command('boh','managerlog.create',logInput())),front=ok(await f.command('foh','managerlog.create',logInput('FOH','foh')));
 assert.ok(await f.record('gm-title',back));assert.equal(await f.record('gm-title',front),undefined);
 await f.rejectedWithoutWrite(()=>f.command('gm-title','managerlog.note',{note:'Title is not authority'},front),404);
 const w=await f.view('gm-title'),home=buildRoleHome(w,'general-manager');
 assert.ok(home.attention.some(i=>i.area==='FOH'&&i.freshness.state==='unavailable'));
 assert.ok(!w.me.capabilities.includes('location.manage'));
});

test('shared employee feedback persists through the separate feedback workflow and excludes another department',async t=>{
 const f=await fixture(t),sent=ok(await f.command('worker','feedback.save',{text:'Fictional support request',shared:true}));
 assert.ok(await f.record('boh',sent));assert.equal(await f.record('foh',sent),undefined);
 await f.target('boh','department-manager',sent,'Feedback');
 await f.rejectedWithoutWrite(()=>f.command('foh','feedback.respond',{text:'Wrong department'},sent),404);
 const reply=ok(await f.command('boh','feedback.respond',{response:'Fictional coaching follow-up',due:due()},sent));
 assert.equal((await f.record('worker',reply)).data.response,'Fictional coaching follow-up');
});

test('Food prep and purchasing require the existing module capabilities, preserve sources and keep supplier placement separate',async t=>{
 const f=await fixture(t),food=(actor,action,input,record)=>f.command(actor,action,input,record,{},'/api/food');
 const prep=(actor,action,input,record)=>f.command(actor,action,{dataset:'demo',...input},record,{},'/api/food/workflows');
 const raw={restaurantId:'module-fixture',name:'Fictional flour',controlNumber:'MODULE-FLOUR',purchaseUnit:'bag',packCount:1,unitQty:25,unitUOM:'lb',portionSize:1,portionUOM:'lb',par:4,active:true,countActive:true,needsReview:false,vendorSkus:[{id:'module-sku',vendor:'Fictional supplier',vendorSku:'F1',purchaseUnit:'bag',packCount:1,unitQty:25,unitUOM:'lb',price:20,priceUpdatedAt:today(),preferred:true,available:true}]};
 let item=ok(await food('owner','fooditem.import',{dataset:'demo',sourceRestaurantId:'module-fixture',sourceLabel:'Fictional module-access fixture',destinationLocationId:'a',confirmed:true,rows:[raw]}));
 item=ok(await food('boh','fooditem.count',{quantity:1,note:'Fictional count',confirmed:true},item));
 const def=ok(await prep('boh','definition.save',{foodRecordId:item.recordId,foodRevision:item.revision,track:'daily',countUnit:'bag',par:4,reviewNote:'Fictional unit/par review',confirmed:true}));
 for(const actor of ['worker','dish','foh','foreign'])assert.equal((await f.request(actor,'/api/food/workflows?locationId=a&dataset=demo')).status,403);
 assert.equal((await prep('worker','count.create',{track:'daily',businessDate:today()})).status,403);
 let count=ok(await prep('boh','count.create',{track:'daily',businessDate:today()}));
 count=ok(await prep('boh','count.save',{lines:[{definitionId:def.recordId,quantity:1,note:'Fictional evening count'}]},count));
 count=ok(await prep('boh','count.submit',{confirmed:true},count));
 const plan=ok(await prep('boh','plan.generate',{countId:count.recordId,countRevision:count.revision,targetDate:nextDate(today(),1)}));
 const released=ok(await prep('boh','plan.release',{confirmed:true},plan));
 const detail=ok(await f.request('owner','/api/food/workflows?'+new URLSearchParams({locationId:'a',dataset:'demo',recordId:released.recordId})));
 assert.equal(detail.record.status,'released');assert.equal(detail.record.lines[0].plannedQty,3);
 const sourceBefore=await f.db.prepare('SELECT * FROM food_records WHERE id=?').bind(item.recordId).first();
 const input={dataset:'demo',countDate:today(),lines:[{itemId:item.recordId,itemRevision:item.revision,skuId:'module-sku',quantity:3}],note:'Internal review fixture only'};
 assert.equal((await f.command('owner','order.food-save',input)).status,403,'Restaurant administration alone is not purchase request permission');
 let order=ok(await f.command('boh','order.food-save',input));
 assert.equal(await f.record('owner-review',order),undefined,'Another reviewer cannot see the requester’s draft');
 order=ok(await f.command('boh','order.submit',{},order));
 assert.ok(await f.record('owner-review',order));
 await f.target('owner-review','owner',order,'Purchasing review','food-order');
 await f.rejectedWithoutWrite(()=>f.command('owner','order.review',{approve:true,note:'Missing review permission'},order),403);
 await f.rejectedWithoutWrite(()=>f.command('boh','order.review',{approve:true,note:'Self review'},order),403);
 const approved=ok(await f.command('owner-review','order.review',{approve:true,note:'Fictional count and pack review'},order));
 const saved=await f.record('boh',approved);assert.equal(saved.data.status,'approved');assert.equal(saved.data.reviewerId,'owner-review');assert.equal(saved.data.food.dataset,'demo');
 assert.deepEqual(await f.db.prepare('SELECT * FROM food_records WHERE id=?').bind(item.recordId).first(),sourceBefore);
});

test('explicit operational GM scope completes real Manager Log and shift-summary workflows in both departments',async t=>{
 const f=await fixture(t);
 for(const [department,manager] of [['FOH','foh'],['BOH','boh']]){
  let issue=ok(await f.command(manager,'managerlog.create',logInput(department,manager)));
  issue=ok(await f.command('gm-operating','managerlog.reassign',{ownerId:'gm-operating',note:'Fictional GM takes this department follow-up',due:due()},issue));
  issue=ok(await f.command('gm-operating','managerlog.accept',{note:'I will coordinate the next step'},issue));
  let summary=ok(await f.command('gm-operating','shiftentry.save',{businessDate:today(),department,shift:'closing',readiness:'action-needed',summary:'Fictional department summary',tomorrowNote:'Confirm the recorded issue.',issueIds:[issue.recordId]}));
  summary=ok(await f.command('gm-operating','shiftentry.submit',{},summary));
  assert.equal((await f.record(manager,summary)).data.status,'submitted');
  await f.target('gm-operating','general-manager',summary,'Manager Log','summary');
  issue=ok(await f.command('gm-operating','managerlog.resolve',{note:'Fictional follow-up completed and confirmed'},issue));
  const reopened=await f.record(manager,issue);assert.equal(reopened.data.status,'resolved');assert.equal(reopened.ownerId,'gm-operating');assert.equal(reopened.area,department);
  assert.equal(await f.record(department==='FOH'?'boh':'foh',issue),undefined);
 }
 const w=await f.view('gm-operating'),home=buildRoleHome(w,'general-manager');
 assert.deepEqual(w.me.capabilities,['tasks.manage','operations.store']);
 assert.ok(home.attention.some(i=>i.recordKind==='shiftentry'&&i.area==='FOH'));
 assert.ok(home.attention.some(i=>i.recordKind==='shiftentry'&&i.area==='BOH'));
 assert.ok(!home.attention.some(i=>i.freshness.state==='unavailable'&&['FOH','BOH'].includes(i.area)));
 assert.ok(!buildRoleHome(await f.view('owner'),'owner').attention.some(i=>i.area==='combined'&&i.freshness.state==='missing'),'GM administration grouping must not invent an operating department');
});

test('operational GM scope adds Food and prep management while retaining administration, People, purchasing, scheduling and foreign-store boundaries',async t=>{
 const f=await fixture(t),issue=ok(await f.command('boh','managerlog.create',logInput()));
 await f.rejectedWithoutWrite(()=>f.command('gm-cap-only','managerlog.note',{note:'Missing tasks.manage'},issue),404);
 await f.rejectedWithoutWrite(()=>f.command('gm-other-store','managerlog.note',{note:'Other restaurant'},issue),403);
 assert.equal((await f.request('gm-operating','/api/workspace?locationId=b')).status,403);
 assert.equal((await f.request('gm-operating','/api/access?locationId=a')).status,403);
 const prep=ok(await f.request('gm-operating','/api/food/workflows?locationId=a&dataset=demo'));
 assert.deepEqual(prep.permissions,{managePrep:true,purchase:false,reviewPurchase:false});
 await f.rejectedWithoutWrite(()=>f.command('gm-operating','managerlog.create',logInput('production','boh')),403);
 const feedback=ok(await f.command('worker','feedback.save',{text:'Fictional private team support',shared:true}));
 assert.equal(await f.record('gm-operating',feedback),undefined);
 await f.rejectedWithoutWrite(()=>f.command('gm-operating','feedback.respond',{response:'Unauthorized People action',due:due()},feedback),404);
 await f.rejectedWithoutWrite(()=>f.command('gm-operating','shift.save',{personId:'worker',position:'Cook',start:due(),end:new Date(Date.now()+90000000).toISOString()}),403);
 await f.rejectedWithoutWrite(()=>f.command('gm-operating','standard.save',{area:'BOH',title:'Unauthorized guide',zone:'fixture-zone',position:'Cook',criteria:['Fictional criterion'],source:'Fictional source',version:1,verification:'manager'}),403);
 await f.rejectedWithoutWrite(()=>f.command('gm-operating','order.save',{lines:[{name:'Fictional item',quantity:1,unit:'case',productId:'fixture'}],note:'Missing ordering permission'}),403);
});

test('Dishwasher can read an actually approved position guide without gaining draft, other-position or authoring access',async t=>{
 const f=await fixture(t);
 const input=(title,zone,position)=>({title,zone,position,criteria:['Fictional observable completion'],source:'Fictional reviewed instruction source',version:1,verification:'manager',guide:{purpose:'Fictional task guidance only.',preparation:[],steps:['Check with the fictional manager.'],troubleshooting:[],escalation:'Ask the manager when uncertain.'}});
 const draft=ok(await f.command('boh','standard.save',input('Draft Dish instructions','dish-draft','Dishwasher')));
 let approved=ok(await f.command('boh','standard.save',input('Approved Dish instructions','dish-approved','Dishwasher')));
 approved=ok(await f.command('guide-approver','standard.approve',{validated:true,note:'Fictional source checked'},approved));
 let cook=ok(await f.command('boh','standard.save',input('Cook instructions','cook-approved','Cook')));
 cook=ok(await f.command('guide-approver','standard.approve',{validated:true,note:'Fictional source checked'},cook));
 const w=await f.view('dish');
 assert.ok(w.records.some(r=>r.id===approved.recordId));assert.ok(!w.records.some(r=>r.id===draft.recordId||r.id===cook.recordId));
 assert.ok(buildRoleHome(w,'frontline').attention.some(i=>i.recordId===approved.recordId&&i.tab==='Training'));
 await f.target('dish','frontline',approved,'Training');
 await f.rejectedWithoutWrite(()=>f.command('dish','standard.retire',{note:'Not an approver'},approved),403);
 await f.rejectedWithoutWrite(()=>f.command('dish','standard.save',input('Unauthorized draft','unauthorized','Dishwasher')),403);
});
