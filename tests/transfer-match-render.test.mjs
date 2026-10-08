import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const source=fs.readFileSync('app/team/food-transfer-match.tsx','utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from '(\.\.\/shared\/[^']+)'/g,"from '$1.mjs'");
fs.mkdirSync('.sites-runtime/team',{recursive:true});fs.writeFileSync('.sites-runtime/team/food-transfer-match.mjs',compiled);
const {TransferDestinationMatch}=await import('../.sites-runtime/team/food-transfer-match.mjs');
const pack={purchaseUnit:'tub',packCount:1,unitQty:10,unitUOM:'lb'};
const match={item:{id:'destination',revision:2,title:'Fictional destination flour',controlNumber:'DEST-FLOUR',pack},destinationUnitsPerDispatchUnit:2.5,reason:'Checked fixture',at:'2026-09-28T12:00:00Z',by:'reviewer',byName:'Fictional reviewer'};
const base={id:'transfer',revision:2,sourceId:'a',destinationId:'b',dataset:'demo',status:'sent',dispatch:{quantity:4,item:{pack:{...pack,purchaseUnit:'bag',unitQty:25}}},receipt:{accepted:1,rejected:0,missing:0,complete:false},destinationMatch:match};
const workspace=(loc,caps)=>({location:{id:loc,timezone:'America/New_York'},me:{capabilities:caps}});
const render=(d=base,w=workspace('b',['orders.review']),review='current')=>renderToStaticMarkup(React.createElement(TransferDestinationMatch,{d,w,review,apiRoot:'/api',send:()=>{throw new Error('Rendering must not save');}}));
test('transfer match view shows saved units, cumulative conversion and pending without implying inventory',()=>{
 const html=render();assert.match(html,/Fictional destination flour/);assert.match(html,/accepted 2.5, rejected 0, pending 7.5 tub/);assert.match(html,/not a physical stock count/);assert.match(html,/Review or change destination item/);
 const final=render({...base,status:'received',receipt:{accepted:2,rejected:1,missing:1,complete:true}});assert.match(final,/accepted 5, rejected 2.5, missing 2.5 tub/);assert.doesNotMatch(final,/pending 7.5/);
});
test('source and destination non-reviewers can read a saved match but cannot open match or clear controls',()=>{
 for(const w of [workspace('a',['location.manage']),workspace('b',['tasks.manage'])]){const html=render(base,w);assert.match(html,/Fictional destination flour/);assert.doesNotMatch(html,/Review or change destination item|Clear an incorrect item match/);}
 assert.doesNotMatch(render({...base,status:'voided'}),/Review or change destination item|Clear an incorrect item match/);
});
test('missing and outdated matches remain explicit and small positive conversions are not shown as zero',()=>{
 assert.match(render({...base,destinationMatch:null},undefined,'unmatched'),/No destination catalog item has been matched/);
 for(const state of ['changed','unavailable',undefined])assert.match(render(base,undefined,state),state===undefined?/Fictional destination flour/:/saved match is historical/);
 const tiny=render({...base,destinationMatch:{...match,destinationUnitsPerDispatchUnit:1e-8}});assert.match(tiny,/accepted &lt;0.000001/);assert.doesNotMatch(tiny,/accepted 0,/);
});
