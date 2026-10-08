import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const source=fs.readFileSync('app/team/food-transfer-parcels.tsx','utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from '(\.\.\/shared\/[^']+)'/g,"from '$1.mjs'");
fs.mkdirSync('.sites-runtime/team',{recursive:true});fs.writeFileSync('.sites-runtime/team/food-transfer-parcels.mjs',compiled);
const {TransferParcels,parcelLocalTimestamp}=await import('../.sites-runtime/team/food-transfer-parcels.mjs');
const stamp={by:'sender',byName:'Fictional sender',at:'2026-09-28T12:00:00Z'};
const parcel={id:'p',tripReference:'T-1',parcelReference:'P-1',quantity:2,departedAt:'2026-09-28T12:00:00Z',note:'Checked slip',recorded:stamp};
const base={id:'transfer',revision:2,sourceId:'a',destinationId:'b',dataset:'demo',status:'sent',dispatch:{quantity:4,item:{pack:{purchaseUnit:'bag'}}},receipt:null,parcels:[parcel]};
const w=(loc,who='sender',caps=['tasks.manage'])=>({location:{id:loc,timezone:'America/New_York'},me:{id:who,capabilities:caps}});
const render=(d=base,workspace=w('a'))=>renderToStaticMarkup(React.createElement(TransferParcels,{d,w:workspace,send:()=>{throw Error('Rendering cannot save')}}));

test('parcel interface separates transport arrival from usable receiving totals and shows only scoped actions',()=>{
 const source=render();assert.match(source,/Record a parcel departure/);assert.match(source,/Void incorrect parcel record/);assert.doesNotMatch(source,/Save parcel arrival/);assert.match(source,/do not change receiving totals/);assert.match(source,/2 bag of the dispatch have no parcel assignment/);
 const dest=render(base,w('b','receiver'));assert.match(dest,/Save parcel arrival/);assert.doesNotMatch(dest,/Save parcel departure|Void parcel record/);
 assert.doesNotMatch(render({...base,status:'voided'}),/<form/);
 assert.match(render({...base,parcels:[]}),/No trip or parcel records yet/);
 assert.match(source,/America\/New_York/);assert.match(source,/step="1"/);
});
test('parcel arrival disagreements need explicit receiving review and historical voids never count',()=>{
 const arrived={...parcel,arrival:{...stamp,by:'receiver',arrivedAt:'2026-09-28T13:00:00Z',note:'Unchecked quality'}};
 const d={...base,parcels:[arrived],receipt:{accepted:1,rejected:0,receivedAt:'2026-09-28T12:30:00Z'}};
 assert.match(render(d,w('b','receiver')),/Reconcile that check explicitly/);assert.match(render(d,w('b','receiver')),/Reopen incorrect arrival/);
 assert.doesNotMatch(render(d,w('b','other')),/Reopen incorrect arrival/);assert.match(render(d,w('b','reviewer',['orders.review'])),/Reopen incorrect arrival/);
 const voided=render({...base,parcels:[{...parcel,void:{...stamp,reason:'Wrong slip'}}]});assert.match(voided,/Voided record/);assert.match(voided,/4 bag of the dispatch have no parcel assignment/);
 const tiny=render({...base,parcels:[{...parcel,quantity:0.00000001}]});assert.match(tiny,/&lt;0.000001 bag/);
});
test('parcel timestamps use restaurant timezone, preserve seconds and reject missing or ambiguous clock time',()=>{
 assert.equal(parcelLocalTimestamp('2026-09-28','08:15:37','America/New_York'),'2026-09-28T12:15:37.000Z');
 assert.throws(()=>parcelLocalTimestamp('2026-03-08','02:30','America/New_York'),/does not exist/);
 assert.throws(()=>parcelLocalTimestamp('2026-11-01','01:30','America/New_York'),/twice/);
 assert.equal(parcelLocalTimestamp('2026-11-01','01:30:05','America/New_York','earlier'),'2026-11-01T05:30:05.000Z');
 assert.equal(parcelLocalTimestamp('2026-11-01','01:30:05','America/New_York','later'),'2026-11-01T06:30:05.000Z');
 assert.throws(()=>parcelLocalTimestamp('2026-09-28','08:15:99','America/New_York'),/valid/);
});
