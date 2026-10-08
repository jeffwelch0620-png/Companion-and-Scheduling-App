import test from 'node:test';
import assert from 'node:assert/strict';
import { companionContext, scopeCurrent } from '../.sites-runtime/shared/companion-context.mjs';
import { companionRequirements, checkedCompanionAnswer } from '../.sites-runtime/shared/companion-requirements.mjs';
import { qualityWorkspace, at } from './companion-quality-fixture.mjs';
import { closingRole } from '../.sites-runtime/shared/companion-close-role.mjs';
import { workforceContext } from '../.sites-runtime/shared/workforce-context.mjs';
const ref=r=>({id:r.id,revision:r.revision,title:r.data.title,kind:r.kind});

test('general learning questions do not retrieve old coaching notes while selected or named goals remain available',()=>{
 const f=qualityWorkspace();f.w.me=f.employee;
 const goal=f.add('general-goal','goal','employee',{title:'Practice table greetings',definition:'Practice with support',type:'development',managerId:'manager',due:at,phase:'active',history:[{actorId:'employee',action:'practice',note:'PRIVATE_OLD_NOTE',at}]});
 const question='Connection check: how can we use a learning goal to help an employee improve, and who confirms that they have completed it? Do not create or change any work records.';
 const general=workforceContext(f.w,question,at,[ref(goal)]);
 assert.equal(general.context.generalLearningQuestion,true);assert.ok(!JSON.stringify(general).includes('PRIVATE_OLD_NOTE'));assert.deepEqual(general.scope,[]);assert.deepEqual(general.evidence,[]);
 assert.ok(general.context.learningWorkflow.steps.some(s=>s.includes('Assigned reviewing manager')));
 for(const [q,selected] of [[question,ref(goal)],['What should I do for Practice table greetings?',undefined],['How is my learning goal going?',undefined]]){
  const c=workforceContext(f.w,q,at,[],selected);assert.equal(c.context.generalLearningQuestion,false);assert.ok(c.evidence.some(e=>e.source.id===goal.id));
 }
 const active=companionContext(f.w,'Explain this goal',at,[],ref(goal)).evidence.find(e=>e.source.id===goal.id).facts;
 assert.equal(active.outcomeReview.completionRecorded,false);assert.equal(active.outcomeReview.employeeReadinessRecorded,false);assert.equal(active.outcomeReview.workflow.reviewerMustConfirmOutcome,true);
 goal.data.phase='verification';
 const ready=companionContext(f.w,'Explain this goal',at,[],ref(goal)).evidence.find(e=>e.source.id===goal.id).facts;
 assert.equal(ready.outcomeReview.employeeReadinessRecorded,true);assert.equal(ready.outcomeReview.completionRecorded,false);
 const corrected=checkedCompanionAnswer(f.w,[ref(goal)],'Who confirms the outcome?','Fictional manager already confirms the outcome in the saved record.',at,ref(goal));
 assert.ok(corrected.includes('awaiting the reviewing manager'));assert.ok(corrected.includes('does not show a completed outcome review'));assert.ok(!corrected.includes('already confirms'));
});

test('role guidance distinguishes performer, checker, manager and correction helper and follows the saved phase',()=>{
 const f=qualityWorkspace(),close=f.w.records.find(r=>r.kind==='close'),sources=[ref(close)];
 for(const [member,label] of [[f.employee,'assigned closer'],[f.senior,'first physical checker'],[f.manager,'separate final physical confirmation']]){
   f.w.me=member;assert.ok(closingRole(f.w,close).includes(label));
   const result=checkedCompanionAnswer(f.w,sources,'What is my role?','WRONG ROLE',at,sources[0]);assert.ok(result.includes(label));assert.ok(!result.includes('WRONG ROLE'));
 }
 f.w.me=f.senior;close.data.phase='verification';
 assert.ok(checkedCompanionAnswer(f.w,sources,'What is my role?','WRONG',at).includes('Perform the first physical check'));
 f.w.me=f.manager;close.data.phase='manager-confirmation';
 // A named manager still needs the scheduled leadership authority for this close.
 assert.ok(!checkedCompanionAnswer(f.w,sources,'What is my role?','WRONG',at).includes('Perform the final physical check'));
 f.add('closing-lead','leadership','manager',{personId:'manager',area:'BOH',start:'2026-09-14T20:00:00Z',end:'2026-09-15T04:00:00Z',active:true});
 assert.ok(checkedCompanionAnswer(f.w,sources,'What is my role?','WRONG',at).includes('Perform the final physical check'));
 const helper={...f.employee,id:'helper',name:'Fictional helper'};f.w.members.push(helper);f.w.me=helper;
 close.data.phase='correction';close.data.correction={personId:helper.id,assignedBy:f.manager.id,assignedAt:at,note:'Fictional help'};
 const helped=checkedCompanionAnswer(f.w,sources,'What is my role?','WRONG',at);assert.ok(helped.includes('assigned correction helper'));assert.ok(helped.includes('Fictional employee remains responsible'));
});

