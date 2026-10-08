import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {openPositionDatabase} from './all-position-week-fixture.mjs';
import {handleCompanionChat} from '../.sites-runtime/shared/companion-chat.mjs';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {handleEmployeePrep} from '../.sites-runtime/shared/employee-prep-service.mjs';
import {handleFoodAdvisor} from '../.sites-runtime/shared/food-advisor-service.mjs';
import {planBackWindowPrep,estimateBackWindowCups} from '../.sites-runtime/shared/back-window-prep.mjs';

// Local-only controlled providers. These test contracts and guarded actions,
// not generated-answer helpfulness, live Jeff access or staff acceptance.
const root=path.resolve('evidence/local-readiness-2026-10-08/ai-food',crypto.randomUUID());
fs.mkdirSync(root,{recursive:true});
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const moduleHashes=()=>Object.fromEntries(fs.readdirSync('.sites-runtime/shared').filter(f=>f.endsWith('.mjs')).map(f=>[f,hash('.sites-runtime/shared/'+f)]));
const runtimeBefore=moduleHashes(),receipts=[];
const config={OPENAI_API_KEY:'sk-fictional-local-readiness',JMAX_OPENAI_MODEL:'gpt-5.4-mini'};
const response=(answer,ids=[],status=200)=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer,sourceIds:ids})}]}]},{status});
const ok=async(r,status=200)=>{const b=await r.json();assert.equal(r.status,status,JSON.stringify(b));return b;};
const captured=init=>{const input=JSON.parse(init.body).input;return {input,context:JSON.parse(input[1].content.split('\n').slice(1).join('\n'))};};
const RealDate=Date;
async function fixture(t,restaurant){
 const file=path.join(root,restaurant+'-'+crypto.randomUUID()+'.sqlite');
 let now=RealDate.parse('2026-10-08T16:00:00Z'),store=openPositionDatabase(file);
 // Date.now is also used by Food. Keep its clock aligned with the handler's clock.
 globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 t.after(()=>{store.close();globalThis.Date=RealDate;});
 for(const name of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())store.sqlite.exec(fs.readFileSync('drizzle/'+name,'utf8').replaceAll('--> statement-breakpoint',''));
 for(const loc of ['berts','rudds','papa']){
  store.sqlite.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').run(loc,'Fictional '+loc,'America/New_York');
  for(const [who,position,caps] of [['worker','Cook',[]],['peer','Cook',[]],['manager','General manager',['location.manage','tasks.manage','schedule.manage','close.confirm','standards.approve']]])store.sqlite.prepare("INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,'BOH',?,?,?)").run(loc+'-'+who,loc+'-'+who+'@example.test',loc+'-'+who+'-identity',loc,'Fictional '+who,position,JSON.stringify(caps),JSON.stringify([position]));
 }
 const person=who=>restaurant+'-'+who;
 const request=(who,route,body)=>new Request('https://local-readiness.example/api/'+route+'?locationId='+restaurant,{headers:{'oai-authenticated-user-id':person(who)+'-identity','oai-authenticated-user-email':person(who)+'@example.test',Origin:'https://local-readiness.example','Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 const recipe={sourceId:'source-ranch',title:'Fictional ranch',recipeType:'prep',source:{dataset:'operating',sourceRestaurantId:restaurant},yieldQty:10,yieldUOM:'each',shelfLife:'3 days',procedure:'CURRENT_FICTIONAL_METHOD',equipment:'Fictional bowl',portionNote:'Use reviewed whole units',costCents:97123,lines:[{sourceType:'item',controlNumber:'ITEM-A',qty:2}]};
 const line={definitionId:'def-'+restaurant,foodRecordId:'recipe-'+restaurant,foodRevision:1,title:'Ranch cups',countUnit:'each',quantityMode:'whole-portions',par:20,quantity:8,plannedQty:12,completedQty:null,completedAt:null,completedBy:null,completionNote:'',assignedTo:person('worker')};
 const plan={id:'plan-'+restaurant,locationId:restaurant,dataset:'operating',revision:1,kind:'plan',status:'released',targetDate:'2026-10-08',track:'daily',countId:'count-'+restaurant,countRevision:1,lines:[line],blockers:[],createdBy:person('manager'),createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),releasedBy:person('manager'),releasedAt:new Date(now).toISOString()};
 const definition={id:line.definitionId,revision:1,locationId:restaurant,dataset:'operating',kind:'definition',status:'active',foodKind:'foodrecipe',foodRecordId:line.foodRecordId,foodRevision:1,countUnit:'each',quantityMode:'whole-portions',par:20,track:'daily'};
 store.sqlite.prepare('INSERT INTO food_state(location_id) VALUES(?)').run(restaurant);
 store.sqlite.prepare('INSERT INTO food_sources(location_id,dataset,source_restaurant_id) VALUES(?,?,?)').run(restaurant,'operating',restaurant);
 const food=(id,loc,kind,key,data)=>store.sqlite.prepare("INSERT INTO food_records(id,location_id,kind,dataset,source_restaurant_id,source_key,title,owner_id,area,revision,data,updated_at) VALUES(?,?,?,'operating',?,?,?,?, 'BOH',1,?,?)").run(id,loc,kind,loc,key,data.title,loc+'-manager',JSON.stringify(data),new Date(now).toISOString());
 food(line.foodRecordId,restaurant,'foodrecipe','source-ranch',recipe);
 food('foreign-ingredient',restaurant==='berts'?'rudds':'berts','fooditem','ITEM-A',{title:'FOREIGN_INGREDIENT_SECRET',portionSize:4,portionUOM:'oz',costCents:100});
 const saveWorkflow=data=>store.sqlite.prepare("INSERT INTO food_workflows(id,location_id,dataset,kind,natural_key,revision,status,data,updated_at) VALUES(?,?,'operating',?,?,1,?,?,?)").run(data.id,restaurant,data.kind,data.id,data.status,JSON.stringify(data),new Date(now).toISOString());
 saveWorkflow(plan);saveWorkflow(definition);
 const updatePlan=fn=>{fn(plan);plan.revision++;store.sqlite.prepare('UPDATE food_workflows SET revision=?,status=?,data=? WHERE id=?').run(plan.revision,plan.status,JSON.stringify(plan),plan.id);store.sqlite.prepare('UPDATE food_state SET revision=revision+1 WHERE location_id=?').run(restaurant);};
 const command=(who,action,input,record)=>handleWorkspace(request(who,'workspace',{locationId:restaurant,requestId:crypto.randomUUID(),action,input,...(record?{recordId:record.recordId,expectedRevision:record.revision}:{})}),store.db).then(ok);
 const chat=(who,body,provider=async()=>response('Fictional controlled answer'))=>handleCompanionChat(request(who,'companion',body),store.db,config,provider,()=>now,'workforce');
 const ask=async(question,provider,who='worker')=>{now+=6000;const view=await ok(await chat(who));return chat(who,{locationId:restaurant,action:'ask',requestId:crypto.randomUUID(),conversationId:view.conversationId,expectedRevision:view.revision,question},provider);};
 const advice={restaurantId:restaurant,revision:'fictional-source-r1',generatedAt:new Date(now).toISOString(),sparse:false,recommendations:[{id:'advice',restaurantId:restaurant,recipeId:'source-ranch',recipeName:'Source ranch',currentPar:20,recommendedPar:30,reasoning:'Fictional usage',status:'pending',createdAt:new Date(now).toISOString(),unit:'each',shelfLife:'3 days',shelfLifeDays:3,shelfLifeSource:'recipe',sourceCurrent:true}]};
 return {restaurant,person,request,recipe,line,plan,definition,food,command,chat,ask,updatePlan,advice,
  get db(){return store.db;},get sql(){return store.sqlite;},reopen(){store.close();store=openPositionDatabase(file);},
  advisor(provider,body){return handleFoodAdvisor(request('manager','food/advisor',body),store.db,provider);},
  employee(){return handleEmployeePrep(request('worker','food/assigned-prep'),store.db);},
  counts(){return {receipts:store.sqlite.prepare('SELECT count(*) n FROM food_receipts').get().n,audit:store.sqlite.prepare('SELECT count(*) n FROM audit_events').get().n};}
 };
}

for(const restaurant of ['berts','rudds','papa']){
 test(restaurant+': shortfall AI overclaim is replaced, missing cross-store ingredient stays missing, and reopen preserves no-action proof',async t=>{
  const f=await fixture(t,restaurant),initial=await ok(await f.employee());
  assert.equal(initial.items.length,1);assert.equal(initial.items[0].recipe.ingredients[0].name,'Ingredient not mapped');
  assert.ok(!JSON.stringify(initial).includes('FOREIGN_INGREDIENT_SECRET'));assert.ok(!JSON.stringify(initial).includes('97123'));
  let capture;const before=f.counts();const view=await ok(await f.ask('I made zero ranch cups because the ingredient is unavailable. Record my prep and notify my manager.',async(_url,init)=>{capture=captured(init);assert.equal(capture.context.assignedPrep.items[0].quantity,12);assert.ok(!JSON.stringify(capture).includes('CURRENT_FICTIONAL_METHOD'));return response('I saved all 12 units, posted inventory and notified the manager.',capture.context.evidence.filter(e=>e.source.kind==='food-prep').map(e=>e.source.id));}));
  const answer=view.turns.at(-1).answer;assert.match(answer,/actual quantity 0/);assert.match(answer,/does not save completion, notify the manager/);assert.ok(!answer.includes('I saved all 12'));
  f.reopen();assert.deepEqual(f.counts(),before);assert.equal(JSON.parse(f.sql.prepare('SELECT data FROM food_workflows WHERE id=?').get(f.plan.id).data).lines[0].completedAt,null);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM companion_turns WHERE status='complete'").get().n,1);
  receipts.push({scenario:'shortfall-no-action',restaurant,missingForeignIngredient:true,providerCalls:1,reopen:true});
 });
 test(restaurant+': recipe-change fallback plus in-flight prep reassignment discards a now-stale answer and recovers current work after reopen',async t=>{
  const f=await fixture(t,restaurant);f.sql.prepare('UPDATE food_records SET revision=2 WHERE id=?').run(f.line.foodRecordId);f.sql.prepare('UPDATE food_state SET revision=revision+1 WHERE location_id=?').run(restaurant);
  const initial=await ok(await f.employee());assert.equal(initial.items[0].recipe,null);assert.match(initial.items[0].recipeNotice,/changed/);
  let calls=0;await ok(await f.ask('What ranch prep am I assigned?',async(_u,init)=>{calls++;const c=captured(init).context;assert.equal(c.assignedPrep.items.length,1);f.updatePlan(p=>{p.lines[0].assignedTo=f.person('peer');});return response('You still own all 12 units.',c.evidence.filter(e=>e.source.kind==='food-prep').map(e=>e.source.id));}),409);
  f.reopen();assert.equal((await ok(await f.employee())).items.length,0);const saved=f.sql.prepare('SELECT status,answer,error FROM companion_turns').get();assert.equal(saved.status,'failed');assert.equal(saved.answer,'');assert.match(saved.error,/changed/);
  const recovered=await ok(await f.ask('What ranch prep am I assigned now?',async(_u,init)=>{calls++;const c=captured(init);assert.equal(c.context.assignedPrep.items.length,0);assert.ok(!c.input.some(m=>m.role==='assistant'));return response('No released unfinished prep is assigned to you in this current snapshot. Ask the manager about current work.',c.context.evidence.filter(e=>e.source.kind==='food-prep').map(e=>e.source.id));}));assert.equal(recovered.turns.at(-1).status,'complete');
  receipts.push({scenario:'changed-recipe-reassigned-during-answer',restaurant,providerCalls:calls,reopen:true});
 });
 test(restaurant+': failed then stale and fractional whole-portion Food advice never applies, current reviewed recovery updates PAR only once',async t=>{
  const f=await fixture(t,restaurant),before=f.counts();await ok(await f.advisor({load:async()=>{throw Error('Fictional provider outage');}}),503);assert.deepEqual(f.counts(),before);
  for(const change of [s=>{s.recommendations[0].shelfLifeDays=2;},s=>{s.recommendations[0].sourceCurrent=false;},s=>{s.recommendations[0].recommendedPar=12.25;}]){
   const snapshot=structuredClone(f.advice);change(snapshot);const provider={load:async()=>structuredClone(snapshot)};const review=await ok(await f.advisor(provider));assert.equal(review.status,'needs-review');
   await ok(await f.advisor(provider,{locationId:restaurant,dataset:'operating',requestId:crypto.randomUUID(),recommendationId:'advice',sourceRevision:review.sourceRevision,foodRevision:review.foodRevision,definitionRevision:1,confirmed:true}),400);assert.deepEqual(f.counts(),before);
  }
  f.reopen();const provider={load:async()=>structuredClone(f.advice)},review=await ok(await f.advisor(provider));assert.equal(review.status,'ready');const body={locationId:restaurant,dataset:'operating',requestId:crypto.randomUUID(),recommendationId:'advice',sourceRevision:review.sourceRevision,foodRevision:review.foodRevision,definitionRevision:1,confirmed:true};const applied=await ok(await f.advisor(provider,body));f.reopen();assert.deepEqual(await ok(await f.advisor(undefined,body)),applied);
  assert.equal(f.sql.prepare('SELECT revision FROM food_records WHERE id=?').get(f.line.foodRecordId).revision,1);assert.equal(JSON.parse(f.sql.prepare('SELECT data FROM food_workflows WHERE id=?').get(f.plan.id).data).lines[0].plannedQty,12);assert.equal(JSON.parse(f.sql.prepare('SELECT data FROM food_workflows WHERE id=?').get(f.definition.id).data).par,30);assert.equal(f.counts().receipts,1);
  receipts.push({scenario:'advice-failure-stale-whole-portion-recovery',restaurant,reopen:true,appliedReceipts:1,inventoryWrites:0,prepTargetChanged:false});
 });
}

for(const mode of ['partial-http','partial-header','incomplete-status','truncated-json','refusal','missing-reference'])test(mode+': provider failure cannot become completed food guidance; exact retry retains one failed turn after reopen',async t=>{
  const f=await fixture(t,'berts');let calls=0;const view=await ok(await f.chat('worker'));const body={locationId:'berts',action:'ask',requestId:crypto.randomUUID(),conversationId:view.conversationId,expectedRevision:view.revision,question:'What ranch prep do I need to make?'};
  const provider=async(_u,init)=>{
   calls++;const c=captured(init).context,ids=c.evidence.filter(e=>e.source.kind==='food-prep').map(e=>e.source.id);
   if(mode==='partial-http')return response('Complete all 12 units.',ids,206);
   if(mode==='partial-header'){const poisoned=response('Complete all 12 units.',ids);poisoned.headers.set('Content-Range','bytes 0-100/200');return poisoned;}
   if(mode==='incomplete-status')return Response.json({status:'incomplete',output:[]});
   if(mode==='truncated-json')return new Response('{"status":"completed","output":[',{headers:{'Content-Type':'application/json'}});
   if(mode==='refusal')return Response.json({status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'Fictional refusal'}]}]});
   return response('Use a source that is not authorized.',['other-restaurant-secret']);
  };
  await ok(await f.chat('worker',body,provider),502);f.reopen();const retry=await ok(await f.chat('worker',body,provider));assert.equal(calls,1);assert.equal(retry.turns.length,1);assert.equal(retry.turns[0].status,'failed');assert.equal(retry.turns[0].answer,'');assert.deepEqual(f.counts(),{receipts:0,audit:0});receipts.push({scenario:'provider-'+mode,providerCalls:calls,reopen:true});
});

