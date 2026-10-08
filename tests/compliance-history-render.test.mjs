import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import fs from 'node:fs';
import ts from 'typescript';
fs.mkdirSync('.sites-runtime/team',{recursive:true});
for(const name of fs.readdirSync('app/team').filter(n=>/\.tsx?$/.test(n))){const code=ts.transpileModule(fs.readFileSync('app/team/'+name,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from '(\.{1,2}\/[^']+)'/g,"from '$1.mjs'").replace(/import '[^']+\.css';/g,'');fs.writeFileSync('.sites-runtime/team/'+name.replace(/\.tsx?$/,'.mjs'),code)}
const {ComplianceRenewalPanel}=await import('../.sites-runtime/team/compliance-renewal.mjs');
const {ComplianceRecords,ComplianceCard}=await import('../.sites-runtime/team/compliance.mjs');
const facts=(reference,date)=>({title:'Fictional '+reference,type:'permit',authority:'Fixture authority',reference,documentDate:date,dueDate:'2026-10-01',evidence:'Fixture page <1>',sourceUrl:'https://example.test/source',summary:'Fixture scope',responsibleId:'owner',responsibleName:'Owner'});
const review={by:'owner',at:'2026-09-03T12:00:00Z',note:'Fixture checked source'};
const prior={id:'old',kind:'compliance',locationId:'a',revision:2,data:{...facts('OLD','2026-09-01'),review,status:'tracking',history:[],versions:[],resolution:''}};
const newer={id:'new',kind:'compliance',locationId:'a',revision:2,data:{...facts('NEW','2026-09-02'),review,status:'tracking',history:[],versions:[],resolution:''}};
const link={previousId:'old',previousRevision:2,previousFacts:facts('OLD','2026-09-01'),previousReview:review,currentFacts:facts('NEW','2026-09-02'),currentReview:review,at:'2026-09-03T13:00:00Z',by:'owner',note:'Fixture relationship checked'};
const me={id:'owner',name:'Owner',locationId:'a',capabilities:['location.manage'],area:'Executive',position:'Owner',qualifications:[]};
const w={me,members:[me],location:{id:'a',name:'Fixture restaurant',timezone:'America/New_York'},records:[prior,newer]};
const render=(r,records=w.records)=>renderToStaticMarkup(React.createElement(ComplianceRenewalPanel,{r,w:{...w,records},send(){throw Error('Render cannot save')},busy:false,onOpen(){}}));
test('filed permit detail retains facts, checks, outcomes and renewal snapshots without any mutation controls',()=>{
 const r={...newer,data:{...newer.data,status:'closed',resolution:'Fixture follow-up finished',renewal:link,renewalHistory:[{action:'linked',at:link.at,by:'owner',note:'Fixture linked',link}],versions:[{at:link.at,by:'owner',facts:facts('BEFORE','2026-09-02'),review,resolution:'Old outcome',reason:'Fixture correction'}]}};
 const html=renderToStaticMarkup(React.createElement(ComplianceCard,{r,w:{...w,records:[prior,r]},send(){throw Error('Read only')},busy:false,dueText:'Filed internal follow-up',readOnly:true,onOpen(){throw Error('No navigation')}}));
 for(const expected of ['Fixture follow-up finished','Source checked by','Earlier permit: Fictional OLD','Newer permit: Fictional NEW','Renewal relationship history','BEFORE','Fixture correction','Fixture page &lt;1&gt;'])assert.ok(html.includes(expected),expected);
 assert.doesNotMatch(html,/<form|<button|<input|<select|<textarea/);assert.match(html,/Open source document/);
});

test('filed stale relationships remain visibly stale and preserve original evidence',()=>{
 const r={...newer,data:{...newer.data,renewal:link}},changed={...prior,data:{...prior.data,review:null}};
 const html=renderToStaticMarkup(React.createElement(ComplianceRenewalPanel,{r,w:{...w,records:[changed,r]},busy:false,send(){},readOnly:true,onOpen(){}}));
 assert.match(html,/Renewal link needs recheck/);assert.match(html,/Earlier permit: Fictional OLD/);assert.doesNotMatch(html,/<form|<button|<input|<select|<textarea/);
});

test('active source detail still permits deliberate corrections and the list points to Work history',()=>{
 const html=renderToStaticMarkup(React.createElement(ComplianceCard,{r:newer,w,send(){},busy:false,dueText:'Follow-up open'}));assert.match(html,/<form/);assert.match(html,/Save corrected source facts/);assert.match(html,/Save follow-up update/);
 const list=renderToStaticMarkup(React.createElement(ComplianceRecords,{w,send(){},busy:false,now:'2026-09-29T12:00:00Z'}));assert.match(list,/Completed follow-ups filed by an owner remain available in Work history/);assert.match(list,/does not certify/);
});
