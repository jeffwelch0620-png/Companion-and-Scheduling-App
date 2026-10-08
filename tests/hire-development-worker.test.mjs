import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {Miniflare} from 'miniflare';
import {seedManagerFixture} from './manager-log-fixture.mjs';import {seedHireDevelopmentFixture} from './hire-development-fixture.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
test('compiled hire review reads current and filed GM history through existing permissions without releasing private content',async t=>{
 let outbound=0;const mf=new Miniflare({modules:true,scriptPath:path.resolve('dist/server/index.js'),modulesRoot:path.resolve('dist/server'),modulesRules:[{type:'ESModule',include:['**/*.js']}],compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],serviceBindings:{ASSETS:()=>new Response('Missing',{status:404})},outboundService:()=>{outbound++;throw Error('No outbound')}});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 await seedManagerFixture(db);await seedHireDevelopmentFixture(db);
 const headers=who=>({'oai-authenticated-user-id':who+'-fixture','oai-authenticated-user-email':who+'@example.test'}),get=async(who,loc='rudds')=>{const r=await mf.dispatchFetch('http://localhost/api/people/hire-review?locationId='+loc+'&employeeId=demo-review-hire',{headers:headers(who)});return {status:r.status,data:await r.json()}};
 let r=await get('admin');assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.schemaVersion,'jmax-hire-review.v2');assert.equal(r.data.development.length,2);assert.equal(r.data.development[0].phase,'gm-review');assert.equal(r.data.development[0].lastDecision.outcome,'returned');assert.equal(r.data.development[1].archived,true);assert.equal(r.data.development[1].approvalRecorded,true);assert.equal(r.data.development[1].guideStatus.unavailable,1);assert.equal(r.data.development[1].guideStatus.manual,1);assert.doesNotMatch(JSON.stringify(r.data),/Fictional private|example.test|identity|selfScore|managerScore|approvalNote/);
 assert.equal((await get('boh')).data.development.length,2);assert.equal((await get('otherowner')).data.development.length,0);
 for(const who of ['foh','worker'])assert.equal((await get(who)).status,403);
 for(const loc of ['berts','papa'])assert.equal((await get('admin',loc)).status,403);
 await db.prepare("UPDATE memberships SET capabilities='[\"location.manage\"]',revision=revision+1 WHERE id='demo-owner-rudds'").run();r=await get('admin');assert.equal(r.data.development.length,0);
 r=await get('boh');assert.equal(r.data.development[1].approvalRecorded,true);assert.equal(r.data.development[1].approver.available,false);
 const rows=await db.prepare("SELECT data FROM records WHERE kind='development'").all();assert.equal(rows.results.length,2);assert.equal(JSON.parse(rows.results[1].data).stations[0].managerScore,5);assert.equal(outbound,0);
});

