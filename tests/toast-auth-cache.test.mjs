import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {cachedToastToken,ToastAuthWait} from '../.sites-runtime/shared/toast-auth-cache.mjs';
import {AppError} from '../.sites-runtime/shared/validation.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
const config={locationId:'fictional',host:'https://ws-api.toasttab.com',restaurantGuid:'11111111-1111-4111-8111-111111111111',clientId:'fictional-client',clientSecret:'fictional-secret'};
async function fixture(t){const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));return db}
test('Toast tokens survive independent requests encrypted at rest and refresh only near their real expiry',async t=>{
 const db=await fixture(t);let now=100000000,calls=0;const auth=async()=>{calls++;return {accessToken:'private-token-'+calls,expiresIn:86400}},read=()=>cachedToastToken(db,config,auth,()=>now);
 assert.equal(await read(),'private-token-1');const stored=await db.prepare('SELECT * FROM toast_auth_cache').first();assert.ok(!JSON.stringify(stored).includes('private-token'));assert.ok(!JSON.stringify(stored).includes('fictional-secret'));
 for(const elapsed of [60000,3600000,80000000]){now+=elapsed;assert.equal(await read(),'private-token-1')};assert.equal(calls,1);
 now=100000000+86400000;assert.equal(await read(),'private-token-2');assert.equal(calls,2);
 assert.equal(await cachedToastToken(db,{...config,clientSecret:'rotated-fictional-secret'},auth,()=>now),'private-token-3');
});
test('a concurrent request and an upstream 429 cannot repeatedly authenticate during the shared cooldown',async t=>{
 const db=await fixture(t);let now=100000000,calls=0,entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const auth=async()=>{calls++;entered();await gate;throw new AppError(429,'Rate limited')};
 const first=cachedToastToken(db,config,auth,()=>now);await started;
 try{await assert.rejects(cachedToastToken(db,config,auth,()=>now),ToastAuthWait);release();await assert.rejects(first,ToastAuthWait);await assert.rejects(cachedToastToken(db,config,auth,()=>now+60000),ToastAuthWait);assert.equal(calls,1)}finally{release()}
 now+=30*60000;assert.equal(await cachedToastToken(db,config,async()=>{calls++;return {accessToken:'recovered',expiresIn:3600}},()=>now),'recovered');assert.equal(calls,2);
});
test('tampered encrypted tokens are replaced, never returned, and a failed replacement retains its cooldown',async t=>{
 const db=await fixture(t);let calls=0;const auth=async()=>{calls++;return {accessToken:'good',expiresIn:3600}};
 await cachedToastToken(db,config,auth,()=>100000000);await db.prepare("UPDATE toast_auth_cache SET encrypted_token='invalid.ciphertext'").run();
 assert.equal(await cachedToastToken(db,config,auth,()=>100060000),'good');assert.equal(calls,2);
 await db.prepare("UPDATE toast_auth_cache SET encrypted_token='invalid.ciphertext'").run();
 const rejected=async()=>{calls++;throw new AppError(429,'Rate limited')};
 await assert.rejects(cachedToastToken(db,config,rejected,()=>100120000),ToastAuthWait);
 await assert.rejects(cachedToastToken(db,config,auth,()=>100180000),ToastAuthWait);assert.equal(calls,3);
 assert.equal(await cachedToastToken(db,config,auth,()=>101920000),'good');assert.equal(calls,4);
});

test('successful short-lived tokens refresh at expiry without retaining a thirty-minute failure cooldown',async t=>{
 const db=await fixture(t);let now=100000000,calls=0;
 const auth=async()=>({accessToken:'short-'+(++calls),expiresIn:300}),read=()=>cachedToastToken(db,config,auth,()=>now);
 assert.equal(await read(),'short-1');assert.equal((await db.prepare('SELECT retry_at FROM toast_auth_cache').first()).retry_at,0);
 now+=240000;assert.equal(await read(),'short-1');assert.equal(calls,1);
 now+=60000;assert.equal(await read(),'short-2');assert.equal(calls,2);
});
