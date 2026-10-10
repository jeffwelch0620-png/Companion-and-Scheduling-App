import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {copiedUiPaths,uiSourceFingerprint,verifyUiSourceBaseline} from './ui-source-baseline.mjs';
const path='app/shared/domain.ts',read=path=>readFile(new URL('../../'+path,import.meta.url),'utf8');
test('UI baseline covers only the three copied components and checkout function body',async()=>{
 await verifyUiSourceBaseline();const baseline=JSON.parse(await readFile(new URL('./ui-source-baseline.json',import.meta.url),'utf8'));
 assert.deepEqual(Object.keys(baseline).sort(),[...copiedUiPaths,path].sort());assert.equal(baseline[path].function,'dishCheckoutCycleStatus');
});
test('unrelated domain implementations and surrounding comments do not block the copy gate',async()=>{
 const source=await read(path),changed='// function dishCheckoutCycleStatus is mentioned here\nexport function unrelatedProbe(){return 2;}\n'+source+'\nexport const unrelatedValue=3;\n';
 assert.equal(uiSourceFingerprint(path,changed),uiSourceFingerprint(path,source));await verifyUiSourceBaseline({readSource:p=>p===path?changed:read(p)});
});
test('checkout projection changes block CI until the copy and baseline are reconciled together',async()=>{
 const source=await read(path),changed=source.replace('const checkouts=w.records.filter','const checkouts=w.records.slice().filter');assert.notEqual(changed,source);
 assert.notEqual(uiSourceFingerprint(path,changed),uiSourceFingerprint(path,source));await assert.rejects(verifyUiSourceBaseline({readSource:p=>p===path?changed:read(p)}),/Reconcile the copy.*same PR/);
});
test('every copied component change still blocks the source gate',async()=>{
 for(const path of copiedUiPaths)await assert.rejects(verifyUiSourceBaseline({readSource:async p=>(await read(p))+(p===path?'\n// changed copied component\n':'')}),/out of date/);
});
test('missing, duplicate or bodyless projection definitions fail closed',()=>{
 for(const source of ['export function unrelated(){}','export function dishCheckoutCycleStatus(){};export function dishCheckoutCycleStatus(){}','export declare function dishCheckoutCycleStatus():void;'])assert.throws(()=>uiSourceFingerprint(path,source),/Expected one/);
});
test('fingerprints normalize line endings and reject unexpected baseline targets',async()=>{
 const source=await read(path);assert.equal(uiSourceFingerprint(path,source.replace(/\r?\n/g,'\r\n')),uiSourceFingerprint(path,source));
 assert.throws(()=>uiSourceFingerprint('app/shared/other.ts',source),/Invalid/);await assert.rejects(verifyUiSourceBaseline({baseline:{}}),/only three/);
});