test('a conditional final-check claim is replaced by the current approved method and both mandatory checks',()=>{
 const f=qualityWorkspace(),close=f.w.records.find(r=>r.kind==='close');
 const incorrect='Read the practice card. Fictional manager is the final check if the work needs escalation or the senior returns it for correction.';
 const answer=checkedCompanionAnswer(f.w,[{...ref(close),title:close.data.standard.title}],'Walk me through this.',incorrect);
 assert.ok(answer.includes('even when the first check passes'));assert.ok(answer.includes('Place the Expo card'));assert.ok(answer.includes('Fictional senior: first physical check'));assert.ok(answer.includes('Fictional manager: separate final physical confirmation'));assert.ok(!answer.includes('final check if'));
 const valid='If the card is missing, ask the manager for help. The senior checks first; the manager performs a separate final physical confirmation.';
 assert.equal(checkedCompanionAnswer(f.w,[ref(close)],'Walk me through this.',valid),valid);
 const clearance='Learning the guide is not station clearance. If you need to work Expo solo, ask the Fictional manager for the current approval and any required check.';
 assert.equal(checkedCompanionAnswer(f.w,[ref(f.expo)],'Can I cover the station alone?',clearance),clearance);
});

test('explicitly attached work takes the first context slot, including in a crowded ambiguous workspace',()=>{
 const f=qualityWorkspace(),selected=f.w.records.filter(r=>r.kind==='close').at(-1);
 const c=companionContext(f.w,'What is my next step here?',at,[ref(f.fry)],{id:selected.id,revision:selected.revision});
 assert.equal(c.evidence[0].source.id,selected.id);assert.equal(c.context.selectedWork.id,selected.id);assert.ok(c.scope.some(s=>s.id===selected.id));assert.ok(c.context.omittedRecords>0);
 assert.equal(companionContext(f.w,'Walk me through this.',at,[],{id:f.fry.id,revision:1}).evidence[0].source.id,f.fry.id);
});

test('a named short station guide survives a crowded manager workspace',()=>{
 const f=qualityWorkspace(),c=companionContext(f.w,'Help me learn Fry.',at);
 assert.equal(c.evidence[0].source.id,f.fry.id);
 assert.ok(JSON.stringify(c.context).includes('Place the Fry card'));
 assert.ok(c.context.omittedRecords>0);assert.ok(c.evidence.length<=20);
});
test('follow-ups retain cited instructions and a new named station changes focus',()=>{
 const f=qualityWorkspace(),focus=[ref(f.fry)];
 assert.equal(companionContext(f.w,'What if that card is missing?',at,focus).evidence[0].source.id,f.fry.id);
 assert.equal(companionContext(f.w,'Now help me with Expo.',at,focus).evidence[0].source.id,f.expo.id);
 f.fry.data.status='retired';f.fry.revision++;
 assert.ok(!companionContext(f.w,'What if that card is missing?',at,focus).evidence.some(e=>e.source.id===f.fry.id));
});
test('station context distinguishes reading from clearance and never retrieves private or unapproved data',()=>{
 const f=qualityWorkspace();f.w.me=f.employee;
 f.add('draft','standard','manager',{...f.guide('Fry','DRAFT_ONLY'),status:'draft'});
 f.add('elsewhere','standard','manager',f.guide('Fry','OTHER_RESTAURANT'),'elsewhere');
 f.add('private','feedback','employee',{text:'PRIVATE_ONLY',shared:false,status:'private',response:'',due:'',history:[]});
 const c=companionContext(f.w,'Show me Expo, DRAFT_ONLY, OTHER_RESTAURANT and PRIVATE_ONLY.',at);
 assert.equal(c.evidence.find(e=>e.source.id===f.expo.id).facts.trainingClearanceRecorded,false);
 const data=JSON.stringify(c.context);for(const marker of ['DRAFT_ONLY','OTHER_RESTAURANT','PRIVATE_ONLY'])assert.ok(!data.includes(marker));
});
test('a goal carries its exact current instruction dependency and loses obsolete method content',()=>{
 const f=qualityWorkspace();f.w.me=f.employee;
 const goal=f.add('learning','goal','employee',{title:'Fry learning goal',definition:'Practice with the approved kit',type:'development',managerId:'manager',due:'2026-09-20',phase:'active',standardId:f.fry.id,standardRevision:1,standardSource:'Fictional source',history:[]});
 const c=companionContext(f.w,'Explain my Fry learning goal.',at),facts=c.evidence.find(e=>e.source.id===goal.id).facts;
 assert.equal(facts.approvedInstructionCurrent,true);assert.ok(facts.guide.steps[0].includes('Fry'));
 f.fry.data.status='retired';f.fry.revision++;
 assert.equal(scopeCurrent(c.scope,f.w,at),false);
 const changed=companionContext(f.w,'Explain my learning goal.',at).evidence.find(e=>e.source.id===goal.id).facts;
 assert.equal(changed.approvedInstructionCurrent,false);assert.equal(changed.guide,undefined);
});

