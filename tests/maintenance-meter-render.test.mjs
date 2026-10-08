import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const compiled=ts.transpileModule(fs.readFileSync('app/team/maintenance.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace("from './maintenance-cost-report'","from './maintenance-cost-report.mjs'").replace("from './maintenance-cost'","from './maintenance-cost.mjs'").replace(/from '(\.\.\/shared\/[^']+)'/g,"from '$1.mjs'").replace("import './operations.css';",'').replace("from './equipment'","from './equipment.mjs'").replace("from './maintenance-meter'","from './maintenance-meter.mjs'");
fs.mkdirSync('.sites-runtime/meter-render-team',{recursive:true});fs.writeFileSync('.sites-runtime/meter-render-team/maintenance.mjs',compiled);
const equipmentCompiled=ts.transpileModule(fs.readFileSync('app/team/equipment.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from '(\.\.\/shared\/[^']+)'/g,"from '$1.mjs'");
fs.writeFileSync('.sites-runtime/meter-render-team/equipment.mjs',equipmentCompiled);
const meterCompiled=ts.transpileModule(fs.readFileSync('app/team/maintenance-meter.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from '(\.\.\/shared\/[^']+)'/g,"from '$1.mjs'");
fs.writeFileSync('.sites-runtime/meter-render-team/maintenance-meter.mjs',meterCompiled);
const costCompiled=ts.transpileModule(fs.readFileSync('app/team/maintenance-cost.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from '(\.\.\/shared\/[^']+)'/g,"from '$1.mjs'");
fs.writeFileSync('.sites-runtime/meter-render-team/maintenance-cost.mjs',costCompiled);
const reportCompiled=ts.transpileModule(fs.readFileSync('app/team/maintenance-cost-report.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from '(\.\.\/shared\/[^']+)'/g,"from '$1.mjs'");
fs.writeFileSync('.sites-runtime/meter-render-team/maintenance-cost-report.mjs',reportCompiled);
const {PlanFields,MaintenanceCard}=await import('../.sites-runtime/meter-render-team/maintenance.mjs');
const {EquipmentRegister,EquipmentFields}=await import('../.sites-runtime/meter-render-team/equipment.mjs');
const me={id:'owner',locationId:'a',name:'Fixture owner',area:'Executive',position:'Owner',capabilities:['location.manage'],qualifications:[]},w={location:{id:'a',name:'Fictional restaurant',timezone:'America/New_York'},me,members:[me],records:[]};
const d={title:'Fictional service',equipment:'Fictional asset',task:'Fictional checked task',sourceRef:'Fictional checked agreement',initialDue:'2026-01-05',intervalDays:0,recurrence:{kind:'calendar-month-weekday',every:1,weekday:1,ordinal:1},warningDays:7,managerId:'owner',managerName:'Fixture owner',status:'active',checkedBy:'owner',checkedAt:'2026-01-01T12:00:00Z',retirementNote:'',services:[],history:[],versions:[]};
const fields=value=>renderToStaticMarkup(React.createElement(PlanFields,{w,d:value}));

const {MeterRuleFields,MeterStatus,MaintenanceMeterPanel}=await import('../.sites-runtime/meter-render-team/maintenance-meter.mjs');
const rule={meterRef:'Fixture hour meter <1>',initialDueHours:100,intervalHours:50,warningHours:10};
const plan={...d,recurrence:undefined,intervalDays:30,initialDue:'2026-12-01',meter:rule};
const reading={id:'reading',date:'2026-09-28',hours:100,evidence:'Fixture meter <photo>',note:'Fixture actual observation',by:'owner',at:'2026-09-28T12:00:00Z',plan,voided:null};
const record={id:'plan',kind:'maintenance',locationId:'a',ownerId:'owner',revision:1,data:{...plan,meterReadings:[reading]}};

test('meter source form is opt-in and requires explicit thresholds without inferred equipment values',()=>{
 let html=renderToStaticMarkup(React.createElement(MeterRuleFields,{}));assert.doesNotMatch(html,/checked=""/);assert.doesNotMatch(html,/name="intervalHours"/);assert.match(html,/calendar rule stays in place/);assert.match(html,/Meter hours only/);
 html=renderToStaticMarkup(React.createElement(MeterRuleFields,{rule}));assert.match(html,/name="intervalHours"/);assert.match(html,/value="50"/);assert.match(html,/Fixture hour meter &lt;1&gt;/);assert.match(html,/separate checked plan/);
});

test('status always shows dated observed hours and does not describe missing readings as current service evidence',()=>{
 const render=r=>renderToStaticMarkup(React.createElement(MeterStatus,{r}));let html=render(record);assert.match(html,/service due at 100 hours/);assert.match(html,/100 hours on 2026-09-28/);assert.match(html,/not a live meter check/);
 html=render({...record,data:{...plan,meterReadings:[]}});assert.match(html,/needs-reading/);assert.match(html,/cannot be established/);assert.doesNotMatch(html,/Recorded threshold reached/);
});

test('read-only meter history keeps source and correction evidence while omitting all mutation controls',()=>{
 const r={...record,data:{...record.data,meterReadings:[{...reading,voided:{by:'owner',at:reading.at,reason:'Fixture incorrect reading'}}]}};
 const html=renderToStaticMarkup(React.createElement(MaintenanceMeterPanel,{r,w,send(){throw Error('Read only')},busy:false,canRecord:true,owner:true,readOnly:true}));assert.match(html,/Fixture meter &lt;photo&gt;/);assert.match(html,/Fixture incorrect reading/);assert.match(html,/Voided reading/);assert.match(html,/first due at 100 hours/);assert.doesNotMatch(html,/<form|<input|<button/);
});

test('completed service requires a same-date reading and its dependency blocks correction in the rendered history',()=>{
 let html=renderToStaticMarkup(React.createElement(MaintenanceCard,{r:record,w,send:async()=>false,busy:false,now:'2026-09-29T12:00:00Z'}));assert.match(html,/name="meterReadingId"/);assert.match(html,/same actual service date/);assert.match(html,/Record actual meter reading/);assert.match(html,/<button disabled="">Save meter reading/);
 const entry={id:'service',date:reading.date,meter:reading,performedBy:'Fixture technician',evidence:'Fixture service',note:'Fixture completed',by:'owner',at:reading.at,plan,contact:null,voided:null};
 const r={...record,data:{...record.data,services:[entry]}};html=renderToStaticMarkup(React.createElement(MaintenanceMeterPanel,{r,w,send:async()=>false,busy:false,canRecord:false,owner:true}));assert.match(html,/supports completed service/);assert.doesNotMatch(html,/Void incorrect meter reading/);
 html=renderToStaticMarkup(React.createElement(MaintenanceCard,{r,w,send:async()=>false,busy:false,now:'2026-09-29T12:00:00Z',readOnly:true}));assert.match(html,/Retained service meter: 100 hours on 2026-09-28/);assert.doesNotMatch(html,/<form/);
});

test('meter-only source form requires hours and omits every calendar input',()=>{
 const value={...plan,meterOnly:true,initialDue:'',intervalDays:0,warningDays:0};const html=fields(value);
 assert.match(html,/<option value="meter-only" selected="">Meter hours only/);assert.match(html,/type="hidden" name="meterEnabled" value="on"/);assert.match(html,/name="initialDueHours"/);assert.match(html,/name="intervalHours"/);
 assert.doesNotMatch(html,/name="(?:initialDue|intervalDays|warningDays|calendarEvery)"/);assert.match(html,/No calendar due date is created/);
});

test('meter-only current and historical cards show hour evidence without fictitious calendar dates',()=>{
 const only={...plan,meterOnly:true,initialDue:'',intervalDays:0,warningDays:0};const r={...record,data:{...only,meterReadings:[{...reading,plan:only}],versions:[{facts:only,at:reading.at,by:'owner',reason:'Fictional source recheck'}]}};
 const html=renderToStaticMarkup(React.createElement(MaintenanceCard,{r,w,send:async()=>false,busy:false,now:'2099-01-01T12:00:00Z',readOnly:true}));
 assert.match(html,/Meter hours only; no calendar due date/);assert.match(html,/service due at 100 hours/);assert.match(html,/100 hours on 2026-09-28/);assert.doesNotMatch(html,/Initial due:|Initial due date:|Next due:|Warning window:|<form/);
});
