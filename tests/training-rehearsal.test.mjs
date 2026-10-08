import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCommand} from '../.sites-runtime/shared/domain.mjs';
import {companionContext} from '../.sites-runtime/shared/companion-context.mjs';
import {checkedCompanionAnswer} from '../.sites-runtime/shared/companion-requirements.mjs';
import {learningNextStep} from '../.sites-runtime/shared/learning-queue.mjs';

const at='2026-09-18T01:00:00.000Z';
function fixture(){
 const employee={id:'employee',locationId:'fictional',name:'Sample employee',area:'FOH',position:'Server',capabilities:[],qualifications:[]};
 const manager={...employee,id:'manager',name:'Sample manager',position:'Manager',capabilities:['people.manage','tasks.manage']};
 const other={...manager,id:'other',name:'Other manager'};
 const standard={id:'guide',locationId:'fictional',ownerId:'manager',area:'FOH',kind:'standard',revision:1,updatedAt:at,data:{title:'Sample guide',zone:'Practice',position:'Server',version:1,status:'approved',criteria:['Counter ready','Stock counted'],source:'Fictional rehearsal only',verification:'senior-then-manager',validationNote:'Fixture',history:[]}};
 let w={location:{id:'fictional',name:'Practice',timezone:'America/New_York',revision:1},members:[employee,manager,other],me:manager,records:[standard]};
 const run=(who,action,input,record)=>{
   w={...w,me:who};
   const changes=applyCommand(w,{requestId:crypto.randomUUID(),locationId:w.location.id,action,input,...(record?{recordId:record.id,expectedRevision:record.revision}:{})},at);
   const changed=new Set(changes.map(r=>r.id));w={...w,records:[...w.records.filter(r=>!changed.has(r.id)),...changes]};
   return changes.find(r=>r.kind==='goal');
 };
 const create=()=>run(manager,'goal.create',{ownerId:employee.id,managerId:manager.id,type:'development',title:'Practice both criteria',definition:'Explain both sample criteria with the manager.',due:'2026-09-19T01:00:00.000Z',standardId:standard.id,standardRevision:standard.revision});
 return {get w(){return w},employee,manager,other,standard,run,create};
}
const cite=r=>({id:r.id,kind:r.kind,revision:r.revision,title:r.data.title});

test('a missing approved method sends the employee to their manager, not on a circular search for nonexistent steps',()=>{
 const f=fixture();let goal=f.create();goal=f.run(f.employee,'goal.transition',{step:'accept',note:'Choose practice'},goal);
 const source=cite(goal),context=companionContext({...f.w,me:f.employee},'Walk me through this learning goal.',at,[source]);
 const facts=context.evidence.find(e=>e.source.id===goal.id).facts;
 assert.equal(facts.approvedInstructionCurrent,true);assert.equal(facts.methodAvailable,false);assert.equal(facts.instructionContentOmitted,undefined);
 const misleading='Open the same guide and ask JMAX there for the missing steps. You are cleared after this.';
 const answer=checkedCompanionAnswer(f.w,[source,cite(f.standard)],'Walk me through this learning goal.',misleading,at,source);
 assert.match(answer,/1\. Counter ready\n2\. Stock counted/);assert.match(answer,/have not been approved/);
 assert.match(answer,/Ask Sample manager for the approved method/);assert.match(answer,/does not grant station clearance/);assert.doesNotMatch(answer,/You are cleared|ask JMAX there/);
});

test('goal acceptance, practice, returned correction, resubmission and independent confirmation preserve the history without granting clearance',()=>{
 const f=fixture();let goal=f.create();assert.equal(goal.data.phase,'proposed');
 goal=f.run(f.employee,'goal.transition',{step:'accept',note:'I choose it'},goal);
 goal=f.run(f.employee,'goal.transition',{step:'practice',note:'Counter explained; stock explanation missing'},goal);assert.equal(goal.data.phase,'active');
 goal=f.run(f.employee,'goal.transition',{step:'ready',note:'Please review'},goal);assert.equal(goal.data.phase,'verification');
 assert.throws(()=>f.run(f.employee,'goal.transition',{step:'verify',note:'Self approval'},goal),/assigned manager/);
 assert.throws(()=>f.run(f.other,'goal.transition',{step:'verify',note:'Wrong reviewer'},goal),e=>e.status===404);
 goal=f.run(f.manager,'goal.transition',{step:'fix',note:'Practice the stock explanation with me'},goal);assert.equal(goal.data.phase,'active');
 const source=cite(goal),answer=checkedCompanionAnswer(f.w,[source],'What steps should I practice?', 'Generic answer',at,source);
 assert.match(answer,/Latest saved manager guidance: Practice the stock explanation with me/);
 goal=f.run(f.employee,'goal.transition',{step:'ready',note:'Both criteria explained in this fictional rehearsal'},goal);
 assert.equal(learningNextStep({...f.w,me:f.manager},goal,at).needsMe,true);
 goal=f.run(f.manager,'goal.transition',{step:'verify',note:'Fictional learning outcome confirmed'},goal);
 assert.equal(goal.data.phase,'closed');assert.equal(learningNextStep(f.w,goal,at).ended,true);
 assert.deepEqual(goal.data.history.map(h=>h.action),['proposed','accept','practice','ready','fix','ready','verify']);
 assert.deepEqual(f.w.members.find(m=>m.id===f.employee.id).qualifications,[]);assert.ok(!f.w.records.some(r=>r.kind==='proficiency'||r.kind==='close'));
});

test('available methods, non-method questions and uncited or stale goals do not trigger the missing-method replacement',()=>{
 const f=fixture();let goal=f.create();goal=f.run(f.employee,'goal.transition',{step:'accept',note:'Choose it'},goal);const source=cite(goal);
 const saved='The goal is due tomorrow.';
 assert.equal(checkedCompanionAnswer(f.w,[source],'When is it due?',saved,at,source),saved);
 assert.equal(checkedCompanionAnswer(f.w,[],'Walk me through it.',saved,at,source),saved);
 assert.equal(checkedCompanionAnswer(f.w,[{...source,revision:99}],'Walk me through it.',saved,at,{...source,revision:99}),saved);
 f.standard.data.guide={purpose:'Fictional practice',preparation:['Read the sample card'],steps:['Place the blue practice card on the sample tray'],troubleshooting:[],escalation:'Ask Sample manager'};
 assert.equal(companionContext(f.w,'Walk me through it.',at,[source]).evidence.find(e=>e.source.id===goal.id).facts.methodAvailable,true);
 const approved='Place the blue practice card on the sample tray.';
 assert.equal(checkedCompanionAnswer(f.w,[source],'Walk me through it.',approved,at,source),approved);
});

test('changed instructions block goal advancement and cannot be presented as the approved method',()=>{
 const f=fixture();let goal=f.create();goal=f.run(f.employee,'goal.transition',{step:'accept',note:'Choose it'},goal);
 f.standard.revision=2;const source=cite(goal);
 assert.throws(()=>f.run(f.employee,'goal.transition',{step:'ready',note:'Ready anyway'},goal),/linked instruction changed/);
 const answer=checkedCompanionAnswer(f.w,[source],'Walk me through the method.','Use the old method.',at,source);
 assert.match(answer,/cannot give a current method/);assert.doesNotMatch(answer,/Use the old method/);
 assert.equal(goal.data.phase,'active');
});
