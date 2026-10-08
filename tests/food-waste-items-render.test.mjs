import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
fs.mkdirSync('.sites-runtime/waste-items-team',{recursive:true});
const source=fs.readFileSync('app/team/food-waste-items.tsx','utf8'),code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;fs.writeFileSync('.sites-runtime/waste-items-team/food-waste-items.mjs',code);
const {FoodWasteItems,WasteItemFacts}=await import('../.sites-runtime/waste-items-team/food-waste-items.mjs');
const base={title:'Fictional <flour>',controlNumber:'FLOUR',storageArea:'Prep',nameBasis:'entry snapshot',pack:{purchaseUnit:'bag',packCount:1,unitQty:25,unitUOM:'lb'},activeQuantity:0.25,entries:3,active:2,voided:1,costed:1,uncosted:1,knownEstimatedCents:0};
const render=g=>renderToStaticMarkup(React.createElement(WasteItemFacts,{group:g}));
test('group cards preserve original units, real zero and incomplete costs without implying stock changes',()=>{
 const html=render(base);assert.match(html,/Fictional &lt;flour&gt;/);assert.match(html,/0.25 bag/);assert.match(html,/1 × 25 lb \/ bag/);assert.match(html,/\$0.00/);assert.match(html,/subtotal is incomplete/);assert.match(html,/1 voided/);assert.doesNotMatch(html,/current catalog name/);
});
test('legacy, no-cost, tiny quantities and overflow remain explicit',()=>{
 assert.match(render({...base,nameBasis:'current catalog fallback',costed:0,knownEstimatedCents:0}),/current catalog name/);assert.match(render({...base,costed:0}),/No costed total/);assert.match(render({...base,activeQuantity:0.00000001}),/&lt;0.000001 bag/);const html=render({...base,activeQuantity:null,knownEstimatedCents:null});assert.match(html,/combined cost exceeds/);assert.match(html,/combined quantity exceeds/);
});
test('item view explains ranking and grouping boundaries before loading',()=>{
 const html=renderToStaticMarkup(React.createElement(FoodWasteItems,{w:{location:{id:'a'}},apiRoot:'/api',dataset:'demo',page:{from:'2026-09-28',through:'2026-09-28',revision:1}}));assert.match(html,/Largest known ingredient-cost subtotals first/);assert.match(html,/Missing costs can change that order/);assert.match(html,/changed packs and unlike units stay separate/);assert.match(html,/not proof of all waste or booked expenses/);assert.match(html,/Loading waste by item/);
});
