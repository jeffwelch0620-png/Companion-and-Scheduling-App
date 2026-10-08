import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCommand} from '../.sites-runtime/shared/domain.mjs';
import {workforceContext} from '../.sites-runtime/shared/workforce-context.mjs';
import {checkedCompanionAnswer} from '../.sites-runtime/shared/companion-requirements.mjs';
import {timeOffShifts} from '../.sites-runtime/shared/time-off-impact.mjs';
const at='2026-09-17T23:40:00.000Z';
const period={start:'2026-09-18T21:00:00.000Z',end:'2026-09-19T03:00:00.000Z'};
function fixture(){
 const manager={id:'manager',locationId:'fictional',name:'Fictional Manager',position:'Manager',area:'FOH',capabilities:['schedule.manage','schedule.publish','schedule.change'],qualifications:['Server']};
 const employee={...manager,id:'employee',name:'Fictional Employee',position:'Server',capabilities:[]};
 const record=(id,kind,data,ownerId='employee')=>({id,kind,data,ownerId,locationId:'fictional',area:'FOH',revision:1,updatedAt:at});
 const shift=record('shift','shift',{...period,personId:employee.id,position:'Server',published:true,cancelled:false,history:[{action:'published',at:'2026-09-17T22:00:00.000Z',actorId:'manager',note:'fixture'},{action:'edited',at,actorId:'manager',note:'PRIVATE_EDIT_NOTE'}]});
 const request=record('off','request',{...period,start:'2026-09-18T22:00:00.000Z',type:'time-off',status:'pending',note:'fictional request'});
 const leadership=record('leader','leadership',{...period,personId:manager.id,area:'FOH',active:true,note:'fixture'},manager.id);
 return {w:{location:{id:'fictional',name:'Fictional',timezone:'America/New_York',revision:1},me:manager,members:[manager,employee],records:[shift,request,leadership]},shift,request,employee};
}

test('a recorded shift edit is available to AI without private notes or invented previous hours',()=>{
 const f=fixture();f.w.me=f.employee;const context=workforceContext(f.w,'Has my next shift changed?',at);
 const facts=context.evidence[0].facts.shifts[0];assert.equal(facts.change.recordedEdit,true);assert.equal(facts.change.previousHoursAvailable,false);
 assert.ok(!JSON.stringify(context).includes('PRIVATE_EDIT_NOTE'));
 const source={id:'shift',kind:'shift',revision:1,title:'Fictional shift'};
 const answer=checkedCompanionAnswer(f.w,[source],'Has my next shift changed?','It is still the same shift.',at);
 assert.match(answer,/was edited/);assert.match(answer,/5:00 PM/);assert.match(answer,/11:00 PM/);assert.doesNotMatch(answer,/still the same/);
 f.shift.data.history=[];assert.match(checkedCompanionAnswer(f.w,[source],'Has my next shift changed?','No change.',at),/does not establish whether/);
 // No cited personal shift means the checker must not reveal other work.
 f.shift.ownerId='other';assert.match(checkedCompanionAnswer(f.w,[source],'Has my next shift changed?','No authorized shift.',at),/assigned to your own name/);
 // Managers can read the team's shifts but must not be told those are their own.
 f.w.me=f.w.members[0];assert.match(checkedCompanionAnswer(f.w,[source],'When do I work next?','Your shift is 5 to 11.',at),/assigned to your own name/);
});

test('time-off preview includes complete overlapping shifts, even for a partial-day request',()=>{
 const f=fixture();f.w.records.push({...f.shift,id:'other-location',locationId:'other'},{...f.shift,id:'other-person',ownerId:'other'},{...f.shift,id:'cancelled',data:{...f.shift.data,cancelled:true}});
 assert.deepEqual(timeOffShifts(f.w.records,f.request).map(s=>s.id),['shift']);
});

test('reviewed time-off approval cancels the exact shift and notifies the employee',()=>{
 const f=fixture(),changes=applyCommand(f.w,{locationId:'fictional',requestId:'review',recordId:'off',expectedRevision:1,action:'request.review',input:{approve:true,note:'Fictional approval',affectedShifts:[{id:'shift',revision:1}]}},at);
 assert.equal(changes.find(r=>r.id==='shift').data.cancelled,true);assert.equal(changes.find(r=>r.id==='off').data.status,'approved');
 assert.ok(changes.some(r=>r.kind==='message'&&r.data.recipients.includes('employee')));
 assert.equal(f.shift.data.cancelled,false);
});

test('time-off approval rejects changed, added or duplicate reviewed shifts without changing the request',()=>{
 for(const snapshot of [[],[{id:'shift',revision:0}],[{id:'shift',revision:1},{id:'shift',revision:1}]]){
  const f=fixture();assert.throws(()=>applyCommand(f.w,{locationId:'fictional',requestId:'review',recordId:'off',expectedRevision:1,action:'request.review',input:{approve:true,note:'Fictional approval',affectedShifts:snapshot}},at),e=>e.status===409);assert.equal(f.request.data.status,'pending');assert.equal(f.shift.data.cancelled,false);
 }
 const f=fixture();f.w.records.push({...f.shift,id:'new-shift'});assert.throws(()=>applyCommand(f.w,{locationId:'fictional',requestId:'review',recordId:'off',expectedRevision:1,action:'request.review',input:{approve:true,note:'Fictional approval',affectedShifts:[{id:'shift',revision:1}]}},at),e=>e.status===409);
});

test('time-off preview never grants a manager unassigned published-shift authority',()=>{
 const f=fixture();f.w.records=f.w.records.filter(r=>r.kind!=='leadership');
 assert.throws(()=>applyCommand(f.w,{locationId:'fictional',requestId:'review',recordId:'off',expectedRevision:1,action:'request.review',input:{approve:true,note:'Fictional approval',affectedShifts:[{id:'shift',revision:1}]}},at),e=>e.status===403);
});
