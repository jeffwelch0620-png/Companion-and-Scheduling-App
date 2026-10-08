import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedCompanionAnswer} from '../.sites-runtime/shared/companion-requirements.mjs';
import {companionClosingNext} from '../.sites-runtime/shared/companion-closing-next.mjs';
import {qualityWorkspace,at} from './companion-quality-fixture.mjs';

const ref=r=>({id:r.id,revision:r.revision,title:r.kind==='close'?r.data.standard.title:r.kind==='shift'?r.data.position+' shift':r.data.title,kind:r.kind});
function fixture(){
 const f=qualityWorkspace();
 f.w.records=f.w.records.filter(r=>r.kind==='standard');
 const shift=f.add('focused-shift','shift','employee',{personId:'employee',position:'Expo',start:'2026-09-14T20:00:00Z',end:'2026-09-15T03:00:00Z',published:true,cancelled:false});
 const close=f.add('focused-close','close','employee',{shiftId:shift.id,standardId:f.expo.id,standardRevision:f.expo.revision,standard:f.expo.data,verifierId:'senior',managerId:'manager',due:shift.data.end,phase:'manager-confirmation',history:[{actorId:'senior',action:'verify',note:'First physical check passed',at}]});
 return {...f,shift,close};
}

test('correct saved next action survives final-check guard with leave and availability conditions',()=>{
 const f=fixture(),source=ref(f.close);
 const answer='Lee’s check is only the first physical check. A separate final manager confirmation is still required, so you should not leave yet unless Dana has also done the manager checkout.\n\nCurrent status on your close says the next action is waiting for Dana, and the required order is Lee first, then Dana’s final physical confirmation. If Dana is available, ask for that manager check now.';
 assert.equal(checkedCompanionAnswer(f.w,[source],'Lee checked my close. Can I leave now?',answer,at,source),answer);
 for(const valid of ['Do not leave unless the final manager check is complete.','The final manager confirmation is still required if the first check passes.','If the manager is available, request the final manager check now.','The final check cannot be skipped.','The final manager check is not optional.'])assert.equal(checkedCompanionAnswer(f.w,[source],'What remains?',valid,at,source),valid);
});

test('conditions making mandatory final checks optional remain blocked',()=>{
 const f=fixture(),source=ref(f.close);
 for(const invalid of ['The manager is the final check if the senior reports a problem.','The final check is only needed if there is a problem.','The final manager confirmation is optional.','The final manager check is required unless the senior passes it.','If the senior finds a problem the manager performs the final check.','You may skip the final manager check after the senior passes.']){
   const answer=checkedCompanionAnswer(f.w,[source],'Explain my check order.',invalid,at,source);
   assert.notEqual(answer,invalid);assert.match(answer,/required even when the first check passes/);assert.match(answer,/Fictional manager: separate final physical confirmation/);
 }
});

test('recorded final-check completion preserves current linked-work and bank guidance',()=>{
 const f=fixture(),task=f.add('linked-task','task','senior',{title:'Remaining silverware',detail:'Actual completion and independent verification remain required',kind:'handoff',shiftId:f.shift.id,incomingId:'senior',phase:'open',due:f.shift.data.end,history:[],closingHandoff:{outgoingId:'employee',acceptedBy:'Fictional senior',acceptedAt:at}});
 f.close.data.phase='closed';
 const sources=[ref(f.shift),ref(task),ref(f.expo)];
 const answer='Not yet. Based on the saved records, Sam’s close still cannot be released because the separate manager release has not been recorded, and the linked silverware work is still open under Casey.\n\n1. The linked silverware task is now owned by Casey, but it still needs the actual work finished and then the required verification.\n2. The close guide also requires a separate final physical confirmation by the closing manager before release.\n3. I do not see any recorded bank settlement in JMAX. The guide says the manager settles the server bank manually before release, and chat cannot do that work.\n\nIf you have completed your final close check in person, the remaining required items are Casey finishing the linked work with verification and the manager’s separate release of Sam’s shift.';
 assert.equal(checkedCompanionAnswer(f.w,sources,'Can I release Sam now? Has the bank been settled?',answer,at,ref(f.shift)),answer);
 for(const valid of ['If you have already performed the final manager check, the linked task still needs verification.','When the final manager confirmation has been completed, review the linked task and bank before checkout.','If Dana is available, ask for the final manager check now.'])assert.equal(checkedCompanionAnswer(f.w,sources,'What remains?',valid,at,ref(f.shift)),valid);
 for(const invalid of ['If there is a problem, the final manager check is only needed if the first check fails.','If you have completed the first check, you may skip the final manager check.'])assert.notEqual(checkedCompanionAnswer(f.w,sources,'What remains?',invalid,at,ref(f.shift)),invalid);
});

