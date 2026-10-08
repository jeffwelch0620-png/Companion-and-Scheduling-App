import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
test('compiled hire review reflects a real fixture setup-code sign-in and keeps employee access private',async t=>{
 let outbound=0;const mf=new Miniflare({modules:true,scriptPath:path.resolve('dist/server/index.js'),modulesRoot:path.resolve('dist/server'),modulesRules:[{type:'ESModule',include:['**/*.js']}],compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{JMAX_LOGIN_SECRET:'a'.repeat(64)},serviceBindings:{ASSETS:()=>new Response('Missing',{status:404})},outboundService:()=>{outbound++;throw Error('No outbound expected')}});t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB');for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+f,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const id of ['a','b'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(id,'Fictional '+id,'America/New_York').run();
 for(const [id,area,caps,loc='a'] of [['owner','Executive',['location.manage']],['people','BOH',['people.manage']],['hire','BOH',[]],['foreign','BOH',['location.manage'],'b']])await db.prepare("INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,active,employment) VALUES(?,?,?,?,?,?,'Line Cook',?,'[]',1,?)").bind(id,id+'@example.test',id+'-identity',loc,'Fictional '+id,area,JSON.stringify(caps),JSON.stringify(id==='hire'?{hireDate:'2026-09-01',status:'active'}:{})).run();
 const headers=id=>({'oai-authenticated-user-id':id+'-identity','oai-authenticated-user-email':id+'@example.test'}),url='http://localhost/api/people/hire-review?locationId=a&employeeId=hire';
 const get=async(id,extra={})=>{const r=await mf.dispatchFetch(url,{headers:{...headers(id),...extra}});return {status:r.status,data:await r.json()}};
 let r=await get('owner');assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.signIn.lastSignedInAt,null);
 const login=body=>mf.dispatchFetch('http://localhost/api/employee-login',{method:'POST',headers:{...headers('owner'),Origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify(body)});
 const issued=await login({action:'issue',locationId:'a',memberId:'hire',expectedRevision:1});assert.equal(issued.status,200);const signed=await login({action:'verify',code:(await issued.json()).code});assert.equal(signed.status,200);const cookie=signed.headers.get('Set-Cookie').split(';')[0];
 r=await get('owner');assert.equal(r.status,200);assert.ok(r.data.signIn.lastSignedInAt);assert.equal(r.data.employee.active,true);assert.equal((await get('people')).data.signIn.lastSignedInAt,null);assert.equal((await get('foreign')).status,403);assert.equal((await get('owner',{Cookie:cookie})).status,403);
 await db.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='hire'").run();r=await get('owner');assert.equal(r.data.employee.active,false);assert.ok(r.data.signIn.lastSignedInAt,'historical successful sign-in remains separate from current access');assert.equal((await get('owner',{Cookie:cookie})).status,401);assert.equal(outbound,0);
});
