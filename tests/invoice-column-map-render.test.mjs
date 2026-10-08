import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import fs from 'node:fs';import ts from 'typescript';
fs.mkdirSync('.sites-runtime/invoice-column-render',{recursive:true});
fs.writeFileSync('.sites-runtime/invoice-column-render/view.mjs',ts.transpileModule(fs.readFileSync('app/team/invoice-column-map.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from '(\.\.\/shared\/[^']+)'/g,"from '$1.mjs'"));
const {InvoiceColumnMap,InvoiceColumnMapHistory}=await import('../.sites-runtime/invoice-column-render/view.mjs');
const source={csv:'SKU,Description\n001,<script>bad</script>',file:{kind:'csv',fileName:'Fictional <img>.csv',byteLength:44,sha256:'a'.repeat(64)}};
const render=(disabled=false)=>renderToStaticMarkup(React.createElement(InvoiceColumnMap,{source,disabled,onApply(){throw Error('Static render must not apply or save')}}));
test('mapping view escapes original values, labels every selection and requires explicit confirmation before use',()=>{
 const html=render();assert.match(html,/Fictional &lt;img&gt;/);assert.match(html,/&lt;script&gt;bad&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>|<form/);assert.equal((html.match(/<select(?: |>)/g)||[]).length,9);assert.match(html,/button type="button" disabled="">Use reviewed column map/);assert.match(html,/Original first three records/);assert.match(html,/Columns excluded/);
});
test('disabled mapping view has no enabled field or apply control and clearly explains source and format limits',()=>{
 const html=render(true);assert.equal((html.match(/<select disabled=""/g)||[]).length,9);assert.match(html,/Dates must be YYYY-MM-DD/);assert.match(html,/net USD/);assert.match(html,/Archive this original before saving/);assert.match(html,/fresh map review/);
});
test('saved mapping shows exact original column names and checked shared values without editing controls',()=>{
 const keys=['vendor','vendor_sku','invoice_number','line_reference','invoice_date','quantity','unit_basis','invoice_unit','line_total'],layout={version:1,headers:['SKU <script>'],fields:Object.fromEntries(keys.map(k=>[k,k==='vendor_sku'?0:{literal:'Checked & value'}]))};
 const html=renderToStaticMarkup(React.createElement(InvoiceColumnMapHistory,{layout}));assert.match(html,/Column 1: SKU &lt;script&gt;/);assert.match(html,/Checked shared value: Checked &amp; value/);assert.doesNotMatch(html,/<input|<select|<button|<script>/);
});
