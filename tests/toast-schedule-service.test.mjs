import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Miniflare} from 'miniflare';
import {handleToastSchedule} from '../.sites-runtime/shared/toast-schedule-service.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=new URL('../.wrangler/registry',import.meta.url).pathname;
const restaurant='11111111-1111-4111-8111-111111111111';
async function fixture(t){
 const worker=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>worker.dispose());
 const db=await worker.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 await db.prepare("INSERT INTO locations(id,name,timezone) VALUES('review','Fictional restaurant','America/New_York')").run();
 await db.prepare("INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,active) VALUES('owner','owner@example.test','owner-identity','review','Fictional Owner','Management','Owner','[\"location.manage\"]','[]',1)").run();
 const bindings={TOAST_LOCATION_ID:'review',TOAST_RESTAURANT_GUID:restaurant,TOAST_CLIENT_ID:'fixture-client',TOAST_CLIENT_SECRET:'fixture-secret'};
 const headers={'oai-authenticated-user-email':'owner@example.test','oai-authenticated-user-id':'owner-identity'};
 return {db,bindings,call:(fetcher,query='locationId=review&weekStart=2026-10-05',method='GET')=>handleToastSchedule(new Request('http://localhost/api/integrations/toast-schedule?'+query,{headers,method}),db,bindings,fetcher)};
}
const auth=()=>Response.json({status:'SUCCESS',token:{accessToken:'fixture-token',tokenType:'Bearer',expiresIn:3600}});
test('administrator preview reads scoped POS shifts, reuses authentication, and leaves schedules untouched',async t=>{
 const f=await fixture(t),calls=[];
 const fetcher=async(url,options)=>{calls.push(new URL(url).pathname);if(url.includes('/authentication/'))return auth();assert.equal(options.method,'GET');assert.equal(options.headers['Toast-Restaurant-External-ID'],restaurant);return Response.json([])};
 for(let n=0;n<2;n++){const r=await f.call(fetcher),body=await r.json();assert.equal(r.status,200);assert.equal(body.previewOnly,true);assert.deepEqual(body.snapshot.shifts,[]);assert.equal(body.snapshot.timezone,'America/New_York');assert.doesNotMatch(JSON.stringify(body),/fixture-secret|fixture-token/)}
 assert.equal(calls.filter(p=>p.includes('authentication')).length,1);assert.equal(calls.filter(p=>p==='/labor/v1/shifts').length,2);
 assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM records').first()).n,0);
});
test('wrong restaurant, extra connection overrides and non-read methods never contact Toast',async t=>{
 const f=await fixture(t);let calls=0;const fetcher=async()=>{calls++;return auth()};
 for(const [query,method,status] of [['locationId=other&weekStart=2026-10-05','GET',403],['locationId=review&weekStart=2026-10-05&host=https://unexpected.example','GET',400],['locationId=review&weekStart=2026-10-05','POST',405]])assert.equal((await f.call(fetcher,query,method)).status,status);
 assert.equal(calls,0);
});
test('permission revocation during provider read prevents returning the snapshot',async t=>{
 const f=await fixture(t);const r=await f.call(async url=>{if(url.includes('/authentication/'))return auth();await f.db.prepare('UPDATE memberships SET active=0').run();return Response.json([])});
 assert.equal(r.status,403);assert.equal((await r.json()).snapshot,undefined);
});
test('upstream forbidden response is unavailable rather than an empty successful schedule',async t=>{
 const f=await fixture(t);const r=await f.call(async url=>url.includes('/authentication/')?auth():new Response('private upstream body',{status:403}));
 assert.equal(r.status,503);const body=await r.json();assert.equal(body.snapshot,undefined);assert.doesNotMatch(JSON.stringify(body),/private upstream/);
});
test('employee matches require an applied identity review for this exact Toast restaurant and active local employee',async t=>{
 const f=await fixture(t),employee='22222222-2222-4222-8222-222222222222';
 await f.db.prepare("INSERT INTO access_reviews(id,location_id,restaurant_guid,employee_id,source_at,source,data,status,member_id,revision,updated_at) VALUES('match','review',?,?,'2026-10-07','{}','{}','draft','owner',1,'2026-10-07')").bind(restaurant,employee).run();
 const fetcher=async url=>url.includes('/authentication/')?auth():Response.json([{guid:'33333333-3333-4333-8333-333333333333',employeeReference:{guid:employee},jobReference:{guid:'44444444-4444-4444-8444-444444444444'},inDate:'2026-10-07T16:00:00Z',outDate:'2026-10-07T20:00:00Z',modifiedDate:'2026-10-06T12:00:00Z',deleted:false}]);
 assert.deepEqual((await (await f.call(fetcher)).json()).employees,[]);
 await f.db.prepare("UPDATE access_reviews SET status='applied'").run();
 assert.deepEqual((await (await f.call(fetcher)).json()).employees,[{toastEmployeeId:employee,memberId:'owner',name:'Fictional Owner'}]);
 await f.db.prepare("UPDATE access_reviews SET restaurant_guid='55555555-5555-4555-8555-555555555555'").run();
 assert.deepEqual((await (await f.call(fetcher)).json()).employees,[]);
});
