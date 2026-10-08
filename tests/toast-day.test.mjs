import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {handleToastDay} from '../.sites-runtime/shared/toast-day-service.mjs';
import {projectToastDay} from '../.sites-runtime/shared/toast-day.mjs';
import {AppError} from '../.sites-runtime/shared/validation.mjs';
import {handleEmployeeLogin} from '../.sites-runtime/shared/employee-login.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
const day='2000-02-29',zone='America/New_York';
const restaurantGuid='11111111-1111-4111-8111-111111111111';
const scope={locationId:'berts',businessDate:day,timezone:zone};
const mapping={locationId:'berts',restaurantGuid,timezone:zone};
function payload(s=scope,guid=restaurantGuid){
 const at=new Date(Date.now()-100).toISOString();
 const feed={recordCount:4,checkedAt:at,dataThrough:at,paginationComplete:true,correctionsApplied:true,dayClosed:true};
 return {schemaVersion:'jmax-toast-day-read.v1',...s,source:{system:'toast',restaurantGuid:guid},orders:{...feed},labor:{...feed,recordCount:7}};
}
async function fixture(t){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const location of ['berts','rudds','papa'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(location,'Fictional '+location,zone).run();
 for(const [name,location,caps,position='Manager',auth=name+'-identity'] of [['owner','berts',['location.manage'],'Owner'],['foh','berts',['tasks.manage']],['boh','berts',['tasks.manage']],['worker','berts',[]],['dish','berts',['location.manage'],'Dishwasher'],['other','rudds',['location.manage'],'Owner'],['third','papa',['location.manage'],'Owner'],['owner-b','rudds',['location.manage'],'Owner','owner-identity']])await db.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,active) VALUES(?,?,?,?,?,?,?,?,?,1)').bind(name,name+'@example.test',auth,location,name,'BOH',position,JSON.stringify(caps),'[]').run();
 // Explicit operator-installed Jay seat; duplicate memberships alone never grant cross-store access.
 await db.prepare("INSERT INTO restaurant_access(auth_user_id,kind,home_location_id) VALUES(?, ?, ?)").bind("owner-identity","jay","berts").run();
 const headers=actor=>actor?{'oai-authenticated-user-id':actor+'-identity','oai-authenticated-user-email':actor+'@example.test'}:{};
 const mappings=new Map([['berts',mapping],['rudds',{...mapping,locationId:'rudds',restaurantGuid:'22222222-2222-4222-8222-222222222222'}],['papa',{...mapping,locationId:'papa',restaurantGuid:'33333333-3333-4333-8333-333333333333'}]]);
 const calls=[];const reader={mappings,read:async s=>{calls.push(s);return payload(s,s.restaurantGuid);}};
 async function call(actor='owner',params={locationId:'berts',businessDate:day},r=reader,extra={}){const response=await handleToastDay(new Request('https://example.test/api/integrations/toast-day?'+(typeof params==='string'?params:new URLSearchParams(params)),{...extra,headers:{...headers(actor),...extra.headers}}),db,r);return {status:response.status,data:await response.json(),headers:response.headers};}
 return {db,call,calls,reader,headers};
}

test('each restaurant gets only its mapped business day and no operating data is written',async t=>{
 const f=await fixture(t);
 for(const [actor,locationId] of [['owner','berts'],['other','rudds'],['third','papa'],['owner','rudds']]){
  const r=await f.call(actor,{locationId,businessDate:day});assert.equal(r.status,200);assert.equal(r.data.locationId,locationId);assert.equal(r.data.businessDate,day);assert.equal(r.data.timezone,zone);assert.equal(r.data.connection,'connected');assert.equal(r.data.orders.recordCount,4);assert.equal(r.data.labor.recordCount,7);
  assert.equal(f.calls.at(-1).restaurantGuid,f.reader.mappings.get(locationId).restaurantGuid);assert.equal(f.calls.at(-1).businessDate,day);assert.equal(f.calls.at(-1).signal.aborted,true);
  assert.equal(r.headers.get('Cache-Control'),'private, no-store');assert.equal(r.headers.get('X-Content-Type-Options'),'nosniff');
 }
 assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM records').first()).n,0);
 assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM toast_rosters').first()).n,0);
 assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM audit_events').first()).n,0);
});