test('selected shift checkout cannot become ready while final close or linked task is pending',()=>{
 const f=fixture(),task=f.add('linked-task','task','employee',{title:'Remaining silverware',detail:'Fictional work',kind:'handoff',shiftId:f.shift.id,incomingId:'senior',phase:'acceptance',due:f.shift.data.end,history:[]});
 const sources=[ref(f.shift),ref(f.close),ref(task)],claim='The final check is still required. Fictional employee is ready for your checkout step now, assuming the linked silverware is complete.';
 const guarded=checkedCompanionAnswer(f.w,sources,'Is the employee ready for checkout?',claim,at,ref(f.shift));
 assert.match(guarded,/not ready for operational checkout/);assert.match(guarded,/Waiting for Fictional manager/);assert.match(guarded,/Remaining silverware: Waiting for Fictional senior/);assert.match(guarded,/Chat does not complete work/);
 f.close.data.phase='closed';
 for(const phase of ['acceptance','open','verification','correction']){task.data.phase=phase;assert.match(checkedCompanionAnswer(f.w,sources,'Can I release them?',claim,at,ref(f.shift)),/not ready for operational checkout/);}
});

test('current closing-next guidance survives repeated answer checks including assignment-scoped footer',()=>{
 const f=fixture(),task=f.add('linked-task','task','employee',{title:'Remaining silverware',detail:'Actual completion and independent verification remain required',kind:'handoff',shiftId:f.shift.id,incomingId:'senior',phase:'acceptance',due:f.shift.data.end,history:[]});
 const sources=[ref(f.shift),ref(task),ref(f.expo)],question='Is the employee ready for checkout? Has the bank been settled?',focus=ref(f.shift);
 for(const valid of ['Readiness does not pass the separate final manager confirmation when assigned.','Perform every required final manager check when assigned.'])assert.equal(checkedCompanionAnswer(f.w,sources,question,valid,at,focus),valid);
 for(const state of ['manager-confirmation','closed']){
   f.close.data.phase=state;
   if(state==='closed'){task.ownerId='senior';task.data.phase='open';task.data.closingHandoff={outgoingId:'employee',acceptedBy:'Fictional senior',acceptedAt:at};}
   const next=companionClosingNext(f.w,sources,question,'The employee cannot leave yet.',at,focus);
   assert.ok(next);assert.match(next,/do not confirm bank settlement/);assert.match(next,/shift is not released/);
   if(state==='closed'){assert.match(next,/saved assignment records its required closing checks complete/);assert.match(next,/Fictional senior must finish the remaining assigned work/);assert.match(next,/independently check the result/);}
   const checked=checkedCompanionAnswer(f.w,sources,question,next,at,focus);
   assert.equal(checked,next);assert.equal(checkedCompanionAnswer(f.w,sources,question,checked,at,focus),next);
 }
 for(const invalid of ['The final manager confirmation when assigned is optional.','The final check is only needed when the first check finds a problem.'])assert.notEqual(checkedCompanionAnswer(f.w,sources,question,invalid,at,focus),invalid);
});

test('checkout guard preserves truthful next actions and does not use unrelated work or stale focus',()=>{
 const f=fixture(),sources=[ref(f.shift),ref(f.close)];
 for(const valid of ['The employee is not ready for checkout. The final manager check remains required.','The employee will be ready for checkout after the final check and linked work are complete.','You can release the employee once the required checks are complete.','You can release the employee if the required checks and linked work are complete.','You cannot release the employee now.'])assert.equal(checkedCompanionAnswer(f.w,sources,'Can I release them?',valid,at,ref(f.shift)),valid);
 const claim='Fictional employee is ready for your checkout now.';
 assert.equal(checkedCompanionAnswer(f.w,sources,'Can I release them?',claim,at,{...ref(f.shift),revision:99}),claim);
 assert.equal(checkedCompanionAnswer(f.w,sources.filter(s=>s.kind!=='shift'),'Can I release them?',claim,at,ref(f.shift)),claim);
 f.close.data.phase='closed';
 f.add('unrelated','task','employee',{title:'Tomorrow work',kind:'normal',shiftId:'another-shift',phase:'open',history:[]});
 assert.equal(checkedCompanionAnswer(f.w,sources,'Can I release them?',claim,at,ref(f.shift)),claim);
 f.shift.data.releasedAt=at;f.close.data.phase='open';assert.equal(checkedCompanionAnswer(f.w,sources,'Was checkout recorded?',claim,at,ref(f.shift)),claim);
});
