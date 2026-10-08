import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {transferLocalTimestamp,transferFormTimestamp} from '../.sites-runtime/shared/food-transfer-time.mjs';
// Compile the real component graph, without replacing child components with mocks.
fs.mkdirSync('.sites-runtime/team',{recursive:true});
const seen=new Set();
function compile(name){
 if(seen.has(name))return;seen.add(name);
 const source=fs.readFileSync('app/team/'+name+'.tsx','utf8');
 const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 for(const match of output.matchAll(/from ['"]\.\/([^'"]+)['"]/g))compile(match[1]);
 fs.writeFileSync('.sites-runtime/team/'+name+'.mjs',output.replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g,"from '$2.mjs'"));
}
compile('food-transfers');
const {TransferReceiptForm}=await import('../.sites-runtime/team/food-transfers.mjs');
const {TransferTimeFields}=await import('../.sites-runtime/team/food-transfer-parcels.mjs');
const {ReceiptUnitFacts}=await import('../.sites-runtime/team/food-transfer-receipt-units.mjs');
const stamp=(date,time,zone,occurrence='')=>{const f=new FormData();for(const [k,v] of Object.entries({date,time,occurrence}))f.set(k,v);return transferFormTimestamp(f,zone)};
test('destination entry is available only with a current checked pack and never defaults confirmation',()=>{
 const d={id:'t',dispatch:{quantity:4,item:{pack:{purchaseUnit:'bag'}}},receipt:{accepted:1,rejected:0,missing:0,complete:false},destinationMatch:{item:{pack:{purchaseUnit:'tub'}}}};
 const render=review=>renderToStaticMarkup(React.createElement(TransferReceiptForm,{d,review,zone:'America/New_York',send:()=>{throw Error('render cannot save')}}));
 const html=render('current');assert.match(html,/Receiving quantity units/);assert.match(html,/value="dispatch" selected=""/);assert.match(html,/Checked destination units — tub/);assert.match(html,/Total accepted bag/);assert.match(html,/name="accepted"[^>]*value="1"/);assert.doesNotMatch(html,/checked=""/);assert.match(html,/button disabled=""/);
 for(const review of ['changed','unavailable','unmatched',undefined]){const other=render(review);assert.doesNotMatch(other,/Receiving quantity units/);assert.match(other,/Use original dispatch units/);assert.match(other,/Total accepted bag/)}
});
test('retained quantity evidence renders the saved pack, exact item revision and entered counts safely',()=>{
 const receipt={accepted:2,rejected:1,missing:1,quantitySource:{basis:'destination',accepted:5,rejected:2.5,missing:2.5,destinationUnitsPerDispatchUnit:2.5,item:{title:'Fictional <flour>',controlNumber:'FLOUR',revision:3,pack:{purchaseUnit:'tub',packCount:1,unitQty:10,unitUOM:'lb'}}}};
 const html=renderToStaticMarkup(React.createElement(ReceiptUnitFacts,{receipt}));assert.match(html,/5 accepted, 2.5 rejected, 2.5 missing tub/);assert.match(html,/item revision 3/);assert.match(html,/1 × 10 lb/);assert.match(html,/One original dispatch unit = 2.5 tub/);assert.match(html,/Fictional &lt;flour&gt;/);assert.match(html,/even if the catalog match changes/);
 assert.equal(renderToStaticMarkup(React.createElement(ReceiptUnitFacts,{receipt:{accepted:2,rejected:1,missing:1}})),'');
});
test('transfer entry crosses UTC midnight correctly in each restaurant and ignores device timezone',()=>{
 const original=process.env.TZ;
 try{for(const device of ['UTC','America/Los_Angeles','Asia/Tokyo']){
  process.env.TZ=device;
  assert.equal(stamp('2026-09-28','23:59:47','America/Chicago'),'2026-09-29T04:59:47.000Z');
  assert.equal(stamp('2026-09-29','00:10:03','America/New_York'),'2026-09-29T04:10:03.000Z');
  assert.equal(stamp('2026-09-29','00:10','Asia/Kathmandu'),'2026-09-28T18:25:00.000Z');
 }}finally{if(original===undefined)delete process.env.TZ;else process.env.TZ=original;}
});
test('transfer entry rejects missing, impossible dates and skipped restaurant times',()=>{
 for(const [date,time] of [['',''],['2026-02-30','12:00'],['2026-09-28','24:01'],['2026-09-28','12:15:60'],['2026-09-28','12:15:01.2'],['2026-03-08','02:30']])assert.throws(()=>stamp(date,time,'America/Chicago'));
});
test('a repeated restaurant hour requires an explicit occurrence and preserves seconds',()=>{
 assert.throws(()=>stamp('2026-11-01','01:30:07','America/Chicago'),/twice/);
 assert.equal(stamp('2026-11-01','01:30:07','America/Chicago','earlier'),'2026-11-01T06:30:07.000Z');
 assert.equal(stamp('2026-11-01','01:30:07','America/Chicago','later'),'2026-11-01T07:30:07.000Z');
 assert.equal(transferLocalTimestamp('2026-09-28','12:00','UTC'),'2026-09-28T12:00:00.000Z');
});
test('clock defaults follow restaurant date across device day boundary and expose seconds and occurrence',()=>{
 const RealDate=Date;
 globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2026-09-29T04:05:37.000Z']))}static now(){return RealDate.parse('2026-09-29T04:05:37.000Z')}};
 try{
  const html=renderToStaticMarkup(React.createElement(TransferTimeFields,{zone:'America/Chicago',label:'Dispatch'}));
  assert.match(html,/Dispatch date \(America\/Chicago\)/);assert.match(html,/value="2026-09-28"/);assert.match(html,/value="23:05:37"/);assert.match(html,/step="1"/);assert.match(html,/First occurrence/);assert.match(html,/Second occurrence/);assert.doesNotMatch(html,/datetime-local/);
 }finally{globalThis.Date=RealDate;}
});
test('first, progress and correction receipt forms use the destination clock and retain cumulative quantities',()=>{
 const d={id:'t',dispatch:{quantity:4,item:{pack:{purchaseUnit:'case'}}},receipt:null};
 const render=(transfer,correction=false)=>renderToStaticMarkup(React.createElement(TransferReceiptForm,{d:transfer,zone:'America/Chicago',correction,send:()=>{throw Error('render cannot save')}}));
 for(const html of [render(d),render({...d,receipt:{accepted:1,rejected:1,missing:0,complete:false}}),render({...d,receipt:{accepted:3,rejected:0,missing:1,complete:true}},true)]){
  assert.match(html,/Delivery check date \(America\/Chicago\)/);assert.match(html,/Delivery check time/);assert.match(html,/cumulative totals/);assert.doesNotMatch(html,/datetime-local|Local delivery check time/);
 }
 assert.match(render({...d,receipt:{accepted:3,rejected:0,missing:1}},true),/Correction reason/);
});