test('learning outcome reviewers stay distinct from the linked station physical checks and unrelated closing roles',()=>{
 const f=qualityWorkspace();f.w.me=f.employee;
 const goal=f.add('learning-review','goal','employee',{title:'Chosen Fry learning goal',definition:'Practice with manager support',type:'development',managerId:'manager',due:at,phase:'active',standardId:f.fry.id,standardRevision:1,history:[{actorId:'manager',action:'fix',note:'Repeat the practice label together.',at}]});
 const close=f.w.records.find(r=>r.kind==='close'),sources=[ref(goal),ref(close)];
 const requirements=companionRequirements(f.w,sources),learning=requirements.find(r=>r.id===goal.id);
 assert.deepEqual(learning.checks,['Fictional manager: review and confirm the agreed goal outcome']);
 assert.ok(learning.notice.includes('does not grant station clearance'));
 assert.equal(requirements.find(r=>r.id===close.data.standardId).checks.length,2);
 const c=companionContext(f.w,'What should I practice next for this goal?',at,[],ref(goal));
 const facts=c.evidence.find(e=>e.source.id===goal.id).facts;
 assert.equal(facts.outcomeReview.reviewer,'Fictional manager');assert.equal(facts.outcomeReview.completesOperatingChecks,false);
 assert.deepEqual(facts.recentFollowThrough.map(h=>[h.by,h.note]),[['Fictional manager','Repeat the practice label together.']]);
 assert.equal(checkedCompanionAnswer(f.w,sources,'What is my role in this goal?','Goal guidance',at,ref(goal)),'Goal guidance');
 const corrected=checkedCompanionAnswer(f.w,sources,'Explain the checks.','The final check is only needed if there is a problem.',at,ref(goal));
 assert.ok(corrected.includes('Goal outcome review:'));assert.ok(corrected.includes('Required physical checks, including when the first check passes:'));
});
test('oversized instructions retain a link and explicit omission without sending a partial method',()=>{
 const f=qualityWorkspace();f.fry.data.guide.steps=Array.from({length:30},()=> 'REPEATED_METHOD '.repeat(65));
 f.fry.data.guide.preparation=Array.from({length:15},()=> 'LONG_PREPARATION '.repeat(60));
 const c=companionContext(f.w,'Teach me Fry.',at),e=c.evidence.find(e=>e.source.id===f.fry.id);
 assert.equal(e.facts.instructionContentOmitted,true);assert.equal(e.facts.guide,undefined);
 assert.ok(!JSON.stringify(c.context).includes('REPEATED_METHOD'));assert.ok(JSON.stringify(c.evidence).length<41000);
});
test('saved requirements preserve named physical checks and missing methods independently of model prose',()=>{
 const f=qualityWorkspace(),close=f.w.records.find(r=>r.kind==='close');f.expo.data.guide=undefined;
 const guideOnly=companionRequirements(f.w,[ref(f.expo)])[0];
 assert.ok(guideOnly.notice.includes('when this guide is assigned as closing work'));
 assert.ok(guideOnly.notice.includes('A learning goal has its own outcome reviewer'));
 const requirements=companionRequirements(f.w,[ref(f.expo),ref(close)]);
 assert.equal(requirements.length,1);assert.equal(requirements[0].checks.length,2);
 assert.ok(!requirements[0].notice.includes('when this guide is assigned as closing work'));
 assert.ok(requirements[0].checks[0].includes('Fictional senior'));assert.ok(requirements[0].checks[1].includes('Fictional manager'));
 assert.ok(requirements[0].notice.includes('Detailed operating steps are missing'));
 f.expo.revision++;f.expo.data.status='retired';
 const changed=companionRequirements(f.w,[ref(close)])[0];assert.equal(changed.checks.length,0);assert.ok(changed.notice.includes('current approved instructions'));
 assert.deepEqual(companionRequirements(f.w,[{...ref(close),revision:999}]),[]);
});
test('a stale goal reference shows its manager and cannot present the old method as current',()=>{
 const f=qualityWorkspace(),goal=f.add('goal','goal','employee',{title:'Fry practice goal',definition:'Practice',type:'development',managerId:'manager',due:'2026-09-20',phase:'active',standardId:f.fry.id,standardRevision:1,history:[]});
 f.fry.revision++;
 const requirements=companionRequirements(f.w,[ref(goal)]);
 assert.equal(requirements[0].checks.length,0);assert.ok(requirements[0].notice.includes('Fictional manager'));
 assert.ok(requirements[0].notice.includes('does not have current approved instructions'));
 const guarded=checkedCompanionAnswer(f.w,[ref(goal)],'Give me the current method.','Open the old guide and do its steps.');
 assert.ok(guarded.includes('Fictional manager'));assert.ok(!guarded.includes('Open the old guide'));
 assert.equal(checkedCompanionAnswer(f.w,[ref(goal)],'When is it due?','September 20.'),'September 20.');
});
