import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {handleEmployeeLogin} from '../.sites-runtime/shared/employee-login.mjs';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {handleAccess} from '../.sites-runtime/shared/access-service.mjs';
import {handleToast} from '../.sites-runtime/shared/toast-service.mjs';
import {handleReminders} from '../.sites-runtime/shared/reminder-service.mjs';
import {handleScheduleImport} from '../.sites-runtime/shared/schedule-import-service.mjs';
import {handleScheduleTransfer} from '../.sites-runtime/shared/schedule-transfer.mjs';
import {handleSourceLibrary} from '../.sites-runtime/shared/source-library.mjs';
import {handleCompanionChat} from '../.sites-runtime/shared/companion-chat.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
const config={JMAX_LOGIN_SECRET:'a'.repeat(64)};
async function fixture(t){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const id of ['a','b'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES (?,?,?)').bind(id,'Fictional '+id,'America/New_York').run();
 for(const [id,loc,active,caps,auth] of [['admin','a',1,['location.manage'],'admin-identity'],['worker','a',1,[],null],['disabled','a',0,[],null],['other','b',1,['location.manage'],'other-identity']])await db.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,active) VALUES (?,?,?,?,?,?,?,?,?)').bind(id,id+'@example.test',auth,loc,'Test '+id,'BOH','Cook',JSON.stringify(caps),active).run();
 async function call(input,actor=null,extra={},binding=db,bindings=config){const headers={Origin:'https://example.test','Content-Type':'application/json',...(actor?{'oai-authenticated-user-id':actor+'-identity','oai-authenticated-user-email':actor+'@example.test'}:{}),...extra};const r=await handleEmployeeLogin(new Request('https://example.test/api/employee-login',{method:'POST',headers,body:JSON.stringify(input)}),binding,bindings);return {status:r.status,body:await r.json(),cookie:r.headers.get('Set-Cookie')};}
 const issue=(memberId='worker',actor='admin',revision=1)=>call({action:'issue',locationId:'a',memberId,expectedRevision:revision},actor);
 const workspace=async(cookie,actor)=>{const r=await handleWorkspace(new Request('https://example.test/api/workspace?locationId=a',{headers:{...(cookie?{Cookie:cookie}:{}),...(actor?{'oai-authenticated-user-id':actor+'-identity','oai-authenticated-user-email':actor+'@example.test'}:{})}}),db);return {status:r.status,data:await r.json()}};
 return {db,call,issue,workspace};
}
test('manager-issued code signs into exact employee without ChatGPT; stored secrets are hashes; replay is blocked',async t=>{
 const f=await fixture(t),issued=await f.issue();assert.equal(issued.status,200,JSON.stringify(issued));assert.match(issued.body.code,/^\d{4} \d{4} \d{4}$/);
 const saved=await f.db.prepare('SELECT * FROM employee_setup_codes').first();assert.equal(saved.code_hash.length,64);assert.ok(!JSON.stringify(saved).includes(issued.body.code.replaceAll(' ','')));
 const signed=await f.call({action:'verify',code:issued.body.code});assert.equal(signed.status,200,JSON.stringify(signed));assert.match(signed.cookie,/^__Host-jmax-session=[a-f0-9]{64}; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=2592000$/);
 const cookie=signed.cookie.split(';')[0],w=await f.workspace(cookie);assert.equal(w.status,200);assert.equal(w.data.me.id,'worker');assert.deepEqual(w.data.me.capabilities,[]);
 assert.equal((await f.workspace(cookie,'admin')).data.me.id,'worker');assert.equal((await f.workspace(undefined,'admin')).data.me.id,'admin');
 assert.equal((await f.call({action:'verify',code:issued.body.code})).status,401);assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM employee_sessions').first()).n,1);
 const logged=await f.call({action:'logout'},null,{Cookie:cookie});assert.equal(logged.status,200);assert.match(logged.cookie,/Max-Age=0/);assert.equal((await f.workspace(cookie,'admin')).status,401);
});
test('access, restaurant, revision, body and origin checks reject unauthorized setup',async t=>{
 const f=await fixture(t);assert.equal((await f.issue('worker',null)).status,401);assert.equal((await f.issue('worker','other')).status,403);assert.equal((await f.issue('disabled')).status,400);assert.equal((await f.issue('worker','admin',99)).status,409);
 assert.equal((await f.call({action:'issue',locationId:'a',memberId:'other',expectedRevision:1},'admin')).status,404);
 assert.equal((await f.call({action:'verify',code:'123456789012',memberId:'admin'})).status,400);
 assert.equal((await f.call({action:'verify',code:'123456789012'},null,{Origin:'https://evil.example'})).status,403);
 assert.equal((await f.call({action:'verify',code:'123456789012'},null,{},f.db,{})).status,503);
 const i=await f.issue();const s=await f.call({action:'verify',code:i.body.code});assert.equal((await f.call({action:'issue',locationId:'a',memberId:'admin',expectedRevision:1},null,{Cookie:s.cookie.split(';')[0]})).status,403);
});
test('new codes supersede old; expired codes, suspended or revised memberships and revoked devices fail closed',async t=>{
 const f=await fixture(t),old=await f.issue(),latest=await f.issue();assert.equal((await f.call({action:'verify',code:old.body.code})).status,401);
 await f.db.prepare('UPDATE employee_setup_codes SET expires_at=0').run();assert.equal((await f.call({action:'verify',code:latest.body.code})).status,401);
 const i=await f.issue(),s=await f.call({action:'verify',code:i.body.code}),cookie=s.cookie.split(';')[0];
 await f.db.prepare('UPDATE memberships SET active=0,revision=revision+1 WHERE id=?').bind('worker').run();assert.equal((await f.workspace(cookie,'admin')).status,401);
 await f.db.prepare('UPDATE memberships SET active=1 WHERE id=?').bind('worker').run();assert.equal((await f.workspace(cookie)).status,401);
 const revision=(await f.db.prepare('SELECT revision FROM memberships WHERE id=?').bind('worker').first()).revision;
 const next=await f.issue('worker','admin',revision),signed=await f.call({action:'verify',code:next.body.code});assert.equal(signed.status,200);
 assert.equal((await f.call({action:'revoke',locationId:'a',memberId:'worker',expectedRevision:revision},'admin')).status,200);assert.equal((await f.workspace(signed.cookie.split(';')[0])).status,401);
 assert.equal((await f.workspace('__Host-jmax-session=bad','admin')).status,401);
});
test('failed attempts are bounded and code issuance cannot survive concurrent lost authority',async t=>{
 const f=await fixture(t);await f.db.prepare('INSERT INTO employee_login_limits(key,window_start,count,expires_at) VALUES(?,?,?,?)').bind('verify-global',Math.floor(Date.now()/3600000)*3600000,1000,Date.now()+3600000).run();assert.equal((await f.call({action:'verify',code:'123456789012'})).status,429);
 let batches=0;const binding={withSession:()=>({prepare:(...args)=>f.db.prepare(...args),batch:async statements=>{batches++;if(batches===2)await f.db.prepare('UPDATE memberships SET active=0,revision=revision+1 WHERE id=?').bind('admin').run();return f.db.batch(statements);}})};
 assert.equal((await f.call({action:'issue',locationId:'a',memberId:'worker',expectedRevision:1},'admin',{},binding)).status,409);assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM employee_setup_codes').first()).n,0);
});

