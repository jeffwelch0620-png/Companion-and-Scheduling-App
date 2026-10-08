import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {workforceContext} from '../.sites-runtime/shared/workforce-context.mjs';

// Compile only this pure helper in memory: no shared module generation or disk output.
const source=fs.readFileSync(new URL('../app/shared/companion-back-window-cups.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {companionBackWindowCups,checkedBackWindowTopUp,companionBackWindowAdditionalCups,checkedBackWindowAdditionalCups,companionBackWindowCupReferences,checkedBackWindowCupReferences}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const guide=(text='Ranch: two deep half pans, approximately 100 cups; honey mustard: one deep half pan, approximately 50 cups; French: one sixth pan, approximately 15 cups.')=>[{source:{id:'approved-bw',kind:'standard',revision:2,title:'Back Window'},facts:{authority:'approved standard',zone:'Back Window',position:'Back Window',methodAvailable:true,guide:{preparation:['Pans hold ready cups.',text],steps:['Count ready cups.']}}}];
const question='I counted one full ranch deep half pan and another half-full deep half pan of ready 3.25 oz cups. I also have half a sixth pan of French cups. About how many ready cups is that?';

test('actual saved Day3 Workspace through authorized workforceContext produces ready82.5 calculation',()=>{
 const cases=JSON.parse(fs.readFileSync(new URL('../evidence/ai-week/back-window-cases.json',import.meta.url),'utf8'));
 const c=cases.cases.find(c=>c.day===3);
 // Root prepares shared modules; this test does not build or inject synthetic context.
 const actual=workforceContext(c.workspace,c.question,c.at,[],c.selected);
 assert.ok(actual.evidence.some(e=>e.source.id==='ai-bw-guide'&&e.facts.authority==='approved standard'));
 const r=companionBackWindowCups(c.question,actual.evidence);
 assert.equal(r.status,'ready',JSON.stringify(r));assert.equal(r.estimatedTotalCups,82.5);
 assert.deepEqual(r.components.map(c=>[c.item,c.panCount,c.cupsPerPan,c.estimatedCups]),[['ranch',1.5,50,75],['french',0.5,15,7.5]]);
 assert.deepEqual(r.sources.map(s=>[s.id,s.revision]),[['ai-bw-guide',1]]);
});

test('colon-free, comma and parenthetical references preserve explicit pans rather than par-as-capacity',()=>{
 for(const text of [
  'Ranch two deep half pans, approximately100cups; French one sixth pan, approximately15cups.',
  'Ranch, two deep half pans (approximately100cups); French, one sixth pan (approximately15cups).',
  'Ranch (two deep half pans, approximately100cups); French (one sixth pan, approximately15cups).'
 ]){
  const normalized=text.replace(/approximately(\d+)/g,'approximately $1 ').replace(/(\d+)cups/g,'$1 cups');
  const r=companionBackWindowCups(question,guide(normalized));assert.equal(r.status,'ready',text);assert.equal(r.estimatedTotalCups,82.5,text);
 }
});

test('actual Day3 wording grounds each pan capacity and calculates75ranch+7.5French=82.5',()=>{
 const r=companionBackWindowCups(question,guide());assert.equal(r.status,'ready');
 assert.deepEqual(r.components,[{item:'ranch',container:'deep-half',panCount:1.5,cupsPerPan:50,estimatedCups:75},{item:'french',container:'sixth',panCount:0.5,cupsPerPan:15,estimatedCups:7.5}]);
 assert.equal(r.estimatedTotalCups,82.5);assert.equal(r.estimated,true);assert.deepEqual(r.sources.map(s=>[s.id,s.revision]),[['approved-bw',2]]);
 assert.equal(r.capacities[0].referencePans,2);assert.equal(r.capacities[0].referenceCups,100);assert.equal(r.capacities[0].cupsPerPan,50);
 assert.match(r.limits.join(' '),/not a verified physical count/);assert.match(r.limits.join(' '),/No forecast/);
});
test('explicit fractional and zero pan quantities remain valid without rounding stock',()=>{
 const r=companionBackWindowCups('1.5 ranch deep half pans and 0.5 sixth pan of French cups',guide());assert.equal(r.status,'ready');assert.equal(r.estimatedTotalCups,82.5);
 const zero=companionBackWindowCups('zero ranch deep half pans and 0 French sixth pans',guide());assert.equal(zero.status,'ready');assert.equal(zero.estimatedTotalCups,0);
});
test('negative or absent quantities never become stock estimates',()=>{
 for(const q of ['-1 ranch deep half pan','negative one ranch deep half pan','ranch deep half pan','a sixth pan'])assert.equal(companionBackWindowCups(q,guide()).status,'needs-review',q);
});
test('no current approved reference, omitted method and another station cannot authorize capacity',()=>{
 assert.equal(companionBackWindowCups(question,[]).status,'needs-review');
 for(const patch of [{authority:'saved assignment'},{instructionContentOmitted:true},{methodAvailable:false},{zone:'Pizza',position:'Cook'}]){
  const e=guide();Object.assign(e[0].facts,patch);assert.equal(companionBackWindowCups(question,e).status,'needs-review');
 }
 const parOnly=guide('Ranch par: 100 cups; French par: 15 cups.');assert.equal(companionBackWindowCups(question,parOnly).status,'needs-review');
});
test('conflicting or missing per-container evidence stays missing; current approved changed capacity wins over static catalog',()=>{
 assert.equal(companionBackWindowCups(question,guide('Ranch: two deep half pans, 100 cups; honey mustard: one deep half pan, 60 cups; French: one sixth pan, 15 cups.')).status,'needs-review');
 assert.equal(companionBackWindowCups(question,guide('Ranch: two deep half pans, 100 cups.')).status,'needs-review');
 const changed=companionBackWindowCups('one ranch deep half pan',guide('Ranch: two deep half pans, 80 cups; French: one sixth pan, 12 cups.'));assert.equal(changed.status,'ready');assert.equal(changed.estimatedTotalCups,40);
});
test('no pan-count question generates no calculation or forecast',()=>{
 assert.equal(companionBackWindowCups('47 honey cups, demand30 and buffer5: what should I prep?',guide()),null);
});

test('actual Day2 first Workspace context rejects a made-up three-cup top-up rule',()=>{
 const cases=JSON.parse(fs.readFileSync(new URL('../evidence/ai-week/back-window-cases.json',import.meta.url),'utf8'));
 const c=cases.cases.find(c=>c.day===2),actual=workforceContext(c.workspace,c.question,c.at,[],c.selected);
 const flawed='If you need buffer, make 3 cups.';
 const checked=checkedBackWindowTopUp(c.question,flawed,actual.evidence);
 assert.notEqual(checked,flawed);assert.match(checked,/Do not automatically make cups solely to fill the reference par/);
 assert.match(checked,/until the next prep/);assert.match(checked,/minus usable ready cups/);assert.match(checked,/Ask your manager/);
 assert.match(checked,/current approved shelf-life guidance if it is supplied/);assert.match(checked,/manager-released prep assignment/);
 assert.match(checked,/does not change stock or record prep/);assert.doesNotMatch(checked,/make 3|make three|5 days|reported to manager/);
 assert.equal(checkedBackWindowTopUp(c.followup,'35 needed, zero additional.',actual.evidence),'35 needed, zero additional.');
 assert.equal(checkedBackWindowTopUp(c.question,flawed,[]),flawed);
 const draft=actual.evidence.map(e=>e.source.kind==='standard'?{...e,facts:{...e.facts,authority:'draft'}}:e);
 assert.equal(checkedBackWindowTopUp(c.question,flawed,draft),flawed);
});
test('top-up guard leaves explicit supplied usage and buffer calculations and other station topics alone',()=>{
 const refs=guide();refs[0].facts.guide.preparation.push('Use expected usage, usable cups and buffer instead of automatic par top-ups.');
 assert.equal(checkedBackWindowTopUp('Should I automatically make ranch cups to par? Expected usage 30 and buffer 5 with 47 usable.','Zero additional cups.',refs),'Zero additional cups.');
 assert.equal(checkedBackWindowTopUp('Should I automatically make pizza to fill par?','Ask the pizza manager.',refs),'Ask the pizza manager.');
});

test('actual four-week French followups calculate additional whole cups, never gross demand',()=>{
 const cases=JSON.parse(fs.readFileSync(new URL('../evidence/ai-multiweek/back-window-cases.json',import.meta.url),'utf8'));
 for(const [day,expected,stock,demand] of [[3,8,7.5,15],[10,12,3.75,15],[17,0,7.5,0],[24,15,7.5,22]]){
  const c=cases.cases.find(c=>c.day===day),actual=workforceContext(c.workspace,c.followup,c.at);
  const r=companionBackWindowAdditionalCups(c.followup,actual.evidence);
  assert.equal(r?.status,'ready',JSON.stringify({day,r}));assert.equal(r.additionalWholeCups,expected);assert.equal(r.readyCups,stock);assert.equal(r.demandCups,demand);
  assert.equal(r.explicitBufferCups,0);assert.equal(r.estimatedReady,true);
  const delivered=checkedBackWindowAdditionalCups(c.followup,'Prepare the full demand.',actual.evidence);
  assert.match(delivered,new RegExp('Prepare '+expected+' additional whole french cups'));
  assert.match(delivered,/not a verified physical count/);assert.match(delivered,/does not change stock/);
 }
});
test('explicit quantities support new demand, optional explicit buffer, zero and stock above demand',()=>{
 for(const [q,want] of [
  ['Need 22 French cups with 7.5 ready cups. How many additional cups should I make?',15],
  ['Demand 15 ranch cups, on hand 3.75 cups. How many should I prepare?',12],
  ['Need 4 French cups using the 7.5-cup estimate and no buffer. How many whole cups should be prepared?',0],
  ['Need 0 French cups with 0 usable cups. How many cups should I prepare?',0],
  ['Need 15 French cups using the 7.5-cup pan estimate and buffer 5. How many more cups should I make?',13],
 ]){const r=companionBackWindowAdditionalCups(q,guide());assert.equal(r?.status,'ready',JSON.stringify({q,r}));assert.equal(r.additionalWholeCups,want,q);}
});
test('previous user pan scenario only supplies stock when explicitly referenced; model answers cannot supply counts',()=>{
 const prior=[{question:'I counted 2 ranch deep half pans and 0.25 sixth pan of French ready cups.',answer:'Incorrect model answer: 100 French cups.'}];
 const q='Need 15 French cups and no buffer, using that pan estimate. How many additional cups should I make?';
 const r=companionBackWindowAdditionalCups(q,guide(),prior);assert.equal(r.status,'ready');assert.equal(r.readyCups,3.75);assert.equal(r.additionalWholeCups,12);
 assert.equal(r.readyBasis,'explicitly referenced previous user pan scenario');
 const noReference=companionBackWindowAdditionalCups('Need 15 French cups. How many more cups should I make?',guide(),prior);assert.equal(noReference.status,'needs-review');
 const stale=companionBackWindowAdditionalCups(q,guide(),[{...prior[0],focus:{id:'approved-bw',revision:1,kind:'standard',title:'Old guide'}}]);assert.equal(stale.status,'needs-review');
});
test('missing, negative, ambiguous and unapproved inputs cannot establish additional production',()=>{
 for(const q of [
  'Need -1 French cups using the 7.5-cup estimate and no buffer. How many should I prepare?',
  'Need 15 French cups using the -1-cup estimate and no buffer. How many should I prepare?',
  'Need 15 French cups. How many should I prepare?',
  'Need 15 French cups or 22 French cups using the 7.5-cup estimate. How many should I prepare?',
  'Need 15 French cups using the 7.5-cup estimate with a buffer. How many should I prepare?',
 ])assert.equal(companionBackWindowAdditionalCups(q,guide())?.status,'needs-review',q);
 assert.equal(companionBackWindowAdditionalCups('Par 15 French cups, 7.5 ready. How many should I prepare?',guide()),null);
 assert.equal(companionBackWindowAdditionalCups('Need 15 French cups using the 7.5-cup estimate. How many should I prepare?',[]),null);
 const complete='My released prep says12ranchcups;I made0. How do I record the actual report?';assert.equal(checkedBackWindowAdditionalCups(complete,'Open Your assigned prep.',guide()),'Open Your assigned prep.');
});

test('immutable fourth Day1 actual bad vessel answer is replaced with the exact approved two-pan ranch reference',()=>{
 const capture=JSON.parse(fs.readFileSync(new URL('../evidence/ai-multiweek/back-window-replies-verified-3.json',import.meta.url),'utf8'));
 const t=capture.results.find(r=>r.day===1).turns[0];
 assert.match(t.answer,/Ranch.*100 cups, one deep half pan/);
 const result=companionBackWindowCupReferences(t.question,t.context.evidence);assert.ok(result);
 assert.match(result.answer,/ranch two deep half pans, approximately 100 cups/i);
 assert.match(result.answer,/honey mustard one deep half pan, approximately 50 cups/i);
 assert.match(result.answer,/tartar one sixth pan each, approximately 15 cups each/i);
 assert.match(result.answer,/all eight dressing portions use 3\.25 oz cups/i);
 assert.match(result.answer,/previous close.*portioning needs.*equipment ready/i);
 assert.doesNotMatch(result.answer,/100 cups, one deep half pan/i);
 assert.match(result.answer,/not.*automatic instruction.*make/i);
 assert.deepEqual(result.sources.map(s=>[s.id,s.revision]),[['ai-bw-guide',1]]);
 assert.equal(checkedBackWindowCupReferences(t.question,t.answer,t.context.evidence),result.answer);
});

test('full reference grounding follows changed approved source instead of fixed capacities and exposes missing/conflicting references',()=>{
 const capture=JSON.parse(fs.readFileSync(new URL('../evidence/ai-multiweek/back-window-replies-verified-3.json',import.meta.url),'utf8'));
 const t=capture.results.find(r=>r.day===1).turns[0],e=structuredClone(t.context.evidence.filter(e=>e.source.id==='ai-bw-guide'));
 e[0].source.revision=2;e[0].facts.guide.preparation=e[0].facts.guide.preparation.map(v=>v.replace('ranch two deep half pans, approximately 100 cups','ranch three deep half pans, approximately 120 cups'));
 const r=companionBackWindowCupReferences(t.question,e);assert.match(r.answer,/ranch three deep half pans, approximately 120 cups/);assert.doesNotMatch(r.answer,/ranch two deep/);assert.equal(r.sources[0].revision,2);
 const conflicting=[...t.context.evidence.filter(e=>e.source.id==='ai-bw-guide'),...e];assert.match(companionBackWindowCupReferences(t.question,conflicting).answer,/references conflict/);
 e[0].facts.guide.preparation=e[0].facts.guide.preparation.filter(v=>!v.includes('Reference ready-cup pars'));assert.match(companionBackWindowCupReferences(t.question,e).answer,/does not supply the full/);
 for(const mutate of [e=>e[0].facts.authority='draft standard',e=>e[0].facts.instructionContentOmitted=true,e=>e[0].facts.methodAvailable=false]){const missing=structuredClone(t.context.evidence.filter(e=>e.source.id==='ai-bw-guide'));mutate(missing);assert.equal(checkedBackWindowCupReferences(t.question,'No current reference.',missing),'No current reference.');}
 assert.equal(checkedBackWindowCupReferences('I counted 1.5 ranch deep half pans. How many cups?','Original.',t.context.evidence),'Original.');
 assert.equal(checkedBackWindowCupReferences('Should I automatically top up honey to par?','Original.',t.context.evidence),'Original.');
});
