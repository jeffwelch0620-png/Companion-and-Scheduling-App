import test from 'node:test';
import assert from 'node:assert/strict';
import { learningNextStep } from '../.sites-runtime/shared/learning-queue.mjs';
const employee={id:'e',locationId:'a',name:'Employee',area:'FOH',position:'Server',capabilities:[],qualifications:[]},manager={...employee,id:'m',capabilities:['people.manage','people.approve']};
const w={location:{id:'a',timezone:'America/New_York'},me:manager,members:[employee,manager],records:[]},at='2026-09-10T20:00:00Z';
const goal={id:'g',kind:'goal',locationId:'a',area:'FOH',ownerId:'e',revision:1,data:{type:'development',managerId:'m',phase:'proposed',due:'2026-09-10T19:00:00Z'}};
test('learning queue names the next actor without treating employee readiness as confirmed completion',()=>{
 let state=learningNextStep(w,goal,at);assert.equal(state.actorId,'e');assert.equal(state.needsMe,false);assert.equal(state.overdue,true);assert.equal(state.canAsk,false);
 state=learningNextStep(w,{...goal,data:{...goal.data,phase:'verification'}},at);assert.equal(state.actorId,'m');assert.equal(state.needsMe,true);assert.equal(state.ended,false);assert.equal(state.canAsk,true);
 state=learningNextStep(w,{...goal,data:{...goal.data,phase:'closed'}},at);assert.equal(state.overdue,false);assert.equal(state.ended,true);assert.equal(state.canAsk,false);
});

test('employee labels make waiting for a manager and returned practice explicit',()=>{
 const mine={...w,me:employee,members:[employee,{...manager,name:'Morgan'}]};
 assert.equal(learningNextStep(mine,{...goal,data:{...goal.data,phase:'verification'}},at).label,'Waiting for Morgan');
 assert.equal(learningNextStep(mine,{...goal,data:{...goal.data,phase:'active',history:[{action:'fix',note:'Practice together'}]}},at).label,'More practice requested');
});
test('changed guides route goal review to the manager and disable AI shortcuts, missing authority is not an actionable assignment',()=>{
 const linked={...goal,data:{...goal.data,phase:'active',standardId:'s',standardRevision:2}};
 let state=learningNextStep(w,linked,at);assert.equal(state.stale,true);assert.equal(state.actorId,'m');assert.equal(state.canAsk,false);
 state=learningNextStep({...w,members:[employee]},linked,at);assert.equal(state.needsMe,false);assert.equal(state.unavailable,true);
 state=learningNextStep({...w,records:[{id:'s',kind:'standard',area:'FOH',revision:2,data:{status:'approved'}}]},linked,at);assert.equal(state.stale,false);assert.equal(state.actorId,'e');assert.equal(state.canAsk,true);
});
test('review queue follows employee, manager conversation, employee response and final approval; due date uses restaurant day',()=>{
 const review={...goal,kind:'development',data:{phase:'self-assessment',managerId:'m',approverId:'m',originalDueDate:'2026-09-10',managerDiscussion:'',employeeDiscussion:''}};
 assert.equal(learningNextStep(w,review,at).actorId,'e');assert.equal(learningNextStep(w,review,at).overdue,false);
 for(const [changes,actor,label] of [[{phase:'manager-assessment'},'m','Manager assessment'],[{phase:'discussion'},'m','Record the conversation'],[{phase:'discussion',managerDiscussion:'Recorded'},'e','Employee response'],[{phase:'discussion',managerDiscussion:'Recorded',employeeDiscussion:'Acknowledged'},'m','Send for final approval'],[{phase:'gm-review'},'m','Final approval']]){const s=learningNextStep(w,{...review,data:{...review.data,...changes}},at);assert.equal(s.actorId,actor);assert.equal(s.label,label)}
 assert.equal(learningNextStep(w,review,'2026-09-11T00:30:00Z').overdue,false);assert.equal(learningNextStep(w,review,'2026-09-11T05:00:00Z').overdue,true);
});
