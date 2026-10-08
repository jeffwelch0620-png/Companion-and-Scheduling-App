import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {handleFoodWorkflows} from '../.sites-runtime/shared/food-workflow-service.mjs';
import {handleEmployeePrep} from '../.sites-runtime/shared/employee-prep-service.mjs';
import {handleFoodAdvisor} from '../.sites-runtime/shared/food-advisor-service.mjs';
import {readPrepContext} from '../.sites-runtime/shared/companion-prep.mjs';
import {scopeCurrent} from '../.sites-runtime/shared/companion-context.mjs';
import {workspace} from '../.sites-runtime/shared/service.mjs';
import {prepProgress} from '../.sites-runtime/shared/prep-progress.mjs';
import {parseFoodRecipe} from '../.sites-runtime/shared/food.mjs';
import {seedFoodFixture,jeffDemo} from './food-fixture.mjs';

// Real handlers with a D1-compatible in-memory SQLite adapter. No network,
// credentials, production storage, generated modules, or preview mutations.
function fixture(t){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
 const db={prepare(sql){let params=[];return {bind(...v){params=v;return this;},async all(){const results=sqlite.prepare(sql).all(...params);return {results,meta:{changes:Number(sqlite.prepare('SELECT changes() AS n').get().n)}};},async first(){return sqlite.prepare(sql).get(...params)??null;},async run(){const r=sqlite.prepare(sql).run(...params);return {meta:{changes:Number(r.changes)},results:[]};}};},async batch(stmts){sqlite.exec('BEGIN');try{const results=[];for(const s of stmts)results.push(await s.all());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 db.withSession=()=>db;
 for(const name of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync('drizzle/'+name,'utf8').replaceAll('--> statement-breakpoint',''));
 for(const loc of ['berts','rudds'])sqlite.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').run(loc,'Fictional simulation '+loc,'America/New_York');
 for(const [person,loc,caps,position] of [['demo-owner-berts','berts',['location.manage'],'Owner'],['manager','berts',['tasks.manage'],'BOH Manager'],['cook','berts',[],'Prep Cook'],['backup','berts',[],'Prep Cook'],['rudds-manager','rudds',['tasks.manage'],'BOH Manager'],['rudds-cook','rudds',[],'Prep Cook']])sqlite.prepare("INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,active,schedule_only) VALUES(?,?,?,?,?,'BOH',?,?,'[]',1,0)").run(person,person+'@example.test',person+'-identity',loc,person,position,JSON.stringify(caps));
 const request=(actor,loc,path,body)=>new Request('http://localhost'+path+'?locationId='+loc,{headers:{'oai-authenticated-user-id':actor+'-identity','oai-authenticated-user-email':actor+'@example.test',Origin:'http://localhost','Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 const invoke=async(handler,actor,loc,path,body,...args)=>{const r=await handler(request(actor,loc,path,body),db,...args);return {status:r.status,data:await r.json()};};
 const command=(actor,loc,action,input={},record,requestId=crypto.randomUUID())=>({requestId,locationId:loc,action,input:{dataset:'operating',...input},...(record?{recordId:record.recordId??record.id,expectedRevision:record.revision}:{})});
 const call=(actor,loc,action,input={},record,requestId)=>invoke(handleFoodWorkflows,actor,loc,'/api/food/workflows',command(actor,loc,action,input,record,requestId));
 const record=id=>JSON.parse(sqlite.prepare('SELECT data FROM food_workflows WHERE id=?').get(id.recordId??id.id??id).data);
 const plans=loc=>sqlite.prepare("SELECT data FROM food_workflows WHERE location_id=? AND kind='plan'").all(loc).map(r=>JSON.parse(r.data));
 const assigned=(actor,loc='berts')=>invoke(handleEmployeePrep,actor,loc,'/api/food/assigned-prep');
 const stock=()=>sqlite.prepare('SELECT id,revision,data FROM food_records ORDER BY id').all().map(r=>({...r}));
 const counts=()=>Object.fromEntries(['food_workflow_events','food_receipts','audit_events'].map(name=>[name,sqlite.prepare('SELECT count(*) AS n FROM '+name).get().n]));
 return {db,sqlite,invoke,command,call,record,plans,assigned,stock,counts};
}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
const date=(day,hour=20)=>`2026-10-${String(day).padStart(2,'0')}T${hour}:00:00.000Z`;
const source=(path,needle)=>({path,line:fs.readFileSync(path,'utf8').split(/\r?\n/).findIndex(line=>line.includes(needle))+1});

test('prep cook executes a seven-day count, release, assigned recipe, actual, manager and next-day loop',async t=>{
 const realDate=globalThis.Date;let now=date(7);
 globalThis.Date=class extends realDate{constructor(...v){super(...(v.length?v:[now]));}static now(){return realDate.parse(now);}};
 t.after(()=>{globalThis.Date=realDate;});
 const f=fixture(t);await seedFoodFixture(f.db);
 f.sqlite.prepare('INSERT INTO food_state(location_id) VALUES(?)').run('rudds');
 // Reuse Jeff's canonical schema, original demo seed and source IDs. These
 // additional operating-labeled rows exist only inside this fictional store,
 // because assigned prep and Companion correctly exclude the demo dataset.
 for(const loc of ['berts','rudds']){
  const s={dataset:'operating',sourceRestaurantId:'source-'+loc,label:'Isolated fictional week simulation',importedAt:now,importedBy:loc==='berts'?'manager':'rudds-manager'};
  f.sqlite.prepare('INSERT INTO food_sources(location_id,dataset,source_restaurant_id) VALUES(?,?,?)').run(loc,'operating',s.sourceRestaurantId);
  for(const [rid,title,yieldQty,yieldUOM,portionNote] of [['ranch','Ranch',5,'gal','Five gallons per dedicated lidded vessel; target six vessels (30 gallons) per restaurant.'],['pepper','Julienne green pepper',1,'vessel','Dedicated lidded bus-tub vessel, not a bussing bin; Bert two, Rudd one.'],['cups','Portioned ranch',1,'fl oz','A 3.25 fl oz container capacity is distinct from an 8 fl oz measuring cup.']]){
   const recipe=parseFoodRecipe({restaurantId:s.sourceRestaurantId,id:rid,name:title,recipeType:'prep',yieldQty,yieldUOM,shelfLife:'5 days',procedure:'Fictional recipe method: verify manager instructions before preparing.',equipment:rid==='pepper'?'Dedicated lidded bus-tub vessel':'Dedicated lidded food vessel',portionNote,lines:[{sourceType:'item',controlNumber:jeffDemo.items[0].controlNumber,qty:1}]},s);
   f.sqlite.prepare('INSERT INTO food_records(id,location_id,kind,dataset,source_restaurant_id,source_key,title,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(loc+'-'+rid,loc,'foodrecipe','operating',s.sourceRestaurantId,rid,title,s.importedBy,'BOH',1,JSON.stringify(recipe),now);
  }
 }
 const initialStock=f.stock(),defs={};
 for(const loc of ['berts','rudds']){
  const actor=loc==='berts'?'manager':'rudds-manager';defs[loc]={};
  for(const [rid,track,unit,par] of [['ranch','bulk','5-gallon vessel',6],['pepper','bulk','dedicated lidded vessel',loc==='berts'?2:1],['cups','daily','3.25 fl oz portion',12]])defs[loc][rid]=ok(await f.call(actor,loc,'definition.save',{foodRecordId:loc+'-'+rid,foodRevision:1,track,countUnit:unit,par,reviewNote:'Simulation uses owner-documented vessel targets; fictional recipe shelf life is not an operating rule.',confirmed:true}));
 }
 const evidence={role:'BOH prep cook',execution:'executed actual shared handlers and Companion context; isolated fictional SQLite store',period:{countDates:'2026-10-07 through 2026-10-13',productionDates:'2026-10-08 through 2026-10-14'},sourceBaseline:{jeffSourceCommit:jeffDemo.sourceCommit,seed:'tests/food-fixture.mjs:seedFoodFixture',scope:'Original Jeff demo baseline retained; operating-labeled simulation recipes are separate test-only fixtures.'},assumptions:{ranchParPerRestaurant:{vessels:6,gallonsPerVessel:5,totalGallons:30},pepperPar:{berts:2,rudds:1,unit:'dedicated lidded bus-tub vessel, not bussing bin'},shelfLife:'5 days is fictional test recipe metadata, not a restaurant policy or hard cap',advice:'Target stock par; prepare max(0, par minus physical count).'},days:[],gaps:[],sourceOnly:[],limitations:['No live APIs, credential use, browser UI, supplier orders, production migrations or inventory writes.','Handlers use the SQLite adapter rather than deployed Workers/D1.','Companion executes readPrepContext and scopeCurrent; no live model or formal learning-system claim.','Jeff extension installation and hosted end-to-end integration are unproven here; pending unless separately verified.','Count observations and consumption are fictional physical observations, never inferred from completion.']};
 let delayed=null,shortPlan=null;
 async function planDay(day,loc,track){
  const manager=loc==='berts'?'manager':'rudds-manager',cook=loc==='berts'?'cook':'rudds-cook';
  let count=ok(await f.call(manager,loc,'count.create',{track,businessDate:now.slice(0,10)}));
  const entries=track==='bulk'?[['ranch',4],['pepper',loc==='berts'?1:0]]:[['cups',day===4?0:8]];
  count=ok(await f.call(manager,loc,'count.save',{lines:entries.map(([rid,quantity])=>({definitionId:defs[loc][rid].recordId,quantity,note:`Fictional observed count before day ${day}; independent physical count.`}))},count));
  count=ok(await f.call(manager,loc,'count.submit',{confirmed:true},count));
  let plan=ok(await f.call(manager,loc,'plan.generate',{countId:count.recordId,countRevision:count.revision,targetDate:date(day+7).slice(0,10)}));
  const draft=f.record(plan);
  for(const line of draft.lines)assert.equal(line.plannedQty,Math.max(0,line.par-line.quantity));
  plan=ok(await f.call(manager,loc,'plan.release',{confirmed:true},plan));
  for(const line of f.record(plan).lines)if(line.plannedQty>0)plan=ok(await f.call(manager,loc,'plan.assign',{definitionId:line.definitionId,assignedTo:cook},plan));
  return {count,plan,draft,loc,track};
 }
 const complete=async(actor,loc,p,line,quantity=line.plannedQty,note='')=>f.call(actor,loc,'plan.employee-complete',{definitionId:line.definitionId,quantity,note,confirmed:true},p);
 async function cookAll(actor,loc,plan,except){
  let p={...plan};for(const line of f.record(p).lines)if(!line.completedAt&&line.definitionId!==except)p=ok(await complete(actor,loc,p,line));return p;
 }
 for(let day=1;day<=7;day++){
  now=date(day+6);const entry={day,countDate:now.slice(0,10),productionDate:date(day+7).slice(0,10),scenario:['normal and units','reassignment','access change','retry and shortage','stale advice and carried work','late completion','cross restaurant'][day-1],actions:[]};
  const bulk=await planDay(day,'berts','bulk'),daily=await planDay(day,'berts','daily');
  entry.actions.push({action:'manager observes count, generates, releases and assigns bulk/daily',expected:'Par minus count; same Food definitions and saved plans.',actual:{bulk:bulk.draft.lines.map(l=>({title:l.title,unit:l.countUnit,par:l.par,onHand:l.quantity,toPrep:l.plannedQty})),daily:daily.draft.lines.map(l=>({title:l.title,unit:l.countUnit,par:l.par,onHand:l.quantity,toPrep:l.plannedQty}))},proof:source('app/shared/food-workflow-model.ts','export function planLines')});
  now=date(day+7,14);
  const view=ok(await f.assigned('cook'));
  assert.ok(view.items.some(i=>i.planId===bulk.plan.recordId));assert.ok(view.items.some(i=>i.planId===daily.plan.recordId));
  for(const i of view.items){assert.ok(i.recipe?.procedure);assert.ok(i.recipe?.portionNote);assert.equal(i.recipe.shelfLife,'5 days');assert.equal(i.recipe.ingredients.length,1);assert.equal(i.recipe.ingredients[0].name,'Ingredient not mapped');assert.match(i.recipe.ingredients[0].notice,/manager/);assert.equal('lines'in i.recipe,false);assert.equal('costCents'in i.recipe,false);}
  const w=(await workspace(f.db,{source:'sites',authUserId:'cook-identity'},'berts')).value;
  const prep=await readPrepContext(f.db,w);assert.ok(prep.facts.items.some(i=>i.planId===bulk.plan.recordId));assert.ok(scopeCurrent([prep.source],w,now,prep.source.revision));
  entry.actions.push({action:'cook notices assignment in Companion and opens recipe',expected:'Only own released operating work, recipe and portion guidance; chat makes no completion.',actual:{assignedItems:view.items.map(i=>({title:i.title,quantity:i.quantity,unit:i.unit,targetDate:i.targetDate,track:i.track})),companionItems:prep.facts.items.length,recipeFields:Object.keys(view.items[0].recipe),chatCompletion:prep.facts.workflow.completion},proof:source('app/shared/companion-prep.ts','export async function readPrepContext')});
  if(day===1){
   const unavailable=ok(await f.invoke(handleFoodAdvisor,'manager','berts','/api/food/advisor'));assert.equal(unavailable.status,'unavailable');
   entry.actions.push({action:'manager opens unconfigured advisor',expected:'Explicitly unavailable with no invented AI advice.',actual:unavailable,proof:source('app/shared/food-advisor-service.ts','const unavailable:AdvisorReview')});
   const snapshot={restaurantId:'source-berts',revision:'fictional-portion-source',generatedAt:now,sparse:false,recommendations:[{id:'portion-target',restaurantId:'source-berts',recipeId:'cups',recipeName:'Portioned ranch',currentPar:39,recommendedPar:39,reasoning:'Fictional portion mapping test.',status:'pending',createdAt:now,unit:'fl oz',shelfLife:'5 days',shelfLifeDays:5,shelfLifeSource:'recipe',sourceCurrent:true}],portionMappings:[{prepItemId:'portion-ranch',recipeId:'cups',countUnit:'3.25 fl oz portion',recipeUnit:'fl oz',recipeUnitsPerCountUnit:3.25,reviewedBy:'manager',reviewedAt:now,reviewNote:'Fictional reviewed filled-portion quantity, not inferred from a vessel name.'}]};
   const portionProvider={load:async()=>structuredClone(snapshot)};
   const mapped=ok(await f.invoke(handleFoodAdvisor,'manager','berts','/api/food/advisor',undefined,portionProvider));assert.equal(mapped.rows[0].status,'ready');assert.equal(mapped.rows[0].recommendedPar,12);
   const withoutMap=ok(await f.invoke(handleFoodAdvisor,'manager','berts','/api/food/advisor',undefined,{load:async()=>({...structuredClone(snapshot),portionMappings:[]})}));assert.equal(withoutMap.rows[0].status,'needs-review');
   const badLife=ok(await f.invoke(handleFoodAdvisor,'manager','berts','/api/food/advisor',undefined,{load:async()=>({...structuredClone(snapshot),recommendations:[{...snapshot.recommendations[0],shelfLife:'3 days',shelfLifeDays:3}]})}));assert.equal(badLife.rows[0].status,'needs-review');
   entry.actions.push({action:'manager checks portion conversion and canonical shelf-life readiness',expected:'Explicit 3.25 fl oz filled-portion mapping yields 12 from 39 fl oz; missing mapping or changed shelf life requires review.',actual:{sourceTargetFluidOunces:39,mappedPortionTarget:mapped.rows[0].recommendedPar,missingMappingStatus:withoutMap.rows[0].status,changedShelfLifeStatus:badLife.rows[0].status,portionGuidance:view.items.find(i=>i.title==='Portioned ranch').recipe.portionNote},proof:source('app/shared/food-advisor-bridge.ts','const candidates=defs.flatMap')});
  }
  if(day===2){
   const line=f.record(daily.plan).lines[0],stale={...daily.plan};daily.plan=ok(await f.call('manager','berts','plan.assign',{definitionId:line.definitionId,assignedTo:'backup'},daily.plan));
   const denied=await complete('cook','berts',daily.plan,line);assert.equal(denied.status,403);
   const staleReply=await complete('backup','berts',stale,line);assert.equal(staleReply.status,409);
   assert.equal(ok(await f.assigned('cook')).items.some(i=>i.planId===daily.plan.recordId),false);
   assert.equal(ok(await f.assigned('backup')).items.some(i=>i.planId===daily.plan.recordId),true);
   assert.equal(scopeCurrent([prep.source],w,now,f.sqlite.prepare("SELECT revision FROM food_state WHERE location_id='berts'").get().revision),false);
   daily.plan=await cookAll('backup','berts',daily.plan);
   entry.actions.push({action:'manager reassigns daily prep while cook holds old assignment',expected:'Original cook cannot finish; new cook refreshes current revision; previous Companion source expires.',actual:{oldCookStatus:denied.status,newCookStaleRevision:staleReply.status,newCookCompletion:f.record(daily.plan).status},proof:source('app/shared/food-workflow-service.ts',"target.assignedTo===w.me.id")});
  }
  if(day===3){
   const before=f.counts(),p=daily.plan,line=f.record(p).lines[0],original=f.db.batch;let revoked=false;
   f.db.batch=async statements=>{if(statements.length===6&&!revoked){revoked=true;f.sqlite.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='cook'").run();}return original(statements);};
   const denied=await complete('cook','berts',p,line);f.db.batch=original;assert.equal(denied.status,403);assert.deepEqual(f.counts(),before);assert.equal(f.record(p).revision,p.revision);
   const hidden=await f.assigned('cook');assert.equal(hidden.status,403);
   f.sqlite.prepare("UPDATE memberships SET active=1,revision=revision+1 WHERE id='cook'").run();
   entry.actions.push({action:'employee access revoked during completion, then restored in fictional roster',expected:'No partial workflow/event/receipt mutation; fresh authorized read after restoration.',actual:{midflightStatus:denied.status,readWhileInactive:hidden.status,mutationsAfterRejectedReport:0},proof:source('app/shared/food-workflow-service.ts','UPDATE food_state SET revision=revision+1,last_command=')});
  }
  if(day===4){
   const line=f.record(daily.plan).lines[0];assert.equal(line.plannedQty,12);
   const missing=await complete('cook','berts',daily.plan,line,0);assert.equal(missing.status,400);
   const body=f.command('cook','berts','plan.employee-complete',{definitionId:line.definitionId,quantity:0,note:'Ingredient unavailable; manager informed.',confirmed:true},daily.plan,'day-four-report');
   const first=ok(await f.invoke(handleFoodWorkflows,'cook','berts','/api/food/workflows',body)),before=f.counts(),stockBefore=f.stock();
   const retry=ok(await f.invoke(handleFoodWorkflows,'cook','berts','/api/food/workflows',body));assert.deepEqual(retry,first);assert.deepEqual(f.counts(),before);assert.deepEqual(f.stock(),stockBefore);
   const changed=await f.invoke(handleFoodWorkflows,'cook','berts','/api/food/workflows',{...body,input:{...body.input,quantity:1}});assert.equal(changed.status,409);
   daily.plan=first;shortPlan=daily.plan;const projection=prepProgress(f.plans('berts'),'berts','operating').find(p=>p.id===first.recordId);assert.equal(projection.shortages[0].actual,0);
   entry.actions.push({action:'cook reports zero with shortage note, retries uncertain save; manager views shortage',expected:'Explicit zero preserved, difference explained, one receipt/event; shortage remains actionable.',actual:{missingNoteStatus:missing.status,sameReceipt:JSON.stringify(first)===JSON.stringify(retry),changedRetryStatus:changed.status,managerShortage:projection.shortages[0],planStatus:f.record(first).status},proof:source('app/shared/prep-progress.ts','shortages:needed.filter')});
   const review=await f.call('manager','berts','plan.review',{definitionId:line.definitionId,resolved:true,note:'Reviewed shortage and arranged replacement prep.'},daily.plan);assert.equal(review.status,400);
   const correction=await f.call('manager','berts','plan.complete',{definitionId:line.definitionId,quantity:12,note:'Later replenishment',confirmed:true},daily.plan);assert.equal(correction.status,400);
   entry.actions.push({action:'manager attempts persisted shortage resolution and corrected completion',expected:'Retain original report and save an explicit follow-through/resolution.',actual:{reviewStatus:review.status,reviewError:review.data.error,correctionStatus:correction.status,correctionError:correction.data.error},gap:'prep-shortage-resolution'});
  }
  if(day===5){
   const provider={load:async()=>({restaurantId:'source-berts',revision:'fictional-source-v1',generatedAt:now,sparse:false,recommendations:[{id:'ranch-target',restaurantId:'source-berts',recipeId:'ranch',recipeName:'Ranch',currentPar:30,recommendedPar:30,reasoning:'Fictional source advice target, not production amount.',status:'pending',createdAt:now,unit:'gal',shelfLife:'5 days',shelfLifeDays:5,shelfLifeSource:'recipe',sourceCurrent:true}],portionMappings:[{prepItemId:'ranch-vessel',recipeId:'ranch',countUnit:'5-gallon vessel',recipeUnit:'gal',recipeUnitsPerCountUnit:5,reviewedBy:'manager',reviewedAt:now,reviewNote:'Owner vessel convention used in fictional test.'}]})};
   const review=ok(await f.invoke(handleFoodAdvisor,'manager','berts','/api/food/advisor',undefined,provider));assert.equal(review.rows[0].recommendedPar,6);assert.equal(review.rows[0].status,'ready');
   const oldSource={load:async scope=>{const s=await provider.load(scope);return {...s,recommendations:s.recommendations.map(r=>({...r,sourceCurrent:false}))};}};
   const old=ok(await f.invoke(handleFoodAdvisor,'manager','berts','/api/food/advisor',undefined,oldSource));assert.equal(old.rows[0].status,'needs-review');
   const unmapped={load:async scope=>({...await provider.load(scope),portionMappings:[]})};
   const needs=ok(await f.invoke(handleFoodAdvisor,'manager','berts','/api/food/advisor',undefined,unmapped));assert.equal(needs.rows[0].status,'needs-review');
   bulk.plan=ok(await f.call('manager','berts','plan.assign',{definitionId:f.record(bulk.plan).lines[0].definitionId,assignedTo:'cook'},bulk.plan));
   const stale=await f.invoke(handleFoodAdvisor,'manager','berts','/api/food/advisor',{requestId:'stale-advice',locationId:'berts',dataset:'operating',confirmed:true,sourceRevision:review.sourceRevision,foodRevision:review.foodRevision,recommendationId:'ranch-target',definitionRevision:review.rows[0].definitionRevision},provider);assert.equal(stale.status,409);
   const latest=ok(await f.invoke(handleFoodAdvisor,'manager','berts','/api/food/advisor',undefined,provider));
   defs.berts.ranch=ok(await f.invoke(handleFoodAdvisor,'manager','berts','/api/food/advisor',{requestId:'fresh-advice',locationId:'berts',dataset:'operating',confirmed:true,sourceRevision:latest.sourceRevision,foodRevision:latest.foodRevision,recommendationId:'ranch-target',definitionRevision:latest.rows[0].definitionRevision},provider));assert.equal(f.record(defs.berts.ranch).par,6);
   delayed=daily.plan;
   entry.actions.push({action:'review vessel-mapped source target, reject stale approval, refresh and approve',expected:'30 gal maps to six five-gallon vessels; count four implies prepare two; stale review changes nothing.',actual:{mappedPar:latest.rows[0].recommendedPar,unmappedStatus:needs.rows[0].status,staleSourceStatus:old.rows[0].status,staleStatus:stale.status,storedPar:f.record(defs.berts.ranch).par,alreadyReleasedProduction:f.record(bulk.plan).lines.find(l=>l.foodRecordId==='berts-ranch').plannedQty,dailyWorkCarriedForward:true},proof:source('app/shared/food-advisor-bridge.ts','const target=r.recommendedPar/factor')});
  }
  if(day===6){
   const carry=ok(await f.assigned('cook')).items.find(i=>i.planId===delayed.recordId);assert.ok(carry);assert.equal(carry.targetDate,date(12).slice(0,10));
   delayed=await cookAll('cook','berts',delayed);const actual=f.record(delayed).lines[0];assert.equal(actual.completedAt.slice(0,10),date(13).slice(0,10));
   entry.actions.push({action:'cook completes yesterday’s carried assignment alongside today’s work',expected:'Past target remains explicit; original plan receives actual completion timestamp, no silent today association.',actual:{targetDate:f.record(delayed).targetDate,completedAt:actual.completedAt,completedBy:actual.completedBy,status:f.record(delayed).status},proof:source('app/shared/employee-prep.ts','targetDate:p.targetDate')});
  }
  if(day===7){
   now=date(13);const otherBulk=await planDay(day,'rudds','bulk'),otherDaily=await planDay(day,'rudds','daily');now=date(14,14);
   const own=ok(await f.assigned('rudds-cook','rudds'));assert.equal(own.items.find(i=>i.title==='Julienne green pepper').quantity,1);
   const read=await f.assigned('cook','rudds');assert.equal(read.status,403);
   const write=await complete('cook','rudds',otherDaily.plan,f.record(otherDaily.plan).lines[0]);assert.equal(write.status,403);
   const foreignId=await f.call('manager','berts','plan.assign',{definitionId:f.record(daily.plan).lines[0].definitionId,assignedTo:'rudds-cook'},daily.plan);assert.equal(foreignId.status,400);
   const guess=await f.call('manager','berts','plan.complete',{definitionId:f.record(otherDaily.plan).lines[0].definitionId,quantity:1,confirmed:true},otherDaily.plan);assert.equal(guess.status,404);
   otherBulk.plan=await cookAll('rudds-cook','rudds',otherBulk.plan);otherDaily.plan=await cookAll('rudds-cook','rudds',otherDaily.plan);
   entry.actions.push({action:'same week targets at Rudd; attempt cross-restaurant read/report/assignment/record guess',expected:'Rudd keeps six ranch vessels and one pepper vessel; Bert employee cannot access or alter them.',actual:{rudds:otherBulk.draft.lines.map(l=>({title:l.title,par:l.par,onHand:l.quantity,toPrep:l.plannedQty})),statuses:{foreignRead:read.status,foreignReport:write.status,foreignAssignment:foreignId.status,foreignRecordId:guess.status}},proof:source('app/shared/food-workflow-service.ts','Workflow not found in this restaurant and dataset.')});
  }
  bulk.plan=await cookAll('cook','berts',bulk.plan);
  if(day!==2&&day!==4&&day!==5)daily.plan=await cookAll('cook','berts',daily.plan);
  const progress=prepProgress(f.plans('berts'),'berts','operating');
  if(shortPlan&&day>=4)assert.ok(progress.some(p=>p.id===shortPlan.recordId&&p.shortages[0].actual===0));
  const page=ok(await f.invoke(handleFoodWorkflows,'manager','berts','/api/food/workflows'));
  entry.actions.push({action:'manager follows actuals and opens next physical count cycle',expected:'Manager sees saved report/history; completion never posts stock; next day derives from a fresh physical count.',actual:{releasedPlanStatuses:[f.record(bulk.plan).status,f.record(daily.plan).status],managerFollowthrough:progress,workflowPlans:page.plans.length,stockUnchanged:JSON.stringify(f.stock())===JSON.stringify(initialStock),nextCountDate:day===7?'week complete':date(day+7).slice(0,10)},proof:source('app/shared/food-workflow-service.ts',"INSERT INTO food_workflow_events(workflow_id,revision,event)")});
  assert.deepEqual(f.stock(),initialStock);evidence.days.push(entry);
 }
 evidence.gaps.push({id:'prep-shortage-resolution',severity:'P2',basis:'executed',expected:'Manager saves review, remediation and resolved/unresolved state while retaining original actual quantity.',actual:'A zero-quantity shortage completes the plan and remains in the manager projection on all later days; plan.review is unsupported, and re-completion of the finished line is rejected. Persistence itself preserves evidence; missing resolution contract prevents recording follow-through.',repro:'Day 4 reports zero of 12 with note, manager sends plan.review and plan.complete; both 400; days 5–7 still show same shortage.',sources:[source('app/shared/prep-progress.ts','shortages:needed.filter'),source('app/shared/food-workflow-service.ts',"Unsupported prep workflow action."),source('app/shared/food-workflow-service.ts',"Choose an unfinished prep task.")]});
 evidence.sourceOnly.push({claim:'Assigned recipe shelf-life and ingredient visibility mapping fixed locally.',basis:'executed seven-day source API reads plus employee-recipe-projection focused render/API checks',detail:'Assigned recipe includes source shelfLife and scoped ingredients on every simulated day. Demo-only ingredient references remain explicitly unmapped rather than leaking from a different dataset. The fictional 5-day value is not an operating rule or computed expiry.'});
 evidence.sourceOnly.push({claim:'Core planning does not enforce shelf-life quantity cap or automatically calculate vessel/portion conversions.',basis:'source-only',detail:'Core planLines uses par minus count; reviewed countUnit is free text. Advisor readiness requires canonical shelf-life metadata and explicit mappings for differing units. No automatic safety cap or formal live ML proved.',sources:[source('app/shared/food-workflow-model.ts','export function planLines'),source('app/shared/food-workflow-service.ts',"countUnit:text(c.input.countUnit"),source('app/shared/food-advisor-bridge.ts','Canonical recipe shelf life is missing')]});
 evidence.sourceOnly.push({claim:'Recovered Jeff source extension keeps its advisor and adds authenticated read-only source context.',basis:'source-only; package inspected, extension tests and live installation not executed by this simulation',detail:'Local patch adds recipe shelf-life context and reviewed portion mappings, and asks the existing advisor for target pars. Existing release receipt reports installation/configuration pending. Receipt is historical local evidence, not a fresh source/deployment check.',sources:[source('../../jeff-food-integration/backend-extension.patch','Recommend a recipe par target'),source('../../jeff-food-integration/backend-extension.patch','@api_router.get("/integration/food-advisor'),source('evidence/parallel-finish/jeff-food.md','live connection remains blocked')]});
 evidence.totals={days:evidence.days.length,plans:f.plans('berts').length+f.plans('rudds').length,stockRecords:f.stock().length,workflowWrites:f.counts(),stockRecordsUnchanged:true};assert.equal(evidence.days.length,7);
 fs.mkdirSync('evidence/week-simulation',{recursive:true});fs.writeFileSync('evidence/week-simulation/prep-cook.json',JSON.stringify(evidence,null,2)+'\n');
});