test('code-first access and a matching connected browser share one canonical account without rebinding sessions',async t=>{
 const f=await fixture(t),first=await f.issue(),signed=await f.call({action:'verify',code:first.body.code}),cookie=signed.cookie.split(';')[0];
 const before=await f.db.prepare("SELECT * FROM memberships WHERE id='worker'").first();
 assert.equal((await f.workspace(undefined,'worker')).status,403); // Merely matching email cannot claim a code-bound account.
 const next=await f.issue('worker','admin',before.revision),connected=await f.call({action:'verify',code:next.body.code},'worker');assert.equal(connected.status,200);
 const w=await f.workspace(undefined,'worker');assert.equal(w.status,200);assert.equal(w.data.me.id,'worker');assert.deepEqual(w.data.me.capabilities,[]);
 assert.equal((await f.workspace(cookie)).status,200);assert.equal((await f.workspace(connected.cookie.split(';')[0])).status,200);
 const after=await f.db.prepare("SELECT * FROM memberships WHERE id='worker'").first();assert.equal(after.auth_user_id,before.auth_user_id);assert.equal(after.revision,before.revision);
 assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM memberships WHERE email='worker@example.test'").first()).n,1);
 assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM browser_identity_links').first()).n,1);
 // The bound provider subject is stable even if its contact email changes.
 const changed=await handleWorkspace(new Request('https://example.test/api/workspace?locationId=a',{headers:{'oai-authenticated-user-id':'worker-identity','oai-authenticated-user-email':'changed@example.test'}}),f.db);assert.equal(changed.status,200);
 // Another provider subject cannot use matching email to take over the binding.
 const stranger=await handleWorkspace(new Request('https://example.test/api/workspace?locationId=a',{headers:{'oai-authenticated-user-id':'stranger-identity','oai-authenticated-user-email':'worker@example.test'}}),f.db);assert.equal(stranger.status,403);
 assert.equal((await f.workspace('__Host-jmax-session=bad','worker')).status,401);
 await f.call({action:'revoke',locationId:'a',memberId:'worker',expectedRevision:before.revision},'admin');
 assert.equal((await f.workspace(undefined,'worker')).status,403);assert.equal((await f.workspace(cookie,'worker')).status,401);
});

