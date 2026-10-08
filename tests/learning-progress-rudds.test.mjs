import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {runPositionWeek} from './all-position-week-fixture.mjs';
import {createLearningProgressOverrides} from './learning-progress-week-hook.mjs';

const directory=path.resolve('evidence/learning-progress-simulations-2026-10-08/rudds');
fs.mkdirSync(directory,{recursive:true});
const profiles=JSON.parse(fs.readFileSync('evidence/all-position-week/rudds-profiles.json','utf8'));
const runtimeFiles=fs.readdirSync('.sites-runtime/shared').filter(file=>file.endsWith('.mjs')).sort().map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join('.sites-runtime/shared',file))).digest('hex')}));
const runtimeDigest=crypto.createHash('sha256').update(JSON.stringify(runtimeFiles)).digest('hex');
fs.writeFileSync(path.join(directory,'runtime-hashes.json'),JSON.stringify({runtimeDigest,files:runtimeFiles},null,2));

test('Rudd’s: every manifest position, 21 continuous durable days with reviewed lessons and personal progress',async()=>{
 const results=[];
 for(const source of profiles){
  const base={...structuredClone(source),simulationDays:21,captureAIContexts:true,preserveDatabaseTo:path.join(directory,source.id+'.sqlite')};
  const overrides=createLearningProgressOverrides(base);
  const profile={...base,...overrides};
  const result=await runPositionWeek(profile);
  result.learningProgress=overrides.learningProgress;
  result.runtimeDigest=runtimeDigest;
  result.profile={id:source.id,restaurant:source.restaurant,position:source.position,area:source.area,shiftVariant:source.shiftVariant??null,staffing:source.staffing??null,opening:source.opening,service:source.service,closing:source.closing,provenance:source.provenance};
  fs.writeFileSync(path.join(directory,source.id+'.json'),JSON.stringify(result,null,2));
  results.push(result);
  fs.writeFileSync(path.join(directory,'summary.json'),JSON.stringify({restaurant:'rudds',runtimeDigest,positions:results.length,plannedPositions:profiles.length,positionDays:results.reduce((sum,item)=>sum+item.days.length,0),failures:results.flatMap(item=>item.failures.map(failure=>({position:item.id,...failure}))),externalRequests:0,provider:'fictional mock; context and workflow checks only',initialSeedsPerPosition:1,dailyOperationalReseeds:results.reduce((sum,item)=>sum+(item.operationalReseeds??0),0),results:results.map(item=>({id:item.id,position:item.position,days:item.days.length,failures:item.failures,learningProgress:item.learningProgress,gaps:item.gaps,sourceGaps:item.sourceGaps,finalReopen:item.finalReopen,operationalReseeds:item.operationalReseeds,savedRecords:item.savedRecords,savedTurns:item.savedTurns}))},null,2));
  process.stdout.write(JSON.stringify({position:source.id,days:result.days.length,failures:result.failures.length,learningPhases:result.learningProgress.phases.length,aiChecks:result.learningProgress.aiChecks.length,cases:result.learningProgress.cases.length})+'\n');
  if(result.failures.length)throw Error(source.id+' failed: '+JSON.stringify(result.failures));
 }
 assert.equal(results.length,15);
 assert.ok(results.every(result=>result.days.length===21&&result.finalReopen&&result.operationalReseeds===0));
 assert.equal(results.reduce((sum,result)=>sum+result.days.length,0),315);
 assert.deepEqual(results.flatMap(result=>result.failures),[]);
 const finalRuntime=fs.readdirSync('.sites-runtime/shared').filter(file=>file.endsWith('.mjs')).sort().map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join('.sites-runtime/shared',file))).digest('hex')}));
 assert.equal(crypto.createHash('sha256').update(JSON.stringify(finalRuntime)).digest('hex'),runtimeDigest,'The runtime must remain frozen throughout the run.');
});
