// Opt-in real provider evaluation using fictional authorized work only.
// Reads a user-authorized existing key in memory; never writes or logs credentials.
import fs from 'node:fs';
import path from 'node:path';
import {workforceContext} from '../.sites-runtime/shared/workforce-context.mjs';
import {askCompanion,configuredCompanion} from '../.sites-runtime/shared/openai-companion.mjs';
import {checkedCompanionAnswer} from '../.sites-runtime/shared/companion-requirements.mjs';
import {prepQuestion,prepContext} from '../.sites-runtime/shared/companion-prep.mjs';
import {scopeCurrent} from '../.sites-runtime/shared/companion-context.mjs';
import {qualityWorkspace,at as qualityAt} from '../tests/companion-quality-fixture.mjs';
import {runHandlerCase} from '../tests/ai-week-handler-fixture.mjs';
if(!process.argv.includes('--live'))throw Error('Explicit --live required.');
const arg=name=>process.argv.find(v=>v.startsWith('--'+name+'='))?.slice(name.length+3);
const envPath=arg('env-path');
if(!envPath)throw Error('Supply the approved existing env path.');
const envText=fs.readFileSync(envPath,'utf8');
const key=envText.match(/^\s*OPENAI_API_KEY\s*=\s*["']?(sk-[A-Za-z0-9_-]+)/m)?.[1];
const config=configuredCompanion({OPENAI_API_KEY:key,JMAX_OPENAI_MODEL:'gpt-5.4-mini'});
if(!config)throw Error('Existing configuration has no usable key.');
const dir=path.resolve('evidence/ai-week');fs.mkdirSync(dir,{recursive:true});
const output=path.join(dir,arg('output')??'actual-replies.json');
const report={at:new Date().toISOString(),model:config.model,fictional:true,transport:'Actual production workforce context, provider request, and answer checks via Node; not hosted deployment proof',status:'running',results:[]};
const save=()=>fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
const only=arg('only')?.split(',');
const days=arg('days')?.split(',').map(Number);
const roles=fs.readdirSync(dir).filter(f=>f.endsWith('-cases.json')&&(!only||only.includes(f.replace('-cases.json',''))));
async function runCase(role,c){
 if(process.argv.includes('--handler')){report.transport='Actual authenticated Companion request handler, disposable D1-compatible SQLite, real OpenAI responses, persisted follow-up history and current answer checks; not hosted deployment proof';report.results.push(await runHandlerCase(role,c,config));save();return;}
 const history=[],turns=[];
 for(const [index,question] of [c.question,c.followup].entries()){
  if(!question)continue;
  const w=index&&c.followupWorkspace?c.followupWorkspace:c.workspace;
  const at=index?(c.followupAt??c.at):c.at;
  const selected=index?c.followupSelected:c.selected;
  const previous=history.filter(t=>scopeCurrent(t.scope,w,at,c.prepRevision??1));
  const current=workforceContext(w,question,at,previous.at(-1)?.sources??[],selected);
  const plans=index?(c.followupPrepPlans??c.prepPlans):c.prepPlans;
  if(!selected&&!w.me.scheduleOnly&&prepQuestion(question)){
   const prep=prepContext(w,plans??[],c.prepRevision??1);
   current.scope.push(prep.source);current.evidence.push({source:prep.source,facts:prep.facts,localTimes:{}});
   Object.assign(current.context,{assignedPrep:prep.facts});
  }
  const scopedHistory=current.context.generalLearningQuestion?[]:String(current.context.scopeMode).startsWith('selected-')?previous.filter(t=>t.focus?.id===current.selectedWork?.id&&t.focus?.revision===current.selectedWork?.revision):previous;
  const before=JSON.stringify(w),started=Date.now();let providerMeta={};
  try{
   const reply=await askCompanion(config,{...current.context,communicationPreference:{explanationStyle:c.explanationStyle??'balanced'}},scopedHistory,question,current.evidence.map(e=>e.source),async(url,init)=>{
    const response=await fetch(url,init);
    providerMeta.status=response.status;
    const body=await response.clone().json().catch(()=>null);
    if(response.ok)providerMeta.usage=body?.usage;
    else if(typeof body?.error?.code==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(body.error.code))providerMeta.errorCode=body.error.code;
    return response;
   });
   if(current.selectedWork&&!reply.sources.some(s=>s.id===current.selectedWork.id))reply.sources.unshift(current.selectedWork);
   const answer=checkedCompanionAnswer(w,reply.sources,question,reply.answer,at,current.selectedWork);
   const turn={question,answer,rawAnswer:reply.answer,sources:reply.sources,scopeMode:current.context.scopeMode,context:current.context,elapsedMs:Date.now()-started,providerMeta,workUnchanged:before===JSON.stringify(w),status:'completed'};
   turns.push(turn);history.push({...turn,scope:current.scope,focus:current.selectedWork??null});
   console.log(JSON.stringify({role,day:c.day,turn:index+1,status:'completed',sourceIds:reply.sources.map(s=>s.id)}));
  }catch(error){turns.push({question,status:'failed',category:error?.category??'transport',providerMeta,elapsedMs:Date.now()-started});console.log(JSON.stringify({role,day:c.day,turn:index+1,status:'failed',category:error?.category,providerMeta}));break;}
 }
 report.results.push({role,day:c.day,scenario:c.scenario,expectedFacts:c.expectedFacts,expectedActions:c.expectedActions,prohibitedClaims:c.prohibitedClaims,requiredSourceIds:c.requiredSourceIds,turns,review:'Real replies captured; independent role review required. A completed provider request is not a helpfulness pass.'});save();
}
if(process.argv.includes('--smoke')){const f=qualityWorkspace();f.w.me=f.employee;await runCase('connection-smoke',{day:0,workspace:f.w,at:qualityAt,question:'In one sentence, say what I should do if approved instructions are missing.'});}
else for(const file of roles){const data=JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));for(const c of data.cases)if(!days||days.includes(c.day))await runCase(data.role??file,c);}
report.status=report.results.some(r=>r.turns.some(t=>t.status==='failed'))?'provider failures':'captured; independent review pending';save();
console.log(JSON.stringify({status:report.status,cases:report.results.length,turns:report.results.reduce((n,r)=>n+r.turns.length,0)}));
