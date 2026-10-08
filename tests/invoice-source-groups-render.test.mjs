import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import fs from 'node:fs';
import ts from 'typescript';
import {invoiceSourceGroups} from '../.sites-runtime/shared/invoice-source-groups.mjs';
fs.mkdirSync('.sites-runtime/invoice-source-render',{recursive:true});
fs.writeFileSync('.sites-runtime/invoice-source-render/view.mjs',ts.transpileModule(fs.readFileSync('app/team/invoice-source-groups.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText);
const {InvoiceSourceSummary}=await import('../.sites-runtime/invoice-source-render/view.mjs');
const row=(n,date='2026-09-29')=>({row:{recordNumber:n,vendor:'Fixture <script> supplier',invoiceNumber:'INV & 001',invoiceDate:date,lineTotal:'10.00'},saved:{state:'not-recorded'},status:'ready'});
const render=(groups,patch={})=>renderToStaticMarkup(React.createElement(InvoiceSourceSummary,{groups,selected:'',disabled:false,shown:2,selectedLines:0,hiddenSelections:0,onChange(){throw Error('Rendering must not select or save')},...patch}));
test('invoice summary escapes source names and distinguishes file subtotal from invoice, payment and stock quantities',()=>{
 const html=render(invoiceSourceGroups([row(2),row(3)]));assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/\$20.00/);assert.match(html,/not the supplier/);assert.match(html,/Tax, freight/);assert.match(html,/units are not added together/);assert.match(html,/2 not recorded/);
});
test('mixed dates and hidden group selections stay explicit without implying correction or approval',()=>{
 const groups=invoiceSourceGroups([row(2),row(3,'2026-09-28')]);const html=render(groups,{selected:groups[0].key,selectedLines:3,hiddenSelections:1,shown:1,disabled:true});assert.match(html,/conflicting dates/);assert.match(html,/2026-09-28, 2026-09-29/);assert.match(html,/1 selected lines are outside/);assert.match(html,/Changing filters does not clear/);assert.match(html,/including rows hidden/);assert.match(html,/<select disabled=""/);
});
test('no source entries yields an explicit zero-line summary and no save controls',()=>{
 const html=render([],{shown:0});assert.match(html,/All 0 supplier invoices/);assert.match(html,/Source lines<strong>0/);assert.match(html,/\$0.00/);assert.doesNotMatch(html,/Save selected|type="checkbox"|conflicting dates/);
});
