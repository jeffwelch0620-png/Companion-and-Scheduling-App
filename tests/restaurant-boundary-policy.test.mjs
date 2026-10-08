import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {handleAccess} from '../.sites-runtime/shared/access-service.mjs';
import {handleEmployeeLogin} from '../.sites-runtime/shared/employee-login.mjs';
import {handleCompanionChat} from '../.sites-runtime/shared/companion-chat.mjs';
import {handleFood} from '../.sites-runtime/shared/food-service.mjs';
import {handleFoodWorkflows} from '../.sites-runtime/shared/food-workflow-service.mjs';
import {requireRestaurantAccess,restaurantAccessWriteGuard} from '../.sites-runtime/shared/restaurant-access.mjs';

process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
const loginConfig={JMAX_LOGIN_SECRET:'d'.repeat(64)};
async function fixture(t){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});
 t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const loc of ['berts','rudds','papa','comm','unapproved'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(loc,'Fictional '+loc,'America/New_York').run();
 async function member(person,loc,{email=person+'@example.test',position='Owner',caps=['location.manage','tasks.manage','orders.review'],auth=person+'-principal'}={}){
  await db.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,active) VALUES(?,?,?,?,?,?,?,?,?,1)').bind(person+'-'+loc,email,auth,loc,'Fictional '+person,'BOH',position,JSON.stringify(caps),'[]').run();
 }
 async function grant(person,kind,home='berts'){await db.prepare('INSERT INTO restaurant_access(auth_user_id,kind,home_location_id) VALUES(?,?,?)').bind(person+'-principal',kind,home).run();}
 const headers=person=>({'oai-authenticated-user-id':person+'-principal','oai-authenticated-user-email':person+'@example.test',Origin:'https://example.test','Content-Type':'application/json'});
 const request=(person,endpoint='workspace',loc,body)=>new Request('https://example.test/api/'+endpoint+(loc?'?locationId='+loc:''),{method:body?'POST':'GET',headers:headers(person),...(body?{body:JSON.stringify(body)}:{})});
 const call=async(handler,person,loc,body,endpoint='workspace',...bindings)=>{const response=await handler(request(person,endpoint,loc,body),db,...bindings);return {status:response.status,data:await response.json()};};
 return {db,member,grant,headers,request,call};
}

test('ordinary staff remain in one restaurant and guessed restaurant reads or writes fail before data changes',async t=>{
 const f=await fixture(t);await f.member('staff','berts',{position:'Server',caps:[]});
 const list=await f.call(handleWorkspace,'staff');assert.equal(list.status,200);assert.deepEqual(list.data.memberships.map(m=>m.locationId),['berts']);
 assert.equal((await f.call(handleWorkspace,'staff','berts')).status,200);
 const before=await f.db.prepare('SELECT COUNT(*) n FROM command_receipts').first();
 for(const loc of ['rudds','papa','comm']){
  assert.equal((await f.call(handleWorkspace,'staff',loc)).status,403);
  assert.equal((await f.call(handleAccess,'staff',loc,undefined,'access')).status,403);
  for(const action of ['task.create','message.read'])assert.equal((await f.call(handleWorkspace,'staff','berts',{locationId:loc,requestId:crypto.randomUUID(),action,recordId:'foreign-record',expectedRevision:1,input:{}})).status,403,loc+' '+action);
 }
 assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM command_receipts').first()).n,before.n);
});

test('Owner titles, administrator capabilities and extra memberships never grant a third person group access',async t=>{
 const f=await fixture(t);for(const loc of ['berts','rudds','papa'])await f.member('pretender',loc,{position:'Co-owner'});
 for(const loc of [undefined,'berts','rudds','papa'])assert.equal((await f.call(handleWorkspace,'pretender',loc)).status,403,String(loc));
 await f.grant('pretender','restaurant','berts');
 const list=await f.call(handleWorkspace,'pretender');assert.equal(list.status,200);assert.deepEqual(list.data.memberships.map(m=>m.locationId),['berts']);
 assert.equal((await f.call(handleWorkspace,'pretender','berts')).status,200);
 for(const loc of ['rudds','papa'])assert.equal((await f.call(handleWorkspace,'pretender',loc)).status,403);
});

