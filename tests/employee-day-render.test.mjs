import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {employeeCheckoutRecords} from './employee-checkout-fixture.mjs';
const out='.sites-runtime/employee-day-render';fs.mkdirSync(out,{recursive:true});
for(const name of ['my-day','personal-learning','learning-progress'])fs.writeFileSync(`${out}/${name}.mjs`,ts.transpileModule(fs.readFileSync(`app/team/${name}.tsx`,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from '(\.{1,2}\/[^']+)'/g,"from '$1.mjs'"));
const {MyDay}=await import('../.sites-runtime/employee-day-render/my-day.mjs');
const now='2026-10-08T02:00:00.000Z',f=employeeCheckoutRecords(now);
const employee={id:f.employeeId,locationId:'rudds',name:'Fictional server',area:'FOH',position:'Server',capabilities:[],qualifications:['Server']},manager={...employee,id:f.managerId,name:'Fictional manager',position:'Manager',capabilities:['tasks.manage','close.confirm','people.manage']};
const w={location:{id:'rudds',name:'Fictional restaurant',timezone:'America/New_York',revision:1},me:employee,members:[employee,manager],records:f.records};
const props={w,now,onOpen(){},onTraining(){},onSchedule(){},onDuties(){},onAsk(){},onStart(){}};
test('My day keeps ended checkout and direct assignment, training and guide entry points visible',()=>{
 const html=renderToStaticMarkup(React.createElement(MyDay,props));
 assert.match(html,/Checkout pending/);assert.match(html,/Prepare your closing check/);assert.match(html,/All assignments/);assert.match(html,/Training &amp; guides/);assert.match(html,/Read the guide/);assert.doesNotMatch(html,/Scheduled now/);
});
test('empty My day retains assignment and training routes without inventing approved learning',()=>{
 const html=renderToStaticMarkup(React.createElement(MyDay,{...props,w:{...w,records:[]}}));
 assert.match(html,/No outstanding assignments/);assert.match(html,/All assignments/);assert.match(html,/Training &amp; guides/);assert.match(html,/still preparing the restaurant guides/);assert.doesNotMatch(html,/Start practice|Read the guide|Approved instructions/);
});
