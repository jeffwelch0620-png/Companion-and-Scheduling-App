import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {positionAchievements} from '../.sites-runtime/shared/position-achievements.mjs';
import {equipmentReader} from '../.sites-runtime/shared/equipment.mjs';

export function learningProgressRuntimeHashes(){return Object.fromEntries(fs.readdirSync('.sites-runtime/shared').filter(f=>f.endsWith('.mjs')).sort().map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join('.sites-runtime/shared',f))).digest('hex')]));}
export function createLearningProgressOverrides(profile){
 const topic=`${profile.position} ${profile.restaurant} continuity lesson`;
 const state={execution:'Actual authenticated commands across continuous shifts; explicitly fictional tasks and checked assets; mocked provider inspects real authorized context only.',phases:[],aiChecks:[],cases:[],tasks:[],messages:[],negativeChecks:[],assetChanges:[],achievementChecks:[],runtimeBefore:learningProgressRuntimeHashes(),limits:['No generated-answer helpfulness, model training, live food integration or physical work is claimed.','The current task title carries a fictional relevance label so actual next-day retrieval is exercised. Prior-shift work remains saved; this variant attaches current work to the daily AI question.']};
 let current,asset,originalLessonBadge;
 const originals=profile.dailyScenarios?.length?profile.dailyScenarios:Array.from({length:7},(_,i)=>({title:`Role interruption ${i+1}`,detail:'Fictional assigned interruption; use current approved instructions and manager direction.'}));
 const snapshots=ctx=>JSON.stringify(Object.fromEntries(['records','command_receipts','audit_events'].map(t=>[t,ctx.store().sqlite.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()])));
 const raw=async(ctx,actor,action,input={},record)=>{const before=snapshots(ctx);const response=await handleWorkspace(ctx.request('workspace',actor,{locationId:profile.restaurant,requestId:crypto.randomUUID(),action,input,...(record?{recordId:record.recordId??record.id,expectedRevision:record.revision}:{})}),ctx.store().db);const data=await response.json();return {status:response.status,data,before,after:snapshots(ctx)};};
 const denied=async(ctx,expected,actor,action,input={},record)=>{const result=await raw(ctx,actor,action,input,record);assert.equal(result.status,expected,JSON.stringify(result.data));assert.equal(result.before,result.after,'Rejected action changed operational records');state.negativeChecks.push({day:ctx.day.day,action,actor,status:result.status});};
 const caseFacts=(task,week,corrected=false)=>({sourceId:task.recordId??task.id,sourceRevision:task.revision,title:`${topic} week ${week}`,symptom:`${topic}: ${corrected?'corrected observation':'initial observation'} of assigned shift work`,actionsTaken:'Fictional employee followed the assigned work and manager direction; not a new equipment procedure.',observedResult:corrected?'Corrected employee report; the manager must review again.':'Employee reports the assigned condition was restored.',uncertainty:'The underlying cause is not established; physical conditions are represented by fictional reviewer assertions.',remainingWork:'Keep the applicable approved method and current manager direction separate from this historical lesson.',shareConfirmed:true});
 const badge=w=>w.records.find(r=>r.kind==='achievement'&&r.ownerId==='worker'&&r.data.milestoneId==='shared-learning');
 const assetInput=(week,changed=false)=>({title:`Fictional ${topic} asset ${week}`,assetTag:`QA-${profile.id??profile.position}-${week}`.slice(0,95),placement:'Fictional assigned station',manufacturer:'',model:'',serial:'',sourceRef:'QA fixture: explicitly checked identity, not a manufacturer method',details:`PRIVATE_ASSET_NOTES_${week}`,checked:true,note:changed?'Corrected checked source reference; same physical asset identity.':'Fictional manager checked this asset identity.'});
 async function run(ctx){
  const n=ctx.day.day,cycle=(n-1)%7+1,week=Math.floor((n-1)/7)+1,at=new Date().toISOString();
  assert.deepEqual(learningProgressRuntimeHashes(),state.runtimeBefore,'Frozen runtime changed while the simulation was running');
  for(const prior of state.cases){const saved=ctx.find(prior.id);assert.ok(saved,'A previous weekly report disappeared after daily reopen');if(prior.week<week)assert.equal(saved.data.status,'withdrawn');}
  // Separate normal work is valid for every position, including Dishwasher.
  let task=await ctx.command('manager','task.create',{ownerId:'worker',kind:'task',title:`${topic} checked work day ${n}`,detail:'Fictional app-recorded assigned condition; employee reports work and an independent manager checks it.',due:new Date(ctx.day.dayStart+6*3600000).toISOString()});
  if(cycle===1){
   asset=await ctx.command('manager','equipment.create',assetInput(week));
   current=await ctx.command('worker','learningcase.submit',caseFacts(task,week));
   state.cases.push({id:current.recordId,week,sourceId:task.recordId,assetId:asset.recordId});
   await denied(ctx,400,'manager','learningcase.review',{verdict:'supported',confirmed:true,evidence:'No completed independent work check yet',note:'Cannot declare restoration without checked work'},current);
  }
  task=await ctx.command('worker','task.transition',{step:'ready',note:'Fictional reported completion; independent check remains required.'},task);
  task=await ctx.command('manager','task.transition',{step:'verify',note:'Independent fictional assigned condition review; no physical observation by this test.'},task,`lesson-work-verify-${n}`);
  const snapshot=snapshots(ctx);assert.deepEqual(await ctx.command('manager','task.transition',{step:'verify',note:'Independent fictional assigned condition review; no physical observation by this test.'},{...task,revision:task.revision-1},`lesson-work-verify-${n}`),task);assert.equal(snapshots(ctx),snapshot);
  state.tasks.push({day:n,id:task.recordId,phase:ctx.find(task.recordId).data.phase});
  if(cycle===1){
   const linked=ctx.find(state.cases.at(-1).sourceId);
   assert.equal(ctx.find(current.recordId).data.source.revision,linked.revision-2,'Initial report should retain the original unfinished-work version');
   current=await ctx.command('worker','learningcase.revise',{...caseFacts(linked,week),note:'Relink the actual newly independently checked source; retain original report version.'},current);
   await denied(ctx,403,'worker','learningcase.review',{verdict:'supported',confirmed:true,evidence:'Cannot review my own report',note:'Independent report review required'},current);
  }
  if([2,3,4,6].includes(cycle)){
   const verdict=cycle===2?'uncertain':cycle===3?'failed':'supported';
   current=await ctx.command('manager','learningcase.review',{verdict,confirmed:true,evidence:`Fictional independent review records ${verdict}; no assumption of current restoration or cause.`,causeStatus:'not-established',cause:'',note:'Historical observed outcome only; current approved methods still govern.',...(verdict==='supported'?{assetId:asset.recordId,assetRevision:asset.revision}:{})},current);
   assert.equal(ctx.find(current.recordId).data.review.verdict,verdict);
   assert.equal(ctx.find(current.recordId).data.status,'reviewed');
  }
  if(cycle===4||cycle===6){
   const own=await ctx.view('worker'),saved=badge(own);assert.ok(saved,'Supported case did not produce a private automatic progress record');
   if(week===1){assert.equal(saved.data.status,'earned');assert.equal(positionAchievements(own).find(c=>c.id==='shared-learning').state,'earned');originalLessonBadge??={id:saved.id,earnedAt:saved.data.earnedAt};}
   else {assert.equal(saved.id,originalLessonBadge.id);assert.equal(saved.data.status,'review-needed','Another case must not silently replace the withdrawn original achievement evidence');}
   assert.equal(saved.data.earnedAt,originalLessonBadge.earnedAt);
   for(const actor of ['manager','incoming'])assert.equal((await ctx.view(actor)).records.some(r=>r.kind==='achievement'&&r.ownerId==='worker'),false,'Private employee achievement leaked');
   if(!equipmentReader({...ctx.find(asset.recordId),locationId:profile.restaurant},own.me))assert.equal(JSON.stringify(own).includes(`PRIVATE_ASSET_NOTES_${week}`),false,'Manager-only equipment notes leaked through progress projection');
   state.achievementChecks.push({day:n,milestone:saved.data.milestoneId,id:saved.id,status:saved.data.status,earnedAt:saved.data.earnedAt});
  }
  if(cycle===5){
   asset=await ctx.command('manager','equipment.revise',assetInput(week,true),asset);state.assetChanges.push({day:n,id:asset.recordId,revision:asset.revision});
   if(week===1)assert.equal(badge(await ctx.view('worker')).data.status,'review-needed','Corrected asset reference did not invalidate automatic stored progress');
   const linked=ctx.find(state.cases.at(-1).sourceId);
   current=await ctx.command('worker','learningcase.revise',{...caseFacts(linked,week,true),note:'Correct the shared observation, reset outcome review, retain all earlier versions.'},current);
   assert.equal(ctx.find(current.recordId).data.status,'reported');assert.equal(ctx.find(current.recordId).data.review,null);
  }
  if(cycle===6){
   current=await ctx.command('worker','learningcase.withdraw',{confirmed:true,note:'Explicitly withdraw the shared historical report; retain dated facts, review and versions.'},current);
   assert.equal(ctx.find(current.recordId).data.status,'withdrawn');assert.equal(badge(await ctx.view('worker')).data.status,'review-needed');
  }
  if(cycle===7)assert.equal(ctx.find(current.recordId).data.status,'withdrawn');
  // Actual two-way Inbox acknowledgment, distinct from a chat claim of contact.
  let message=await ctx.command('worker','message.send',{recipients:['manager'],title:`${topic} follow-through day ${n}`,body:'Please review the current saved outcome and tell me the remaining action. Report '+current.recordId});
  message=await ctx.command('manager','message.reply',{text:'I have reviewed the saved report state. Follow your current approved work and preserve any unfinished condition.'},message);
  await ctx.command('worker','message.read',{},message);
  const savedMessage=ctx.find(message.recordId);assert.ok(savedMessage.data.replies.some(r=>r.actorId==='manager'));assert.ok(savedMessage.data.readBy.includes('worker'));assert.ok((await ctx.view('manager')).records.some(r=>r.id===message.recordId));
  state.messages.push({day:n,id:message.recordId,managerReply:true,employeeRead:true});
  const achievements=(await ctx.view('worker')).records.filter(r=>r.kind==='achievement');assert.equal(achievements.filter(r=>r.data.milestoneId==='checked-work').length,1);assert.equal(achievements.filter(r=>r.data.milestoneId==='shared-learning').length,week===1&&cycle<4?0:1);
  const row=ctx.find(current.recordId);state.phases.push({day:n,week,cycleDay:cycle,at,caseId:row.id,revision:row.revision,status:row.data.status,verdict:row.data.review?.verdict??null,sourceRevision:row.data.source.revision,versions:row.data.versions.length,achievementCount:achievements.length});
  state.runtimeAfter=learningProgressRuntimeHashes();assert.deepEqual(state.runtimeAfter,state.runtimeBefore);
 }
 const dailyScenarios=originals.map(original=>({...original,title:`${original.title??'Role interruption'} — ${topic}`,run:async ctx=>{if(original.run)await original.run(ctx);await run(ctx);}}));
 const aiProvider=async(_url,_init,{context})=>{
  const n=state.aiChecks.length+1,previous=state.phases.at(-1),cases=context.evidence.filter(e=>e.source.kind==='learningcase');
  for(const prior of state.cases){const expected=previous?.caseId===prior.id&&previous.status==='reviewed';const found=cases.find(e=>e.source.id===prior.id);
   if(expected){assert.ok(found,`Day ${n}: relevant previous-day reviewed report missing from actual AI context`);assert.equal(found.source.revision,previous.revision);assert.equal(found.facts.review.verdict,previous.verdict);assert.equal(found.facts.review.causeStatus,'not-established');assert.equal(found.facts.review.cause,'');assert.match(found.facts.authority,/historical/);assert.equal(found.facts.sourceState,'current');}
   else assert.equal(found,undefined,`Day ${n}: reported, corrected or withdrawn case leaked into actual AI context`);
  }
  assert.equal(JSON.stringify(context).includes('PRIVATE_ASSET_NOTES_'),false);assert.equal(JSON.stringify(context).includes('FOREIGN_SECRET'),false);
  state.aiChecks.push({day:n,priorCaseId:previous?.caseId??null,expectedVerdict:previous?.status==='reviewed'?previous.verdict:null,deliveredCaseIds:cases.map(e=>e.source.id),deliveredVerdicts:cases.map(e=>e.facts.review.verdict),actualProviderContext:true});
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:'Use current approved work instructions and the named manager. Reviewed lessons describe historical outcomes and uncertainty; they do not approve a repair or complete this shift. Chat has not contacted anyone.',sourceIds:context.evidence.map(e=>e.source.id).slice(0,20)})}]}]});
 };
 return {simulationDays:21,aiAlwaysCurrent:true,dailyScenarios,aiProvider,learningProgress:state};
}
export function withLearningProgress(profile){return {...profile,...createLearningProgressOverrides(profile)};}
