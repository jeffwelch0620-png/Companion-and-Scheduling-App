import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

// Root prepares this existing team render output once before this focused suite.
// This suite generates no modules, builds, fixtures on disk or live requests.
const {WorkspaceForm,RecordDetail}=await import('../.sites-runtime/food-navigation-team/workspace-forms.mjs');
const {FollowForm,FollowDetail}=await import('../.sites-runtime/food-navigation-team/followthrough-forms.mjs');
const {CompanionChat}=await import('../.sites-runtime/food-navigation-team/companion-chat.mjs');
const {OperationsHome}=await import('../.sites-runtime/food-navigation-team/operations-home.mjs');
const now='2026-10-07T23:00:00Z';
function fixture(){
 const employee={id:'cook',locationId:'berts',name:'Fictional Cook',position:'Cook',area:'BOH',capabilities:[],qualifications:['Cook','Pizza'],scheduleJobs:['Cook']};
 const manager={...employee,id:'manager',name:'Fictional Manager',position:'Manager',capabilities:['tasks.manage','close.confirm','close.verify'],qualifications:[]};
 const incoming={...employee,id:'incoming',name:'Fictional Incoming'};
 const make=(id,kind,data,ownerId='cook',area='BOH',locationId='berts')=>({id,kind,data,ownerId,area,locationId,revision:1,updatedAt:now,createdAt:now});
 const shift=make('shift-pizza','shift',{start:'2026-10-07T20:00:00Z',end:'2026-10-08T02:00:00Z',position:'Cook',stationId:'station-pizza',stationName:'Pizza',published:true,cancelled:false,history:[]});
 const guide=make('guide-pizza','standard',{title:'Approved Pizza close',zone:'Pizza',position:'Pizza',status:'approved',version:1,verification:'manager',criteria:['Pizza close ready'],source:'Fictional approved source',guide:{purpose:'Fictional source',preparation:[],steps:['Fictional close instruction'],troubleshooting:[],escalation:'Ask manager'}});
 const station=make('station-pizza','station',{title:'Pizza',status:'active',setup:{jobs:['Cook'],memberIds:['cook'],allJobMembers:false,standardIds:[guide.id],goals:[]}});
 const task=make('required-work','task',{title:'Required station reset',detail:'Fictional required work',kind:'task',phase:'open',shiftId:shift.id,due:shift.data.end,history:[]});
 const close=make('close-pizza','close',{shiftId:shift.id,standardId:guide.id,standardRevision:guide.revision,managerId:manager.id,phase:'open',due:shift.data.end,answers:[],history:[],standard:guide.data});
 const extra=[make('draft-shift','shift',{...shift.data,published:false}),make('cancelled-shift','shift',{...shift.data,cancelled:true}),make('released-shift','shift',{...shift.data,releasedAt:now}),make('other-shift','shift',shift.data,'incoming'),make('foreign-shift','shift',shift.data,'cook','BOH','rudds'),make('wrong-area-shift','shift',shift.data,'cook','FOH')];
 const leader=make('closing-leader','leadership',{personId:manager.id,area:'BOH',start:shift.data.start,end:shift.data.end,active:true,note:'Fictional named closing coverage'},manager.id);
 const w={location:{id:'berts',name:'Fictional Bert’s',timezone:'America/New_York',revision:1},me:manager,members:[manager,employee,incoming],records:[shift,guide,station,task,close,leader,...extra]};
 return {w,shift,guide,task,close,employee,incoming};
}
const props=f=>({w:f.w,send(){throw Error('Rendering must not submit actions')},onError(){},onOpen(){},onWeek(){},onGuides(){},onAskWeek(){},now,apiRoot:'/api'});
const render=(Component,properties)=>renderToStaticMarkup(React.createElement(Component,properties));

test('manager daily brief keeps closing checks and the separate checkout route visible',()=>{
 const f=fixture(),p={w:f.w,now,onNavigate(){},onIssue(){},onFollowup(){}};
 const pending=render(OperationsHome,p);
 assert.match(pending,/Closing checks and checkout/);
 assert.match(pending,/2 pending closing checks/);
 assert.match(pending,/Open shift duties &amp; checkout/);
 f.close.data.phase='closed';f.task.data.phase='closed';
 const complete=render(OperationsHome,p);
 assert.match(complete,/0 pending closing checks/);
 assert.match(complete,/1 shift ready for manager checkout/);
});

test('Cook shift can select its approved Pizza station close rather than only Cook-titled guides',()=>{
 const f=fixture(),html=render(WorkspaceForm,{...props(f),kind:'close',record:f.shift,day:'2026-10-07'});
 assert.match(html,/<option value="guide-pizza" selected="">Approved Pizza close/);
 const invalid=render(WorkspaceForm,{...props(f),w:{...f.w,records:f.w.records.filter(r=>r.id!==f.guide.id)},kind:'close',record:f.shift,day:'2026-10-07'});
 assert.match(invalid,/No approved closing standard matches/);assert.doesNotMatch(invalid,/value="guide-pizza"/);
});

test('shift-linked task form exposes only this employee’s eligible published shift and defaults due to shift end',()=>{
 const f=fixture(),html=render(FollowForm,{...props(f),kind:'task',record:f.shift});
 assert.match(html,/Required for shift checkout/);assert.match(html,/<option value="shift-pizza" selected="">Pizza/);assert.match(html,/No shift checkout requirement/);
 for(const id of ['draft-shift','cancelled-shift','released-shift','other-shift','foreign-shift','wrong-area-shift'])assert.doesNotMatch(html,new RegExp('<option value="'+id+'"'));
 assert.match(html,/name="dueTime"[^>]*value="22:00"/);
});

test('shift drawer exposes actual closing records and disables checkout until linked checks finish',()=>{
 const f=fixture(),pending=render(RecordDetail,{...props(f),record:f.shift});
 assert.match(pending,/Required station reset · open/);assert.match(pending,/Approved Pizza close · open/);assert.match(pending,/<button disabled="">Confirm checkout/);
 f.task.data.phase='closed';f.close.data.phase='closed';const ready=render(RecordDetail,{...props(f),record:f.shift});assert.match(ready,/<button>Confirm checkout/);assert.doesNotMatch(ready,/<button disabled="">Confirm checkout/);
});

test('accepted incoming checkout handoff remains actionable work, carries responsibility, and opens its original shift',()=>{
 const f=fixture();f.task.ownerId=f.incoming.id;f.task.data.kind='handoff';f.task.data.incomingId=f.incoming.id;f.task.data.closingHandoff={outgoingId:f.employee.id,acceptedBy:f.incoming.id,acceptedAt:now};
 const html=render(FollowDetail,{...props(f),w:{...f.w,me:f.incoming},record:f.task});assert.match(html,/Received by Fictional Incoming from Fictional Cook/);assert.match(html,/Incoming work ready for physical check/);assert.match(html,/Open linked shift/);assert.doesNotMatch(html,/Reassign the remaining work/);
});

test('close and task attachments remain current and have appropriate closing or work conversation entry points',()=>{
 const f=fixture();for(const record of [f.close,f.task]){const html=render(CompanionChat,{...props(f),w:{...f.w,me:f.employee},focus:{id:record.id,kind:record.kind,revision:record.revision,title:record.kind==='close'?record.data.standard.title:record.data.title}});assert.match(html,/ · Attached/);assert.match(html,/Open attached work/);assert.doesNotMatch(html,/Needs refresh|no longer available/);assert.match(html,record.kind==='close'?/Who has the next required check\?/:/Who has the next step for this work\?/);}
});
