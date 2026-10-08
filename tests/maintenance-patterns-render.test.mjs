import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const compiled=ts.transpileModule(fs.readFileSync('app/team/maintenance.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace("from './maintenance-cost-report'","from './maintenance-cost-report.mjs'").replace("from './maintenance-cost'","from './maintenance-cost.mjs'").replace(/from '(\.\.\/shared\/[^']+)'/g,"from '$1.mjs'").replace("import './operations.css';",'').replace("from './equipment'","from './equipment.mjs'").replace("from './maintenance-meter'","from './maintenance-meter.mjs'");
fs.mkdirSync('.sites-runtime/team',{recursive:true});fs.writeFileSync('.sites-runtime/team/maintenance.mjs',compiled);
const equipmentCompiled=ts.transpileModule(fs.readFileSync('app/team/equipment.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from '(\.\.\/shared\/[^']+)'/g,"from '$1.mjs'");
fs.writeFileSync('.sites-runtime/team/equipment.mjs',equipmentCompiled);
const meterCompiled=ts.transpileModule(fs.readFileSync('app/team/maintenance-meter.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from '(\.\.\/shared\/[^']+)'/g,"from '$1.mjs'");
fs.writeFileSync('.sites-runtime/team/maintenance-meter.mjs',meterCompiled);
const costCompiled=ts.transpileModule(fs.readFileSync('app/team/maintenance-cost.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from '(\.\.\/shared\/[^']+)'/g,"from '$1.mjs'");
fs.writeFileSync('.sites-runtime/team/maintenance-cost.mjs',costCompiled);
const reportCompiled=ts.transpileModule(fs.readFileSync('app/team/maintenance-cost-report.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from '(\.\.\/shared\/[^']+)'/g,"from '$1.mjs'");
fs.writeFileSync('.sites-runtime/team/maintenance-cost-report.mjs',reportCompiled);
const {PlanFields,MaintenanceCard}=await import('../.sites-runtime/team/maintenance.mjs');
const {EquipmentRegister,EquipmentFields}=await import('../.sites-runtime/team/equipment.mjs');
const me={id:'owner',locationId:'a',name:'Fixture owner',area:'Executive',position:'Owner',capabilities:['location.manage'],qualifications:[]},w={location:{id:'a',name:'Fictional restaurant',timezone:'America/New_York'},me,members:[me],records:[]};
const d={title:'Fictional service',equipment:'Fictional asset',task:'Fictional checked task',sourceRef:'Fictional checked agreement',initialDue:'2026-01-05',intervalDays:0,recurrence:{kind:'calendar-month-weekday',every:1,weekday:1,ordinal:1},warningDays:7,managerId:'owner',managerName:'Fixture owner',status:'active',checkedBy:'owner',checkedAt:'2026-01-01T12:00:00Z',retirementNote:'',services:[],history:[],versions:[]};
const fields=value=>renderToStaticMarkup(React.createElement(PlanFields,{w,d:value}));
test('checked monthly rule form shows explicit choices and previews source dates without silently fixing an anchor',()=>{
 const html=fields(d);assert.match(html,/First three scheduled dates: 2026-01-05 · 2026-02-02 · 2026-03-02/);assert.match(html,/name="calendarWeekday"/);assert.match(html,/name="calendarOrdinal"/);assert.match(html,/fifth-weekday and holiday-adjusted rules are not supported/);assert.match(html,/I checked this equipment/);
 assert.match(fields({...d,initialDue:'2026-01-06'}),/Choose 2026-01-05 or another month/);assert.match(fields({...d,initialDue:'2026-01-06'}),/value="2026-01-06"/);
 const blank=fields(undefined);assert.match(blank,/Choose a timing rule/);assert.doesNotMatch(blank,/First three scheduled dates:/);
});
test('month-end preview differs from same day-number and stored history keeps its original rule',()=>{
 let html=fields({...d,initialDue:'2026-04-30',recurrence:{kind:'calendar-month-end',every:1}});assert.match(html,/2026-04-30 · 2026-05-31 · 2026-06-30/);assert.doesNotMatch(html,/name="calendarOrdinal"/);
 html=fields({...d,initialDue:'2026-04-30',recurrence:{kind:'calendar-months',every:1}});assert.match(html,/2026-04-30 · 2026-05-30 · 2026-06-30/);
 const record={id:'plan',locationId:'a',kind:'maintenance',ownerId:'owner',area:'Executive',revision:2,data:{...d,services:[{id:'service',date:'2026-01-06',scheduledDue:'2026-01-05',performedBy:'Fixture technician',evidence:'Fixture report',note:'Fixture note',by:'owner',at:'2026-01-06T15:00:00Z',plan:d,contact:null,voided:null}]}};
 html=renderToStaticMarkup(React.createElement(MaintenanceCard,{r:record,w,send:()=>{throw Error('Render only')},busy:true,readOnly:true,now:'2026-09-29T12:00:00Z'}));assert.match(html,/First Monday of the month/);assert.match(html,/Scheduled occurrence: 2026-01-05/);assert.match(html,/2026-02-02/);assert.doesNotMatch(html,/<form/);
});
const af={title:'Fixture cooler',assetTag:'TEST-C1',placement:'Fixture kitchen',manufacturer:'',model:'Fixture model',serial:'FIXTURE-SERIAL',sourceRef:'Fixture equipment label',details:'',status:'active',checkedBy:'owner',checkedAt:'2026-01-01T12:00:00Z',retirementNote:'',history:[],versions:[]};
const ar={id:'asset1',kind:'equipment',locationId:'a',ownerId:'owner',area:'Executive',revision:1,data:af};
const link={id:ar.id,revision:1,facts:af,checkedBy:'owner',checkedAt:af.checkedAt};
test('equipment form leaves unknown identifiers blank, retains tags and offers only permitted active links',()=>{
 let html=renderToStaticMarkup(React.createElement(EquipmentFields,{}));assert.match(html,/Leave unknown identifiers blank/);assert.match(html,/name="serial"/);assert.doesNotMatch(html,/value="TEST-C1"/);
 html=renderToStaticMarkup(React.createElement(EquipmentFields,{d:af}));assert.match(html,/<input(?=[^>]*name="assetTag")(?=[^>]*readOnly="")[^>]*>/);
 const scoped={...w,records:[ar,{...ar,id:'foreign',locationId:'b',data:{...af,title:'Foreign marker'}}]};
 html=renderToStaticMarkup(React.createElement(PlanFields,{w:scoped,d:{...d,asset:link}}));assert.match(html,/TEST-C1/);assert.match(html,/FIXTURE-SERIAL/);assert.doesNotMatch(html,/Foreign marker/);assert.match(html,/name="assetRevision" value="1"/);
});
test('stale or retired equipment blocks the service form without hiding overdue plans or retained service snapshots',()=>{
 const r={id:'plan',locationId:'a',kind:'maintenance',ownerId:'owner',area:'Executive',revision:1,data:{...d,asset:link}};
 const render=(records,readOnly=false)=>renderToStaticMarkup(React.createElement(MaintenanceCard,{r,w:{...w,records},send:async()=>false,busy:false,now:'2026-09-29T12:00:00Z',readOnly}));
 let html=render([ar]);assert.match(html,/Record completed service/);
 html=render([{...ar,revision:2,data:{...af,serial:'Changed serial'}}]);assert.match(html,/Linked equipment is changed/);assert.match(html,/FIXTURE-SERIAL/);assert.doesNotMatch(html,/Record completed service/);assert.match(html,/Next due/);
 html=render([{...ar,data:{...af,status:'retired'}}]);assert.match(html,/Linked equipment is retired/);assert.doesNotMatch(html,/Record completed service/);
 html=render([],true);assert.match(html,/FIXTURE-SERIAL/);assert.doesNotMatch(html,/<form/);assert.doesNotMatch(html,/Linked equipment is unavailable/);
});
test('managers can read equipment register but cannot see owner editing controls or retired equipment',()=>{
 const manager={...me,id:'manager',capabilities:['tasks.manage']},mw={...w,me:manager,members:[me,manager],records:[ar,{...ar,id:'retired',data:{...af,status:'retired',title:'Retired marker'}}]};
 const html=renderToStaticMarkup(React.createElement(EquipmentRegister,{w:mw,send:async()=>false,busy:false}));assert.match(html,/TEST-C1/);assert.doesNotMatch(html,/Retired marker|Add checked equipment|<form/);
});

const {EquipmentCard}=await import('../.sites-runtime/team/equipment.mjs');
test('filed equipment detail retains source and versions with no edit, retirement or reactivation forms',()=>{
 const r={...ar,data:{...af,status:'retired',retirementNote:'Fictional retirement',history:[{action:'retired',actorId:'owner',at:'2026-01-01T12:00:00Z',note:'Fictional retirement'}],versions:[{facts:{...af,placement:'Old fixture location'},by:'owner',at:'2026-01-01T12:00:00Z',reason:'Fictional corrected source'}]}};
 const html=renderToStaticMarkup(React.createElement(EquipmentCard,{r,w,send:()=>{throw Error('Render must not write')},busy:false,readOnly:true}));
 assert.match(html,/Filed equipment history is read-only/);assert.match(html,/Restoration keeps this asset retired/);assert.match(html,/Old fixture location/);assert.match(html,/FIXTURE-SERIAL/);assert.doesNotMatch(html,/<form|Save checked equipment revision|Recheck and reactivate/);
 const live=renderToStaticMarkup(React.createElement(EquipmentCard,{r,w,send:async()=>false,busy:false}));assert.match(live,/Recheck and reactivate equipment/);
});
test('register explains owner-reviewed filing and retained asset tags',()=>{
 const html=renderToStaticMarkup(React.createElement(EquipmentRegister,{w,send:async()=>false,busy:false}));assert.match(html,/Owners can file older retired equipment/);assert.match(html,/Filed asset tags remain reserved/);
});
const costEvent={id:'cost1',kind:'recorded',amountCents:12345,currency:'USD',documentDate:'2026-09-28',sourceRef:'Fixture invoice <1>',allocation:'Service share includes tax',note:'Fixture checked amount',by:'owner',at:'2026-09-29T12:00:00Z'};
const costEntry={id:'svc',date:'2026-09-28',performedBy:'Fixture technician',evidence:'Fixture report',note:'Fixture complete',by:'owner',at:costEvent.at,plan:d,contact:null,voided:null,costHistory:[costEvent]};
function costCard(entry=costEntry,options={}){return renderToStaticMarkup(React.createElement(MaintenanceCard,{r:{id:'plan',locationId:'a',kind:'maintenance',ownerId:'owner',revision:1,data:{...d,services:[entry]}},w,send(){throw Error('Render only')},busy:false,now:'2026-09-30T02:00:00Z',...options}));}
test('cost display distinguishes unknown from checked zero and safely retains source and allocation',()=>{
 let html=costCard();assert.match(html,/\$123.45 USD/);assert.match(html,/Fixture invoice &lt;1&gt;/);assert.match(html,/Service share includes tax/);assert.match(html,/not a payment status or an accounting total/);assert.match(html,/max="2026-09-29"/);
 html=costCard({...costEntry,costHistory:[]});assert.match(html,/Cost not entered; amount unknown/);assert.match(html,/1 without a current cost/);
 html=costCard({...costEntry,costHistory:[{...costEvent,amountCents:0}]});assert.match(html,/No charge recorded/);assert.match(html,/0 without a current cost/);
});
test('filed and voided cost evidence stays readable without forms and withdraw does not erase prior amount',()=>{
 let html=costCard(costEntry,{readOnly:true});assert.match(html,/Fixture invoice &lt;1&gt;/);assert.doesNotMatch(html,/<form|Correct service cost|Withdraw incorrect cost/);
 html=costCard({...costEntry,voided:{by:'owner',at:costEvent.at,reason:'Wrong task'}},{readOnly:true});assert.match(html,/1 voided service records excluded/);assert.match(html,/Excluded because the service was voided/);
 html=costCard({...costEntry,costHistory:[costEvent,{id:'withdraw',kind:'withdrawn',by:'owner',at:costEvent.at,note:'Fictional incorrect allocation'}]},{readOnly:true});assert.match(html,/Cost withdrawn; amount unknown/);assert.match(html,/\$123.45 USD/);assert.match(html,/Fictional incorrect allocation/);
});
test('assigned manager gets first cost form only while owner can correct independently of equipment changes',()=>{
 const manager={...me,id:'manager',capabilities:['tasks.manage']},mw={...w,me:manager};
 const render=(events,who=mw)=>renderToStaticMarkup(React.createElement(MaintenanceCard,{r:{id:'p',kind:'maintenance',locationId:'a',data:{...d,managerId:'manager',services:[{...costEntry,costHistory:events}]}},w:who,send:async()=>false,busy:false,now:costEvent.at}));
 assert.match(render([]),/Record service cost/);assert.doesNotMatch(render([costEvent]),/Correct service cost|Withdraw incorrect cost/);assert.match(render([costEvent],w),/Correct service cost/);
});
