import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {runPositionWeek} from './all-position-week-fixture.mjs';
import {trialSourceRevision} from './ai-task-trial-fixture.mjs';

const groups=['berts-foh','berts-boh','rudds','papas','management','commissary'];
const profiles=groups.flatMap(group=>JSON.parse(fs.readFileSync(`evidence/all-position-week/${group}-profiles.json`,'utf8')).map(profile=>({...profile,group})));
const evidenceRoot=process.env.HOUR_MULTI_EVIDENCE_ROOT??'evidence/hour-trial',startDate=process.env.HOUR_MULTI_START_DATE??'2026-10-08';
const sourceRevision={...trialSourceRevision(),weekFixtureSha256:createHash('sha256').update(fs.readFileSync('tests/all-position-week-fixture.mjs')).digest('hex')};
const summary={createdAt:new Date().toISOString(),sourceRevision,continuousDaysPerProfile:21,operationalReseeds:0,provider:'Local mock; no external calls or generated helpfulness grading',profiles:[],failures:[],limits:['Each functional profile has its own fictional database. All 21 days within that profile use the same database and identities; no reseeding between weeks.','Papa shared Dish is a Pizza Make coverage assignment, not a new approved permanent position.','Documented duty text uses QA reference instructions and generic saved work; physical work and live integrations are not simulated as actual execution.','Seven documented curveballs repeat over three weekly cycles; their records, revisions, notification history and authority checks are distinct each day.']};
fs.mkdirSync(`${evidenceRoot}/multiweek`,{recursive:true});
for(const profile of profiles)test(`${profile.id}: 21 consecutive persisted days with original carryover in weeks two and three`,async()=>{
 const result=await runPositionWeek({...profile,simulationStartDate:startDate,simulationDays:21,preserveDatabaseTo:`${evidenceRoot}/multiweek/${profile.id}.sqlite`});
 result.group=profile.group;result.sourceRevision=sourceRevision;result.proofScope='Actual handlers and one retained disk database for all 21 days; mocked AI context; no physical operations, hosted writes or real model quality claim.';
 fs.writeFileSync(`${evidenceRoot}/multiweek/${profile.id}.json`,JSON.stringify(result,null,2));
 summary.profiles.push({id:profile.id,restaurant:profile.restaurant,position:profile.position,group:profile.group,days:result.days.length,phaseChecks:result.days.reduce((n,d)=>n+d.checks.length,0),aiRequests:result.aiContextRequests,savedTurns:result.savedTurns,savedRecords:result.savedRecords,initialSeeds:result.initialSeeds,operationalReseeds:result.operationalReseeds,interruptionReopens:result.interruptionReopens,priorShiftAIDays:result.aiAnswers.filter(a=>a.focus.priorShift).map(a=>a.day),finalReopen:result.finalReopen,failures:result.failures,receipt:`multiweek/${profile.id}.json`,database:`multiweek/${profile.id}.sqlite`});
 summary.failures.push(...result.failures.map(f=>({profileId:profile.id,...f})));fs.writeFileSync(`${evidenceRoot}/multiweek-summary.json`,JSON.stringify(summary,null,2));
 assert.deepEqual(result.failures,[],JSON.stringify(result.failures));assert.equal(result.days.length,21);assert.equal(result.operationalReseeds,0);assert.equal(result.initialSeeds,1);assert.equal(result.savedTurns,21);assert.equal(result.interruptionReopens,21);assert.equal(result.aiContextRequests,21);assert.deepEqual(result.aiAnswers.filter(a=>a.focus.priorShift).map(a=>a.day),[2,5,9,12,16,19]);assert.equal(result.days[20].week,3);
});
test.after(()=>{summary.completedAt=new Date().toISOString();summary.simulationStartDate=startDate;summary.evidenceRoot=evidenceRoot;summary.localCalendarAdvancement=true;summary.totalPositionDays=summary.profiles.reduce((n,p)=>n+p.days,0);summary.totalPhaseChecks=summary.profiles.reduce((n,p)=>n+p.phaseChecks,0);summary.totalAIRequests=summary.profiles.reduce((n,p)=>n+p.aiRequests,0);summary.totalSavedTurns=summary.profiles.reduce((n,p)=>n+p.savedTurns,0);summary.finalSourceRevision=trialSourceRevision();summary.runtimeUnchanged=summary.sourceRevision.runtimeSha256===summary.finalSourceRevision.runtimeSha256;fs.writeFileSync(`${evidenceRoot}/multiweek-summary.json`,JSON.stringify(summary,null,2));});
