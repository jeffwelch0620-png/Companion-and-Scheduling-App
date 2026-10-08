import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import fs from 'node:fs';import ts from 'typescript';
import {guideLayouts,readOrderGuide,reviewOrderGuide} from '../.sites-runtime/shared/food-order-guide.mjs';
fs.mkdirSync('.sites-runtime/order-guide-render',{recursive:true});fs.writeFileSync('.sites-runtime/order-guide-render/view.mjs',ts.transpileModule(fs.readFileSync('app/team/food-order-guide.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from '(\.\.\/shared\/[^']+)'/g,"from '$1.mjs'"));
const {GuideFindings,FoodOrderGuide}=await import('../.sites-runtime/order-guide-render/view.mjs');
const table=readOrderGuide(guideLayouts.berts.join(',')+'\n'+Array.from({length:23},(_,n)=>`${n},<script>Bad</script>,Fictional Supplier,99,2,CS,Fictional Supplier`).join('\n'));
const review={locationId:'a',dataset:'demo',revision:1,checkedAt:'2026-09-30T15:00:00Z',fileName:'fictional.csv',sha256:'a'.repeat(64),table,...reviewOrderGuide(table,[])};
test('guide findings escape source text, paginate all rows and preserve historical quantity labels',()=>{
 const render=offset=>renderToStaticMarkup(React.createElement(GuideFindings,{review,offset})),first=render(0),last=render(20);
 assert.equal((first.match(/<article/g)||[]).length,20);assert.equal((last.match(/<article/g)||[]).length,3);assert.doesNotMatch(first,/<script>/);assert.match(first,/&lt;script&gt;/);assert.match(first,/Old guide quantities/);assert.match(first,/do not establish today/);assert.match(first,/blank or zero/);assert.match(last,/Row 24/);
});
test('guide review explains exact matching and cannot submit before source and restaurant confirmation',()=>{
 const html=renderToStaticMarkup(React.createElement(FoodOrderGuide,{locationId:'a',locationName:'Fictional restaurant',dataset:'demo',apiRoot:'/api',disabled:true}));assert.match(html,/<fieldset disabled/);assert.match(html,/Simple sheet/);assert.match(html,/not imported/);assert.doesNotMatch(html,/Compare guide with this catalog|<form|Import reviewed|Place order/);
});