test('another person’s ambient browser account is never attached by a setup-code login',async t=>{
 const f=await fixture(t),issued=await f.issue(),signed=await f.call({action:'verify',code:issued.body.code},'admin');assert.equal(signed.status,200);
 assert.equal((await f.workspace(signed.cookie.split(';')[0],'admin')).data.me.id,'worker');
 assert.equal((await f.workspace(undefined,'admin')).data.me.id,'admin');
 assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM browser_identity_links').first()).n,0);
 const rev=(await f.db.prepare("SELECT revision FROM memberships WHERE id='worker'").first()).revision;
 const second=await f.issue('worker','admin',rev);
 const attempt=await f.call({action:'verify',code:second.body.code},null,{'oai-authenticated-user-id':'admin-identity','oai-authenticated-user-email':'worker@example.test'});assert.equal(attempt.status,200);
 assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM browser_identity_links').first()).n,0);
 assert.equal((await f.workspace(undefined,'admin')).data.me.id,'admin');
});

test('setup-code sessions stay on the exact membership across workspace, AI, imports and all administrator routes',async t=>{
 const f=await fixture(t);
 await f.db.prepare("UPDATE memberships SET auth_user_id='worker-identity' WHERE id='worker'").run();
 // One provider identity is an employee here and an owner at another
 // restaurant. A code for the employee must not inherit the owner membership.
 await f.db.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,active) VALUES (?,?,?,?,?,?,?,?,1)').bind('worker-owner-b','worker@example.test','worker-identity','b','Fictional other membership','BOH','Owner','["location.manage"]').run();
 await f.db.prepare("INSERT INTO restaurant_access(auth_user_id,kind,home_location_id) VALUES('worker-identity','restaurant','a')").run();
 const issued=await f.issue(),signed=await f.call({action:'verify',code:issued.body.code});assert.equal(signed.status,200);
 const cookie=signed.cookie.split(';')[0];
 const read=async(handler,path)=>{const response=await handler(new Request('https://example.test/api/'+path,{headers:{Cookie:cookie}}),f.db);return {status:response.status,body:await response.json()}};
 const list=await read(handleWorkspace,'workspace');assert.equal(list.status,200);assert.deepEqual(list.body.memberships.map(m=>[m.id,m.locationId]),[['worker','a']]);
 const own=await f.workspace(cookie,'admin');assert.equal(own.status,200);assert.equal(own.data.me.id,'worker');assert.deepEqual(own.data.me.capabilities,[]);
 assert.equal((await read(handleWorkspace,'workspace?locationId=b')).status,403);
 for(const [handler,path] of [[handleAccess,'access'],[handleToast,'toast'],[handleReminders,'reminders'],[handleScheduleImport,'schedule-import'],[handleScheduleTransfer,'schedule-transfer'],[handleSourceLibrary,'source-library']]){
  assert.equal((await read(handler,path+'?locationId=a')).status,403,path+' cannot borrow administrator capabilities from elsewhere');
  assert.equal((await read(handler,path+'?locationId=b')).status,403,path+' rejects another restaurant');
 }
 assert.equal((await read(handleCompanionChat,'companion?locationId=b')).status,403);
 assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM companion_conversations').first()).n,0,'denied chat creates no conversation');
 const before=await f.db.prepare("SELECT revision FROM locations WHERE id='b'").first();
 let providerCalls=0;const noProvider=async()=>{providerCalls++;throw Error('Unauthorized request reached a provider')};
 const post=async(handler,path,body)=>handler(new Request('https://example.test/api/'+path+'?locationId=a',{method:'POST',headers:{Cookie:cookie,Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify(body)}),f.db,{},noProvider);
 for(const [handler,path,body] of [
  [handleWorkspace,'workspace',{locationId:'b',requestId:crypto.randomUUID(),action:'task.create',input:{}}],
  [handleAccess,'access',{locationId:'b',requestId:crypto.randomUUID(),action:'administrator.add',input:{}}],
  [handleToast,'toast',{locationId:'b'}],
  [handleCompanionChat,'companion',{locationId:'b',action:'ask',requestId:crypto.randomUUID(),question:'Read the other restaurant'}],
  [handleScheduleImport,'schedule-import',{locationId:'b',action:'preview'}],
  [handleScheduleTransfer,'schedule-transfer',{locationId:'b',confirmed:true}],
 ])assert.equal((await post(handler,path,body)).status,403,path+' checks the body restaurant');
 assert.equal((await f.call({action:'issue',locationId:'b',memberId:'other',expectedRevision:1},null,{Cookie:cookie})).status,403);
 assert.equal((await f.db.prepare("SELECT revision FROM locations WHERE id='b'").first()).revision,before.revision);
 assert.equal(providerCalls,0);
});

