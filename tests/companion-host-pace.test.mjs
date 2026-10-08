import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedHostPace} from '../.sites-runtime/shared/companion-host-pace.mjs';
const question='Can I promise them a ten-minute wait, or set myself a target of seating a party every two minutes?';
const unsafe='One party every two minutes can be a personal pace goal.';
function fixture(){return {product:'workforce',evidence:[{source:{id:'host-guide',kind:'standard',revision:1,title:'Fictional Host guide'},facts:{authority:'approved standard',position:'Host',methodAvailable:true,guide:{purpose:'Welcome guests as the single Host.',steps:['Use the written server rotation and a steady seating pace.','Check the server lineup, occupied tables and meal progress.'],escalation:'Ask the manager for seating pace and coverage direction when a server is overloaded.'}}}]}}
test('actual final-capture personal target is replaced by current Host pace and manager direction without invented duties',()=>{
 const context=fixture(),before=JSON.stringify(context),answer=checkedHostPace(context,question,unsafe);
 assert.notEqual(answer,unsafe);assert.match(answer,/including as a personal pace goal/);assert.match(answer,/current floor capacity or a wait forecast is not verified/);
 assert.match(answer,/written server rotation and a steady, welcoming seating pace/);assert.match(answer,/ask the manager for seating pace and coverage direction/i);
 assert.doesNotMatch(answer,/silverware|closing check|phone duty|second Host|mark.*Ready/i);assert.equal(JSON.stringify(context),before);
});
test('wait promise alone and numeric cadence alone use the same actual evidence boundary',()=>{
 const context=fixture();
 assert.notEqual(checkedHostPace(context,'Can I promise a ten-minute wait?',unsafe),unsafe);
 assert.notEqual(checkedHostPace(context,'Can I set a seating target of one party every 2 minutes?',unsafe),unsafe);
 assert.notEqual(checkedHostPace(context,'Can I set a fixed numerical seating target?',unsafe),unsafe);
 assert.equal(checkedHostPace(context,'How do I reopen my Host guide?',unsafe),unsafe);
 assert.equal(checkedHostPace(context,'How long is my scheduled shift?',unsafe),unsafe);
});
test('missing, omitted, unapproved or another role method cannot supply a Host replacement',()=>{
 for(const mutate of [c=>c.evidence=[],c=>c.evidence[0].facts.authority='saved draft',c=>c.evidence[0].facts.position='Server',c=>c.evidence[0].facts.approvedInstructionCurrent=false,c=>c.evidence[0].facts.instructionContentOmitted=true,c=>c.evidence[0].source.kind='close']){
  const c=fixture();mutate(c);assert.equal(checkedHostPace(c,question,unsafe),unsafe);
 }
});
test('an explicit approved numerical method is preserved; prohibited targets and examples are not approval',()=>{
 for(const step of ['Approved seating target: seat one party every two minutes.','Seat parties at a two-minute interval.','Use a two-minute seating interval.']){
  const cadence=fixture();cadence.evidence[0].facts.guide.steps.push(step);
  assert.equal(checkedHostPace(cadence,'Can I seat one party every two minutes?',unsafe),unsafe);
 }
 const wait=fixture();wait.evidence[0].facts.guide.steps.push('Quote a ten-minute wait using this approved timing method.');
 assert.equal(checkedHostPace(wait,'Can I quote a ten-minute wait?',unsafe),unsafe);
 for(const step of ['Do not seat one party every two minutes.','A personal target of one party every two minutes is not approved.','Example only: seat one party every two minutes.','Check menus every two minutes before returning to seating.']){
  const context=fixture();context.evidence[0].facts.guide.steps.push(step);assert.notEqual(checkedHostPace(context,question,unsafe),unsafe);
 }
});