test('unclaimed second membership with the same personal email is also denied rather than silently becoming a second identity',async t=>{
 const f=await fixture(t);await f.member('duplicate','berts');await f.member('unclaimed','rudds',{email:'duplicate@example.test',auth:null});
 assert.equal((await f.call(handleWorkspace,'duplicate')).status,403);
 assert.equal((await f.call(handleWorkspace,'duplicate','berts')).status,403);
});

test('the explicit Jay and Rudd seats allow only assigned canonical restaurants and cannot be reused by another principal',async t=>{
 const f=await fixture(t);
 for(const person of ['jay','rudd']){
  for(const loc of ['berts','rudds','papa','comm','unapproved'])await f.member(person,loc);
  await f.grant(person,person);
  const list=await f.call(handleWorkspace,person);assert.equal(list.status,200);assert.deepEqual(list.data.memberships.map(m=>m.locationId).sort(),['berts','comm','papa','rudds']);
  for(const loc of ['berts','rudds','papa','comm'])assert.equal((await f.call(handleWorkspace,person,loc)).status,200,person+' '+loc);
  assert.equal((await f.call(handleWorkspace,person,'unapproved')).status,403);
 }
 await f.member('stranger','berts');await f.member('stranger','papa');assert.equal((await f.call(handleWorkspace,'stranger','papa')).status,403);
 await assert.rejects(f.grant('stranger','jay'),/UNIQUE/,'only one principal can occupy the Jay seat');
});

test('commissary sees its own general workspace and Bert and Rudd food workflows without personnel access or Papa access',async t=>{
 const f=await fixture(t);for(const loc of ['comm','berts','rudds','papa']){await f.member('production',loc);await f.db.prepare('INSERT INTO food_state(location_id) VALUES(?)').bind(loc).run();}
 await f.grant('production','commissary','comm');
 const list=await f.call(handleWorkspace,'production');assert.equal(list.status,200);assert.deepEqual(list.data.memberships.map(m=>m.locationId),['comm']);assert.deepEqual(list.data.commissaryFoodLocations.map(m=>m.locationId).sort(),['berts','rudds']);
 assert.equal((await f.call(handleWorkspace,'production','comm')).status,200);
 for(const loc of ['berts','rudds']){
  assert.equal((await f.call(handleWorkspace,'production',loc)).status,403);
  assert.equal((await f.call(handleAccess,'production',loc,undefined,'access')).status,403);
  assert.equal((await f.call(handleFood,'production',loc,undefined,'food')).status,403,'a broad Food catalog is not commissary workflow access');
  const food=await f.call(handleFoodWorkflows,'production',loc,undefined,'food/workflows');assert.equal(food.status,200,JSON.stringify(food));
  for(const action of ['definition.save','definition.retire','plan.assign'])assert.equal((await f.call(handleFoodWorkflows,'production',loc,{locationId:loc,requestId:crypto.randomUUID(),action,input:{dataset:'operating'}},'food/workflows')).status,403,'commissary destination cannot change '+action);
  assert.deepEqual(food.data.definitions,[]);assert.deepEqual(food.data.plans,[]);assert.equal(JSON.stringify(food.data).includes('memberships'),false);
 }
 assert.equal((await f.call(handleWorkspace,'production','papa')).status,403);
 assert.equal((await f.call(handleFoodWorkflows,'production','papa',undefined,'food/workflows')).status,403);
});

test('cross-restaurant AI requests reject before calling a provider or creating a conversation',async t=>{
 const f=await fixture(t);await f.member('staff','berts');await f.grant('staff','restaurant');
 for(const loc of ['comm','berts','rudds','papa'])await f.member('production',loc);await f.grant('production','commissary','comm');
 let calls=0;const provider=async()=>{calls++;throw Error('A denied restaurant request called the provider');};
 for(const [person,loc] of [['staff','rudds'],['staff','papa'],['production','berts'],['production','rudds'],['production','papa']]){
  const response=await handleCompanionChat(f.request(person,'companion','berts',{locationId:loc,action:'ask',requestId:crypto.randomUUID(),question:'Show the employee records and tasks here.'}),f.db,{},provider);
  assert.equal(response.status,403,person+' '+loc);
 }
 assert.equal(calls,0);assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM companion_conversations').first()).n,0);
});