test('existing owner code sessions remain usable at their restaurant while verified owner sign-in retains assigned restaurants',async t=>{
 const f=await fixture(t);
 for(const loc of ['berts','rudds'])await f.db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(loc,'Fictional '+loc,'America/New_York').run();
 await f.db.prepare("UPDATE memberships SET location_id='berts' WHERE id='admin'").run();
 await f.db.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,active) VALUES (?,?,?,?,?,?,?,?,1)').bind('owner-b','admin@example.test','admin-identity','rudds','Fictional owner','BOH','Owner','["location.manage"]').run();
 await f.db.prepare("INSERT INTO restaurant_access(auth_user_id,kind,home_location_id) VALUES('admin-identity','jay','berts')").run();
 const issued=await f.call({action:'issue',locationId:'berts',memberId:'admin',expectedRevision:1},'admin'),signed=await f.call({action:'verify',code:issued.body.code});assert.equal(signed.status,200);
 const get=async(path,headers)=>handleWorkspace(new Request('https://example.test/api/workspace'+path,{headers}),f.db);
 const cookie=signed.cookie.split(';')[0],local=await get('?locationId=berts',{Cookie:cookie});assert.equal(local.status,200);const me=(await local.json()).me;assert.equal(me.id,'admin');assert.ok(me.capabilities.includes('location.manage'));
 assert.equal((await get('?locationId=rudds',{Cookie:cookie})).status,403);
 const headers={'oai-authenticated-user-id':'admin-identity','oai-authenticated-user-email':'admin@example.test'};
 const list=await get('',headers);assert.equal(list.status,200);assert.deepEqual((await list.json()).memberships.map(m=>m.locationId).sort(),['berts','rudds']);
 assert.equal((await get('?locationId=rudds',headers)).status,200);
 // A stale code cookie must not silently become the ambient browser owner.
 assert.equal((await get('?locationId=rudds',{...headers,Cookie:'__Host-jmax-session='+'0'.repeat(64)})).status,401);
});

test('cookie selection matches the exact session name and rejects duplicate session cookies',async t=>{
 const f=await fixture(t);
 assert.equal((await f.workspace('unrelated=__Host-jmax-session=bad; prefix__Host-jmax-session=bad','admin')).status,200);
 const issued=await f.issue(),signed=await f.call({action:'verify',code:issued.body.code}),cookie=signed.cookie.split(';')[0];
 assert.equal((await f.workspace(cookie+'; '+cookie,'admin')).status,401);
});


test('onboarding status is owner-only, restaurant-scoped, secret-free, and follows the exact issued code',async t=>{
 const f=await fixture(t);
 const get=async(actor='admin',member='worker',location='a')=>{const r=await handleEmployeeLogin(new Request('https://example.test/api/employee-login?memberId='+member+'&locationId='+location,{headers:actor?{'oai-authenticated-user-id':actor+'-identity','oai-authenticated-user-email':actor+'@example.test'}:{}}),f.db,config);return {status:r.status,data:await r.json()}};
 assert.equal((await get(null)).status,401);assert.equal((await get('other')).status,403);assert.equal((await get('admin','other')).status,404);
 const before=await get();assert.equal(before.status,200);assert.equal(before.data.claimed,false);assert.equal(before.data.firstSignedInAt,null);
 const issued=await f.issue(),pending=await get();assert.equal(pending.data.codeIssuedAt,issued.body.issuedAt);assert.equal(pending.data.codeUsedAt,null);assert.ok(!JSON.stringify(pending.data).includes(issued.body.code));assert.ok(!JSON.stringify(pending.data).includes('code_hash'));
 const signed=await f.call({action:'verify',code:issued.body.code});assert.equal(signed.status,200);
 const after=await get();assert.equal(after.data.claimed,true);assert.ok(after.data.firstSignedInAt);assert.ok(after.data.codeUsedAt);
 const denied=await handleEmployeeLogin(new Request('https://example.test/api/employee-login?memberId=worker&locationId=a',{headers:{Cookie:signed.cookie.split(';')[0]}}),f.db,config);assert.equal(denied.status,403);
 const replacement=await f.issue('worker','admin',after.data.revision);assert.equal(replacement.status,200);const refreshed=await get();assert.equal(refreshed.data.codeIssuedAt,replacement.body.issuedAt);assert.equal(refreshed.data.codeUsedAt,null);assert.equal(refreshed.data.firstSignedInAt,after.data.firstSignedInAt);
});
