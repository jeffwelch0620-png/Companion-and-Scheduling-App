import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
const output=ts.transpileModule(fs.readFileSync('app/team/food-transfer-dates.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from '([^']+)'/g,(all,name)=>name.startsWith('.')?`from '${name}.mjs'`:all);fs.mkdirSync('.sites-runtime/team',{recursive:true});fs.writeFileSync('.sites-runtime/team/food-transfer-dates.mjs',output);
const {TransferDateFilter,TransferWindowNote}=await import('../.sites-runtime/team/food-transfer-dates.mjs');
test('date controls expose apply/today/all and distinguish dispatch from arrival dates',()=>{
 const html=renderToStaticMarkup(React.createElement(TransferDateFilter,{applied:{from:'2026-09-28',through:'2026-09-29'},zone:'America/Chicago',onApply(){throw Error('render may not apply')}}));
 assert.match(html,/America\/Chicago/);assert.match(html,/original dispatch, not later parcel arrivals/);assert.match(html,/value="2026-09-28"/);assert.match(html,/value="2026-09-29"/);for(const label of ['Apply dispatch dates','Dispatched today','All dispatch dates'])assert.ok(html.includes(label));
});
test('applied scope discloses full-range counts across statuses and preserves all-dates default',()=>{
 const render=window=>renderToStaticMarkup(React.createElement(TransferWindowNote,{window}));
 assert.match(render({from:'2026-09-28',through:'2026-09-29',timezone:'America/Chicago'}),/2026-09-28 through 2026-09-29/);
 assert.match(render({from:'',through:'',timezone:'America/Chicago'}),/all dates/);assert.match(render({from:'',through:'',timezone:'America/Chicago'}),/across all pages and statuses/);
});