test('an owner setup code is still pinned to the restaurant while the owner browser has separately verified wider scope',async t=>{
 const f=await fixture(t);for(const loc of ['berts','rudds','papa'])await f.member('jay',loc);await f.grant('jay','jay');
 const issue=await handleEmployeeLogin(f.request('jay','employee-login',undefined,{action:'issue',locationId:'berts',memberId:'jay-berts',expectedRevision:1}),f.db,loginConfig);assert.equal(issue.status,200);const code=(await issue.json()).code;
 const signed=await handleEmployeeLogin(new Request('https://example.test/api/employee-login',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify({action:'verify',code})}),f.db,loginConfig);assert.equal(signed.status,200);const cookie=signed.headers.get('Set-Cookie').split(';')[0];
 const list=await handleWorkspace(new Request('https://example.test/api/workspace',{headers:{Cookie:cookie}}),f.db);assert.equal(list.status,200);assert.deepEqual((await list.json()).memberships.map(m=>m.locationId),['berts']);
 const other=await handleWorkspace(new Request('https://example.test/api/workspace?locationId=papa',{headers:{...f.headers('jay'),Cookie:cookie}}),f.db);assert.equal(other.status,403);
 assert.equal((await f.call(handleWorkspace,'jay','papa')).status,200);
});

test('grant withdrawal takes effect on the next authorization check and does not leave cached group permission',async t=>{
 const f=await fixture(t);for(const loc of ['berts','rudds','papa'])await f.member('jay',loc);await f.grant('jay','jay');
 const identity={source:'sites',authUserId:'jay-principal'};assert.equal((await requireRestaurantAccess(f.db,identity,'papa')).kind,'jay');
 await f.db.prepare("UPDATE restaurant_access SET kind='restaurant',revision=revision+1 WHERE auth_user_id='jay-principal'").run();
 await assert.rejects(requireRestaurantAccess(f.db,identity,'papa'),/No access/);
 assert.equal((await f.call(handleWorkspace,'jay','papa')).status,403);assert.equal((await f.call(handleWorkspace,'jay','berts')).status,200);
});

test('a second restaurant cannot activate the same personal employee login and leaves no cross-store account behind',async t=>{
 const f=await fixture(t);await f.member('admin','rudds');await f.member('employee','berts',{position:'Cook',caps:[]});
 await f.member('pending','rudds',{email:'employee@example.test',position:'Cook',caps:[],auth:null});await f.db.prepare("UPDATE memberships SET active=0 WHERE id='pending-rudds'").run();
 const input={profile:{name:'Fictional duplicate',email:'employee@example.test',area:'BOH',position:'Cook',capabilities:[],qualifications:[]},identityConfirmed:true,note:'Reviewed fictional employee setup'};
 const response=await f.call(handleAccess,'admin','rudds',{locationId:'rudds',requestId:crypto.randomUUID(),action:'account.save',recordId:'pending-rudds',expectedRevision:1,input},'access');assert.equal(response.status,403,JSON.stringify(response));
 assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM memberships WHERE location_id='rudds' AND email='employee@example.test' AND active=1").first()).n,0);
});

test('a phone setup code cannot claim a second same-email restaurant even under a fresh principal',async t=>{
 const f=await fixture(t);await f.member('admin','berts');await f.member('employee','berts',{position:'Cook',caps:[],auth:null});
 const issued=await handleEmployeeLogin(f.request('admin','employee-login',undefined,{action:'issue',locationId:'berts',memberId:'employee-berts',expectedRevision:1}),f.db,loginConfig);assert.equal(issued.status,200);const code=(await issued.json()).code;
 await f.member('duplicate','rudds',{email:'employee@example.test',position:'Cook',caps:[],auth:null});
 const response=await handleEmployeeLogin(new Request('https://example.test/api/employee-login',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify({action:'verify',code})}),f.db,loginConfig);assert.equal(response.status,403,JSON.stringify(await response.clone().json()));
 assert.equal(response.headers.get('Set-Cookie'),null);assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM employee_sessions').first()).n,0);assert.equal((await f.db.prepare("SELECT auth_user_id FROM memberships WHERE id='employee-berts'").first()).auth_user_id,null);
});

