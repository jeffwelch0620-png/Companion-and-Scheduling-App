import test from 'node:test';
import assert from 'node:assert/strict';
import {workforceContext} from '../.sites-runtime/shared/workforce-context.mjs';
import {publicWorkspace} from '../.sites-runtime/shared/domain.mjs';
import {shiftContextWorkspace} from '../.sites-runtime/shared/shift-context.mjs';
const at='2026-10-08T01:00:00.000Z';

test('explicit ordinary task attachment stays narrowly readable without becoming checkout work',()=>{
 const f=fixture(),task=f.w.records.find(r=>r.id==='unlinked');
 const context=workforceContext(f.w,'Explain this task.',at,[],{id:task.id,revision:task.revision});
 assert.equal(context.context.scopeMode,'selected-task');
 assert.deepEqual(context.evidence.map(e=>e.source.id),['unlinked']);
 assert.equal(context.context.selectedEmployee.id,f.employee.id);
 assert.match(context.context.limits.join(' '),/unlinked task does not block shift checkout/i);
});
function fixture(){
 const person=(id,position='Host',capabilities=[])=>({id,locationId:'berts',name:'Fictional '+id,area:'FOH',position,capabilities,qualifications:['Host'],scheduleJobs:[position]});
 const employee=person('employee'),other=person('OTHER_WORKER'),manager=person('manager','Manager',['tasks.manage','close.confirm','schedule.manage']),helper=person('helper');
 const r=(id,kind,ownerId,data)=>({id,kind,ownerId,data,locationId:'berts',area:'FOH',revision:1,updatedAt:at});
 const standard=r('guide','standard','manager',{title:'Host closing guide',zone:'Podium',position:'Host',version:1,status:'approved',source:'Fictional fixture',validationNote:'Fixture only',verification:'manager',criteria:['Menus wiped','Boosters cleaned'],history:[],guide:{purpose:'Fictional Host closing practice',preparation:[],steps:['Fictional menus and booster cleaning method'],troubleshooting:[],escalation:'Ask the assigned manager'}});
 const shift=r('shift','shift','employee',{personId:'employee',position:'Host',start:'2026-10-07T20:00:00.000Z',end:'2026-10-08T02:00:00.000Z',published:true,cancelled:false});
 const close=r('close','close','employee',{shiftId:'shift',standardId:'guide',standardRevision:1,standard:standard.data,managerId:'manager',due:shift.data.end,phase:'open',history:[]});
 const task=r('linked-task','task','employee',{shiftId:'shift',title:'Linked closing help',detail:'Fictional silverware backlog',kind:'task',phase:'open',due:shift.data.end,history:[]});
 const leader=r('leader','leadership','manager',{personId:'manager',area:'FOH',start:shift.data.start,end:shift.data.end,active:true,note:'Fictional authority fixture'});
 const hidden=[r('other-shift','shift','OTHER_WORKER',{...shift.data,personId:'OTHER_WORKER'}),r('other-close','close','OTHER_WORKER',{...close.data,shiftId:'other-shift',managerId:'OTHER_WORKER'}),r('other-task','task','OTHER_WORKER',{...task.data,shiftId:'other-shift',title:'OTHER_PRIVATE_TASK'}),r('unlinked','task','employee',{...task.data,shiftId:undefined,title:'UNRELATED_TASK'}),r('inbox','message','manager',{title:'PRIVATE_INBOX',body:'PRIVATE_CONVERSATION',recipients:['employee'],readBy:[],replies:[]})];
 const w={location:{id:'berts',name:'Fictional Bert’s',timezone:'America/New_York',revision:1},me:employee,members:[employee,other,manager,helper],records:[standard,shift,close,task,leader,...hidden]};
 return {w,employee,manager,helper,standard,shift,close,task,leader};
}
const selected=r=>({id:r.id,revision:r.revision});
const facts=(context,id)=>context.evidence.find(e=>e.source.id===id)?.facts;

