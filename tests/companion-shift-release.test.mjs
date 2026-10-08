import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const compile=path=>ts.transpileModule(fs.readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const data=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
const helperUrl=data(compile('../app/shared/companion-shift-release.ts'));
const {companionShiftReleaseBoundary}=await import(helperUrl);
const openai=compile('../app/shared/openai-companion.ts').replace(/from ['"]\.\/(.*?)['"]/g,(_,name)=>`from '${name==='companion-shift-release'?helperUrl:new URL('../.sites-runtime/shared/'+name+'.mjs',import.meta.url).href}'`);
const {askCompanion}=await import(data(openai));
// Immutable third-replay faults; later provider captures must not silently
// replace these failing raw answers with already-repaired regression inputs.
const capture=JSON.parse(fs.readFileSync(new URL('../evidence/ai-multiweek/back-window-replies-verified-2.json',import.meta.url),'utf8'));
const actual=(day,turn=2)=>capture.results.find(r=>r.day===day).turns[turn-1];
const copy=value=>structuredClone(value);
const shift=c=>c.evidence.find(e=>e.source.id===c.myShift.sourceId);
const guide=c=>c.evidence.find(e=>e.source.id==='ai-bw-guide');

test('actual Day19/26 current contexts require manager checkout and cannot invent guide-only checkers',()=>{
 for(const day of [19,26]){
  const t=actual(day),result=companionShiftReleaseBoundary(t.context,t.question);
  assert.ok(result,`Day${day}`);
  assert.match(result.answer,/manager must perform separate operational checkout before you leave/);
  assert.match(result.answer,/manager.*It does not authorize you to close the drawer/s);
  assert.match(result.answer,/No linked closing assignment or assigned physical checker.*supplied/);
  assert.match(result.answer,/separate from payroll clock-out/);
  assert.match(result.answer,/Chat cannot mark your shift checked out or release it/);
  assert.match(result.answer,/keep each ticket attached.*tell Expo the exact/s);
  assert.doesNotMatch(result.answer,/Lee|Morgan|if it is being recorded|that the restaurant uses|must submit Ready|finish your Back Window closing/);
  assert.deepEqual(result.sources.map(s=>[s.id,s.revision]),[[`ai-bw-shift-${day}`,1],['ai-bw-guide',1]]);
 }
});

test('actual assigned closing phases are left to the existing workflow guard',()=>{
 for(const day of [7,8,14,15,21,22,28]){
  const t=actual(day);assert.equal(companionShiftReleaseBoundary(t.context,t.question),null);
 }
 const t=actual(19),c=copy(t.context);
 c.closingStatus={shiftId:c.myShift.sourceId,releaseRecorded:false,assignedCloses:[],linkedTasks:[{id:'real-task',phase:'verification'}]};
 assert.equal(companionShiftReleaseBoundary(c,t.question),null);
});

test('released, draft, cancelled, future and ambiguous shifts cannot be called current unreleased work',()=>{
 const t=actual(26);
 for(const mutate of [
  c=>shift(c).facts.releasedAt=c.asOf,
  c=>shift(c).facts.published=false,
  c=>shift(c).facts.cancelled=true,
  c=>shift(c).facts.start='2099-01-01T00:00:00Z',
  c=>c.myShift.status='next published shift',
  c=>c.myShift.status='conflicting assignments',
  c=>c.myShift.sourceId='missing',
  c=>c.scopeMode='selected-shift'
 ]){const c=copy(t.context);mutate(c);assert.equal(companionShiftReleaseBoundary(c,t.question),null);}
 const c=copy(t.context);c.myShift.status='scheduled shift ended; operational checkout pending';c.asOf='2026-11-03T00:00:00Z';
 assert.ok(companionShiftReleaseBoundary(c,t.question));
});

test('missing, draft, omitted or different-station guides cannot establish manager drawer method',()=>{
 const t=actual(26);
 for(const mutate of [
  c=>c.evidence=c.evidence.filter(e=>e.source.kind!=='standard'),
  c=>guide(c).facts.authority='draft standard',
  c=>guide(c).facts.methodAvailable=false,
  c=>guide(c).facts.instructionContentOmitted=true,
  c=>guide(c).facts.zone='Pizza',
  c=>guide(c).facts.guide.steps=['Close the cash drawer.'],
  c=>c.myShift.station='Pizza',
  c=>c.product='food'
 ]){const c=copy(t.context);mutate(c);assert.equal(companionShiftReleaseBoundary(c,t.question),null);}
});

test('cup arithmetic, ordinary changeover, learning and other-person questions are unchanged',()=>{
 const c=actual(26).context;
 for(const q of ['How many cups should I prepare?','At changeover, who closes the cash drawer?','How does checkout work for Jordan?','Explain this guide.'])assert.equal(companionShiftReleaseBoundary(c,q),null);
 for(const day of [3,10,17,24]){const t=actual(day);assert.equal(companionShiftReleaseBoundary(t.context,t.question),null);}
});

test('provider delivery repairs exact captured context faults even when model cites only the guide',async()=>{
 assert.match(actual(19).answer,/finish your Back Window closing steps/);
 assert.match(actual(26).answer,/that the restaurant uses internally/);
 for(const day of [19,26]){
  const t=actual(day),sources=t.context.evidence.map(e=>e.source);let calls=0;
  const result=await askCompanion({key:'sk-fictional-test-only',model:'gpt-5.4-mini'},t.context,[],t.question,sources,async(_url,init)=>{
   calls++;const prompt=JSON.parse(init.body).input[0].content;
   assert.match(prompt,/A guide's named lead or manager is not an assigned physical checker/);
   assert.match(prompt,/Never qualify this required step/);
   return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:t.answer,sourceIds:['ai-bw-guide']})}]}]});
  });
  assert.equal(calls,1);assert.match(result.answer,/manager must perform separate operational checkout/);
  assert.doesNotMatch(result.answer,/Lee|Morgan|that the restaurant uses/);
  assert.deepEqual(result.sources.map(s=>s.id),['ai-bw-guide',`ai-bw-shift-${day}`]);
 }
});

test('delivery boundary cannot introduce a source omitted from caller authorization',async()=>{
 const t=actual(26),onlyGuide=[guide(t.context).source];
 const original='A fictional original answer.';
 const result=await askCompanion({key:'sk-fictional-test-only',model:'gpt-5.4-mini'},t.context,[],t.question,onlyGuide,async()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:original,sourceIds:['ai-bw-guide']})}]}]}));
 assert.equal(result.answer,original);assert.deepEqual(result.sources,onlyGuide);
});
