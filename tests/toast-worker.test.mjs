import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { Miniflare } from 'miniflare';

process.env.MINIFLARE_REGISTRY_PATH ??= path.resolve('.wrangler/registry');

test('compiled Toast route reads and persists a roster without following credential-bearing redirects', async t => {
  const restaurantGuid='11111111-1111-4111-8111-111111111111';
  const authPath='/authentication/v1/authentication/login';
  let redirectPath=null;
  const calls=[];
  const worker=new Miniflare({
    modules:true,scriptPath:path.resolve('dist/server/index.js'),modulesRoot:path.resolve('dist/server'),
    modulesRules:[{type:'ESModule',include:['**/*.js']}],compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],
    d1Databases:['DB'],serviceBindings:{ASSETS:()=>new Response('Not found',{status:404})},
    bindings:{TOAST_LOCATION_ID:'fictional-restaurant',TOAST_RESTAURANT_GUID:restaurantGuid,TOAST_CLIENT_ID:'fictional-client',TOAST_CLIENT_SECRET:'fictional-secret',TOAST_API_HOST:'https://ws-api.toasttab.com'},
    outboundService:async request=>{
      const url=new URL(request.url);calls.push(url.pathname);
      assert.equal(url.origin,'https://ws-api.toasttab.com','No redirect destination may receive credentials');
      if(url.pathname===redirectPath)return new Response(null,{status:307,headers:{Location:'https://unexpected.example/blocked'}});
      if(url.pathname===authPath){
        assert.equal(request.method,'POST');
        assert.deepEqual(await request.json(),{clientId:'fictional-client',clientSecret:'fictional-secret',userAccessType:'TOAST_MACHINE_CLIENT'});
        return Response.json({status:'SUCCESS',token:{accessToken:'fictional-token',tokenType:'Bearer',expiresIn:3600}});
      }
      assert.equal(request.method,'GET');assert.equal(request.headers.get('Authorization'),'Bearer fictional-token');
      assert.equal(request.headers.get('Toast-Restaurant-External-ID'),restaurantGuid);
      if(url.pathname==='/labor/v1/jobs')return Response.json([{guid:'cook-job',title:'Cook',deleted:false}]);
      assert.equal(url.pathname,'/labor/v1/employees');
      return Response.json([{guid:'employee-one',firstName:'Fictional',lastName:'Cook',email:'cook@example.test',deleted:false,jobReferences:[{guid:'cook-job'}],passcode:'must-not-retain',wage:99}]);
    },
  });
  t.after(()=>worker.dispose());
  const db=await worker.getD1Database('DB');
  for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
  await db.prepare("INSERT INTO locations(id,name,timezone) VALUES('fictional-restaurant','Fictional restaurant','America/New_York')").run();
  await db.prepare("INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,active) VALUES('owner','owner@example.test','owner-identity','fictional-restaurant','Fictional Owner','Management','Owner','[\"location.manage\"]','[]',1)").run();
  const headers={'oai-authenticated-user-email':'owner@example.test','oai-authenticated-user-id':'owner-identity',Origin:'http://localhost','Content-Type':'application/json'};
  const read=()=>worker.dispatchFetch('http://localhost/api/integrations/toast',{method:'POST',headers,body:JSON.stringify({locationId:'fictional-restaurant'})});
  const response=await read(),data=await response.json();
  assert.equal(response.status,200,JSON.stringify({data,outboundCalls:calls}));
  assert.equal(data.roster.employees[0].jobs[0].title,'Cook');
  assert.equal(JSON.stringify(data).includes('must-not-retain'),false);
  assert.equal(JSON.stringify(data).includes('fictional-secret'),false);
  let saved=await db.prepare('SELECT data FROM toast_rosters').first();
  assert.ok(saved);assert.equal((await db.prepare('SELECT COUNT(*) n FROM memberships').first()).n,1);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='toast.roster-read'").first()).n,1);
  const reread=await worker.dispatchFetch('http://localhost/api/integrations/toast?locationId=fictional-restaurant',{headers});
  assert.deepEqual((await reread.json()).roster,data.roster);
  const encrypted=await db.prepare('SELECT * FROM toast_auth_cache').first();assert.ok(encrypted);assert.ok(!JSON.stringify(encrypted).includes('fictional-token'));assert.ok(!JSON.stringify(encrypted).includes('fictional-secret'));
  await db.prepare('DELETE FROM integration_attempts').run();calls.length=0;
  assert.equal((await read()).status,200);assert.deepEqual(calls.sort(),['/labor/v1/employees','/labor/v1/jobs']);
  saved=await db.prepare('SELECT data FROM toast_rosters').first();
  for(const blocked of [authPath,'/labor/v1/employees','/labor/v1/jobs']){
    redirectPath=blocked;calls.length=0;
    await db.prepare('DELETE FROM integration_attempts').run();
    await db.prepare('DELETE FROM toast_auth_cache').run();
    const rejected=await read();assert.equal(rejected.status,blocked===authPath?503:502);
    assert.ok(calls.includes(blocked));assert.equal(calls.length,blocked===authPath?1:3);
    assert.equal((await db.prepare('SELECT data FROM toast_rosters').first()).data,saved.data);
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='toast.roster-read'").first()).n,2);
  }
});