test('missing connection and missing feed remain unavailable rather than zero',async t=>{
 const f=await fixture(t);
 const disconnected=await f.call('owner',undefined,null);assert.equal(disconnected.status,200);assert.equal(disconnected.data.connection,'not-connected');assert.equal(disconnected.data.orders.recordCount,null);assert.equal(disconnected.data.labor.state,'unavailable');assert.equal(f.calls.length,0);
 f.reader.mappings.delete('berts');assert.equal((await f.call()).data.connection,'not-connected');assert.equal(f.calls.length,0);
 f.reader.mappings.set('berts',mapping);f.reader.read=async()=>({...payload(),orders:null});
 const partial=await f.call();assert.equal(partial.data.orders.state,'unavailable');assert.equal(partial.data.labor.state,'available');
});

test('signed-out, wrong restaurant, frontline, department managers and dish-only roles never reach the reader',async t=>{
 const f=await fixture(t);
 for(const [actor,status] of [[null,401],['other',403],['third',403],['foh',403],['boh',403],['worker',403],['dish',403]])assert.equal((await f.call(actor)).status,status);
 assert.equal((await f.call('owner',undefined,undefined,{headers:{Cookie:'__Host-jmax-session=invalid'}})).status,401);
 assert.equal(f.calls.length,0);
});

test('strict single restaurant/date rejects overrides, ambiguous queries, impossible/future dates and writes',async t=>{
 const f=await fixture(t);
 for(const params of ['businessDate='+day,'locationId=berts','locationId=berts&businessDate=2000-02-30','locationId=berts&businessDate=20000229','locationId=berts&businessDate=2999-01-01','locationId=berts&locationId=rudds&businessDate='+day,'locationId=berts&businessDate='+day+'&businessDate='+day,'locationId=berts&businessDate='+day+'&endpoint=https://evil.example','locationId=berts&businessDate='+day+'&restaurantGuid='+restaurantGuid])assert.equal((await f.call('owner',params)).status,400,params);
 const write=await f.call('owner',undefined,undefined,{method:'POST'});assert.equal(write.status,405);assert.equal(write.headers.get('Allow'),'GET');assert.equal(f.calls.length,0);
});

test('zero requires closed day, complete pagination and corrections; partial feeds never expose a total',()=>{
 for(const count of [0,4])for(const key of ['paginationComplete','correctionsApplied','dayClosed']){
  const p=payload();p.orders.recordCount=count;p.orders[key]=false;
  const r=projectToastDay(p,scope,mapping,Date.now());assert.equal(r.orders.state,'incomplete');assert.equal(r.orders.recordCount,null);assert.equal(r.labor.recordCount,7);
 }
 const p=payload();p.orders.recordCount=0;const r=projectToastDay(p,scope,mapping,Date.now());assert.equal(r.orders.state,'empty');assert.equal(r.orders.recordCount,0);
});

test('freshness follows covered data time, not a recent fetch; stale totals stay withheld',()=>{
 const p=payload(),now=Date.now();p.orders.dataThrough=new Date(now-1800001).toISOString();
 const r=projectToastDay(p,scope,mapping,now);assert.equal(r.orders.freshness,'stale');assert.equal(r.orders.recordCount,null);assert.equal(r.labor.freshness,'current');
 p.orders.dataThrough=new Date(now-1800000).toISOString();assert.equal(projectToastDay(p,scope,mapping,now).orders.freshness,'current');
});

test('raw orders, employee information, metrics and extra provider fields cannot pass through',()=>{
 const p=payload();p.orders.rows=[{email:'private@example.test',payment:'private'}];p.labor.wages='private';p.source.token='private';p.providerError='private';p.orders.netSalesCents=99999;
 const r=projectToastDay(p,scope,mapping,Date.now());assert.equal(JSON.stringify(r).includes('private'),false);assert.equal('netSalesCents' in r.orders,false);assert.equal('source'in r,false);
});

