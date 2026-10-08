import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const compiled=ts.transpileModule(fs.readFileSync('app/team/hire-review.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from '(\.\.\/shared\/[^']+)'/g,"from '$1.mjs'");
fs.mkdirSync('.sites-runtime/team',{recursive:true});fs.writeFileSync('.sites-runtime/team/hire-review.mjs',compiled);
const {HireReviewDetails}=await import('../.sites-runtime/team/hire-review.mjs');
const data={schemaVersion:'jmax-hire-review.v2',locationId:'a',viewerId:'owner',checkedAt:'2026-09-29T12:00:00Z',timezone:'America/New_York',employee:{name:'Fictional hire',area:'BOH',position:'Cook',hireDate:'2026-09-01',active:false,scheduleOnly:true,status:'onboarding'},signIn:{visibility:'owner',lastSignedInAt:null},checklists:[],handoffs:[],stations:[],development:[]};
const render=(d=data,busy=false)=>renderToStaticMarkup(React.createElement(HireReviewDetails,{data:d,busy,onNavigate:()=>{throw new Error('Render only')}}));
test('review screen keeps missing requirements, code sign-in, scheduling and station assessments distinct',()=>{
 const html=render();assert.match(html,/Scheduling only/);assert.match(html,/No successful setup-code sign-in recorded/);assert.match(html,/Missing records do not mean that no requirements apply/);assert.match(html,/No scheduling handoff/);assert.match(html,/does not establish that training is unnecessary/);assert.doesNotMatch(html,/Ready to work|Onboarding complete/);assert.match(html,/Open employee setup/);
});
test('filed and stale evidence stays labeled and owner audit controls are withheld from people coordinators',()=>{
 const html=render({...data,signIn:{visibility:'owner-only',lastSignedInAt:null},checklists:[{id:'c',archived:true,current:false,status:'reviewed',checked:1,total:1,overdue:0}],handoffs:[{id:'h',archived:true,status:'scheduled',schedulerName:'Scheduler',targetDate:'2026-09-02',confirmedStart:'2026-09-02T14:00:00Z'}],stations:[{id:'s',title:'Grill',state:'definition-changed',levelLabel:null,assessedAt:null,thresholdLabel:'Independent'}]},true);
 assert.match(html,/owner’s review/);assert.doesNotMatch(html,/Open employee setup/);assert.match(html,/Employee setup changed/);assert.match(html,/current scheduling is not revalidated here/);assert.match(html,/reassessment needed/);assert.equal((html.match(/<button/g)??[]).length,(html.match(/<button disabled/g)??[]).length);
});

test('development review shows filed decisions and changed guides without manufacturing station clearance',()=>{
 const r={id:'d',phase:'approved',archived:true,originalDueDate:'2026-09-01',overdueDays:0,manager:{name:'Former <manager>',available:false},approver:{name:'GM & reviewer',available:true},approvalRecorded:true,lastDecision:{outcome:'approved',at:'2026-09-29T14:00:00Z',by:'GM & reviewer'},guideStatus:{current:0,changed:1,unavailable:0,manual:1}};
 const html=render({...data,development:[r]},true);assert.match(html,/Filed development review/);assert.match(html,/Saved GM approval/);assert.match(html,/Current follow-up authority unavailable/);assert.match(html,/Former &lt;manager&gt;/);assert.match(html,/original decision is retained/);assert.match(html,/Open filed development history/);assert.doesNotMatch(html,/Open development reviews|Ready to work|Onboarding complete/);assert.equal((html.match(/<button/g)??[]).length,(html.match(/<button disabled/g)??[]).length);
});
test('pending development decisions,missing evidence and empty authorized views keep their distinct meaning',()=>{
 let html=render();assert.match(html,/No development review is available to you/);assert.match(html,/does not establish that a review is missing/);
 const r={id:'pending',phase:'gm-review',archived:false,originalDueDate:'2026-09-01',overdueDays:2,manager:{name:'Manager',available:true},approver:{name:'GM',available:true},approvalRecorded:false,lastDecision:{outcome:'returned',at:null,by:'GM'},guideStatus:{current:1,changed:0,unavailable:0,manual:0}};
 html=render({...data,development:[r]});assert.match(html,/Awaiting named GM decision/);assert.match(html,/Returned for discussion/);assert.match(html,/Decision date needs review/);assert.match(html,/2 days past due/);assert.match(html,/Open development reviews/);
 html=render({...data,development:[{...r,phase:'approved'}]});assert.match(html,/approval evidence needs review/);
});