test('selected shift includes its closing assignment and explicitly linked task without unrelated worker or Inbox evidence',()=>{
 const f=fixture(),before=JSON.stringify(f.w),c=workforceContext(f.w,'What remains before I leave?',at,[],selected(f.shift));
 assert.equal(c.context.scopeMode,'selected-shift');assert.ok(facts(c,'close'));assert.ok(facts(c,'linked-task'));assert.match(facts(c,'close').guide.steps.join(' '),/menus and booster/);
 assert.doesNotMatch(JSON.stringify(c),/OTHER_WORKER|OTHER_PRIVATE_TASK|PRIVATE_INBOX|PRIVATE_CONVERSATION|UNRELATED_TASK/);assert.equal(JSON.stringify(f.w),before);
 assert.match(c.context.limits.join(' '),/never saves Ready.*verifies work.*releases a shift/);
});

test('general closing question and close follow-up use authorized assigned closing work',()=>{
 const f=fixture();
 for(const [question,focus] of [['What remains before I leave?',[]],['What is my closing work?',[]],['What happens next?',[{...selected(f.close),kind:'close',title:'Host close'}]]]){
  const c=workforceContext(f.w,question,at,focus);assert.equal(c.context.scopeMode,'my-closing-work');assert.ok(facts(c,'close'));assert.ok(facts(c,'linked-task'));assert.doesNotMatch(JSON.stringify(c),/OTHER_WORKER|UNRELATED_TASK|PRIVATE_CONVERSATION/);
 }
});

test('missing, retired, or changed guide keeps the saved close but never supplies its embedded old method',()=>{
 for(const alter of [f=>f.w.records=f.w.records.filter(r=>r.id!=='guide'),f=>f.standard.data.status='retired',f=>f.standard.revision=2]){
  const f=fixture();alter(f);const c=workforceContext(f.w,'Explain my closing assignment.',at,[],selected(f.close)),e=facts(c,'close');
  assert.equal(e.approvedInstructionCurrent,false);assert.equal(e.guide,undefined);assert.equal(e.conditions,undefined);assert.doesNotMatch(JSON.stringify(c),/Fictional menus and booster cleaning method/);assert.ok(!c.scope.some(s=>s.id==='guide'));
  const general=workforceContext(f.w,'What is my closing work?',at);assert.equal(facts(general,'close').approvedInstructionCurrent,false);assert.doesNotMatch(JSON.stringify(general),/Fictional menus and booster cleaning method/);
 }
});

test('correction includes exact manager instruction and named helper without declaring the physical check complete',()=>{
 const f=fixture();f.close.data.phase='correction';f.close.data.correction={personId:'helper',assignedBy:'manager',assignedAt:at,note:'Help the assigned closer'};f.close.data.history=[{actorId:'manager',action:'fix',note:'Fictional booster still sticky; repeat approved wipe.',at}];
 f.w.me=f.helper;const c=workforceContext(f.w,'What correction do I need to do?',at,[],selected(f.close)),e=facts(c,'close');
 assert.equal(e.phase,'correction');assert.match(e.signedInResponsibilities,/assigned correction helper/);assert.equal(e.helper,'Fictional helper');assert.match(e.nextAction,/Correct and request another check/);assert.match(e.lastRecordedSteps[0].note,/booster still sticky/);assert.match(e.appWorkflow.recording,/chat statement does not/);
});

test('waiting manager retains the assigned physical-check role and receives the next step',()=>{
 const f=fixture();f.close.data.phase='manager-confirmation';f.w.me=f.manager;
 const c=workforceContext(f.w,'What closing check is waiting for me?',at,[],selected(f.close)),e=facts(c,'close');
 assert.match(e.signedInResponsibilities,/named closing manager/);assert.equal(e.nextAction,'Perform the final physical check');assert.deepEqual(e.appWorkflow.physicalCheckOrder,['Fictional manager']);
 const employee=workforceContext({...f.w,me:f.employee},'What is my closing next step?',at,[],selected(f.close));assert.equal(facts(employee,'close').nextAction,'Waiting for Fictional manager');
});

test('stale, foreign, and unauthorized close attachments fail rather than importing another employee',()=>{
 const f=fixture();assert.throws(()=>workforceContext(f.w,'this',at,[],{id:'close',revision:0}),/changed/);assert.throws(()=>workforceContext(f.w,'this',at,[],{id:'other-close',revision:1}),/no longer available/);
 f.close.locationId='elsewhere';assert.throws(()=>workforceContext(f.w,'this',at,[],selected(f.close)),/no longer available/);
});