test('wrong source, day, timezone, schema and malformed completeness/count/time are unavailable',async t=>{
 const f=await fixture(t);
 const variants=[p=>p.locationId='rudds',p=>p.businessDate='2000-03-01',p=>p.timezone='UTC',p=>p.source.restaurantGuid='22222222-2222-4222-8222-222222222222',p=>p.source.system='other',p=>p.schemaVersion='v0',p=>delete p.orders,p=>delete p.orders.dayClosed,p=>p.orders.recordCount=-1,p=>p.orders.recordCount='4',p=>p.orders.recordCount=1.5,p=>p.orders.recordCount=Number.MAX_SAFE_INTEGER+1,p=>p.orders.dataThrough='invalid',p=>p.orders.checkedAt='2999-01-01T00:00:00Z',p=>p.orders.dataThrough='2999-01-01T00:00:00Z'];
 for(const mutate of variants){const p=payload();mutate(p);f.reader.read=async()=>p;const r=await f.call();assert.equal(r.status,503);assert.equal(r.data.connection,'unavailable');assert.equal(r.data.orders.recordCount,null);assert.equal(r.data.labor.recordCount,null);assert.equal(r.data.error,'Toast day data could not be verified. Try again later.');}
 f.reader.mappings.set('berts',{...mapping,locationId:'rudds'});assert.equal((await f.call()).status,503);
});

test('upstream exception text is never returned, even when shaped as an application error',async t=>{
 const f=await fixture(t);
 for(const error of [new Error('private token'),new AppError(403,'private token')]){f.reader.read=async()=>{throw error;};const r=await f.call();assert.equal(r.status,503);assert.equal(JSON.stringify(r.data).includes('private token'),false);}
});

test('membership or restaurant settings changed during fetch prevent disclosure',async t=>{
 const f=await fixture(t);
 for(const sql of ["UPDATE memberships SET revision=revision+1 WHERE id='owner'","UPDATE memberships SET capabilities='[]' WHERE id='owner'","UPDATE memberships SET active=0 WHERE id='owner'","UPDATE locations SET timezone='UTC' WHERE id='berts'"]){
  await f.db.prepare("UPDATE memberships SET capabilities='[\"location.manage\"]',active=1 WHERE id='owner'").run();
  f.reader.read=async()=>{await f.db.prepare(sql).run();return payload();};
  const r=await f.call();assert.ok([403,409].includes(r.status),JSON.stringify(r));assert.equal('orders'in r.data,false);
 }
});

test('revocable employee session cannot borrow ambient browser privileges or cross restaurants',async t=>{
 const f=await fixture(t);
 const login=async(input,headers={})=>handleEmployeeLogin(new Request('https://example.test/api/employee-login',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json',...headers},body:JSON.stringify(input)}),f.db,{JMAX_LOGIN_SECRET:'a'.repeat(64)});
 const issue=await login({action:'issue',locationId:'berts',memberId:'owner',expectedRevision:1},f.headers('owner'));assert.equal(issue.status,200);
 const signed=await login({action:'verify',code:(await issue.json()).code});assert.equal(signed.status,200);const Cookie=signed.headers.get('Set-Cookie').split(';')[0];
 assert.equal((await f.call('owner',{locationId:'rudds',businessDate:day},undefined,{headers:{Cookie}})).status,403);
 f.reader.read=async()=>{await f.db.prepare('DELETE FROM employee_sessions').run();return payload();};
 const revoked=await f.call('owner',undefined,undefined,{headers:{Cookie}});assert.equal(revoked.status,401);assert.equal('orders'in revoked.data,false);
});

test('a stalled reader is bounded and receives cancellation',async t=>{
 const f=await fixture(t);let signal;
 f.reader.read=s=>{signal=s.signal;return new Promise(()=>{});};
 const start=Date.now(),r=await f.call();assert.equal(r.status,503);assert.equal(signal.aborted,true);assert.ok(Date.now()-start<9000);assert.equal(r.data.orders.recordCount,null);
});
