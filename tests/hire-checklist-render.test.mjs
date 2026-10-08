import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const source=fs.readFileSync('app/team/hire-checklist.tsx','utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from '(\.\.\/shared\/[^']+)'/g,"from '$1.mjs'");
fs.mkdirSync('.sites-runtime/team',{recursive:true});fs.writeFileSync('.sites-runtime/team/hire-checklist.mjs',compiled);
const {HireChecklistCard,HireChecklists}=await import('../.sites-runtime/team/hire-checklist.mjs');
const me={id:'owner',name:'Fictional owner',locationId:'a',area:'Executive',position:'Owner',capabilities:['location.manage'],qualifications:[]};
const candidate={id:'hire',name:'Fictional hire',area:'BOH',position:'Line Cook',revision:1,hireDate:'2026-09-01',status:'onboarding',active:false,scheduleOnly:false};
const data={title:'Onboarding · Fictional hire',employeeName:'Fictional hire',position:'Line Cook',hireDate:'2026-09-01',sourceReference:'Checked fixture checklist reference',items:[{id:'one',label:'Fixture paperwork status',dueDate:'2026-09-28',check:null},{id:'two',label:'Fixture other check',dueDate:'',check:null}],status:'open',review:null,history:[],versions:[]};
const row={id:'list',kind:'hirechecklist',locationId:'a',ownerId:'hire',area:'BOH',revision:1,updatedAt:'2026-09-29T00:00:00Z',data};
const w={location:{id:'a',name:'Fictional restaurant',timezone:'America/New_York'},me,members:[me],hireCandidates:[candidate],records:[row]};
const props={r:row,w,send:()=>{throw new Error('Render cannot save');},busy:false,now:'2026-09-29T02:00:00Z'};
const render=p=>renderToStaticMarkup(React.createElement(HireChecklistCard,{...props,...p}));

test('onboarding screens distinguish entered requirements and manual checks from access, legal validity and training',()=>{
 let html=render();assert.match(html,/0 of 2 entered requirements checked/);assert.doesNotMatch(html,/1 past entered due date/);assert.match(html,/does not establish legal document validity/);assert.match(html,/Record checked completion/);assert.match(html,/identification numbers/);
 html=render({now:'2026-09-29T05:00:00Z'});assert.match(html,/1 past entered due date/);
 const page=renderToStaticMarkup(React.createElement(HireChecklists,{...props,onNavigate:()=>{}}));assert.match(page,/Open first-shift handoff/);assert.match(page,/Open employee setup/);assert.match(page,/supplies no default legal paperwork/);
});

test('changed employee facts and historical records hide completion and review controls while retaining saved evidence',()=>{
 const reviewed={...row,data:{...data,status:'reviewed',items:data.items.map(i=>({...i,check:{completedDate:'2026-09-01',evidence:'Saved fixture evidence',at:'2026-09-01T14:00:00Z',by:'owner'}})),review:{at:'2026-09-01T15:00:00Z',by:'owner',note:'Checked source list.'}}};
 let html=render({r:reviewed,readOnly:true});assert.match(html,/Historical record/);assert.match(html,/Saved fixture evidence/);assert.doesNotMatch(html,/<form|Reopen checklist|Revise requirements/);
 html=render({w:{...w,hireCandidates:[{...candidate,position:'Prep Cook'}]}});assert.match(html,/position changed/);assert.doesNotMatch(html,/Record checked completion/);assert.match(html,/Revise requirements/);
 html=render({w:{...w,me:{...me,capabilities:['schedule.manage'],area:'BOH'}}});assert.doesNotMatch(html,/<form|Record checked completion|Cancel this checklist/);
});

test('final review is offered only when all items are checked and saving disables every action fieldset',()=>{
 assert.doesNotMatch(render(),/Review the completed checklist/);
 const complete={...row,data:{...data,items:data.items.map(i=>({...i,check:{completedDate:'2026-09-01',evidence:'Checked fixture',at:'2026-09-01T14:00:00Z',by:'owner'}}))}};
 const html=render({r:complete,busy:true});assert.match(html,/Review the completed checklist/);assert.match(html,/Correct this check/);assert.equal((html.match(/<fieldset/g)??[]).length,(html.match(/<fieldset disabled/g)??[]).length);assert.match(html,/previous completion and evidence will remain/);
});
