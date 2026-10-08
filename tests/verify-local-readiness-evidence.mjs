import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const base=path.resolve('evidence/local-readiness-2026-10-08');
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const runtime=Object.fromEntries(fs.readdirSync('.sites-runtime/shared').filter(n=>n.endsWith('.mjs')).sort().map(n=>[n,hash('.sites-runtime/shared/'+n)]));
const log=fs.readFileSync(path.join(base,'final-integrated-tests.log'),'utf8');
const count=key=>Number(log.match(new RegExp('ℹ '+key+' (\\d+)'))?.[1]??NaN);
assert.equal(count('tests'),95);assert.equal(count('pass'),95);assert.equal(count('fail'),0);assert.equal(count('skipped'),0);assert.equal(count('cancelled'),0);
assert.match(fs.readFileSync(path.join(base,'final-build.log'),'utf8'),/Build complete\./);
function latest(group){const dir=path.join(base,group);return fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>path.join(dir,e.name,'summary.json')).filter(p=>fs.existsSync(p)).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs)[0];}
const selected={},receipts={};
for(const group of ['shift-setup','dish-gap','rush','recovery','ai-food','ui']){
 const p=latest(group);assert.ok(p,'Missing '+group+' receipt');selected[group]=p;const r=JSON.parse(fs.readFileSync(p,'utf8'));receipts[group]=r;
 for(const key of ['runtime','runtimeBefore','runtimeAfter'])if(r[key])for(const [name,digest] of Object.entries(r[key]))if(name.endsWith('.mjs'))assert.equal(runtime[name],digest,group+' final runtime mismatch: '+name);
 if(r.runtimeStable!==undefined)assert.equal(r.runtimeStable,true);
 if(group==='shift-setup'){assert.equal(r.tests,3);assert.equal(r.operatingReadiness,false);assert.equal(r.failures.length,0);assert.equal(r.gaps.length,6);}
 if(group==='dish-gap'){assert.equal(r.tests,2);assert.equal(r.externalCalls,0);assert.equal(r.receipts.length,2);}
 if(group==='rush'){assert.equal(r.cases,3);assert.equal(r.status,'passed');assert.equal(r.externalCalls,0);assert.ok(r.restaurants.every(s=>s.status==='passed'));}
 if(group==='recovery')assert.equal(r.tests,7);
 if(group==='ai-food'){assert.equal(r.externalRequests,0);assert.equal(r.realProviderEvaluated,false);assert.equal(r.jeffHostedConnectionTested,false);}
 if(group==='ui'){
  assert.equal(r.findings.length,0);
  for(const [name,digest] of Object.entries(r.source))assert.equal(hash(name),digest,'UI source mismatch: '+name);
 }
}
const rush=receipts.rush.restaurants;
const summary={date:'2026-10-08',scope:'Local-only fictional records, controlled responses, actual handlers and component callbacks. No staff trial or live restaurant integration.',passed:95,failed:0,skipped:0,newScenarioTests:45,relatedRegressionTests:50,productionBuild:'passed',typeCheck:'passed',runtime,selected,
 fixedDefects:['Workspace gateway failure retained original command identifier','Rapid prep double submit cannot replace pending retry identifier','Partial AI transport cannot become a completed saved answer'],
 unresolvedReadiness:['Published shifts do not generate recurring operating work; empty assignment can pass manager release','Dedicated Dish no-show substitution remains unsupported','Whole-workspace revision contention requires visible review and retry for unrelated simultaneous saves'],
 rushTotals:{requests:rush.reduce((n,r)=>n+r.totalRequests,0),submittedConcurrently:rush.reduce((n,r)=>n+r.concurrentRequests,0),waves:rush.reduce((n,r)=>n+r.waves,0),databaseReopens:rush.reduce((n,r)=>n+r.reopens,0),completedTasks:rush.reduce((n,r)=>n+r.closedTasks,0),explicitConflicts:rush.reduce((n,r)=>n+(r.statusCounts['409']??0),0)},
 limits:['Passing characterization tests preserve known readiness gaps rather than declaring operating readiness.','Controlled AI responses prove context and safeguards, not real-model helpfulness.','Local SQLite recovery does not prove hosted backups, migration rollback or power-loss durability.','UI hook adapters are not real-device acceptance; root workspace late POST completion after unmount remains uncovered.','No hosted Jeff/Toast/Shipday calls or production writes.','Rush transaction queue and local timing do not establish production capacity.']};
fs.writeFileSync(path.join(base,'verified-summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({passed:summary.passed,newScenarioTests:45,relatedRegressionTests:50,rushTotals:summary.rushTotals,selected},null,2));
