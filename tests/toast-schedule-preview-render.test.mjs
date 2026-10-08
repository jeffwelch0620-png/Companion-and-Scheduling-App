import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import fs from 'node:fs';import ts from 'typescript';
fs.mkdirSync('.sites-runtime/toast-preview-render',{recursive:true});fs.writeFileSync('.sites-runtime/toast-preview-render/view.mjs',ts.transpileModule(fs.readFileSync('app/team/toast-schedule-preview.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from '(\.\.\/shared\/[^']+)'/g,"from '$1.mjs'"));
const {ToastSchedulePreview,ToastScheduleSnapshotView}=await import('../.sites-runtime/toast-preview-render/view.mjs');
const w={location:{id:'review',timezone:'America/New_York'},me:{position:'Owner',capabilities:['location.manage']}};
test('only authorized administrators get the explicit read button, and the review does not offer publishing',()=>{
 const render=workspace=>renderToStaticMarkup(React.createElement(ToastSchedulePreview,{w:workspace,weekStart:'2026-10-05'}));
 assert.match(render(w),/Read Toast planned shifts/);assert.match(render(w),/does not change or publish/);assert.doesNotMatch(render(w),/Import shifts|Publish schedule/);
 assert.equal(render({...w,me:{position:'Server',capabilities:[]}}),'');assert.equal(render({...w,me:{position:'Dishwasher',capabilities:['location.manage']}}),'');
});
test('empty POS results are distinguished from missing Sling schedules',()=>{
 const preview={snapshot:{retrievedAt:'2026-10-07T12:00:00Z',timezone:'America/New_York',shifts:[]},employees:[]};
 const html=renderToStaticMarkup(React.createElement(ToastScheduleSnapshotView,{preview}));assert.match(html,/no active planned shifts/);assert.match(html,/does not establish whether Sling/);
});
test('cancelled shifts stay out of active rows and unknown employees are not guessed from names',()=>{
 const shift={toastShiftId:'one',toastEmployeeId:'source-person',start:'2026-10-07T16:00:00Z',end:'2026-10-07T20:00:00Z',deleted:false};
 const preview={snapshot:{retrievedAt:'2026-10-07T12:00:00Z',timezone:'America/New_York',shifts:[shift,{...shift,toastShiftId:'two',deleted:true}]},employees:[]};
 let html=renderToStaticMarkup(React.createElement(ToastScheduleSnapshotView,{preview}));assert.match(html,/1 planned shifts/);assert.match(html,/1 cancelled records/);assert.match(html,/Unmatched Toast employee/);assert.doesNotMatch(html,/source-person/);
 preview.employees=[{toastEmployeeId:'source-person',memberId:'worker',name:'Verified employee'}];html=renderToStaticMarkup(React.createElement(ToastScheduleSnapshotView,{preview}));assert.match(html,/Verified employee/);assert.doesNotMatch(html,/Unmatched Toast employee/);
});
