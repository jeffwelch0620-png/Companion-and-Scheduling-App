import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {handleAccess} from '../.sites-runtime/shared/access-service.mjs';
import {handleEmployeeLogin} from '../.sites-runtime/shared/employee-login.mjs';
import {randomToken,tokenHash} from '../.sites-runtime/shared/employee-session.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
const origin='https://example.test',config={JMAX_LOGIN_SECRET:'a'.repeat(64)};
const headers=actor=>({'oai-authenticated-user-id':actor+'-identity','oai-authenticated-user-email':actor+'@example.test'});
async function fixture(t){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const id of ['berts','rudds'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(id,'Fictional '+id,'America/New_York').run();
 for(const [id,email,auth,loc,caps] of [['owner','owner@example.test','owner-identity','berts',['location.manage','schedule.manage','schedule.publish']],['jay','jay@example.test','employee-legacy-jay','berts',['location.manage','schedule.manage']],['jay-b','jay@example.test','employee-legacy-jay','rudds',['location.manage']],['employee','employee@example.test','employee-identity','berts',[]]])await db.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,active) VALUES(?,?,?,?,?,?,?,?,1)').bind(id,email,auth,loc,'Fictional '+id,'Executive','Cook',JSON.stringify(caps)).run();
 await db.prepare('INSERT INTO restaurant_access(auth_user_id,kind,home_location_id) VALUES (?,?,?)').bind('employee-legacy-jay','jay','berts').run();
 const call=async(handler,url,body,h={})=>{const response=await handler(new Request(origin+url,{headers:{...h,...(body?{Origin:origin,'Content-Type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})}),db,config);return {status:response.status,data:await response.json(),cookie:response.headers.get('Set-Cookie')}};
 const access=(action,input={},account,actor='owner',requestId=crypto.randomUUID())=>call(handleAccess,'/api/access',{locationId:'berts',action,input,requestId,...(account?{recordId:account.id,expectedRevision:account.revision}:{})},headers(actor));
 const state=async()=>{const result=await call(handleAccess,'/api/access?locationId=berts',null,headers('owner'));assert.equal(result.status,200,JSON.stringify(result));return result.data};
 const account=async id=>(await state()).accounts.find(a=>a.id===id);
 const workspace=(actor,extra={},location='berts')=>call(handleWorkspace,'/api/workspace?locationId='+location,null,{...(actor?headers(actor):{}),...extra});
 const phone=async id=>{const m=await db.prepare('SELECT * FROM memberships WHERE id=?').bind(id).first(),token=randomToken();await db.prepare('INSERT INTO employee_sessions(token_hash,auth_user_id,member_id,member_revision,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(await tokenHash(token),m.auth_user_id,m.id,m.revision,Date.now(),Date.now()+86400000).run();return '__Host-jmax-session='+token};
 const login=(input,h={})=>call(handleEmployeeLogin,'/api/employee-login',input,h);
 const approve=(a,extra={})=>access('administrator.approve',{administratorRequestId:a.administratorRequest.requestId,identityConfirmed:true,note:'Confirmed directly with the person',...extra},a);
 return {db,call,access,state,account,workspace,phone,login,approve};
}

test('administrator invitation requires recipient sign-in and explicit approval; employee edit and forged identity cannot bypass it',async t=>{
 const f=await fixture(t),created=await f.access('administrator.add',{name:'New Owner',email:'newowner@example.test',coOwner:true,identityConfirmed:true,note:'Invite new owner'});assert.equal(created.status,200,JSON.stringify(created));
 let a=await f.account(created.data.recordId);assert.equal(a.active,false);assert.equal(a.claimed,false);assert.equal(a.administratorRequest.status,'invited');
 assert.equal((await f.approve(a)).status,409);
 assert.equal((await f.access('account.save',{profile:a,identityConfirmed:true,note:'Attempted bypass'},a)).status,409);
 assert.equal((await f.workspace('newowner')).status,403);
 a=await f.account(a.id);assert.equal(a.active,false);assert.equal(a.claimed,false);assert.equal(a.administratorRequest.status,'requested');assert.equal(a.administratorRequest.verifiedEmail,'newowner@example.test');
 assert.equal((await f.approve(a,{identityConfirmed:false})).status,400);
 const approved=await f.approve(a,{authUserId:'owner-identity',browserSubject:'owner-identity'});assert.equal(approved.status,200,JSON.stringify(approved));
 assert.equal((await f.workspace('newowner')).data.me.id,a.id);assert.equal((await f.workspace('newowner',{},'rudds')).status,403);
 const saved=await f.db.prepare('SELECT * FROM memberships WHERE id=?').bind(a.id).first();assert.equal(saved.auth_user_id,'newowner-identity');
 const employee=await f.account('employee');assert.equal((await f.access('account.save',{profile:{...employee,capabilities:['location.manage']},identityConfirmed:true,note:'Bypass invitation'},employee)).status,403);
});

test('code-only owner recovery preserves existing access until approval, changes only that restaurant and is retry safe',async t=>{
 const f=await fixture(t),oldPhone=await f.phone('jay'),otherPhone=await f.phone('jay-b');
 const requested=await f.workspace('jay');assert.equal(requested.status,403);assert.match(requested.data.error,/waiting for approval/);
 let a=await f.account('jay');assert.equal(a.administratorRequest.kind,'recovery');assert.equal(a.administratorRequest.status,'requested');
 assert.equal((await f.workspace(null,{Cookie:oldPhone})).status,200);assert.equal((await f.workspace(null,{Cookie:otherPhone},'rudds')).status,200);
 const oldId=a.administratorRequest.requestId;await f.workspace('jay');a=await f.account('jay');assert.equal(a.administratorRequest.requestId,oldId);
 const requestId=crypto.randomUUID(),input={administratorRequestId:oldId,identityConfirmed:true,note:'Confirmed owner requested recovery'};
 const first=await f.access('administrator.approve',input,a,'owner',requestId);assert.equal(first.status,200,JSON.stringify(first));assert.deepEqual((await f.access('administrator.approve',input,a,'owner',requestId)).data,first.data);
 assert.equal((await f.workspace('jay')).data.me.id,'jay');assert.equal((await f.workspace(null,{Cookie:oldPhone})).status,401);assert.equal((await f.workspace(null,{Cookie:otherPhone},'rudds')).status,200);
 assert.equal((await f.db.prepare("SELECT auth_user_id FROM memberships WHERE id='jay-b'").first()).auth_user_id,'employee-legacy-jay');
 assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM access_changes WHERE action='administrator.approve'").first()).n,1);
});

test('cancelled, expired, suspended and changed requests cannot grant access or revoke a still-working owner session',async t=>{
 const f=await fixture(t),cookie=await f.phone('jay');await f.workspace('jay');let a=await f.account('jay');
 assert.equal((await f.access('administrator.cancel',{administratorRequestId:a.administratorRequest.requestId,note:'Not requested by owner'},a)).status,200);
 assert.equal((await f.approve(a)).status,409);assert.equal((await f.workspace(null,{Cookie:cookie})).status,200);
 await f.workspace('jay');a=await f.account('jay');await f.db.prepare("UPDATE administrator_requests SET expires_at='2000-01-01T00:00:00Z' WHERE member_id='jay'").run();assert.equal((await f.approve(a)).status,409);
 await f.workspace('jay');a=await f.account('jay');await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='jay'").run();assert.equal((await f.approve(a)).status,409);
 assert.equal((await f.workspace('jay')).status,403);assert.equal((await f.db.prepare("SELECT active FROM memberships WHERE id='jay'").first()).active,0);
});

test('approval rolls back identity, devices and request together when audit fails',async t=>{
 const f=await fixture(t),cookie=await f.phone('jay');await f.workspace('jay');const a=await f.account('jay');
 await f.db.prepare("CREATE TRIGGER fail_admin_approval BEFORE INSERT ON audit_events WHEN NEW.action='administrator.approve' BEGIN SELECT RAISE(ABORT,'fixture failure'); END").run();
 assert.equal((await f.approve(a)).status,503);
 assert.equal((await f.workspace(null,{Cookie:cookie})).status,200);assert.equal((await f.account('jay')).administratorRequest.status,'requested');assert.equal((await f.db.prepare("SELECT auth_user_id FROM memberships WHERE id='jay'").first()).auth_user_id,'employee-legacy-jay');
 await f.db.prepare('DROP TRIGGER fail_admin_approval').run();assert.equal((await f.approve(a)).status,200);
});

test('administrators issue only their own phone codes and legacy codes issued by another administrator cannot be redeemed',async t=>{
 const f=await fixture(t),cookie=await f.phone('jay');
 assert.equal((await f.login({action:'issue',locationId:'berts',memberId:'jay',expectedRevision:1},headers('owner'))).status,403);
 const own=await f.login({action:'issue',locationId:'berts',memberId:'jay',expectedRevision:1},{Cookie:cookie});assert.equal(own.status,200);
 await f.db.prepare("UPDATE employee_setup_codes SET issued_by='owner' WHERE member_id='jay'").run();assert.equal((await f.login({action:'verify',code:own.data.code})).status,403);
 const again=await f.login({action:'issue',locationId:'berts',memberId:'jay',expectedRevision:1},{Cookie:cookie});assert.equal((await f.login({action:'verify',code:again.data.code})).status,200);
 // Revoking phone-code sessions must preserve the owner's verified provider mapping.
 await f.db.prepare('INSERT INTO browser_identity_links(subject_id,principal_id,linked_at) VALUES(?,?,?)').bind('jay-identity','employee-legacy-jay',Date.now()).run();
 assert.equal((await f.login({action:'revoke',locationId:'berts',memberId:'jay',expectedRevision:1},headers('owner'))).status,200);
 assert.equal((await f.workspace(null,{Cookie:cookie})).status,401);assert.equal((await f.workspace('jay')).status,200);
});

test('invitation cancellation and restart demand a fresh recipient sign-in and cannot be used to recover a suspended owner',async t=>{
 const f=await fixture(t),created=await f.access('administrator.add',{name:'New Owner',email:'newowner@example.test',identityConfirmed:true,note:'Invitation'});await f.workspace('newowner');let a=await f.account(created.data.recordId);
 assert.equal((await f.access('administrator.cancel',{administratorRequestId:a.administratorRequest.requestId,note:'Cancel invitation'},a)).status,200);
 a=await f.account(a.id);assert.equal((await f.access('administrator.resend',{administratorRequestId:a.administratorRequest.requestId,note:'Restart invitation'},a)).status,200);
 a=await f.account(a.id);assert.equal(a.administratorRequest.status,'invited');assert.equal(a.administratorRequest.verifiedEmail,null);assert.equal((await f.approve(a)).status,409);
 await f.workspace('newowner');a=await f.account(a.id);assert.equal((await f.approve(a)).status,200);
});

test('a pending verified identity cannot be replaced, self-approved or granted broader powers than the approver holds',async t=>{
 const f=await fixture(t),cookie=await f.phone('jay');await f.workspace('jay');const a=await f.account('jay');
 await f.workspace('jay',{'oai-authenticated-user-id':'another-provider-subject'});
 assert.equal((await f.db.prepare("SELECT requested_auth_user_id FROM administrator_requests WHERE member_id='jay'").first()).requested_auth_user_id,'jay-identity');
 const body={locationId:'berts',requestId:crypto.randomUUID(),action:'administrator.approve',recordId:'jay',expectedRevision:a.revision,input:{administratorRequestId:a.administratorRequest.requestId,identityConfirmed:true,note:'Cannot approve myself'}};
 assert.equal((await f.call(handleAccess,'/api/access',body,{Cookie:cookie})).status,403);
 await f.db.prepare("UPDATE memberships SET capabilities='[\"location.manage\"]',revision=revision+1 WHERE id='owner'").run();assert.equal((await f.approve(a)).status,403);
 assert.equal((await f.db.prepare("SELECT auth_user_id FROM memberships WHERE id='jay'").first()).auth_user_id,'employee-legacy-jay');
});

test('losing approval authority during the final save cannot bind an owner identity or invalidate their old phone',async t=>{
 const f=await fixture(t),cookie=await f.phone('jay');await f.workspace('jay');const a=await f.account('jay');let batches=0;
 const binding={withSession:()=>({prepare:(...args)=>f.db.prepare(...args),batch:async statements=>{batches++;if(batches===2)await f.db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='owner'").run();return f.db.batch(statements)}})};
 const response=await handleAccess(new Request(origin+'/api/access',{method:'POST',headers:{...headers('owner'),Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({locationId:'berts',requestId:crypto.randomUUID(),action:'administrator.approve',recordId:'jay',expectedRevision:a.revision,input:{administratorRequestId:a.administratorRequest.requestId,identityConfirmed:true,note:'Concurrent authority fixture'}})}),binding);
 assert.equal(response.status,409);assert.equal((await f.workspace(null,{Cookie:cookie})).status,200);assert.equal((await f.db.prepare("SELECT status FROM administrator_requests WHERE member_id='jay'").first()).status,'requested');
});
