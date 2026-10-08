import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runPositionWeek} from './all-position-week-fixture.mjs';
import {localDate,nextDate} from '../.sites-runtime/shared/local-time.mjs';
import {trialSourceRevision} from './ai-task-trial-fixture.mjs';

const all=['berts-boh','rudds','papas'].flatMap(group=>JSON.parse(fs.readFileSync(`evidence/all-position-week/${group}-profiles.json`,'utf8')));
const cases=[
 {id:'papa-counter',start:15,end:23},
 {id:'berts-combined-oven',start:12,end:20},
 {id:'berts-dishwasher-am',start:8,end:15},
 {id:'berts-dishwasher-pm',start:15,end:23},
 {id:'rudds-server',start:21,end:5,overnight:true},
];
const rows=[],sourceRevision=trialSourceRevision();
for(const spec of cases)test(`${spec.id}: local opening/end hours and prior work survive the November clock change`,async()=>{
 const original=all.find(p=>p.id===spec.id);assert.ok(original);
 const result=await runPositionWeek({...original,id:'dst-'+spec.id,simulationStartDate:'2026-10-29',shiftStartHour:spec.start,shiftEndHour:spec.end,preserveDatabaseTo:`evidence/hour-trial/dst/${spec.id}.sqlite`});
 assert.deepEqual(result.failures,[]);assert.equal(result.days.length,7);assert.equal(result.savedTurns,7);assert.equal(result.operationalReseeds,0);assert.equal(result.localCalendarAdvancement,true);
 for(const day of result.days){assert.equal(day.actualShift.startClock,String(spec.start).padStart(2,'0')+':00');assert.equal(day.actualShift.endClock,String(spec.end).padStart(2,'0')+':00');assert.equal(localDate(day.actualShift.start,'America/New_York'),day.businessDate);assert.equal(localDate(day.actualShift.end,'America/New_York'),spec.overnight?nextDate(day.businessDate):day.businessDate);}
 const before=result.days.find(d=>d.businessDate==='2026-10-31'),after=result.days.find(d=>d.businessDate==='2026-11-01');assert.equal(after.dayStart-before.dayStart,25*3600000,'Local opening stays fixed across a 25-hour calendar day');
 if(spec.overnight)assert.equal(Date.parse(before.actualShift.end)-Date.parse(before.actualShift.start),9*3600000,'A fictional 21:00–05:00 overnight shift includes the repeated fall-back hour');
 result.sourceRevision=sourceRevision;result.extraChecks={fixedLocalHours:true,twentyFiveHourCalendarDay:true,overnightRepeatedHour:!!spec.overnight};result.timeScope='October 29–November 4 with calendar-day advancement. Except Papa’s 3PM opening, assigned test hours and overnight Rudd’s Server scenario are fictional schedule stress inputs, not approved restaurant operating hours.';
 fs.mkdirSync('evidence/hour-trial/dst',{recursive:true});fs.writeFileSync(`evidence/hour-trial/dst/${spec.id}.json`,JSON.stringify(result,null,2));rows.push({id:spec.id,days:result.days.length,phaseChecks:result.days.reduce((n,d)=>n+d.checks.length,0),failures:result.failures,checks:result.extraChecks});
});
test.after(()=>{fs.mkdirSync('evidence/hour-trial',{recursive:true});fs.writeFileSync('evidence/hour-trial/dst-summary.json',JSON.stringify({createdAt:new Date().toISOString(),sourceRevision,profiles:rows,provider:'Mock only',proof:'Actual saved shift starts/ends preserve New York local clocks and prior records on one disk database across DST; fictional time inputs are not production hours.'},null,2));});
