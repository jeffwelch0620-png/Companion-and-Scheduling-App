import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import fs from 'node:fs';
import ts from 'typescript';
fs.mkdirSync('.sites-runtime/team',{recursive:true});
for(const name of fs.readdirSync('app/team').filter(n=>/\.tsx?$/.test(n))){const code=ts.transpileModule(fs.readFileSync('app/team/'+name,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from '(\.{1,2}\/[^']+)'/g,"from '$1.mjs'").replace(/import '[^']+\.css';/g,'');fs.writeFileSync('.sites-runtime/team/'+name.replace(/\.tsx?$/,'.mjs'),code)}
const {ComplianceRenewalPanel}=await import('../.sites-runtime/team/compliance-renewal.mjs');
const {ComplianceRecords}=await import('../.sites-runtime/team/compliance.mjs');
const facts=(reference,date)=>({title:'Fictional '+reference,type:'permit',authority:'Fixture authority',reference,documentDate:date,dueDate:'2026-10-01',evidence:'Fixture page <1>',sourceUrl:'https://example.test/source',summary:'Fixture scope',responsibleId:'owner',responsibleName:'Owner'});
const review={by:'owner',at:'2026-09-03T12:00:00Z',note:'Fixture checked source'};
const prior={id:'old',kind:'compliance',locationId:'a',revision:2,data:{...facts('OLD','2026-09-01'),review,status:'tracking',history:[],versions:[],resolution:''}};
const newer={id:'new',kind:'compliance',locationId:'a',revision:2,data:{...facts('NEW','2026-09-02'),review,status:'tracking',history:[],versions:[],resolution:''}};
const link={previousId:'old',previousRevision:2,previousFacts:facts('OLD','2026-09-01'),previousReview:review,currentFacts:facts('NEW','2026-09-02'),currentReview:review,at:'2026-09-03T13:00:00Z',by:'owner',note:'Fixture relationship checked'};
const me={id:'owner',name:'Owner',locationId:'a',capabilities:['location.manage'],area:'Executive',position:'Owner',qualifications:[]};
const w={me,members:[me],location:{id:'a',name:'Fixture restaurant',timezone:'America/New_York'},records:[prior,newer]};
const render=(r,records=w.records)=>renderToStaticMarkup(React.createElement(ComplianceRenewalPanel,{r,w:{...w,records},send(){throw Error('Render cannot save')},busy:false,onOpen(){}}));
test('renewal form offers eligible earlier records but never preconfirms a relationship',()=>{
 const html=render(newer);assert.match(html,/Link an earlier permit/);assert.match(html,/OLD/);assert.match(html,/does not submit a renewal/);assert.match(html,/<button disabled="">Save renewal document link/);assert.doesNotMatch(html,/checked=""/);
 assert.doesNotMatch(render({...newer,data:{...newer.data,type:'inspection'}}),/renewal/);
 assert.match(render({...newer,data:{...newer.data,review:null}}),/Check this permit against its source/);
});
test('retained source pair displays both references, original checks, escaped evidence and navigation',()=>{
 const r={...newer,data:{...newer.data,renewal:link}};const html=render(r,[prior,r]);
 assert.match(html,/Source relationship checked/);assert.match(html,/Earlier permit: Fictional OLD/);assert.match(html,/Newer permit: Fictional NEW/);assert.match(html,/Source check retained/);assert.match(html,/Fixture page &lt;1&gt;/);assert.match(html,/Open earlier permit record/);assert.match(html,/Clear an incorrect renewal link/);
 const previousHtml=render(prior,[prior,r]);assert.match(previousHtml,/Open newer permit record/);
});
test('changed or unavailable source is visibly stale and keeps its prior evidence',()=>{
 const r={...newer,data:{...newer.data,renewal:link}},changed={...prior,data:{...prior.data,review:null}};
 let html=render(r,[changed,r]);assert.match(html,/Renewal link needs recheck/);assert.match(html,/earlier record is unavailable/);assert.match(html,/No eligible earlier permit/);assert.match(html,/Earlier permit: Fictional OLD/);
 html=render(r,[r]);assert.doesNotMatch(html,/Open earlier permit record/);assert.match(html,/Earlier permit: Fictional OLD/);
 const list=renderToStaticMarkup(React.createElement(ComplianceRecords,{w:{...w,records:[changed,r]},busy:false,send(){},now:'2026-09-29T12:00:00Z'}));assert.match(list,/Renewal link needs recheck/);
});
test('cleared link retains earlier and newer source evidence in relationship history',()=>{
 const r={...newer,data:{...newer.data,renewal:null,renewalHistory:[{action:'cleared',at:link.at,by:'owner',note:'Incorrect relationship',link}]}};
 const html=render(r,[prior,r]);assert.match(html,/Renewal relationship history \(1\)/);assert.match(html,/cleared/);assert.match(html,/Incorrect relationship/);assert.match(html,/Earlier permit: Fictional OLD/);assert.doesNotMatch(html,/Clear an incorrect renewal link/);
});
