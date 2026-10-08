import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {openPositionDatabase} from './all-position-week-fixture.mjs';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {handleCompanionChat} from '../.sites-runtime/shared/companion-chat.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex').slice(0,12);
export const trialSource=profile=>{const raw=profile.source??profile.provenance?.source??'Owner-confirmed position manifest, fictional QA approval only';return typeof raw==='string'?raw:JSON.stringify(raw);};
export const trialGaps=profile=>Object.entries(profile).filter(([key])=>/gap/i.test(key)).flatMap(([key,value])=>(Array.isArray(value)?value:[value]).filter(Boolean).map(v=>({field:key,detail:typeof v==='string'?v:JSON.stringify(v)})));
export function trialSourceRevision(){const files=fs.readdirSync('.sites-runtime/shared').filter(f=>f.endsWith('.mjs')).sort();const hash=createHash('sha256');for(const f of files){hash.update(f);hash.update(fs.readFileSync(path.join('.sites-runtime/shared',f)));}const components={};for(const name of ['openai-companion','companion-chat','companion-memory','workforce-context','companion-context'])for(const [kind,file] of [['source',`app/shared/${name}.ts`],['compiled',`.sites-runtime/shared/${name}.mjs`]])if(fs.existsSync(file))components[file]={kind,sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')};return {capturedAt:new Date().toISOString(),runtimeSha256:hash.digest('hex'),compiledModuleCount:files.length,fixtureSha256:createHash('sha256').update(fs.readFileSync('tests/ai-task-trial-fixture.mjs')).digest('hex'),runnerSha256:createHash('sha256').update(fs.readFileSync('tests/ai-task-trial-runner.mjs')).digest('hex'),components};}
export function buildTaskCases(profile){
 const cases=[];
 for(const phase of ['opening','service','closing']){
  const seen=new Set();
  for(const [index,text] of (profile[phase]??[]).entries()){
   const duty=String(text).trim();if(!duty||seen.has(duty))continue;seen.add(duty);
   cases.push({caseId:`${profile.id}-${phase}-${digest(duty)}`,profileId:profile.id,phase,index:index+1,type:'duty',title:duty,expectedHelpfulAction:duty,question:`I am the ${profile.position} at ${profile.restaurant}. Walk me through this assigned ${phase} task: ${duty} Explain the practical steps supported by our current instructions, how I know it is done, and what to do if I get blocked. Do not invent a missing recipe, chemical, temperature or equipment method.`});
  }
 }
 if(profile.goal)cases.push({caseId:`${profile.id}-goal-${digest(profile.goal)}`,profileId:profile.id,phase:'goal',index:1,type:'goal',supportedGoalWorkflow:profile.position!=='Dishwasher',title:profile.goal,expectedHelpfulAction:profile.goal,question:`As the ${profile.position}, how can I work toward this stated practice goal: ${profile.goal}? Give a practical approach using the current role instructions, explain who checks the outcome, and distinguish practice from permission or completed work.${profile.position==='Dishwasher'?' My current role has no in-app development-goal workflow; do not pretend one was assigned.':''}`});
 for(const [index,scenario] of (profile.dailyScenarios??[]).entries())cases.push({caseId:`${profile.id}-curveball-${index+1}`,profileId:profile.id,phase:'curveball',index:index+1,type:'curveball',title:scenario.title,detail:scenario.detail,expectedHelpfulAction:scenario.nextAction??'Use the current approved role instructions; report missing instructions to the named manager without inventing a method.',question:`During my ${profile.position} shift: ${scenario.title}. ${scenario.detail} What should I do now, why, who needs to be involved, and what must remain unresolved until checked?`});
 return cases;
}
const responseData=async response=>{const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;};
export async function createTaskTrial(profile,{file,bindings,fetcher}){
 fs.mkdirSync(path.dirname(file),{recursive:true});let store=openPositionDatabase(file),clock=Date.now();let captured,lastPhase,archives=0,reopens=0,priorGuideAnswersChecked=0;const guideAnswerIds=new Set();
 const loc=profile.restaurant,area=profile.area??'BOH',cases=buildTaskCases(profile);
 const request=(route,actor='worker',body,location=loc)=>new Request(`https://ai-task-trial.example/api/${route}?locationId=${location}`,{headers:{'oai-authenticated-user-id':actor+'-trial-identity','oai-authenticated-user-email':actor+'@example.test',Origin:'https://ai-task-trial.example','Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 const command=(actor,action,input,record)=>handleWorkspace(request('workspace',actor,{locationId:loc,requestId:crypto.randomUUID(),action,input,...(record?{recordId:record.id??record.recordId,expectedRevision:record.revision}:{})}),store.db).then(responseData);
 const existing=(kind,title)=>{const r=store.sqlite.prepare('SELECT * FROM records WHERE kind=? AND json_extract(data,\'$.title\')=? AND location_id=? ORDER BY revision DESC LIMIT 1').get(kind,title,loc);return r&&{id:r.id,revision:r.revision,ownerId:r.owner_id,data:JSON.parse(r.data)};};
 const snapshot=()=>JSON.stringify(Object.fromEntries(['records','command_receipts','audit_events','food_records','food_workflows','food_workflow_events','food_receipts'].map(table=>[table,store.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])));
 const chat=async(body,query={})=>{const base=request('companion','worker',body),target=new URL(base.url);for(const [key,value] of Object.entries(query))target.searchParams.set(key,String(value));const response=await handleCompanionChat(new Request(target,base),store.db,bindings,async(url,init)=>{
  const input=JSON.parse(init.body).input,context=JSON.parse(input[1].content.split('\n').slice(1).join('\n'));captured={input,context};
  assert.equal(JSON.stringify(input).includes('FOREIGN_TRIAL_SECRET'),false,'Another restaurant must not reach the provider');
  const reply=await fetcher(url,init,{input,context,profile});captured.providerStatus=reply.status;
  try{captured.usage=(await reply.clone().json()).usage??null;}catch{captured.usage=null;}
  return reply;
 },()=>clock,'workforce');return {status:response.status,data:await response.json()};};
 const close=()=>store.close();
 try{
  if(!store.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='locations'").get()){
   for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())store.sqlite.exec(fs.readFileSync('drizzle/'+f,'utf8').replaceAll('--> statement-breakpoint',''));
   for(const id of ['berts','rudds','papa','comm'])store.sqlite.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').run(id,'Fictional '+id,'America/New_York');
   for(const [actor,position,caps,restaurant=loc,department=area] of [['worker',profile.position,profile.capabilities??[]],['manager','General manager',['location.manage','tasks.manage','people.manage','standards.approve','close.confirm','schedule.manage','schedule.publish']],['outsider','Server',[],loc==='berts'?'rudds':'berts','FOH']])store.sqlite.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?,?)').run(actor,actor+'@example.test',actor+'-trial-identity',restaurant,'Fictional '+actor,department,position,JSON.stringify(caps),JSON.stringify([profile.position]));
   store.sqlite.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,1,?,?)').run('foreign-trial-secret',loc==='berts'?'rudds':'berts','task','outsider','FOH',JSON.stringify({title:'FOREIGN_TRIAL_SECRET',detail:'Must never reach this employee',kind:'task',phase:'open',due:new Date(clock+7*86400000).toISOString(),history:[]}),new Date().toISOString());
  }
  const guideTitle=`QA role instructions: ${profile.id}`;
  let guide=existing('standard',guideTitle);
  if(!guide){const draft=await command('manager','standard.save',{title:guideTitle,position:profile.position,zone:'Task-by-task QA role reference',criteria:['Explain the specific task and when to ask the responsible manager'],source:trialSource(profile),version:1,verification:'manager',guide:{purpose:`${profile.position} operating discussion reference; fictional software-test approval, not production SOP publication.`,preparation:(profile.opening??[]).map(step=>'At opening: '+step),steps:[...(profile.service??[]).map(step=>'During service: '+step),...(profile.closing??[]).map(step=>'At closing: '+step)],troubleshooting:['Use only the supplied role instructions. If a detailed recipe, sanitation concentration, temperature or equipment method is missing, pause that affected work and ask the manager for the current method.'],escalation:'Fictional manager is the named on-duty manager for this isolated restaurant.'}});await command('manager','standard.approve',{validated:true,note:'Fictional QA reference approved to test the supplied source instructions; no restaurant SOP publication.'},draft);guide=existing('standard',guideTitle);}
  const initialView=await chat();assert.equal(initialView.status,200,JSON.stringify(initialView.data));
  // Resume clock after the last saved request without changing global time.
  const latest=store.sqlite.prepare('SELECT max(last_started) AS t FROM companion_conversations').get().t;if(latest)clock=Math.max(clock,Number(latest)+300000);
  return {
   profile,cases,guide,request,snapshot,
   async askCase(spec){
    if(lastPhase&&lastPhase!==spec.phase){const current=await chat();assert.equal(current.status,200);if(current.data.turns.length){const archived=await chat({action:'start-new',locationId:loc,conversationId:current.data.conversationId,expectedRevision:current.data.revision});assert.equal(archived.status,200,JSON.stringify(archived.data));archives++;}const before=snapshot();store.close();store=openPositionDatabase(file);assert.equal(snapshot(),before);reopens++;}
    lastPhase=spec.phase;clock+=300000;
    const taskTitle=`QA assigned task ${spec.caseId}`;let task=existing('task',taskTitle);
    if(!task){await command('manager','task.create',{ownerId:'worker',title:taskTitle,detail:spec.type==='curveball'?`${spec.title}: ${spec.detail}\nCurrent assigned next action: ${spec.expectedHelpfulAction}`:`${spec.title}\nSource role reference: ${guide.id}. This assignment remains subject to independent manager review.`,kind:profile.position==='Dishwasher'||spec.type!=='curveball'?'task':'issue',due:new Date(clock+7*86400000).toISOString()});task=existing('task',taskTitle);}
    // Normal tasks select their actual approved method; curveballs select their
    // current reported assignment and expected remedy. Both records are real.
    let selected=spec.type==='curveball'?task:guide;
    if(spec.type==='goal'&&spec.supportedGoalWorkflow){let goal=existing('goal',spec.title);if(!goal){await command('worker','goal.create',{ownerId:'worker',managerId:'manager',title:spec.title,definition:spec.expectedHelpfulAction,type:'development',standardId:guide.id,standardRevision:guide.revision,due:new Date(clock+7*86400000).toISOString()});goal=existing('goal',spec.title);}selected=goal;}
    let current=await chat();assert.equal(current.status,200,JSON.stringify(current.data));
    for(const turn of current.data.turns.filter(t=>guideAnswerIds.has(t.id??t.requestId))){assert.equal(turn.stale,false,'An unrelated new task must not invalidate an unchanged guide answer');assert.ok(turn.answer,'Unchanged guide answer must remain readable after unrelated work is assigned');priorGuideAnswersChecked++;}
    if(current.data.full){const archived=await chat({action:'start-new',locationId:loc,conversationId:current.data.conversationId,expectedRevision:current.data.revision});assert.equal(archived.status,200);archives++;current=archived;}
    const before=snapshot();captured=null;
    const result=await chat({action:'ask',locationId:loc,conversationId:current.data.conversationId,expectedRevision:current.data.revision,requestId:`trial-${spec.caseId}`,question:spec.question,focus:{id:selected.id,revision:selected.revision}});
    assert.equal(snapshot(),before,'An AI answer must not mutate operational work');
    const turn=result.data.turns?.find(t=>t.requestId===`trial-${spec.caseId}`||t.id===`trial-${spec.caseId}`)??result.data.turns?.at(-1);if(selected.id===guide.id&&turn?.answer)guideAnswerIds.add(turn.id??turn.requestId);
    return {...spec,restaurant:loc,position:profile.position,source:trialSource(profile),provenance:profile.provenance??null,sourceGaps:trialGaps(profile),knownGaps:profile.knownGaps??profile.gaps??[],qaApprovalOnly:true,contextFixture:'Approved QA manifest guide for normal duties; actual generic assignment for curveballs and actual saved supported goal. No Jeff/live prep/dispatch/receipt records are seeded.',assignedTask:{id:task.id,revision:task.revision},focus:{id:selected.id,revision:selected.revision,title:selected.data.title},handlerStatus:result.status,providerStatus:captured?.providerStatus??null,status:turn?.status??'handler-error',answer:turn?.answer??'',sources:turn?.sources??[],question:spec.question,error:result.status!==200?result.data.error:turn?.error??null,evidence:captured?.context?.evidence??[],context:captured?.context??null,providerInput:captured?.input??null,usage:captured?.usage??null,operationalMutation:false};
   },
   async finish(){const before=snapshot();store.close();store=openPositionDatabase(file);assert.equal(snapshot(),before);reopens++;const turns=store.sqlite.prepare('SELECT count(*) AS n FROM companion_turns').get().n;const savedArchives=store.sqlite.prepare('SELECT id FROM companion_archives').all();const observed=new Set();for(const query of [{},...savedArchives.map(row=>({archived:row.id}))]){const view=await chat(undefined,query);assert.equal(view.status,200,JSON.stringify(view.data));for(const turn of (view.data.turns??[]).filter(t=>guideAnswerIds.has(t.id??t.requestId))){assert.equal(turn.stale,false,'An unchanged guide answer must survive final reopen and archive retrieval');assert.ok(turn.answer,'Saved guide answer must remain readable');observed.add(turn.id??turn.requestId);}}assert.equal(observed.size,guideAnswerIds.size,'Every generated guide answer must be retrievable from active or archived history');return {databaseReopens:reopens,archivesThisRun:archives,retainedTurns:turns,retainedArchives:savedArchives.length,priorGuideAnswersChecked,finalGuideAnswersRetrieved:observed.size,finalReopen:true,operationalReseeds:0};},close,
  };
 }catch(error){close();throw error;}
}
