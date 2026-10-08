import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const root=path.resolve('evidence/learning-progress-simulations-2026-10-08');
const groups=['berts-foh','berts-boh','rudds','papas','management','commissary'];
const profiles=groups.flatMap(group=>JSON.parse(fs.readFileSync(`evidence/all-position-week/${group}-profiles.json`,'utf8')).map(p=>({...p,group})));
assert.equal(profiles.length,42);
const files=fs.readdirSync(root,{recursive:true}).filter(f=>f.endsWith('.json')).map(f=>path.join(root,f));
const receiptFiles=new Map();
const initialSimulationDiagnostics=[];
const supersededSuccessfulReceipts=[];
for(const file of files){const data=JSON.parse(fs.readFileSync(file,'utf8'));if(data.id&&Array.isArray(data.days)&&profiles.some(p=>p.id===data.id)&&data.failures?.length)initialSimulationDiagnostics.push({profileId:data.id,days:data.days.length,failures:data.failures,receipt:file});if(data.id&&Array.isArray(data.days)&&data.days.length===21&&data.preservedDatabase&&data.failures?.length===0&&profiles.some(p=>p.id===data.id)){
 const earlier=receiptFiles.get(data.id);if(earlier){assert.deepEqual(earlier.data.learningProgress.runtimeBefore,data.learningProgress.runtimeBefore,`Do not combine different app builds for ${data.id}`);const newer=fs.statSync(file).mtimeMs>fs.statSync(earlier.file).mtimeMs;supersededSuccessfulReceipts.push({profileId:data.id,receipt:newer?earlier.file:file,reason:'A later complete successful simulation on the identical app runtime is selected.'});if(!newer)continue;}receiptFiles.set(data.id,{file,data});
}}
const hashes=Object.fromEntries(fs.readdirSync('.sites-runtime/shared').filter(f=>f.endsWith('.mjs')).sort().map(f=>[f,createHash('sha256').update(fs.readFileSync('.sites-runtime/shared/'+f)).digest('hex')]));
const report={createdAt:new Date().toISOString(),status:'pending',profiles:[],totalPositionDays:0,phaseChecks:0,aiContextRequests:0,lessonDeliveries:0,lessonExclusions:0,acknowledgedMessages:0,savedTurns:0,learningCases:0,achievementRecords:0,interruptionReopens:0,externalRequests:0,operationalReseeds:0,limits:['Fictional records through actual authenticated local handlers. AI responses are mocked; context delivery is checked, not generated answer quality.','Each role has its own database retained for all three weeks. Separate same-database tests cover selected distinct-role handoff chains.','Software evidence does not prove physical cleaning, food safety, live recipes, POS accuracy, real dispatch or hosted rollout.']};
for(const p of profiles){
 const entry=receiptFiles.get(p.id);assert.ok(entry,`Missing current simulation receipt: ${p.id}`);const r=entry.data;
 assert.deepEqual(r.failures,[],p.id);assert.equal(r.days.length,21,p.id);assert.equal(r.initialSeeds,1,p.id);assert.equal(r.operationalReseeds,0,p.id);assert.equal(r.finalReopen,true,p.id);assert.equal(r.savedTurns,21,p.id);assert.equal(r.aiContextRequests,21,p.id);assert.equal(r.interruptionReopens,21,p.id);
 assert.equal(new Set(r.days.map(d=>d.businessDate)).size,21,p.id+' distinct business dates');assert.deepEqual(r.days.map(d=>d.day),Array.from({length:21},(_,i)=>i+1));
 for(const d of r.days)assert.ok(d.checks.every(c=>c.status==='passed'),p.id+' day '+d.day);
 assert.deepEqual(r.learningProgress.runtimeBefore,hashes,p.id+' current frozen source');assert.deepEqual(r.learningProgress.runtimeAfter,hashes,p.id+' unchanged runtime');
 assert.equal(r.learningProgress.phases.length,21,p.id+' complete new-feature lifecycle');assert.equal(r.learningProgress.aiChecks.length,21,p.id+' actual AI context checks');assert.equal(r.learningProgress.messages.length,21,p.id+' named message follow-through');
 const delivered=r.learningProgress.aiChecks.filter(c=>c.deliveredCaseIds.length>0).length;assert.equal(delivered,9,p.id+' historical lessons delivered on later shifts');
 const database=r.preservedDatabase??entry.file.replace(/\.json$/,'.sqlite');assert.ok(fs.existsSync(database),p.id+' preserved database');
 const db=new DatabaseSync(database,{readOnly:true});let records;
 try{records=db.prepare('SELECT * FROM records ORDER BY rowid').all().map(row=>({...row,data:JSON.parse(row.data)}));assert.equal(db.prepare('SELECT COUNT(*) n FROM companion_turns').get().n,21);assert.equal(records.length,r.savedRecords);}
 finally{db.close();}
 const cases=records.filter(row=>row.kind==='learningcase'),awards=records.filter(row=>row.kind==='achievement');
 assert.ok(cases.length>=3,p.id+' persisted new operational learning');assert.ok(cases.some(row=>row.data.versions.some(v=>v.review?.verdict==='supported')),p.id+' supported reviewed history');assert.ok(cases.some(row=>row.data.versions.some(v=>v.review?.verdict==='failed')),p.id+' failed reviewed history');assert.ok(cases.some(row=>row.data.status==='withdrawn'),p.id+' withdrawn case retained');
 assert.ok(awards.some(row=>row.owner_id==='worker'&&row.data.milestoneId==='checked-work'),p.id+' actual independently checked work earned');
 const awardKeys=awards.map(row=>[row.owner_id,row.data.milestoneId,row.data.ruleVersion].join('|'));assert.equal(new Set(awardKeys).size,awardKeys.length,p.id+' no duplicate milestones');
 const item={id:p.id,restaurant:p.restaurant,position:p.position,group:p.group,days:r.days.length,phaseChecks:r.days.reduce((n,d)=>n+d.checks.length,0),aiContextRequests:r.aiContextRequests,lessonDeliveries:delivered,lessonExclusions:r.learningProgress.aiChecks.length-delivered,acknowledgedMessages:r.learningProgress.messages.length,savedTurns:r.savedTurns,learningCases:cases.length,achievementRecords:awards.length,interruptionReopens:r.interruptionReopens,finalReopen:r.finalReopen,initialSeeds:r.initialSeeds,operationalReseeds:r.operationalReseeds,learningProgress:r.learningProgress,receipt:entry.file,database,knownGaps:r.gaps,sourceGaps:r.sourceGaps};
 report.profiles.push(item);for(const key of ['phaseChecks','aiContextRequests','lessonDeliveries','lessonExclusions','acknowledgedMessages','savedTurns','learningCases','achievementRecords','interruptionReopens'])report[key]+=item[key];report.totalPositionDays+=item.days;
}
const memoryPath=process.argv[2];assert.ok(memoryPath,'Provide the fresh completed memory summary');const memory=JSON.parse(fs.readFileSync(memoryPath,'utf8'));
assert.equal(memory.completedProfiles,50);assert.equal(memory.totalCompletedDays,2250);assert.ok(memory.results.every(r=>r.exitCode===0&&!r.failures.length));assert.equal(memory.externalCalls,0);
assert.deepEqual(hashes,memory.runtimeRevision,'Same compiled modules as the freshly completed 45-day memory run');
report.memory={profiles:50,daysPerProfile:45,positionDays:memory.totalCompletedDays,workerAsks:memory.workerAsks,checks:memory.checks,externalCalls:0,summary:path.resolve(memoryPath)};
const independentFile=path.join(root,'independent/results.json');const independent=JSON.parse(fs.readFileSync(independentFile,'utf8'));assert.equal(independent.evidence.length,15);assert.ok(independent.evidence.every(e=>e.passed));assert.equal(independent.externalProviderCalls,0);report.independent={checks:independent.evidence.length,sameDatabaseRoleChains:independent.evidence.filter(e=>e.positions),receipt:independentFile};
report.runtimeRevision=hashes;report.runtimeUnchanged=true;report.status='passed';
report.initialSimulationDiagnostics=initialSimulationDiagnostics;
report.supersededSuccessfulReceipts=supersededSuccessfulReceipts;
const output=path.join(root,'verified-summary.json');fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,profiles:report.profiles.length,totalPositionDays:report.totalPositionDays,phaseChecks:report.phaseChecks,aiContextRequests:report.aiContextRequests,learningCases:report.learningCases,achievementRecords:report.achievementRecords,memory:report.memory,independentChecks:report.independent.checks,output},null,2));
