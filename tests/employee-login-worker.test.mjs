import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';

process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');

test('compiled sign-in preserves its restaurant scope through real API routes and logout',async t=>{
 let outboundCalls=0;
 const worker=new Miniflare({
  modules:true,scriptPath:path.resolve('dist/server/index.js'),modulesRoot:path.resolve('dist/server'),
  modulesRules:[{type:'ESModule',include:['**/*.js']}],compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],
  d1Databases:['DB'],serviceBindings:{ASSETS:()=>new Response('Not found',{status:404})},
  bindings:{JMAX_LOGIN_SECRET:'a'.repeat(64)},
  outboundService:async()=>{outboundCalls++;return new Response('No outbound requests allowed in this fixture',{status:503})},
 });
 t.after(()=>worker.dispose());
 const db=await worker.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const location of ['a','b'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(location,'Fictional '+location,'America/New_York').run();
 for(const [id,identity,location,caps] of [['owner','owner-identity','a',['location.manage']],['employee','employee-identity','a',[]],['employee-other','employee-identity','b',['location.manage']]])await db.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,active) VALUES(?,?,?,?,?,?,?,?,1)').bind(id,id+'@example.test',identity,location,'Fictional '+id,'BOH','Cook',JSON.stringify(caps)).run();
 const origin='http://localhost',ownerHeaders={'oai-authenticated-user-email':'owner@example.test','oai-authenticated-user-id':'owner-identity'};
 const post=(route,body,headers={})=>worker.dispatchFetch(origin+route,{method:'POST',headers:{...headers,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 // Deliberate duplicate provider memberships require an operator-installed
 // home restaurant assignment before any employee setup code is issued.
 const unassigned=await post('/api/employee-login',{action:'issue',locationId:'a',memberId:'employee',expectedRevision:1},ownerHeaders);
 const unassignedBody=await unassigned.json();assert.equal(unassigned.status,403,JSON.stringify(unassignedBody));assert.match(unassignedBody.error,/assigned to another restaurant/);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM employee_setup_codes').first()).n,0);
 await db.prepare("INSERT INTO restaurant_access(auth_user_id,kind,home_location_id) VALUES('employee-identity','restaurant','a')").run();
 const issued=await post('/api/employee-login',{action:'issue',locationId:'a',memberId:'employee',expectedRevision:1},ownerHeaders);
 assert.equal(issued.status,200,JSON.stringify(await issued.clone().json()));
 const signed=await post('/api/employee-login',{action:'verify',code:(await issued.json()).code});assert.equal(signed.status,200);
 const cookie=signed.headers.get('Set-Cookie').split(';')[0];
 const list=await worker.dispatchFetch(origin+'/api/workspace',{headers:{Cookie:cookie,...ownerHeaders}});
 assert.equal(list.status,200);assert.deepEqual((await list.json()).memberships.map(m=>m.id),['employee']);
 const local=await worker.dispatchFetch(origin+'/api/workspace?locationId=a',{headers:{Cookie:cookie}});assert.equal(local.status,200);assert.equal((await local.json()).me.id,'employee');
 for(const route of ['/api/workspace','/api/access','/api/companion','/api/integrations/toast','/api/integrations/hotschedules','/api/source-library','/api/reminders','/api/schedule-transfer']){
  const blocked=await worker.dispatchFetch(origin+route+'?locationId=b',{headers:{Cookie:cookie,...ownerHeaders}});
  assert.equal(blocked.status,403,route);
 }
 assert.equal((await post('/api/workspace',{requestId:crypto.randomUUID(),locationId:'b',action:'task.create',input:{}},{Cookie:cookie})).status,403);
 assert.equal((await post('/api/employee-login',{action:'logout'},{Cookie:cookie})).status,200);
 assert.equal((await worker.dispatchFetch(origin+'/api/workspace?locationId=a',{headers:{Cookie:cookie,...ownerHeaders}})).status,401);
 const owner=await worker.dispatchFetch(origin+'/api/workspace?locationId=a',{headers:ownerHeaders});assert.equal(owner.status,200);assert.equal((await owner.json()).me.id,'owner');
 // The compiled invitation route must keep access off until a verified
 // recipient signs in and the existing administrator approves that request.
 const invite=await post('/api/access',{locationId:'a',requestId:crypto.randomUUID(),action:'administrator.add',input:{name:'Fictional new owner',email:'newowner@example.test',identityConfirmed:true,note:'Compiled invitation fixture'}},ownerHeaders);assert.equal(invite.status,200);
 const memberId=(await invite.json()).recordId,newHeaders={'oai-authenticated-user-email':'newowner@example.test','oai-authenticated-user-id':'new-owner-identity'};
 assert.equal((await worker.dispatchFetch(origin+'/api/workspace?locationId=a',{headers:newHeaders})).status,403);
 const access=await worker.dispatchFetch(origin+'/api/access?locationId=a',{headers:ownerHeaders}),account=(await access.json()).accounts.find(a=>a.id===memberId);assert.equal(account.active,false);assert.equal(account.administratorRequest.status,'requested');
 const approved=await post('/api/access',{locationId:'a',requestId:crypto.randomUUID(),action:'administrator.approve',recordId:memberId,expectedRevision:account.revision,input:{administratorRequestId:account.administratorRequest.requestId,identityConfirmed:true,note:'Verified fixture account'}},ownerHeaders);assert.equal(approved.status,200);
 assert.equal((await worker.dispatchFetch(origin+'/api/workspace?locationId=a',{headers:newHeaders})).status,200);
 assert.equal(outboundCalls,0);
});
