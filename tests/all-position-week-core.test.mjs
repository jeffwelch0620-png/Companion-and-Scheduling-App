import test from 'node:test';
import assert from 'node:assert/strict';
import {runPositionWeek} from './all-position-week-fixture.mjs';

test('durable seven-day harness exercises all phases through actual handlers',async()=>{
 const result=await runPositionWeek({id:'harness-core',restaurant:'berts',position:'Fry',area:'BOH',captureAIContexts:true,opening:['Review station stock'],service:['Prepare assigned orders'],closing:['Clean assigned station'],dailyScenarios:Array.from({length:7},(_,i)=>({title:`Fictional interruption ${i+1}`,detail:'Stop incomplete work and obtain manager direction.'}))});
 assert.deepEqual(result.failures,[]);assert.equal(result.days.length,7);assert.equal(result.operationalReseeds,0);assert.equal(result.aiContextRequests,7);assert.equal(result.finalReopen,true);assert.ok(result.days.every(d=>d.checks.length>=8&&d.checks.every(c=>c.status==='passed')));
 assert.equal(result.interruptionReopens,7);
 for(let n=1;n<7;n++)assert.equal(result.days[n].dayStart-result.days[n-1].dayStart,86400000);
 for(const index of [1,4])assert.ok(result.aiContexts[index].context.evidence.some(e=>e.facts.title==='Unfinished previous-shift work'));
 assert.equal(result.aiContexts[4].context.evidence.find(e=>e.facts.title==='Unfinished previous-shift work').facts.phase,'correction');
});

test('a ninth day keeps the original carryover and practice goal open until the actual final day',async()=>{
 const result=await runPositionWeek({id:'harness-nine-day',restaurant:'rudds',position:'Fry',area:'BOH',simulationDays:9,captureAIContexts:true,opening:['Read prior work'],service:['Coordinate with Expo'],closing:['Restore the station'],dailyScenarios:Array.from({length:7},(_,i)=>({title:`Source curveball ${i+1}`,detail:'Obtain named manager direction.'}))});
 assert.deepEqual(result.failures,[]);assert.equal(result.days.length,9);assert.equal(result.operationalReseeds,0);assert.equal(result.savedTurns,9);assert.equal(result.aiContextRequests,9);assert.equal(result.days[7].scenario.title,'Source curveball 1');assert.equal(result.days[8].week,2);assert.equal(result.aiAnswers[8].focus.priorShift,true);assert.ok(result.aiContexts[8].context.evidence.some(e=>e.facts.title==='Unfinished previous-shift work'&&e.facts.phase==='correction'));
});