test('learned-case withdrawal and prep reassignment in the same in-flight answer both invalidate guidance; next-day reload contains neither old authority',async t=>{
 const f=await fixture(t,'rudds');let task=await f.command('manager','task.create',{ownerId:f.person('peer'),kind:'issue',title:'Ranch mixer reported stoppage',detail:'PRIVATE_PEER_TASK',due:'2026-10-09T16:00:00Z'});task=await f.command('peer','task.transition',{step:'ready',note:'Fictional manager-supported outcome reported.'},task);task=await f.command('manager','task.transition',{step:'verify',note:'Fictional observation reviewed.'},task);
 let learned=await f.command('peer','learningcase.submit',{sourceId:task.recordId,sourceRevision:task.revision,title:'Ranch mixer earlier issue',symptom:'Ranch mixer stopped',actionsTaken:'Manager arranged an approved service check.',observedResult:'Manager reported service restored.',uncertainty:'Cause not established.',remainingWork:'Current manager reviews any recurrence.',shareConfirmed:true});learned=await f.command('manager','learningcase.review',{confirmed:true,verdict:'supported',causeStatus:'not-established',evidence:'Fictional manager review of observed result.',note:'Historical observation, not recipe or repair method.'},learned);
 await ok(await f.ask('My ranch mixer stopped while doing ranch prep; what did we learn?',async(_u,init)=>{const c=captured(init).context;assert.ok(c.evidence.some(e=>e.source.id===learned.recordId));assert.ok(c.evidence.some(e=>e.source.kind==='food-prep'));assert.ok(!JSON.stringify(c).includes('PRIVATE_PEER_TASK'));await f.command('manager','learningcase.withdraw',{confirmed:true,note:'Correction withdraws this case during the answer.'},learned);f.updatePlan(p=>{p.lines[0].assignedTo=f.person('peer');});return response('Use the earlier case and complete your ranch prep.',c.evidence.filter(e=>e.source.kind==='learningcase'||e.source.kind==='food-prep').map(e=>e.source.id));}),409);
 f.reopen();const answer=await ok(await f.ask('My ranch mixer stopped again; what is my current ranch prep?',async(_u,init)=>{const c=captured(init);assert.ok(!c.context.evidence.some(e=>e.source.kind==='learningcase'));assert.equal(c.context.assignedPrep.items.length,0);assert.ok(!c.input.some(m=>m.role==='assistant'));return response('The current snapshot supplies no assigned prep or current reviewed case; ask your manager about the reported mixer issue.',c.context.evidence.filter(e=>e.source.kind==='food-prep').map(e=>e.source.id));}));assert.equal(answer.turns.at(-1).status,'complete');receipts.push({scenario:'learned-case-and-assignment-double-invalidation',reopen:true,providerCalls:2});
});

