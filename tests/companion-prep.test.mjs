import test from 'node:test';
import assert from 'node:assert/strict';
import {prepContext,prepQuestion,readPrepContext} from '../.sites-runtime/shared/companion-prep.mjs';
import {scopeCurrent} from '../.sites-runtime/shared/companion-context.mjs';
import {askCompanion} from '../.sites-runtime/shared/openai-companion.mjs';
import {qualityWorkspace,at} from './companion-quality-fixture.mjs';
const fixture=()=>{
 const f=qualityWorkspace();f.w.me=f.employee;
 const plan={id:'own-plan',revision:3,kind:'plan',locationId:f.w.location.id,dataset:'operating',status:'released',targetDate:'2026-10-08',track:'daily',lines:[{definitionId:'ranch',foodRecordId:'ranch-recipe',foodRevision:2,title:'Ranch cups',plannedQty:12,countUnit:'cup',completedAt:null,assignedTo:f.employee.id}]};
 return {...f,plan};
};
test('Companion receives only own released operating prep and no recipe method or private list notes',()=>{
 const {w,plan}=fixture();const context=prepContext(w,[{...plan,privateNote:'PRIVATE',lines:[...plan.lines,{...plan.lines[0],assignedTo:'other',title:'OTHER'}]}, {...plan,id:'draft',status:'draft'}, {...plan,id:'demo',dataset:'demo'}, {...plan,id:'elsewhere',locationId:'elsewhere'}],9);
 assert.equal(context.facts.items.length,1);assert.equal(context.facts.items[0].quantity,12);assert.ok(!JSON.stringify(context).includes('PRIVATE'));assert.ok(!JSON.stringify(context).includes('OTHER'));assert.ok(context.facts.workflow.completion.includes('Chat does not complete'));
 assert.equal(scopeCurrent([context.source],w,at,9),true);assert.equal(scopeCurrent([context.source],w,at,10),false);assert.equal(scopeCurrent([context.source],w,at),false);
 assert.equal(scopeCurrent([context.source],{...w,me:{...w.me,id:'different'}},at,9),false);
});
test('prep context stays bounded, retains bulk track, and rejects schedule-only access',()=>{
 const {w,plan}=fixture();const plans=Array.from({length:23},(_,i)=>({...plan,id:'bulk-'+i,track:'bulk'}));const context=prepContext(w,plans,4);
 assert.equal(context.facts.items.length,20);assert.equal(context.facts.omittedItems,3);assert.equal(context.facts.items[0].track,'bulk');
 assert.throws(()=>prepContext({...w,me:{...w.me,scheduleOnly:true}},plans,4),e=>e.status===403);
});
test('database reader binds restaurant and person and refuses a changed Food snapshot',async()=>{
 const {w,plan}=fixture();let calls=0;const queries=[];
 const db={prepare(sql){return {bind(...args){queries.push({sql,args});return this;},async first(){return {revision:++calls};},async all(){return {results:[{data:JSON.stringify(plan)}]};}};}};
 await assert.rejects(readPrepContext(db,w),e=>e.status===409);
 const query=queries.find(q=>q.sql.includes('food_workflows'));assert.deepEqual(query.args,[w.location.id,w.me.id]);assert.ok(query.sql.includes("dataset='operating'"));assert.ok(query.sql.includes("status='released'"));
});
test('prep questions engage the connection while unrelated scheduling questions do not',()=>{
 for(const q of ['What prep is assigned to me?','What should I do today?','How many ranch cups?','My work'])assert.equal(prepQuestion(q),true);
 assert.equal(prepQuestion('When is my next shift?'),false);
});
test('provider receives the narrow Food connection and can cite its saved assignment snapshot',async()=>{
 const {w,plan}=fixture(),prep=prepContext(w,[plan],9);
 const reply=await askCompanion({key:'sk-fictional-test-only',model:'gpt-5.4-mini'},{product:'workforce',assignedPrep:prep.facts,evidence:[prep]},[],'What prep is assigned to me?',[prep.source],async(_url,init)=>{
  const body=JSON.parse(init.body),serialized=JSON.stringify(body);
  assert.ok(serialized.includes('narrow active Food connection'));assert.ok(serialized.includes('Ranch cups'));assert.ok(serialized.includes('Chat does not complete prep'));
  assert.deepEqual(body.text.format.schema.properties.sourceIds.items.enum,[prep.source.id]);
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:'You have 12 ranch cups assigned. Open Your assigned prep for the current recipe.',sourceIds:[prep.source.id]})}]}]});
 });assert.deepEqual(reply.sources,[prep.source]);
});
