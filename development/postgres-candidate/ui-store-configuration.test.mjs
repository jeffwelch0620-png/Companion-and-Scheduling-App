import test from 'node:test';import assert from 'node:assert/strict';
import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {configuredLocation,isCheckoutPosition,isCheckoutLabel,checkoutPeople,operationsManager,departmentOrder} from './ui-store-configuration.mjs';
import {stationAssignmentIssue,selectableStations} from './runtime/ui-reference/ui-station-assignment.mjs';
import {dishCheckoutCycleStatus} from './runtime/ui-reference/ui-checkout-cycle-status.mjs';
import {DishCheckoutCycles,DishCheckoutDetail} from './runtime/ui-reference/ui-dish-checkouts.mjs';
import {ScheduleBoard} from './runtime/ui-reference/ui-schedule-board.mjs';
import {ShiftEditor} from './runtime/ui-reference/ui-shift-editor.mjs';
import {loadScheduleScreen} from './schedule-screen-client.mjs';
const member=(id,position='Cook',area='Kitchen',capabilities=[])=>({id,name:id,position,area,capabilities,locationId:'configured',qualifications:[],scheduleJobs:[position]});
const workspace=()=>({location:{id:'configured',name:'Configured fictional store',revision:1,timezone:'Europe/London',configuration:{operatingDepartments:['Service','Kitchen'],dishDepartment:'Kitchen',dishPosition:'Steward',dishAliases:['Steward','Steward PM']}},me:member('manager','Manager','Kitchen',['tasks.manage','schedule.manage']),members:[member('AM','Steward'),member('PM1','Steward'),member('PM2','Steward'),member('alias','Steward PM'),member('ordinary','Dishwasher'),{...member('no-login','Steward'),scheduleOnly:true},member('foreign','Steward','Service')],records:[]});
const render=(component,props)=>renderToStaticMarkup(React.createElement(component,props));
const inert=()=>{};
test('configuration requires explicit valid timezone and store mapping without fallback',()=>{
 const w=workspace();assert.equal(configuredLocation(w.location),w.location);assert.equal(configuredLocation({...w.location,revision:0}).revision,0);
 for(const location of [{...w.location,timezone:undefined},{...w.location,timezone:'Invalid/Zone'},{...w.location,configuration:undefined},{...w.location,configuration:{...w.location.configuration,dishDepartment:'Other'}},{...w.location,configuration:{...w.location.configuration,dishAliases:['Steward',' steward ']}}])assert.throws(()=>configuredLocation(location),/configuration|timezone/);
});
test('primary checkout role remains exact while explicit station aliases normalize whitespace and case',()=>{
 const w=workspace();assert.equal(isCheckoutPosition(w,'Steward'),true);assert.equal(isCheckoutPosition(w,'steward'),false);assert.equal(isCheckoutPosition(w,'Steward PM'),false);
 assert.equal(isCheckoutLabel(w,'STEWARD   PM'),true);assert.equal(isCheckoutLabel(w,'  Steward PM  '),true);for(const job of ['Dishwasher','Dish','Steward / Prep','\tSteward'])assert.equal(isCheckoutLabel(w,job),false);
});
test('checkout selector excludes aliases, other departments, schedule-only and foreign-store members',()=>{
 const w=workspace();w.members.push({...member('other-store','Steward'),locationId:'other'});assert.deepEqual(checkoutPeople(w).map(m=>m.id),['AM','PM1','PM2']);
});
test('configured names grant no management access and store operations retain capability and department scope',()=>{
 const w=workspace();assert.equal(operationsManager(w,member('cook')),false);assert.equal(operationsManager(w,w.me,'Service'),false);
 const store=member('store','Manager','Kitchen',['tasks.manage','operations.store']);assert.equal(operationsManager(w,store,'Service'),true);assert.equal(operationsManager(w,store,'Production'),false);
 assert.equal(operationsManager(w,member('role','Steward','Kitchen',['tasks.manage','location.manage'])),false);
 assert.equal(operationsManager(w,member('weak','Manager','Kitchen',['operations.store']),'Service'),false);
 assert.equal(operationsManager(w,{...store,locationId:'other'},'Service'),false);
});
test('station choices use scoped alias restrictions and retain underlying scheduling eligibility',()=>{
 const w=workspace(),station={id:'station',kind:'station',locationId:'configured',area:'Kitchen',data:{title:'Test station',status:'active',setup:{jobs:['Steward PM','Dishwasher','Cook'],allJobMembers:true}}};w.records=[station];
 assert.match(stationAssignmentIssue(w,w.members[3],'Steward PM','station'),/Checkout jobs/);
 assert.equal(stationAssignmentIssue(w,w.members[4],'Dishwasher','station'),'');assert.equal(selectableStations(w,w.members[3],'Steward PM').length,0);
 assert.match(stationAssignmentIssue(w,member('no-job'), 'Dishwasher','station'),/underlying/);
});
const cycle=w=>{const ids=['AM','PM1','PM2'];w.records=ids.map((id,i)=>({id:'checkout-'+id,kind:'task',locationId:'configured',ownerId:id,area:'Kitchen',revision:1,data:{kind:'task',title:id,phase:'closed',dishCheckout:{cycleId:'cycle',participantIds:ids,businessDate:'2031-01-01',shift:i===0?'AM':'PM'},dishHandoffs:[]}}));return w;};
test('custom-department checkout completion requires all three independent checks',()=>{
 const w=cycle(workspace());assert.equal(dishCheckoutCycleStatus(w,'cycle').complete,true);w.records[1].data.phase='verification';assert.equal(dishCheckoutCycleStatus(w,'cycle').complete,false);w.records.pop();assert.equal(dishCheckoutCycleStatus(w,'cycle').coverageComplete,false);
});
test('checkout cycle projection rejects records from an unconfigured department',()=>{
 const w=cycle(workspace());w.records[2].area='BOH';assert.equal(dishCheckoutCycleStatus(w,'cycle').validShape,false);
});
test('checkout manager form renders a custom mapped cycle with complete independent validation',()=>{
 const html=render(DishCheckoutCycles,{w:cycle(workspace()),send:inert});assert.match(html,/All expected checkouts and linked incoming work are manager validated/);assert.match(html,/Set up AM \/ PM checkouts/);assert.doesNotMatch(html,/Dishwasher/);
});
test('checkout employee sees only their own work and cannot create assignments',()=>{
 const w=cycle(workspace());w.me=w.members[0];const html=render(DishCheckoutCycles,{w,send:inert});assert.match(html,/your checkout only/);assert.doesNotMatch(html,/Set up AM|PM 1|PM 2/);
});
test('incoming handoff detail uses actual store time and neutral role labels',()=>{
 const w=workspace();w.me=w.members[1];const r={id:'handoff',ownerId:'PM1',area:'Kitchen',kind:'task',data:{title:'Test',detail:'Pending',due:'2031-07-01T12:00:00Z',phase:'open',dishHandoff:{businessDate:'2031-07-01',cycleId:'cycle',sourceId:'source'}}};
 const html=render(DishCheckoutDetail,{r,w,send:inert,onError:inert});assert.match(html,/incoming checkout employee/);assert.match(html,/1:00 PM|1:00 pm/);assert.doesNotMatch(html,/Dishwasher/);
});
test('schedule board orders custom departments as configured and retains raw job labels',()=>{
 const w=workspace(),days=['2031-07-01'],shifts=['Kitchen','Service'].map((area,i)=>({id:'shift-'+i,kind:'shift',ownerId:'ordinary',area,locationId:'configured',data:{published:true,position:'Dishwasher',start:'2031-07-01T12:00:00Z',end:'2031-07-01T14:00:00Z'}}));w.members.push(member('manager','Manager'));w.records=shifts;
 const html=render(ScheduleBoard,{w,now:'2031-07-01T00:00:00Z',days,shifts,selected:[],onSelect:inert,onOpen:inert,onDayChange:inert,onRequests:inert,onViewChange:inert,busy:false,pendingRequests:0,view:'day'});
 assert.ok(html.indexOf('>Service<')<html.indexOf('>Kitchen<'));assert.match(html,/Dishwasher/);assert.doesNotMatch(html,/data-job-tone="dish"/);assert.match(html,/1pm|1 PM/);
});
test('shift editor interprets saved shift clocks using the supplied store timezone',()=>{
 const w=workspace(),shift={ownerId:'ordinary',kind:'shift',data:{position:'Dishwasher',published:false,start:'2031-07-01T12:00:00Z',end:'2031-07-01T14:00:00Z'}};
 const html=render(ShiftEditor,{w,day:'2031-07-01',shift,send:inert,onError:inert});assert.match(html,/value="13:00"/);assert.match(html,/value="15:00"/);
});
test('schedule loader rejects absent configuration before reading any records',async()=>{
 let calls=0;await assert.rejects(loadScheduleScreen(async()=>{calls++;return {status:200,body:{location:{id:'configured',revision:1,timezone:'UTC'}}};}),/configuration/);assert.equal(calls,1);
});
