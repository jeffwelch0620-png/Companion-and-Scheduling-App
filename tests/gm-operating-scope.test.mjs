import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {Miniflare} from 'miniflare';

// Disposable local stores and fictional identities; no running preview or grant.
const output=path.resolve('.sites-runtime/gm-operating-scope');
fs.mkdirSync(output,{recursive:true});
for(const name of fs.readdirSync('app/shared').filter(n=>n.endsWith('.ts'))){
 const js=ts.transpileModule(fs.readFileSync('app/shared/'+name,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");
 fs.writeFileSync(path.join(output,name.replace(/\.ts$/,'.mjs')),js);
}
const load=name=>import(pathToFileURL(path.join(output,name+'.mjs')));
const {gmOperatingSetup}=await load('gm-operating-setup');
const {operationsManager}=await load('operations');
const {foodManager}=await load('food');
const {foodPurchaser,foodWorkflowDestination}=await load('food-navigation');
const {availableModules}=await load('operations-home');
const {authorizedRoleHomeKind}=await load('role-home-target');
const {handleAccess}=await load('access-service');
const {handleWorkspace}=await load('service');
const {handleFood}=await load('food-service');
const {handleFoodWorkflows}=await load('food-workflow-service');
const {localDate,nextDate}=await load('local-time');
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/gm-scope-registry');
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
const today=()=>localDate(new Date().toISOString(),'America/New_York');
const due=()=>new Date(Date.now()+86400000).toISOString();
const member={id:'gm',locationId:'a',name:'Fictional GM',qualifications:[],...gmOperatingSetup()};

test('explicit GM preset opens both department operating tools and prep without deriving authority from title',()=>{
 const a=gmOperatingSetup();a.capabilities.push('location.manage');
 assert.deepEqual(gmOperatingSetup().capabilities,['tasks.manage','operations.store'],'Each proposed setup is independent');
 assert.equal(operationsManager(member),true,'Nondepartment Executive membership can open operating tools');
 for(const area of ['FOH','BOH'])assert.equal(operationsManager(member,area),true);
 for(const area of ['production','combined'])assert.equal(operationsManager(member,area),false);
 for(const capabilities of [[],['operations.store'],['tasks.manage']]){
  const titleOnly={...member,capabilities};assert.equal(operationsManager(titleOnly,'BOH'),false);assert.equal(foodManager(titleOnly),false);
 }
 const renamed={...member,position:'Cook'};assert.equal(operationsManager(renamed,'FOH'),true);
 assert.equal(foodManager(member),true);assert.equal(foodPurchaser(member),false);
 assert.equal(foodWorkflowDestination('Prep production',member),'prep');
 assert.equal(foodWorkflowDestination('Purchasing review',member),null);
 assert.ok(availableModules(member).some(m=>m.tab==='Manager Log'));
 assert.ok(!availableModules(member).some(m=>m.access==='owner'));
 assert.equal(authorizedRoleHomeKind({me:member},'owner'),'general-manager');
});

async function fixture(t){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fictional GM scope fixture")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const loc of ['a','b'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(loc,'Fictional restaurant '+loc,'America/New_York').run();
 for(const [id,area,position,caps] of [['admin','Executive','Administrator',['location.manage','tasks.manage']],['boh','BOH','Kitchen manager',['tasks.manage']],['foh','FOH','Service manager',['tasks.manage']],['worker','BOH','Cook',[]]])await db.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,active) VALUES(?,?,?,?,?,?,?,?,?,1)').bind(id,id+'@example.test',id+'-identity','a','Fictional '+id,area,position,JSON.stringify(caps),'[]').run();
 async function request(actor,url,body){
  const handler=url.startsWith('/api/access')?handleAccess:url.startsWith('/api/food/workflows')?handleFoodWorkflows:url.startsWith('/api/food')?handleFood:handleWorkspace;
  const response=await handler(new Request('http://localhost'+url,{headers:{'oai-authenticated-user-id':actor+'-identity','oai-authenticated-user-email':actor+'@example.test',Origin:'http://localhost','Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})}),db);
  return {status:response.status,data:await response.json()};
 }
 const command=(actor,url,action,input={},record,requestId=crypto.randomUUID())=>request(actor,url,{requestId,locationId:'a',action,input,...(record?{recordId:record.recordId??record.id,expectedRevision:record.revision}:{})});
 const profile={name:'Fictional GM',email:'gm@example.test',...gmOperatingSetup(),qualifications:[]};
 const draft=ok(await command('admin','/api/access','hire.save',{profile,hireDate:today(),note:'Fictional identity and operating setup review'}));
 const beforeEnable=await request('gm','/api/workspace?locationId=a');assert.equal(beforeEnable.status,403);
 const saved=await db.prepare('SELECT active,capabilities,auth_user_id FROM memberships WHERE id=?').bind(draft.recordId).first();assert.equal(saved.active,0);assert.equal(saved.auth_user_id,null);assert.deepEqual(JSON.parse(saved.capabilities),['tasks.manage','operations.store']);
 assert.equal((await command('admin','/api/access','hire.activate',{identityConfirmed:false,note:'Unreviewed'},draft)).status,400);
 const active=ok(await command('admin','/api/access','hire.activate',{identityConfirmed:true,clearancesConfirmed:false,note:'Fictional saved identity and permissions explicitly confirmed'},draft));
 assert.equal((await db.prepare('SELECT active FROM memberships WHERE id=?').bind(active.recordId).first()).active,1);
 // Fixtures bind a fictional authenticated principal after the enabled review.
 // This is not a setup-code redemption or a claim of real employee sign-in.
 await db.prepare('UPDATE memberships SET auth_user_id=? WHERE id=?').bind('gm-identity',active.recordId).run();
 const view=()=>request('gm','/api/workspace?locationId=a');
 const snapshot=async()=>Object.fromEntries(await Promise.all(['records','command_receipts','audit_events','food_records','food_workflows','food_workflow_events','food_receipts'].map(async table=>[table,(await db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()).results])));
 const rejected=async(fn,status)=>{const before=await snapshot(),response=await fn();assert.equal(response.status,status,JSON.stringify(response.data));assert.deepEqual(await snapshot(),before);return response;};
 return {db,request,command,profile,active,view,rejected};
}

test('reviewed distinct GM works FOH and BOH logs; stale, revocation, admin and foreign-store paths fail without partial writes',async t=>{
 const f=await fixture(t),w=ok(await f.view());assert.equal(w.me.area,'Executive');assert.deepEqual(w.me.capabilities,['tasks.manage','operations.store']);assert.equal(authorizedRoleHomeKind(w,'owner'),'general-manager');
 for(const area of ['FOH','BOH']){
  let r=ok(await f.command(area==='FOH'?'foh':'boh','/api/workspace','managerlog.create',{department:area,ownerId:w.me.id,title:area+' fictional handoff',detail:'Fictional department issue',category:'Other',priority:'routine',due:due()}));
  r=ok(await f.command('gm','/api/workspace','managerlog.accept',{note:'Explicit GM takes responsibility'},r));
  const original=r;r=ok(await f.command('gm','/api/workspace','managerlog.note',{note:'Recorded next step'},r));
  await f.rejected(()=>f.command('gm','/api/workspace','managerlog.note',{note:'Stale save'},original),409);
  r=ok(await f.command('gm','/api/workspace','managerlog.resolve',{note:'Fictional result confirmed'},r));
  assert.equal((await f.db.prepare('SELECT data FROM records WHERE id=?').bind(r.recordId).first()).data.includes('Fictional result confirmed'),true);
 }
 assert.equal((await f.request('gm','/api/access?locationId=a')).status,403);
 assert.equal((await f.request('gm','/api/workspace?locationId=b')).status,403);
 await f.rejected(()=>f.command('gm','/api/workspace','meeting.create',{managerId:'boh',cadenceDays:14,due:due(),agenda:'Unauthorized'}),403);
 const issue=ok(await f.command('gm','/api/workspace','managerlog.create',{department:'BOH',ownerId:w.me.id,title:'Fictional current issue',detail:'Fictional',category:'Other',priority:'routine',due:due()}));
 await f.db.prepare("UPDATE memberships SET capabilities='[\"tasks.manage\"]',revision=revision+1 WHERE id=?").bind(w.me.id).run();
 await f.rejected(()=>f.command('gm','/api/workspace','managerlog.note',{note:'Revoked access'},issue),404);
});

test('GM can complete a saved prep planning roundtrip while imports, catalog definitions, invoices, purchasing and other stores remain separately gated',async t=>{
 const f=await fixture(t),raw={restaurantId:'fictional-source',name:'Fictional flour',controlNumber:'FLOUR',purchaseUnit:'bag',packCount:1,unitQty:25,unitUOM:'lb',portionSize:1,portionUOM:'lb',par:4,active:true,countActive:true,needsReview:false,vendorSkus:[]};
 const item=ok(await f.command('admin','/api/food','fooditem.import',{dataset:'demo',sourceRestaurantId:'fictional-source',sourceLabel:'Fictional GM test',destinationLocationId:'a',confirmed:true,rows:[raw]}));
 assert.equal((await f.request('gm','/api/food?locationId=a&dataset=demo')).status,200);
 const prep=ok(await f.request('gm','/api/food/workflows?locationId=a&dataset=demo'));assert.deepEqual(prep.permissions,{managePrep:true,purchase:false,reviewPurchase:false});
 const countItem=ok(await f.command('gm','/api/food','fooditem.count',{quantity:1,confirmed:true,note:'Fictional physical count'},item));
 const def=ok(await f.command('gm','/api/food/workflows','definition.save',{dataset:'demo',foodRecordId:countItem.recordId,foodRevision:countItem.revision,track:'daily',countUnit:'bag',par:4,confirmed:true,reviewNote:'Fictional count unit review'}));
 let count=ok(await f.command('gm','/api/food/workflows','count.create',{dataset:'demo',track:'daily',businessDate:today()}));
 count=ok(await f.command('gm','/api/food/workflows','count.save',{dataset:'demo',lines:[{definitionId:def.recordId,quantity:1,note:'Fictional current count'}]},count));
 count=ok(await f.command('gm','/api/food/workflows','count.submit',{dataset:'demo',confirmed:true},count));
 let plan=ok(await f.command('gm','/api/food/workflows','plan.generate',{dataset:'demo',countId:count.recordId,countRevision:count.revision,targetDate:nextDate(today(),1)}));
 plan=ok(await f.command('gm','/api/food/workflows','plan.release',{dataset:'demo',confirmed:true},plan));
 plan=ok(await f.command('gm','/api/food/workflows','plan.assign',{dataset:'demo',definitionId:def.recordId,assignedTo:'worker'},plan));
 const detail=ok(await f.request('gm','/api/food/workflows?locationId=a&dataset=demo&recordId='+plan.recordId));assert.equal(detail.record.status,'released');assert.equal(detail.record.lines[0].plannedQty,3);assert.equal(detail.record.lines[0].assignedTo,'worker');assert.equal(detail.history.at(-1).by,ok(await f.view()).me.id);
 await f.rejected(()=>f.command('gm','/api/food','fooditem.import',{dataset:'demo',sourceRestaurantId:'fictional-source',sourceLabel:'Unauthorized import',destinationLocationId:'a',confirmed:true,rows:[{...raw,controlNumber:'OTHER'}]}),403);
 for(const action of ['fooditem.configure','fooditem.invoice','fooditem.claim','fooditem.credit'])await f.rejected(()=>f.command('gm','/api/food',action,{dataset:'demo'},countItem),403);
 await f.rejected(()=>f.command('gm','/api/workspace','order.save',{lines:[],note:'Unauthorized buying'}),403);
 assert.equal((await f.request('gm','/api/food?locationId=b&dataset=demo')).status,403);
 await f.db.prepare("UPDATE memberships SET capabilities='[\"operations.store\"]',revision=revision+1 WHERE id=?").bind(f.active.recordId).run();
 assert.equal((await f.request('gm','/api/food/workflows?locationId=a&dataset=demo')).status,403);
 await f.rejected(()=>f.command('gm','/api/food/workflows','plan.complete',{dataset:'demo',definitionId:def.recordId,quantity:3,confirmed:true},plan),403);
});

test('access review rejects operations.store without its required task permission',async t=>{
 const f=await fixture(t);
 const response=await f.command('admin','/api/access','hire.save',{profile:{...f.profile,email:'inert@example.test',capabilities:['operations.store']},hireDate:today(),note:'Fictional incomplete authority'});
 assert.equal(response.status,400);assert.match(response.data.error,/requires task management/);
 assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM memberships WHERE email='inert@example.test'").first()).n,0);
});
