import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {handleOwnerReview,seedOwnerReview} from '../.sites-runtime/shared/owner-review.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
const config={JMAX_REVIEW_OWNER_EMAIL:'owner@example.test'};
async function fixture(t){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 const call=async(role,route='workspace',body,options={})=>{const r=await handleOwnerReview(new Request('https://test.example/api/review/'+role+'/'+route,{method:body?'POST':'GET',headers:{...(options.email===null?{}:{'oai-authenticated-user-email':options.email??'owner@example.test'}),Origin:options.origin??'https://test.example','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),db,options.config??config);return {status:r.status,data:await r.json()}};
 return {db,call};
}
function ok(r){assert.equal(r.status,200,JSON.stringify(r.data));return r.data}
const command=(action,input,record)=>({requestId:crypto.randomUUID(),locationId:'owner-review',action,input,...(record?{recordId:record.id,expectedRevision:record.revision}:{})});
test('owner review requires the configured signed-in owner and refuses real-restaurant routing or external actions',async t=>{
 const f=await fixture(t);
 assert.equal((await f.call('manager','workspace',undefined,{config:{}})).status,404);
 assert.equal((await f.call('manager','workspace',undefined,{email:null})).status,401);
 assert.equal((await f.call('manager','workspace',undefined,{email:'stranger@example.test'})).status,403);
 assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM locations').first()).n,0);
 assert.equal((await f.call('admin','access?locationId=real')).status,403);
 assert.equal((await f.call('admin','reminders?locationId=real',{action:'run',locationId:'owner-review'})).status,403);
 assert.equal((await f.call('admin','workspace',command('message.send',{}),{origin:'https://other.example'})).status,403);
 assert.equal((await f.call('admin','integrations/toast',{locationId:'owner-review'})).status,400);
 assert.equal((await f.call('admin','access',command('review.save',{profile:{email:'real@restaurant.example'}}))).status,400);
});
test('simultaneous review initialization is durable and employee, manager, Dish and setup use the real scoped services',async t=>{
 const f=await fixture(t);await Promise.all([seedOwnerReview(f.db),seedOwnerReview(f.db)]);
 assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM memberships').first()).n,8);
 const before=(await f.db.prepare('SELECT COUNT(*) AS n FROM records').first()).n;await seedOwnerReview(f.db);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM records').first()).n,before);
 const manager=ok(await f.call('manager','workspace?locationId=owner-review')),employee=ok(await f.call('employee','workspace?locationId=owner-review')),dish=ok(await f.call('dish','workspace?locationId=owner-review'));
 assert.equal(manager.records.filter(r=>r.kind==='shift').length,3);assert.equal(employee.records.filter(r=>r.kind==='shift').length,1);assert.equal(dish.records.some(r=>['close','development','task'].includes(r.kind)),false);
 const close=employee.records.find(r=>r.kind==='close');ok(await f.call('employee','workspace',command('close.transition',{step:'ready',note:'Sample ready',answers:[0,1]},close)));
 assert.equal(ok(await f.call('senior','workspace?locationId=owner-review')).records.find(r=>r.id===close.id).data.phase,'verification');
 const access=ok(await f.call('admin','access?locationId=owner-review'));assert.equal(access.accounts.length,8);assert.equal(access.roster.employees.length,2);
 assert.equal((await f.call('employee','access?locationId=owner-review')).status,403);
 assert.equal(ok(await f.call('admin','integrations/toast?locationId=owner-review')).configured,false);
 assert.equal(ok(await f.call('admin','reminders?locationId=owner-review',{action:'run'})).delivered,2);
});
