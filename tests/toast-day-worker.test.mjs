import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
test('built Toast day route authenticates and reports unconnected without calling ingestion',async t=>{
 let outbound=0;
 const mf=new Miniflare({modules:true,scriptPath:path.resolve('dist/server/index.js'),modulesRoot:path.resolve('dist/server'),modulesRules:[{type:'ESModule',include:['**/*.js']}],compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],serviceBindings:{ASSETS:()=>new Response('Not found',{status:404})},outboundService:()=>{outbound++;throw new Error('No external request expected');}});t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB');for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 await db.prepare("INSERT INTO locations(id,name,timezone) VALUES('a','Fictional A','America/New_York')").run();
 for(const [id,caps] of [['owner',['location.manage']],['worker',[]]])await db.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,active) VALUES(?,?,?,?,?,?,?,?,?,1)').bind(id,id+'@example.test',id+'-identity','a',id,'BOH','Cook',JSON.stringify(caps),'[]').run();
 const url='http://localhost/api/integrations/toast-day?locationId=a&businessDate=2000-02-29';
 for(const [id,status] of [[null,401],['worker',403],['owner',200]]){const r=await mf.dispatchFetch(url,{headers:id?{'oai-authenticated-user-id':id+'-identity','oai-authenticated-user-email':id+'@example.test'}:{}});assert.equal(r.status,status);const body=await r.json();if(id==='owner'){assert.equal(body.connection,'not-connected');assert.equal(body.orders.recordCount,null);assert.equal(body.labor.state,'unavailable');assert.equal(r.headers.get('Cache-Control'),'private, no-store');}}
 assert.equal((await mf.dispatchFetch(url,{method:'POST'})).status,405);assert.equal(outbound,0);
});
