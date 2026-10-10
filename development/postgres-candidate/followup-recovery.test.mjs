import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';import {createRequire} from 'node:module';import {compileFunction} from 'node:vm';
import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {transform} from 'esbuild';
import {indexedDB} from 'fake-indexeddb';
import {generateKeyPair,exportJWK,createLocalJWKSet,createRemoteJWKSet,customFetch,SignJWT,errors} from 'jose';
import {IndexedDbQueueStorage,OfflineTaskQueue} from './offline-task-queue.mjs';
import {retainReady,employeeRecordCacheKey,clearCachedEmployee} from './checkout-queue-client.mjs';
import {isSubmissionConflict} from './submission-recovery-policy.mjs';
import {makeJwtVerifier,withKeyRotationGrace} from './task-http.ts';
const ready=()=>({requestId:randomUUID(),recordId:randomUUID(),expectedRevision:1,locationId:'fictional-a',action:'task.transition',input:{step:'ready',note:'Fictional checked work'}});
function queues(t){
 const name='followup-'+randomUUID(),a=new IndexedDbQueueStorage(name,indexedDB),b=new IndexedDbQueueStorage(name,indexedDB);
 t.after(async()=>{await a.close();await b.close();});
 return [a,b].map(storage=>new OfflineTaskQueue(storage,{maxAgeMs:86400000}));
}
test('two independent tabs cannot retain different request IDs for the same employee work',async t=>{
 const [a,b]=queues(t),first=ready(),second={...first,requestId:randomUUID()};
 const results=await Promise.allSettled([retainReady(a,'employee','fictional-a',first),retainReady(b,'employee','fictional-a',second)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.match(results.find(r=>r.status==='rejected').reason.message,/already has a saved submission/);
 const entries=await a.list('employee','fictional-a');assert.equal(entries.length,1);
 const saved=entries[0];assert.deepEqual(await b.enqueue('employee','fictional-a',saved.command),saved);
 await assert.rejects(b.enqueue('employee','fictional-a',{...saved.command,input:{...saved.command.input,note:'Changed'}}),/request_payload_conflict/);
});
test('record-level retention releases after discard or confirmed apply and preserves employee/scope partitions',async t=>{
 const [a,b]=queues(t),c=ready();await a.enqueue('employee','fictional-a',c);
 await b.enqueue('other','fictional-a',{...c,requestId:randomUUID()});
 await b.enqueue('employee','fictional-b',{...c,requestId:randomUUID(),locationId:'fictional-b'});
 await a.discard('employee','fictional-a',c.requestId);const next={...c,requestId:randomUUID()};await b.enqueue('employee','fictional-a',next);
 await a.flush('employee','fictional-a',async()=>({status:200,body:{requestId:next.requestId,recordId:c.recordId,revision:2,workspaceRevision:1,appliedAt:new Date().toISOString(),replayed:false}}));
 await b.enqueue('employee','fictional-a',{...c,requestId:randomUUID(),expectedRevision:2});
 assert.equal((await a.list('employee','fictional-a')).length,2);
 assert.equal((await a.list('other','fictional-a')).length,1);assert.equal((await a.list('employee','fictional-b')).length,1);
});
test('confirmed and legacy conflicts cannot retry unchanged intent; blocked/auth/age outcomes can',async t=>{
 const [q]=queues(t);
 for(const code of ['revision_conflict','record_changed','new_conflict']){
  const c=ready();await q.enqueue('employee','fictional-a',c);
  const [entry]=(await q.flush('employee','fictional-a',async()=>({status:409,body:{error:{code}}}))).filter(e=>e.requestId===c.requestId);
  assert.equal(entry.responseStatus,409);assert.ok(isSubmissionConflict(entry));
  await assert.rejects(q.retry('employee','fictional-a',c.requestId),/saved_submission_conflict/);
  assert.deepEqual((await q.list('employee','fictional-a')).find(e=>e.requestId===c.requestId).command,c);
  await q.discard('employee','fictional-a',c.requestId);
 }
 assert.ok(isSubmissionConflict({status:'needs_review',error:'revision_conflict'}));
 for(const status of [401,403]){
  const c=ready();await q.enqueue('employee','fictional-a',c);await q.flush('employee','fictional-a',async()=>({status}));
  assert.deepEqual((await q.retry('employee','fictional-a',c.requestId)).command,c);await q.discard('employee','fictional-a',c.requestId);
 }
 const c=ready();await q.enqueue('employee','fictional-a',c);
 await q.storage.mutate(JSON.stringify(['employee','fictional-a',c.requestId]),entry=>({entry:{...entry,status:'needs_review',error:'queue_age_exceeded'},value:null}));
 assert.deepEqual((await q.retry('employee','fictional-a',c.requestId)).command,c);
});
test('rendered recovery controls offer discard-and-redo for conflicts and retry for recoverable holds',async()=>{
 const source=await readFile(new URL('saved-submission-review.jsx',import.meta.url),'utf8');
 const built=await transform(source,{loader:'jsx',format:'cjs'}),module={exports:{}};
 compileFunction(built.code,['require','module','exports'])(createRequire(new URL('saved-submission-review.jsx',import.meta.url)),module,module.exports);
 const render=entry=>renderToStaticMarkup(React.createElement(module.exports.SavedSubmissionReview,{entries:[{...entry,requestId:randomUUID(),createdAt:0,attempts:1,command:ready()}],busy:false,onRetry(){},onDiscard(){},onClear(){}}));
 for(const error of ['revision_conflict','record_changed']){
  const html=render({status:'needs_review',error});assert.ok(!html.includes('Retry original submission'));assert.ok(html.includes('Discard and redo'));assert.ok(html.includes('reload the current assignment'));
 }
 for(const entry of [{status:'needs_review',error:'queue_age_exceeded'},{status:'blocked',error:'access_denied'},{status:'needs_auth',error:'authentication_required'}])
  assert.ok(render(entry).includes('Retry original submission'));
});
test('cache creation and cleanup share escaped identities without removing another employee or malformed data',()=>{
 const prefix='p:',actor='employee:one',key=employeeRecordCacheKey('close:old',actor,'dish:one');
 const values=new Map([[prefix+key,1],[prefix+key+':selected',2],[prefix+employeeRecordCacheKey('close:old','employee:two','dish:one'),3],[prefix+'records:old:%ZZ:close',4],['unrelated',5]]);
 const storage={get length(){return values.size;},key:i=>[...values.keys()][i],removeItem:key=>values.delete(key)};
 clearCachedEmployee(storage,prefix,actor);assert.equal(values.size,3);assert.ok(values.has(prefix+employeeRecordCacheKey('close:old','employee:two','dish:one')));assert.ok(values.has(prefix+'records:old:%ZZ:close'));
});

const issuer='https://fictional.invalid/auth/v1';
async function token(privateKey,kid){return new SignJWT({role:'authenticated',session_id:randomUUID()}).setSubject('fictional-employee').setIssuer(issuer).setAudience('authenticated').setIssuedAt().setExpirationTime('2m').setProtectedHeader({alg:'ES256',kid}).sign(privateKey);}
test('unexpected verifier key/configuration failures stay 503 while invalid signatures stay 401',async()=>{
 const pair=await generateKeyPair('ES256'),signed=await token(pair.privateKey,'fictional-one');
 for(const getKey of [async()=>({}),async()=>{throw null;},async()=>{throw new Error('Fictional private configuration');}]){
  const verifier=makeJwtVerifier({issuer,audience:'authenticated',getKey});
  await assert.rejects(verifier(signed),e=>e.status===503&&e.code==='authentication_service_unavailable'&&!e.message.includes('private'));
 }
 const other=await generateKeyPair('ES256'),jwk=await exportJWK(other.publicKey);jwk.kid='fictional-one';
 await assert.rejects(makeJwtVerifier({issuer,audience:'authenticated',getKey:createLocalJWKSet({keys:[jwk]})})(signed),e=>e.status===401);
});
test('remote key rotation recovers after native cooldown; an unknown key has a bounded grace then 401',async()=>{
 const a=await generateKeyPair('ES256'),b=await generateKeyPair('ES256'),ja=await exportJWK(a.publicKey),jb=await exportJWK(b.publicKey);ja.kid='old';jb.kid='new';
 const old=await token(a.privateKey,'old'),rotated=await token(b.privateKey,'new'),invalid=await token(a.privateKey,'unknown');
 let published=[ja],fetches=0,now=1000;
 const remote=createRemoteJWKSet(new URL('https://fictional.invalid/jwks'),{cooldownDuration:200,[customFetch]:async()=>{fetches++;return new Response(JSON.stringify({keys:published}));}});
 const verifier=makeJwtVerifier({issuer,audience:'authenticated',getKey:withKeyRotationGrace(remote,{cooldownMs:200,now:()=>now})});
 assert.equal((await verifier(old)).subject,'fictional-employee');published=[jb];
 await assert.rejects(verifier(rotated),e=>e.status===503);assert.equal(fetches,1);
 await new Promise(resolve=>setTimeout(resolve,250));now+=250;
 assert.equal((await verifier(rotated)).subject,'fictional-employee');assert.equal(fetches,2);
 await assert.rejects(verifier(invalid),e=>e.status===503);now+=201;
 await assert.rejects(verifier(invalid),e=>e.status===401);assert.equal(fetches,2);
});
test('unknown-key grace is bounded in memory and never overrides transport failures',async()=>{
 let now=0;const lookup=withKeyRotationGrace(async()=>{throw new errors.JWKSNoMatchingKey();},{cooldownMs:10,maxUnknownKeys:1,now:()=>now});
 await assert.rejects(lookup({alg:'ES256',kid:'one'},{}),e=>e.status===503);
 await assert.rejects(lookup({alg:'ES256',kid:'two'},{}),e=>e.code==='ERR_JWKS_NO_MATCHING_KEY');
 now=11;await assert.rejects(lookup({alg:'ES256',kid:'one'},{}),e=>e.code==='ERR_JWKS_NO_MATCHING_KEY');
 await assert.rejects(lookup({alg:'ES256',kid:'two'},{}),e=>e.status===503);
 const down=withKeyRotationGrace(async()=>{throw new errors.JWKSTimeout();});await assert.rejects(down({alg:'ES256',kid:'one'},{}),e=>e.code==='ERR_JWKS_TIMEOUT');
});