test('manager selected shift is narrowed even when the manager can read the whole department',()=>{
 const f=fixture();f.w.me=f.manager;f.w.records.push({...f.shift,id:'manager-own-shift',ownerId:'manager',data:{...f.shift.data,personId:'manager',position:'Manager'}});const w=publicWorkspace(f.w,at),scoped=shiftContextWorkspace(w,f.shift);assert.ok(scoped.records.some(r=>r.id==='close'));assert.ok(scoped.records.some(r=>r.id==='linked-task'));assert.ok(scoped.records.some(r=>r.id==='leader'));assert.ok(!scoped.records.some(r=>r.id==='other-close'));
 const c=workforceContext(f.w,'What remains before this employee leaves?',at,[],selected(f.shift));assert.equal(c.context.selectedEmployee.id,'employee');assert.equal(c.context.selectedShift.id,'shift');assert.doesNotMatch(JSON.stringify(c),/OTHER_WORKER|OTHER_PRIVATE_TASK|UNRELATED_TASK|PRIVATE_CONVERSATION|manager-own-shift/);
});

test('explicit task focus stays linked to its shift and does not pad missing operating instructions',()=>{
 const f=fixture(),c=workforceContext(f.w,'What should I finish?',at,[],selected(f.task));assert.equal(c.context.scopeMode,'selected-closing-work');assert.ok(facts(c,'linked-task'));assert.ok(facts(c,'shift'));assert.ok(!facts(c,'close'));assert.ok(!facts(c,'guide'));assert.doesNotMatch(JSON.stringify(c),/OTHER_WORKER|UNRELATED_TASK|menus and booster cleaning method/);
});

test('a current shift does not erase earlier unfinished closing work from a general closing question',()=>{
 const f=fixture(),prior={...f.close,id:'prior-close',data:{...f.close.data,shiftId:'prior-shift',due:'2026-10-07T02:00:00.000Z',phase:'correction'}},shift={...f.shift,id:'prior-shift',data:{...f.shift.data,start:'2026-10-06T20:00:00.000Z',end:'2026-10-07T02:00:00.000Z'}};f.w.records.push(prior,shift);
 const c=workforceContext(f.w,'What remains in my closing work for my shift today?',at);assert.ok(facts(c,'prior-close'));assert.ok(facts(c,'close'));assert.doesNotMatch(JSON.stringify(c),/OTHER_WORKER/);
});

test('accepted linked closing handoff remains in outgoing shift context and both participants can follow the remaining work',()=>{
 const f=fixture();f.task.ownerId='helper';f.task.data.incomingId='helper';f.task.data.closingHandoff={outgoingId:'employee',acceptedBy:'helper',acceptedAt:at};
 const c=workforceContext(f.w,'What remains before I leave?',at,[],selected(f.shift));assert.ok(facts(c,'linked-task'));assert.equal(facts(c,'linked-task').owner,'Fictional helper');assert.equal(facts(c,'linked-task').closingHandoff.outgoingId,'employee');
 const general=workforceContext(f.w,'What remains in my closing work?',at);assert.ok(facts(general,'linked-task'));
 const incoming=workforceContext({...f.w,me:f.helper},'What closing work did I receive?',at);assert.ok(facts(incoming,'linked-task'));assert.equal(facts(incoming,'linked-task').owner,'Fictional helper');assert.doesNotMatch(JSON.stringify(incoming),/OTHER_WORKER|PRIVATE_CONVERSATION/);
});

test('completed checks and linked work still explain separate pending manager checkout',()=>{
 const f=fixture();f.close.data.phase='closed';f.task.data.phase='closed';const after='2026-10-08T03:00:00.000Z',before=JSON.stringify(f.w);
 for(const c of [workforceContext(f.w,'What remains before I leave?',after),workforceContext(f.w,'What remains before I leave?',after,[],selected(f.shift))]){
  assert.equal(c.context.closingStatus.releaseRecorded,false);assert.equal(c.context.closingStatus.assignedCloses[0].phase,'closed');assert.equal(c.context.closingStatus.linkedTasks[0].phase,'closed');assert.equal(c.context.closingStatus.nextAction,'Waiting for manager checkout');assert.match(c.context.closingStatus.meaning,/separate manager release/);
 }
 assert.equal(JSON.stringify(f.w),before);
});
