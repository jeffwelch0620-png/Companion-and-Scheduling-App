import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import fs from 'node:fs';import ts from 'typescript';
fs.mkdirSync('.sites-runtime/employee-prep-render',{recursive:true});fs.writeFileSync('.sites-runtime/employee-prep-render/view.mjs',ts.transpileModule(fs.readFileSync('app/team/employee-prep.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from '(\.\.\/shared\/[^']+)'/g,"from '$1.mjs'"));
const {EmployeePrep,PrepReport,EmployeeRecipeCard}=await import('../.sites-runtime/employee-prep-render/view.mjs');
const w={location:{id:'berts',name:'Fictional Bert’s'},me:{id:'cook'}};
const item={planId:'prep',planRevision:2,definitionId:'ranch',title:'Ranch',quantity:12,unit:'cup'};
test('recipe card presents source ingredients and shelf life without guessed expiry',()=>{
 const recipe={title:'Ranch',yieldQty:1,yieldUOM:'gal',procedure:'Mix.',equipment:'Bowl',portionNote:'',shelfLife:'Source reference: 3 days refrigerated',ingredients:[{name:'Milk',quantity:2,unit:'portion(s)',portionGuidance:'Each portion: 4 fl oz',notice:''}]};
 const html=renderToStaticMarkup(React.createElement(EmployeeRecipeCard,{recipe}));assert.match(html,/Ingredients for the recipe yield/);assert.match(html,/2 portion\(s\).*Milk/);assert.match(html,/Each portion: 4 fl oz/);assert.match(html,/Shelf life from recipe source: Source reference: 3 days refrigerated/);assert.doesNotMatch(html,/expiry|expires|cost|price/i);
});
test('recipe card identifies absent source details rather than filling them in',()=>{
 const recipe={title:'Ranch',yieldQty:null,yieldUOM:'',procedure:'',equipment:'',portionNote:'',shelfLife:'',ingredients:[]};
 const html=renderToStaticMarkup(React.createElement(EmployeeRecipeCard,{recipe}));assert.match(html,/Ingredients are not supplied/);assert.match(html,/Not supplied; ask your manager before labeling or storing/);
});
test('assigned prep has a direct home anchor and no stale tasks before a fresh read',()=>{
 const html=renderToStaticMarkup(React.createElement(EmployeePrep,{w,apiRoot:'/api'}));assert.match(html,/id="assigned-prep"/);assert.match(html,/Loading your released prep/);assert.match(html,/Refresh prep/);assert.match(html,/<button disabled/);assert.doesNotMatch(html,/Record actual prep|Recipe card/);
});
test('completion allows actual zero and explains shortage follow-through',()=>{
 const html=renderToStaticMarkup(React.createElement(PrepReport,{w,item,apiRoot:'/api',onSaved(){},onRefresh(){},onBusy(){}}));assert.match(html,/min="0"/);assert.match(html,/including zero/);assert.match(html,/Let your manager know if service is affected/);assert.match(html,/Record actual prep/);assert.match(html,/maxLength="1000"/);
});
test('other pending reports lock completion controls',()=>{
 const html=renderToStaticMarkup(React.createElement(PrepReport,{w,item,apiRoot:'/api',disabled:true,onSaved(){},onRefresh(){},onBusy(){}}));assert.match(html,/<fieldset disabled/);
});

