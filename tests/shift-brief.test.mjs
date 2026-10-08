import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShiftBrief } from '../.sites-runtime/shared/shift-brief.mjs';
const now='2026-09-07T02:00:00.000Z'; // 10 PM on September 6 in the restaurant.
const member=(id,caps=[],position='Server',area='FOH')=>({id,locationId:'restaurant',name:id,position,area,capabilities:caps,qualifications:[position]});
const people=[member('employee'),member('senior',['close.verify']),member('manager',['tasks.manage','close.confirm','schedule.manage','schedule.change','people.manage']),member('other-manager',['tasks.manage','close.confirm','schedule.manage','schedule.change','people.manage']),member('gm',['people.approve']),member('dish',[],'Dishwasher','BOH')];
const record=(id,kind,ownerId,data)=>({id,kind,ownerId,locationId:'restaurant',area:'FOH',revision:1,updatedAt:now,data});
const standard={title:'Station close',zone:'Server Station',position:'Server',criteria:['Counter ready','Stock counted'],source:'Fictional test conditions',version:3,verification:'senior-then-manager',status:'approved',validationNote:'Test only',history:[]};
const shift=record('shift','shift','employee',{personId:'employee',start:'2026-09-06T20:00:00.000Z',end:'2026-09-07T03:00:00.000Z',published:true,cancelled:false,position:'Server'});
const close=(phase='open')=>record('close','close','employee',{shiftId:'shift',standardId:'standard',standardRevision:1,standard,verifierId:'senior',managerId:'manager',due:shift.data.end,phase,history:[]});
const leader=record('leader','leadership','manager',{personId:'manager',area:'FOH',start:shift.data.start,end:shift.data.end,active:true,note:'Assigned leader'});
function workspace(actor,records=[]){return structuredClone({location:{id:'restaurant',name:'Test restaurant',timezone:'America/New_York',revision:1},me:people.find(p=>p.id===actor),members:people,records:[shift,record('standard','standard','manager',standard),leader,...records]})}
function item(actor,r){return buildShiftBrief(workspace(actor,[r]),now).items.find(i=>i.record.id===r.id)}
test('shift briefing follows each named closing participant and never implies submission is completion',()=>{
 assert.equal(item('employee',close()).lane,'action');
 assert.equal(item('employee',close('verification')).lane,'waiting');
 assert.match(item('employee',close('verification')).next,/senior/);
 assert.equal(item('senior',close('verification')).lane,'action');
 assert.equal(item('manager',close('verification')).lane,'waiting');
 assert.equal(item('manager',close('manager-confirmation')).lane,'action');
 assert.equal(item('other-manager',close('manager-confirmation')).lane,'waiting');
 assert.equal(item('employee',close('closed')),undefined);
 const b=buildShiftBrief(workspace('employee',[close()]),now);assert.equal(b.today,'2026-09-06');assert.equal(b.current.id,'shift');
});
test('manager checkout is a separate next action only after every required closing check passes',()=>{
 assert.equal(buildShiftBrief(workspace('manager',[close('verification')]),now).items.some(i=>i.record.id==='shift'),false);
 assert.match(buildShiftBrief(workspace('manager',[close('closed')]),now).items.find(i=>i.record.id==='shift').next,/Confirm operational checkout/);
 assert.equal(buildShiftBrief(workspace('employee',[close('closed')]),now).items.find(i=>i.record.id==='shift').lane,'waiting');
 assert.equal(buildShiftBrief(workspace('other-manager',[close('closed')]),now).items.some(i=>i.record.id==='shift'),false);
 const w=workspace('manager',[close('closed')]);w.records.find(r=>r.id==='shift').data={...shift.data,releasedAt:now};assert.equal(buildShiftBrief(w,now).items.some(i=>i.record.id==='shift'),false);
});
test('a retired standard or unpublished shift produces an explanation rather than a ready-for-check prompt',()=>{
 const w=workspace('employee',[close()]);w.records.find(r=>r.kind==='standard').data={...standard,status:'retired'};
 assert.equal(buildShiftBrief(w,now).items[0].lane,'waiting');assert.match(buildShiftBrief(w,now).items[0].reason,/no longer approved/);
 const draft=workspace('manager',[close()]);draft.records.find(r=>r.id==='shift').data={...shift.data,published:false};assert.match(buildShiftBrief(draft,now).items.find(i=>i.record.id==='close').reason,/not active and published/);
});
test('privacy and Dish scope apply even when passed an unfiltered workspace',()=>{
 const note=record('private-note','feedback','employee',{text:'Private employee information',shared:false,status:'private',response:'',due:'',history:[]});
 const review=record('private-review','development','employee',{managerId:'manager',approverId:'gm',originalDueDate:'2026-09-05',phase:'self-assessment',selfShared:false,managerShared:false,selfSummary:'Secret draft',managerSummary:'',stations:[],submissions:[],managerDiscussion:'',employeeDiscussion:'',history:[]});
 const w=workspace('other-manager',[close(),note,review]);assert.equal(buildShiftBrief(w,now).items.some(i=>['private-note','private-review'].includes(i.record.id)),false);
 assert.deepEqual(buildShiftBrief(workspace('dish',[close(),note,review]),now).items,[]);
 const gmItem=buildShiftBrief(workspace('gm',[review]),now).items[0];assert.equal(gmItem.record.data.selfSummary,'');
});
test('coverage approval appears only for the assigned shift leader after the replacement accepts',()=>{
 const r=record('swap','request','employee',{type:'swap',shiftId:'shift',replacementId:'senior',start:shift.data.start,end:shift.data.end,status:'pending',note:'Cover this shift'});
 assert.equal(item('senior',r).lane,'action');assert.equal(item('manager',r).lane,'waiting');
 r.data.status='accepted-by-replacement';assert.equal(item('manager',r).lane,'action');assert.equal(item('other-manager',r).lane,'waiting');
});
test('tasks are routed by phase and tomorrow work is not presented as due tonight',()=>{
 const r=record('task','task','employee',{title:'Count stock',detail:'Record the actual count',kind:'task',phase:'open',due:'2026-09-08T02:00:00.000Z',history:[]});
 assert.equal(item('employee',r).lane,'later');assert.equal(item('manager',r).lane,'waiting');
 r.data.phase='verification';assert.equal(item('manager',r).lane,'action');assert.equal(item('employee',r).lane,'waiting');
 r.data.phase='correction';assert.equal(item('employee',r).lane,'action');assert.match(item('employee',r).next,/correction/);
});
test('development prompts respect the current conversation participant and date-only due dates',()=>{
 const r=record('review','development','employee',{managerId:'manager',approverId:'gm',originalDueDate:'2026-09-06',phase:'discussion',selfShared:true,managerShared:true,selfSummary:'',managerSummary:'',stations:[],submissions:[],managerDiscussion:'Discussed examples',employeeDiscussion:'',history:[]});
 assert.equal(item('employee',r).lane,'action');assert.equal(item('employee',r).overdue,false);assert.equal(item('employee',r).category,'development');assert.equal(item('manager',r).lane,'waiting');
 r.data.employeeDiscussion='Confirmed';assert.equal(item('manager',r).lane,'action');assert.equal(item('employee',r).lane,'waiting');
 r.data.phase='gm-review';assert.equal(item('gm',r).lane,'action');assert.equal(item('manager',r).lane,'waiting');
});
test('urgent incoming handoffs outrank routine work without taking ownership before acceptance',()=>{
 const w=workspace('manager',[record('task','task','manager',{title:'Routine work',detail:'Test',kind:'task',phase:'open',due:now,history:[]}),record('handoff','handoff','other-manager',{title:'Reported issue',detail:'Safe deferral test',outgoingId:'other-manager',incomingId:'manager',outgoingLeadershipId:'other',incomingLeadershipId:'leader',priority:'urgent',due:now,phase:'offered',history:[]})]);
 const b=buildShiftBrief(w,now);assert.equal(b.items[0].record.id,'handoff');assert.equal(b.items[0].record.ownerId,'other-manager');assert.match(b.items[0].reason,/retains responsibility/);
});
