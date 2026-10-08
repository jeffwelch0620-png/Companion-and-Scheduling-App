import test from 'node:test';
import assert from 'node:assert/strict';
import {askCompanion} from '../.sites-runtime/shared/openai-companion.mjs';

// Inspect the actual provider request with a local fake transport. These checks
// prove request contracts, not that a real model obeys them in every response.
const config={key:'sk-fictional-prompt-contract-only',model:'gpt-5.4-mini'};
const source=(id,kind='close')=>({id,kind,revision:2,title:'Fictional '+id});
async function captured(context,question,history=[]){
 const before=JSON.stringify({context,history}),sources=(context.evidence??[]).map(e=>e.source);
 let request;
 await askCompanion(config,context,history,question,sources,async(_url,init)=>{
  request=JSON.parse(init.body);
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:'Fictional local transport response.',sourceIds:[]})}]}]});
 });
 assert.equal(JSON.stringify({context,history}),before,'building the AI request must not change authorized work');
 assert.equal(request.store,false);
 assert.equal(request.input.at(-1).content,question);
 const sentContext=JSON.parse(request.input[1].content.slice(request.input[1].content.indexOf('\n')+1));
 return {request,prompt:request.input[0].content,sentContext};
}

test('closing request carries correction/release state and instructions separating readiness, checks and release',async()=>{
 const context={product:'workforce',scopeMode:'selected-close',selectedWork:source('booster-close'),closingStatus:{releaseRecorded:false,nextAction:'Correct the booster and request another physical check'},evidence:[{source:source('booster-close'),facts:{phase:'correction',owner:'Morgan',manager:'Casey',signedInResponsibilities:['performer'],conditions:['Booster clean'],approvedInstructionCurrent:true,lastRecordedSteps:[{action:'fix',person:'Casey',note:'Booster still sticky'}]}}]};
 const {prompt,sentContext}=await captured(context,'My time ended. What do I do and what note should I write?');
 assert.deepEqual(sentContext.evidence,context.evidence);assert.deepEqual(sentContext.closingStatus,context.closingStatus);
 assert.match(prompt,/supports Scheduling, Training, workforce readiness and guidance about authorized saved closing assignments and explicitly linked closing tasks/);
 assert.doesNotMatch(prompt,/PASS\/FIX and operational handoff execution are parked/);
 assert.match(prompt,/Readiness is only a request for a physical check; it is not completion/);
 assert.match(prompt,/Physical confirmation of conditions and a separate manager release of the shift are distinct requirements/);
 assert.match(prompt,/when releaseRecorded is false, do not say preparing for, requesting or passing a check alone permits leaving/);
 assert.match(prompt,/Chat cannot submit Ready, verify conditions, accept or complete a transferred task, or release a shift/);
 assert.match(prompt,/Every proposed note must describe only the current saved facts or what the person explicitly reports having done/);
 assert.match(prompt,/An instruction to correct something is not evidence of a correction/);
 assert.match(prompt,/Before rework,[^\n]*Booster seat still sticky; correction and another physical check needed[^\n]*never "Corrected; ready for another physical check/);
 assert.match(prompt,/Do not infer completion, success, readiness, inspection, manager confirmation or release from an attempt, effort, scheduled end time or a request for a note/);
 assert.match(prompt,/Booster seat wiped again; not marked Ready or physically checked yet/);
 assert.match(prompt,/Deliver the useful artifact the person actually requested in this reply/);
});

test('missing, retired and omitted instructions retain distinct availability warnings in the actual request',async()=>{
 const context={product:'workforce',evidence:[
  {source:source('missing-method','standard'),facts:{authority:'approved standard',methodAvailable:false,manager:'Casey',conditions:['Clean booster']}},
  {source:source('retired-close'),facts:{approvedInstructionCurrent:false,manager:'Casey'}},
  {source:source('omitted-guide','standard'),facts:{authority:'approved standard',instructionContentOmitted:true}}
 ]};
 const {prompt,sentContext}=await captured(context,'Walk me through the cleaning method.');
 assert.deepEqual(sentContext.evidence,context.evidence);
 assert.match(prompt,/methodAvailable false means the supplied approved material has no detailed method: explicitly say the detailed method is missing/);
 assert.match(prompt,/Do not suggest reopening the same guide or asking JMAX again to obtain nonexistent steps/);
 assert.match(prompt,/approvedInstructionCurrent false means the saved assignment's instructions are no longer current/);
 assert.match(prompt,/instructionContentOmitted means an existing method was omitted from this answer context/);
 assert.match(prompt,/Neither condition permits reconstructing an old method from chat/);
});

test('transferred task awaiting verification carries current owner and checker despite contradictory earlier chat',async()=>{
 const context={product:'workforce',selectedWork:source('linked-backlog','task'),evidence:[{source:source('linked-backlog','task'),facts:{owner:'Incoming Riley',phase:'verification',nextAction:'Casey physically checks the completed bagging',signedInResponsibilities:['manager'],closingHandoff:{outgoing:'Morgan',acceptedBy:'Incoming Riley'}}}]};
 const history=[{question:'Can Morgan finish bagging?',answer:'Morgan owns the open task.',focus:source('linked-backlog','task')}];
 const {prompt,sentContext,request}=await captured(context,'What should I do now?',history);
 assert.deepEqual(sentContext.evidence,context.evidence);
 assert.equal(request.input[3].content,history[0].answer,'old conversation remains data, so the prompt must resolve its contradiction');
 assert.match(prompt,/Current saved owner, phase and nextAction override earlier conversation/);
 assert.match(prompt,/a task awaiting verification needs its named checker, not an instruction to repeat the performer's work/);
 assert.match(prompt,/the incoming current owner performs the task; the outgoing person cannot complete it on the incoming person's behalf/);
 assert.match(prompt,/never tell a manager waiting for someone else's work to perform it/);
 assert.match(prompt,/You have no action tools and cannot mark work done, send messages/);
});

test('item-specific method actors and exceptions are preserved without granting station authority',async()=>{
 const context={product:'workforce',selectedWork:source('pizza-guide','standard'),evidence:[{source:source('pizza-guide','standard'),facts:{authority:'approved standard',methodAvailable:true,guide:{steps:['Sandwich/Pasta assembles and loads this item.','Oven pulls and plates it for Expo.']},requiredPhysicalChecks:['Casey performs final physical confirmation']}}]};
 const {prompt,sentContext}=await captured(context,'Give me the approved sequence for this item.');
 assert.deepEqual(sentContext.evidence,context.evidence);
 assert.match(prompt,/Preserve the exact named actor for every approved step, including item-specific exceptions/);
 assert.match(prompt,/A specific item's assigned assembly, loading, pulling, plating or checking responsibility overrides a general product or station list/);
 assert.match(prompt,/Do not reassign a step to another station because that station handles similar products/);
 assert.match(prompt,/reading it never grants station clearance or authority to cover a shift/);
 assert.match(prompt,/The final manager confirmation is mandatory even when the first check passes/);
 const allowed=requestSources(sentContext);
 assert.deepEqual(allowed,['pizza-guide']);
});
function requestSources(context){return context.evidence.map(e=>e.source.id)}

test('service guide checks and zones do not become closing inspections or employee assignments',async()=>{
 const {prompt}=await captured({product:'workforce',myShift:{stationAssigned:false},evidence:[]},'How do I finish this pizza?');
 assert.match(prompt,/guide's zone is not an employee's section or station assignment/);
 assert.match(prompt,/Do not add a closing-manager inspection to each pizza, order or ordinary service step/);
 assert.match(prompt,/Keep service instructions and closing checks distinct/);
});

test('manager prep scenario keeps target, capacity, production and stock distinct without inventing a personal assignment',async()=>{
 const context={product:'workforce',assignedPrep:[],viewer:{name:'Casey',capabilities:['tasks.manage']},quantityCheck:{target:{amount:24,unit:'portions'},capacity:{amount:8,unit:'portions per pan'},productionShortfall:{amount:6,unit:'portions'},currentOnHand:null,verifiedArithmetic:{pansForTarget:3,assumption:'8 portions per pan'}},managerFollowThrough:{responsible:'BOH manager',flow:'Review the released prep plan with BOH'}};
 const {prompt,sentContext}=await captured(context,'How many pans do I need and how much stock do we have?');
 assert.deepEqual(sentContext.quantityCheck,context.quantityCheck);
 assert.deepEqual(sentContext.assignedPrep,[]);
 assert.deepEqual(sentContext.managerFollowThrough,context.managerFollowThrough);
 assert.match(prompt,/a par or target is not container capacity or current on-hand stock/);
 assert.match(prompt,/A production shortfall does not establish how much stock is available/);
 assert.match(prompt,/Prefer the supplied verified arithmetic or helper results/);
 assert.match(prompt,/If a signed-in manager has no personal assignedPrep lines, do not tell them to record completion against a nonexistent personal assignment/);
 assert.match(prompt,/Use the named responsible manager or BOH follow-through and the supplied authorized manager flow instead/);
 assert.match(prompt,/Do not invent inventory balances, prep assignments or recording controls/);
});