test('commissary cannot redirect Food changes to Papa or employee operations to either destination',async t=>{
 const f=await fixture(t);for(const loc of ['comm','berts','rudds','papa'])await f.member('production',loc);await f.grant('production','commissary','comm');
 const before=await f.db.prepare('SELECT COUNT(*) n FROM food_receipts').first();
 const badFood={locationId:'papa',requestId:crypto.randomUUID(),action:'count.create',input:{dataset:'operating',track:'bulk',businessDate:'2026-10-07'}};
 assert.equal((await f.call(handleFoodWorkflows,'production','berts',badFood,'food/workflows')).status,403);
 for(const loc of ['berts','rudds'])assert.equal((await f.call(handleWorkspace,'production','comm',{locationId:loc,requestId:crypto.randomUUID(),action:'task.create',input:{}})).status,403);
 assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM food_receipts').first()).n,before.n);
});

test('a captured SQL policy guard rejects an owner grant withdrawn before the write executes',async t=>{
 const f=await fixture(t);for(const loc of ['berts','rudds'])await f.member('jay',loc);await f.grant('jay','jay');
 const identity={source:'sites',authUserId:'jay-principal'},guard=await restaurantAccessWriteGuard(f.db,identity,'rudds');
 const before=await f.db.prepare("SELECT revision FROM locations WHERE id='rudds'").first();
 await f.db.prepare("UPDATE restaurant_access SET kind='restaurant',revision=revision+1 WHERE auth_user_id='jay-principal'").run();
 const [write]=await f.db.batch([f.db.prepare('UPDATE locations SET revision=revision+1 WHERE id=? AND '+guard.sql).bind('rudds',...guard.values)]);
 assert.equal(write.meta.changes,0);assert.equal((await f.db.prepare("SELECT revision FROM locations WHERE id='rudds'").first()).revision,before.revision);
});

test('an API command cannot finish after cross-restaurant access is withdrawn between authorization and its transaction',async t=>{
 const f=await fixture(t);for(const loc of ['berts','rudds'])await f.member('jay',loc);await f.grant('jay','jay');await f.member('cook','rudds',{position:'Cook',caps:[]});
 const before={location:await f.db.prepare("SELECT revision,last_command FROM locations WHERE id='rudds'").first(),records:await f.db.prepare('SELECT COUNT(*) n FROM records').first(),receipts:await f.db.prepare('SELECT COUNT(*) n FROM command_receipts').first(),audit:await f.db.prepare('SELECT COUNT(*) n FROM audit_events').first()};
 let revoked=false;
 const wrap=(stmt,sql)=>({sql,statement:stmt,bind(...params){return wrap(stmt.bind(...params),sql);},first(...args){return stmt.first(...args);},all(...args){return stmt.all(...args);},run(...args){return stmt.run(...args);},raw(...args){return stmt.raw(...args);}});
 const binding={prepare(sql){return wrap(f.db.prepare(sql),sql);},async batch(statements){if(!revoked&&statements.some(s=>/^UPDATE locations SET revision/i.test(s.sql))){revoked=true;await f.db.prepare("UPDATE restaurant_access SET kind='restaurant',revision=revision+1 WHERE auth_user_id='jay-principal'").run();}return f.db.batch(statements.map(s=>s.statement));}};binding.withSession=()=>binding;
 const response=await handleWorkspace(f.request('jay','workspace','rudds',{locationId:'rudds',requestId:crypto.randomUUID(),action:'task.create',input:{ownerId:'cook-rudds',kind:'task',title:'Fictional cleanup',detail:'Clean the fictional prep counter.',due:'2026-10-09T21:00:00.000Z'}}),binding);
 assert.equal(revoked,true,'the test revokes the grant at the actual write transaction');assert.equal(response.status,403,JSON.stringify(await response.clone().json()));
 assert.deepEqual(await f.db.prepare("SELECT revision,last_command FROM locations WHERE id='rudds'").first(),before.location);
 for(const [table,key] of [['records','records'],['command_receipts','receipts'],['audit_events','audit']])assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM '+table).first()).n,before[key].n,table+' is unchanged');
});