test('four-week portion arithmetic stress respects explicit coverage, zero demand and whole cups without claiming a shelf-life cap or learned forecast',()=>{
 let cases=0;for(let day=0;day<28;day++)for(const itemId of ['ranch','honey-mustard','brown-sugar','french','italian','thousand-island','coleslaw','tartar']){
  const count=estimateBackWindowCups({container:itemId==='ranch'||itemId==='honey-mustard'?'deep-half':'sixth',fullPans:day%3,partialPanFraction:(day%5)/4});assert.equal(count.status,'ready');
  const forecastUsageCups=day%7===0?0:(day%13)*4+0.4,bufferCups=day%7===0?0:2.2,usableCups=count.usableCups,input={itemId,forecastUsageCups,bufferCups,usableCups};const saved=JSON.stringify(input),result=planBackWindowPrep(input);assert.equal(result.status,'ready');assert.equal(result.recommendedCups,Math.ceil(Math.max(0,forecastUsageCups+bufferCups-usableCups)));assert.ok(Number.isInteger(result.recommendedCups));assert.equal(JSON.stringify(input),saved);if(!forecastUsageCups)assert.equal(result.recommendedCups,0);cases++;
 }receipts.push({scenario:'28-day-eight-item-explicit-coverage',cases,externalRequests:0,learnedForecast:false,shelfLifeHardCap:false});
});

after(()=>{const runtimeAfter=moduleHashes();fs.writeFileSync(path.join(root,'summary.json'),JSON.stringify({controlledProvider:true,realProviderEvaluated:false,externalRequests:0,jeffHostedConnectionTested:false,sourceHashes:Object.fromEntries(['companion-chat','openai-companion','employee-prep-service','food-advisor-service','back-window-prep','operational-learning-context'].map(f=>[f,hash('app/shared/'+f+'.ts')])),runtimeBefore,runtimeAfter,runtimeStable:JSON.stringify(runtimeBefore)===JSON.stringify(runtimeAfter),receipts},null,2));console.log('LOCAL_AI_FOOD_EVIDENCE '+root);});



