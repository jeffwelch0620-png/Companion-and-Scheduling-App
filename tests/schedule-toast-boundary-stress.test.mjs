import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {openPositionDatabase} from './all-position-week-fixture.mjs';
const runtime=process.env.JMAX_TOAST_STRESS_RUNTIME??'.sites-runtime/shared';
const {handleToastSchedule}=await import('../'+runtime+'/toast-schedule-service.mjs');
const {handleToastDay}=await import('../'+runtime+'/toast-day-service.mjs');
const {tokenHash,employeeCookie}=await import('../'+runtime+'/employee-session.mjs');
const output='evidence/schedule-toast-simulations-2026-10-08/independent';
fs.mkdirSync(output,{recursive:true});
const modules=Object.fromEntries(fs.readdirSync(runtime).filter(n=>n.endsWith('.mjs')).sort().map(n=>[n,createHash('sha256').update(fs.readFileSync(runtime+'/'+n)).digest('hex')])),receipts=[];
const restaurants={berts:'11111111-1111-4111-8111-111111111111',rudds:'22222222-2222-4222-8222-222222222222',papa:'33333333-3333-4333-8333-333333333333'};
const employee='44444444-4444-4444-8444-444444444444',job='55555555-5555-4555-8555-555555555555';
const shift={guid:'66666666-6666-4666-8666-666666666666',employeeReference:{guid:employee},jobReference:{guid:job},inDate:'2026-10-07T16:00:00Z',outDate:'2026-10-07T20:00:00Z',modifiedDate:'2026-10-06T16:00:00Z',deleted:false};
const auth=()=>Response.json({status:'SUCCESS',token:{accessToken:'fictional-token-do-not-disclose',tokenType:'Bearer',expiresIn:3600}});
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(output,'trial-')),file=path.join(dir,'state.sqlite'),store=openPositionDatabase(file);t.after(()=>store.close());
 for(const migration of fs.readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())store.sqlite.exec(fs.readFileSync('drizzle/'+migration,'utf8').replaceAll('--> statement-breakpoint',''));
 for(const loc of ['berts','rudds','papa','comm'])store.sqlite.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').run(loc,'Fictional '+loc,'America/New_York');
 const add=(id,principal,location,capabilities)=>store.sqlite.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?,?)').run(id,principal+'@example.test',principal,location,'Fictional '+id,'BOH','General Manager',JSON.stringify(capabilities),'[]');
 for(const principal of ['jay','rudd']){for(const loc of ['berts','rudds','papa'])add(principal+'-'+loc,principal,loc,['location.manage']);store.sqlite.prepare('INSERT INTO restaurant_access(auth_user_id,kind,home_location_id) VALUES(?,?,?)').run(principal,principal,'berts');}
 for(const loc of ['berts','rudds'])add('gm-'+loc,'gm',loc,['location.manage']);store.sqlite.prepare('INSERT INTO restaurant_access(auth_user_id,kind,home_location_id) VALUES(?,?,?)').run('gm','restaurant','berts');
 for(const loc of ['comm','berts','rudds'])add('production-'+loc,'production',loc,['location.manage','orders.review']);store.sqlite.prepare('INSERT INTO restaurant_access(auth_user_id,kind,home_location_id) VALUES(?,?,?)').run('production','commissary','comm');
 add('staff-berts','staff','berts',[]);
 const bindings=loc=>({TOAST_LOCATION_ID:loc,TOAST_RESTAURANT_GUID:restaurants[loc],TOAST_CLIENT_ID:'fictional-client-'+loc,TOAST_CLIENT_SECRET:'fictional-secret-'+loc});
 const request=(who,loc='berts',query='',method='GET')=>new Request('https://boundary.example/api/integrations/toast-schedule?locationId='+loc+'&weekStart=2026-10-05'+query,{method,headers:{'oai-authenticated-user-id':who,'oai-authenticated-user-email':who+'@example.test'}});
 const call=async(who,loc,fetcher,config=bindings(loc),query='',method='GET')=>{const response=await handleToastSchedule(request(who,loc,query,method),store.db,config,fetcher);return {status:response.status,data:await response.json()};};
 const state=()=>JSON.stringify(Object.fromEntries(['records','command_receipts','audit_events'].map(n=>[n,store.sqlite.prepare('SELECT * FROM '+n+' ORDER BY rowid').all()])));
 return {store,file,call,state,bindings};
}
test('only verified Jay and Rudd seats read each restaurant; staff, pinned managers and commissary Food grants cannot hop into Toast schedules',async t=>{
 const f=await fixture(t),calls=[];const fetcher=async(url,init)=>{calls.push({path:new URL(url).pathname,restaurant:init.headers['Toast-Restaurant-External-ID']??null});return url.includes('/authentication/')?auth():Response.json([shift]);};const before=f.state();
 for(const who of ['jay','rudd'])for(const loc of ['berts','rudds','papa']){const r=await f.call(who,loc,fetcher);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.locationId,loc);assert.equal(r.data.snapshot.restaurantGuid,restaurants[loc]);assert.equal(r.data.previewOnly,true);assert.doesNotMatch(JSON.stringify(r.data),/fictional-secret|fictional-token/);}
 const authorizedCalls=calls.length;
 for(const [who,loc] of [['staff','berts'],['gm','rudds'],['production','berts'],['production','rudds'],['production','papa']]){const r=await f.call(who,loc,fetcher);assert.equal(r.status,403,JSON.stringify(r.data));assert.equal(r.data.snapshot,undefined);}
 assert.equal(calls.length,authorizedCalls);assert.equal(f.state(),before);assert.equal(calls.filter(c=>c.path==='/labor/v1/shifts').length,6);assert.deepEqual(new Set(calls.filter(c=>c.restaurant).map(c=>c.restaurant)),new Set(Object.values(restaurants)));
 receipts.push({case:'verified owner seats versus isolated staff/commissary schedule scope',passed:true,reads:6,denials:5,database:f.file,limitation:'Separate fictional per-location bindings are supplied. Production configuredToast supports one location binding per server configuration.'});
});
test('forged Toast overrides and schedule writes are rejected without provider calls or local schedule mutation',async t=>{
 const f=await fixture(t);let called=0;const fetcher=async()=>{called++;return auth();},before=f.state();
 for(const [query,method,status] of [['&restaurantGuid='+restaurants.rudds,'GET',400],['&host=https://foreign.example','GET',400],['&locationId=rudds','GET',400],['','POST',405],['','PUT',405]])assert.equal((await f.call('jay','berts',fetcher,undefined,query,method)).status,status);
 assert.equal((await f.call('jay','rudds',fetcher,f.bindings('berts'))).status,503);assert.equal(called,0);assert.equal(f.state(),before);receipts.push({case:'server-only configuration and preview-only API',passed:true,database:f.file});
});
test('permission and owner-seat revocation during a provider read suppress the snapshot and cannot write shifts',async t=>{
 for(const change of ["UPDATE memberships SET active=0,revision=revision+1 WHERE id='jay-rudds'","UPDATE memberships SET capabilities='[]',revision=revision+1 WHERE id='jay-rudds'","UPDATE restaurant_access SET kind='restaurant',revision=revision+1 WHERE auth_user_id='jay'"]){const f=await fixture(t),before=f.state();const r=await f.call('jay','rudds',async url=>{if(url.includes('/authentication/'))return auth();f.store.sqlite.exec(change);return Response.json([shift]);});assert.equal(r.status,403,JSON.stringify(r.data));assert.equal(r.data.snapshot,undefined);assert.equal(f.state(),before);receipts.push({case:'in-flight source authority revocation',change,passed:true,database:f.file});}
});
test('server restaurant configuration changed mid-read cannot return the former snapshot',async t=>{
 const f=await fixture(t),config=f.bindings('berts'),before=f.state();const r=await f.call('jay','berts',async url=>{if(url.includes('/authentication/'))return auth();config.TOAST_RESTAURANT_GUID=restaurants.rudds;return Response.json([shift]);},config);assert.equal(r.status,409,JSON.stringify(r.data));assert.equal(r.data.snapshot,undefined);assert.equal(f.state(),before);receipts.push({case:'in-flight server restaurant configuration change',passed:true,database:f.file});
});
test('failed, rate-limited and partial upstream reads do not become successful empty schedules',async t=>{
 const samples=[{name:'forbidden',response:()=>new Response('PRIVATE_UPSTREAM_DETAIL',{status:403}),status:503},{name:'limited',response:()=>new Response('PRIVATE_UPSTREAM_DETAIL',{status:429}),status:429},{name:'malformed JSON',response:()=>new Response('{not valid JSON'),status:400},{name:'missing deletion status',response:()=>Response.json([{...shift,deleted:undefined}]),status:502},{name:'duplicate shifts',response:()=>Response.json([shift,shift]),status:502},{name:'partial content is not a complete week',response:()=>Response.json([shift],{status:206,headers:{'Content-Range':'items 0-0/20'}}),status:502},{name:'impossible source calendar date',response:()=>Response.json([{...shift,inDate:'2026-02-30T16:00:00Z',outDate:'2026-02-30T20:00:00Z'}]),status:502},{name:'null upstream employee reference',response:()=>Response.json([{...shift,employeeReference:null}]),status:502}];
 for(const sample of samples){const f=await fixture(t),before=f.state();const r=await f.call('jay','berts',async url=>url.includes('/authentication/')?auth():sample.response());assert.equal(r.status,sample.status,JSON.stringify(r.data));assert.equal(r.data.snapshot,undefined);assert.doesNotMatch(JSON.stringify(r.data),/PRIVATE_UPSTREAM_DETAIL|fictional-token|fictional-secret/);assert.equal(f.state(),before);receipts.push({case:'upstream failure stays unavailable',name:sample.name,status:r.status,passed:true,database:f.file});}
});
test('restaurant timezone changed during schedule read rejects an obsolete week snapshot',async t=>{
 const f=await fixture(t),before=f.state();const r=await f.call('jay','berts',async url=>{if(url.includes('/authentication/'))return auth();f.store.sqlite.exec("UPDATE locations SET timezone='Pacific/Honolulu',revision=revision+1 WHERE id='berts'");return Response.json([shift]);});
 receipts.push({case:'in-flight restaurant timezone changed',actualStatus:r.status,returnedTimezone:r.data.snapshot?.timezone??null,desiredStatus:409,database:f.file});assert.equal(f.state(),before);assert.equal(r.status,409,'A changed restaurant day definition must not return the obsolete weekly bounds');assert.equal(r.data.snapshot,undefined);
});
test('revoking a phone session during the read suppresses the result rather than trusting the already-authenticated identity',async t=>{
 const f=await fixture(t),token='a'.repeat(64),hash=await tokenHash(token),revision=f.store.sqlite.prepare("SELECT revision FROM memberships WHERE id='gm-berts'").get().revision;
 f.store.sqlite.prepare('INSERT INTO employee_sessions(token_hash,auth_user_id,member_id,member_revision,created_at,expires_at) VALUES(?,?,?,?,?,?)').run(hash,'gm','gm-berts',revision,Date.now(),Date.now()+86400000);
 const before=f.state(),request=new Request('https://boundary.example/api/integrations/toast-schedule?locationId=berts&weekStart=2026-10-05',{headers:{Cookie:employeeCookie+'='+token,'oai-authenticated-user-id':'jay','oai-authenticated-user-email':'jay@example.test'}});
 const response=await handleToastSchedule(request,f.store.db,f.bindings('berts'),async url=>{if(url.includes('/authentication/'))return auth();f.store.sqlite.prepare('DELETE FROM employee_sessions WHERE token_hash=?').run(hash);return Response.json([shift]);}),data=await response.json();
 receipts.push({case:'phone session revoked during schedule read',actualStatus:response.status,snapshotReturned:!!data.snapshot,desiredStatus:401,database:f.file});assert.equal(f.state(),before);assert.equal(response.status,401,'Deleted phone session must invalidate the in-flight private schedule read without browser-owner fallback');assert.equal(data.snapshot,undefined);
});
test('existing GM day-data reader already rejects the same revoked-device and changed-timezone races',async t=>{
 for(const mode of ['device','timezone']){const f=await fixture(t),token='b'.repeat(64),hash=await tokenHash(token),revision=f.store.sqlite.prepare("SELECT revision FROM memberships WHERE id='gm-berts'").get().revision;
  f.store.sqlite.prepare('INSERT INTO employee_sessions(token_hash,auth_user_id,member_id,member_revision,created_at,expires_at) VALUES(?,?,?,?,?,?)').run(hash,'gm','gm-berts',revision,Date.now(),Date.now()+86400000);
  const request=new Request('https://boundary.example/api/integrations/toast-day?locationId=berts&businessDate=2000-02-29',{headers:{Cookie:employeeCookie+'='+token,'oai-authenticated-user-id':'jay','oai-authenticated-user-email':'jay@example.test'}}),before=f.state();
  const reader={mappings:new Map([['berts',{locationId:'berts',restaurantGuid:restaurants.berts,timezone:'America/New_York'}]]),read:async()=>{if(mode==='device')f.store.sqlite.prepare('DELETE FROM employee_sessions WHERE token_hash=?').run(hash);else f.store.sqlite.exec("UPDATE locations SET timezone='Pacific/Honolulu',revision=revision+1 WHERE id='berts'");return null;}};
  const response=await handleToastDay(request,f.store.db,reader),data=await response.json();assert.equal(response.status,mode==='device'?401:409,JSON.stringify(data));assert.equal(data.orders,undefined);assert.equal(f.state(),before);receipts.push({case:'existing day reader rejects same race',mode,status:response.status,passed:true,database:f.file});
 }
});
test.after(()=>{fs.writeFileSync(output+'/results.json',JSON.stringify({runtime,runtimeModules:modules,externalProviderCalls:0,transport:'Local fake Toast response only; actual authenticated preview handler and durable SQLite.',proof:'Scope, races and unavailable data, not live Toast access or schedule synchronization.',receipts},null,2)+'\n');});