async function commissaryPhone(f){
 for(const loc of ['comm','berts','rudds','papa']){await f.member('production',loc);await f.db.prepare('INSERT INTO food_state(location_id) VALUES(?)').bind(loc).run();}
 await f.grant('production','commissary','comm');
 const issue=await handleEmployeeLogin(f.request('production','employee-login',undefined,{action:'issue',locationId:'comm',memberId:'production-comm',expectedRevision:1}),f.db,loginConfig);assert.equal(issue.status,200);const code=(await issue.json()).code;
 const signIn=await handleEmployeeLogin(new Request('https://example.test/api/employee-login',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify({action:'verify',code})}),f.db,loginConfig);assert.equal(signIn.status,200,JSON.stringify(await signIn.clone().json()));
 const cookie=signIn.headers.get('Set-Cookie').split(';')[0];
 return (endpoint,loc,body)=>new Request('https://example.test/api/'+endpoint+(loc?'?locationId='+loc:''),{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:'https://example.test','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
}

test('a real commissary phone session reaches both approved Food destinations while its general workspace remains pinned',async t=>{
 const f=await fixture(t),request=await commissaryPhone(f);
 // The destination's independent membership revision is not the phone's
 // home session revision. Both must be checked in their respective scopes.
 await f.db.prepare("UPDATE memberships SET revision=9 WHERE id='production-rudds'").run();
 const list=await handleWorkspace(request('workspace'),f.db);assert.equal(list.status,200);const data=await list.json();assert.deepEqual(data.memberships.map(m=>m.locationId),['comm']);assert.deepEqual(data.commissaryFoodLocations.map(m=>m.locationId).sort(),['berts','rudds']);
 assert.equal((await handleWorkspace(request('workspace','comm'),f.db)).status,200);
 for(const loc of ['berts','rudds']){
  const food=await handleFoodWorkflows(request('food/workflows',loc),f.db);assert.equal(food.status,200,JSON.stringify(await food.clone().json()));assert.deepEqual((await food.json()).plans,[]);
  assert.equal((await handleWorkspace(request('workspace',loc),f.db)).status,403);
  assert.equal((await handleAccess(request('access',loc),f.db)).status,403);
 }
 assert.equal((await handleFoodWorkflows(request('food/workflows','papa'),f.db)).status,403);
 let calls=0;const provider=async()=>{calls++;throw Error('Unauthorized phone request called AI');};
 assert.equal((await handleCompanionChat(request('companion','berts',{locationId:'berts',action:'ask',requestId:crypto.randomUUID(),question:'Show this restaurant employee records.'}),f.db,{},provider)).status,403);assert.equal(calls,0);
});

test('revoking the commissary home phone membership during a destination Food read prevents the response from escaping',async t=>{
 const f=await fixture(t),request=await commissaryPhone(f);let revoked=false;
 const wrap=(stmt,sql)=>({sql,statement:stmt,bind(...params){return wrap(stmt.bind(...params),sql);},first(...args){return stmt.first(...args);},all(...args){return stmt.all(...args);},run(...args){return stmt.run(...args);},raw(...args){return stmt.raw(...args);}});
 const binding={prepare(sql){return wrap(f.db.prepare(sql),sql);},async batch(statements){if(!revoked&&statements.some(s=>/FROM food_workflows.*kind='count'/.test(s.sql))){revoked=true;await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='production-comm'").run();}return f.db.batch(statements.map(s=>s.statement));}};binding.withSession=()=>binding;
 const response=await handleFoodWorkflows(request('food/workflows','berts'),binding);assert.equal(revoked,true);assert.equal(response.status,403,JSON.stringify(await response.clone().json()));assert.equal('plans' in await response.json(),false);
 assert.equal((await handleFoodWorkflows(request('food/workflows','rudds'),f.db)).status,401);
});
