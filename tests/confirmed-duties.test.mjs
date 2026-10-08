import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// This source-only reference has no persistence or Worker dependency.
const source=fs.readFileSync(new URL('../app/shared/starter-tasks.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {confirmedDutiesForLocation,confirmedDutySource,starterTaskPacks,starterTaskRevision,starterQuestions}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const textFor=id=>JSON.stringify(confirmedDutiesForLocation(id));

test('restaurant differences do not bleed across canonical store boundaries',()=>{
 const berts=textFor('berts'),rudds=textFor('rudds'),papa=textFor('papa');
 assert.match(berts,/Back Window/);assert.doesNotMatch(rudds,/Back Window/);assert.doesNotMatch(papa,/Back Window/);
 assert.match(rudds,/back hallway/);assert.doesNotMatch(berts,/back hallway/);assert.doesNotMatch(papa,/back hallway/);
 assert.match(berts,/smoking area/);assert.doesNotMatch(rudds,/smoking area/);assert.doesNotMatch(papa,/smoking area/);
 assert.match(papa,/seven outdoor tables/);assert.doesNotMatch(berts,/seven outdoor tables/);
});
test('unknown locations get no store fallback or inferred duties',()=>{
 for(const id of ['','other','comm','Berts','papa-leones'])assert.deepEqual(confirmedDutiesForLocation(id),[]);
});
test('department review filters exclude other departments and empty authority',()=>{
 assert.ok(confirmedDutiesForLocation('berts',['FOH']).every(item=>item.area==='FOH'));
 assert.ok(confirmedDutiesForLocation('berts',['BOH']).every(item=>item.area==='BOH'));
 assert.deepEqual(confirmedDutiesForLocation('berts',[]),[]);
});
test('shared server work retains manager release while identifying restaurant exceptions',()=>{
 for(const id of ['berts','rudds']){
  const server=confirmedDutiesForLocation(id).find(item=>item.id==='server-shared');
  assert.match(server.closing.join(' '),/Bag silverware/);
  assert.match(server.closing.join(' '),/checks side work and settles the server bank before release/);
 }
 assert.doesNotMatch(textFor('papa'),/server banking/);
});
test('current reference does not revise historical draft identities or approval requirements',()=>{
 assert.equal(starterTaskRevision,3);
 assert.deepEqual(starterTaskPacks.map(pack=>pack.id),['server','busser','expo','food-runner','flat-top','pizza-make','floor-manager']);
 assert.equal(starterQuestions(starterTaskPacks[0]).length,3);
 assert.match(source,/Reading this catalog does not approve, assign, or replace a saved standard/);
 assert.equal(confirmedDutySource.date,'2026-10-07');
});
