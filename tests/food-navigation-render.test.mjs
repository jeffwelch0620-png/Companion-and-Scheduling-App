import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import fs from 'node:fs';import ts from 'typescript';
const target='.sites-runtime/food-navigation-team';fs.mkdirSync(target,{recursive:true});
for(const name of fs.readdirSync('app/team').filter(n=>/\.tsx?$/.test(n))){
 const code=ts.transpileModule(fs.readFileSync('app/team/'+name,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from '(\.{1,2}\/[^']+)'/g,"from '$1.mjs'").replace(/import '[^']+\.css';/g,'');
 fs.writeFileSync(target+'/'+name.replace(/\.tsx?$/,'.mjs'),code);
}
const {FoodWorkspace}=await import('../.sites-runtime/food-navigation-team/food.mjs');
const me={id:'fictional',locationId:'berts',area:'Executive',position:'Owner',capabilities:['location.manage'],qualifications:[]};
const w={location:{id:'berts',name:'Fictional restaurant',timezone:'America/New_York'},me,members:[me],records:[]};
const render=(initialView,extra={})=>renderToStaticMarkup(React.createElement(FoodWorkspace,{w,apiRoot:'/api',initialView,onBusy(){throw Error('Rendering does not save or lock')},...extra}));
test('direct Food entries render their intended view and restaurant-record default',()=>{
 for(const [view,title] of [['invoices','Invoice CSV matching'],['receiving','Delivery checks'],['returns','Supplier returns'],['claims','Supplier issues'],['transfers','Restaurant transfers'],['waste','Waste and estimated costs']]){
  const html=render(view);assert.ok(html.includes('<h1>'+title+'</h1>'));assert.match(html,/<option value="operating" selected=""/);assert.doesNotMatch(html,/DEMO DATA/);
 }
});
test('invoice direct entry opens checked CSV review and guards an unauthorized direct prop',()=>{
 assert.match(render('invoices'),/250 lines/);assert.match(render('invoices'),/Browse archived CSVs/);
 const html=render('invoices',{w:{...w,me:{...me,area:'BOH',capabilities:['tasks.manage']}}});assert.match(html,/<h1>Food inventory/);assert.doesNotMatch(html,/250 lines|Browse archived CSVs/);
});
test('queue entry does not initially render generic item loading or an unrelated invoice review',()=>{
 for(const view of ['receiving','returns','claims','transfers','waste']){const html=render(view);assert.doesNotMatch(html,/Loading this food page|250 lines/);}
});
test('recipe entry retains its own title and excludes Food mutation and queue controls',()=>{
 const html=render('invoices',{recipesOnly:true});assert.match(html,/<h1>Recipes and build cards/);assert.doesNotMatch(html,/Review delivery checks|Match invoice CSV to items|250 lines/);
});
