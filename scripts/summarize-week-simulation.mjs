import fs from 'node:fs';
import path from 'node:path';

const folder=path.resolve('evidence/week-simulation');
const names=['server','host','back-window','pizza','prep-cook','gm'];
const roles=names.map(name=>{
 const raw=JSON.parse(fs.readFileSync(path.join(folder,name+'.json'),'utf8'));
 const days=raw.days??raw.locations?.flatMap(location=>location.days.map(day=>({...day,restaurant:location.locationId})))??[];
 if(days.length<7)throw Error(name+' has fewer than seven recorded days');
 return {name:raw.role,receipt:name+'.json',test:'../../tests/week-sim-'+name+'.test.mjs',recordedRoleDays:days.length,days,findings:raw.gaps??raw.findings??[],limitations:raw.limitations??raw.coverageLimitations??raw.proofBoundary??raw.scope,raw};
});
const log=fs.readFileSync(path.join(folder,'combined-test.log'),'utf8');
const tests=Number(log.match(/(?:#|ℹ) tests (\d+)/)?.[1]);
const pass=Number(log.match(/(?:#|ℹ) pass (\d+)/)?.[1]);
const fail=Number(log.match(/(?:#|ℹ) fail (\d+)/)?.[1]);
if(!tests||tests!==pass||fail!==0)throw Error('Combined execution has not passed');
const repairs=[
 {id:'WEEK-01',priority:'first',area:'GM work',finding:'The bounded GM setup opens operating logs and prep but cannot assign/verify ordinary FOH and BOH tasks or act as the closing confirmer. Papa combined closing is also rejected.',next:'Align the explicit reviewed GM operating permissions with those confirmed responsibilities; retain separate sensitive administration and purchasing gates.',receipts:['gm.json']},
 {id:'WEEK-02',priority:'first',area:'Checkout',finding:'A separately assigned shift-end side-work task and pending late-pizza handoff can remain open after manager release.',next:'Link designated shift closing work to checkout and record explicit completion or manager-approved carryover. Do not block unrelated tasks.',receipts:['server.json','pizza.json']},
 {id:'WEEK-03',priority:'first',area:'Pizza station closing',finding:'A Cook shift receives its Pizza Make or combined Oven station guide, but assigning that same guide as a close fails the job-name comparison.',next:'Use current approved station eligibility consistently for both training and closing assignment.',receipts:['pizza.json']},
 {id:'WEEK-04',priority:'first',area:'Prep amounts',finding:'The Back Window usage helper recommends zero for fictional 47 ready honey mustard cups with 30 expected usage plus five buffer, while the selected legacy par-50 released plan requests three.',next:'Connect the existing usage recommendation to the reviewed ready-cup plan. Preserve source provenance and do not imply a live forecast was verified.',receipts:['back-window.json','prep-cook.json']},
 {id:'WEEK-05',priority:'next',area:'Late catch handoff',finding:'Accepting the generic incoming Expo handoff closes it immediately without a linked incoming food-completion responsibility.',next:'Distinguish receipt of responsibility from completion, and keep the remaining late-catch work assigned until checked or explicitly handed onward.',receipts:['pizza.json']},
 {id:'WEEK-06',priority:'next',area:'Checkout visibility',finding:'The frontline home calls an ended pending-checkout shift upcoming; without an assigned close, My Work can drop an unreleased shift although Shift Brief still shows checkout pending.',next:'Use one checkout state across My day, role home, shift brief and Companion.',receipts:['host.json','server.json']},
 {id:'WEEK-07',priority:'next',area:'Recipe guidance',finding:'The assigned employee recipe response drops source shelf-life metadata, and the employee card does not display it.',next:'Carry approved source shelf-life guidance through the recipe view with provenance. Fictional or archived values must not become policy.',receipts:['back-window.json','prep-cook.json']},
 {id:'WEEK-08',priority:'next',area:'Shortage follow-through',finding:'Reported zero production preserves the shortage, but there is no saved reviewed/remediated/resolved state; the original completed line cannot be re-completed.',next:'Add a manager review and linked remediation record while preserving original planned and actual quantities.',receipts:['prep-cook.json']},
 {id:'WEEK-09',priority:'next',area:'Ready-cup units',finding:'A half-sixth-pan estimate produces a 7.5-cup preparation instruction and permits 7.5 actual portion cups.',next:'Keep approximate on-hand separate from unit-aware whole-cup production; do not round continuous food units indiscriminately.',receipts:['back-window.json']},
 {id:'WEEK-10',priority:'scope wiring',area:'Companion help',finding:'The active workforce Companion deliberately excludes close/task evidence in general and shift-attached questions. Legacy context can construct it.',next:'Connect authorized current closing and task facts to employee help without changing record visibility or granting management access.',receipts:['server.json']},
];
const fixedClosingGroups=new Set(['WEEK-02','WEEK-03','WEEK-05','WEEK-06','WEEK-10']);
for(const repair of repairs)repair.status=fixedClosingGroups.has(repair.id)?'Repaired and tested in the expanded closing review':repair.id==='WEEK-01'?'Closing permissions repaired; ordinary cross-department task scope remains separate':'Remaining separate work';
const report={
 schema:'jmax-six-role-week-audit.v1',date:'2026-10-07',status:'Original six-role audit, with expanded closing repairs recorded separately',closingReview:'../closing-simulation/review.html',
 execution:{agents:6,minimumRoleDays:42,recordedRoleDays:roles.reduce((n,r)=>n+r.recordedRoleDays,0),extraCoverage:'Host week executed separately at Bert\u2019s and Rudd\u2019s',tests,pass,fail,log:'combined-test.log'},
 proof:'Executed current domain/service code against fictional isolated state, including disposable local D1 and D1-compatible in-memory SQLite. The role weeks are independent scenarios, not a shared live crew schedule. Physical restaurant actions, live AI answers, Toast, Jeff hosted installation, actual banking, and browser execution of all days were not established.',
 strengths:['Independent closing checks and correction paths','Overnight assigned-work and issue carryover where linked','Approved schedule replacement and stale-revision rejection','Prep assignment, current recipe checks, actual quantity and shortage preservation','Idempotent request replay and access-change rejection','Restaurant boundaries and no duplicate stock posting in the tested prep path'],
 repairs,
 separateBoundaries:[
  'Server bank settlement is an instruction and free-form checkout note, not a structured bank reconciliation proof.',
  'Historical handoff output deliberately includes current open issue status alongside dated entries; the meaning of a historical request needs explicit labeling rather than an assumed as-of snapshot.',
  'Confirmed duty catalog does not automatically approve a saved training standard. Reachable approved Host guides were tested; missing approval is a setup boundary.',
  'Pizza catalog completeness observations are source-only: the shared Catch ticket/cut/garnish/box-or-plate sequence and Papa\u2019s 3 PM opening are absent from that catalog, not proven absent from every source.',
  'Future released prep and late completion retain the original target date and were not classified as defects.',
 ],roles,
};
fs.writeFileSync(path.join(folder,'summary.json'),JSON.stringify(report,null,2)+'\n');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>JayMax — Six-role week audit</title>
<style>body{margin:0;background:#f6f9fe;color:#142943;font:16px/1.55 system-ui,sans-serif}main{max-width:1080px;margin:auto;padding:28px}header{background:linear-gradient(110deg,#0871c9,#1258b9,#071e46);color:white;border-radius:18px;padding:28px}h1{margin:0;font-size:32px}h2{margin-top:32px}.stats{display:flex;gap:14px;flex-wrap:wrap;margin:20px 0}.stats div{background:white;border:1px solid #dce5f1;border-radius:12px;padding:16px;flex:1;min-width:140px}.stats b{display:block;font-size:28px;color:#1258b9}article,details{background:white;border:1px solid #dce5f1;border-radius:12px;padding:18px;margin:12px 0}article h3{margin:0 0 8px}article p{margin:8px 0}small,.muted{color:#5a6b83}summary{cursor:pointer;font-weight:650}li{margin:8px 0}.pill{display:inline-block;background:#e9f2ff;color:#1258b9;border-radius:20px;padding:3px 10px;font-size:13px}footer{margin:28px 0;color:#5a6b83}@media(max-width:600px){main{padding:14px}header{padding:20px}h1{font-size:26px}}</style>
<main><header><small style="color:#e9f2ff">JAYMAX · LOCAL SIMULATION · OCTOBER 7, 2026</small><h1>Six jobs. A week of work. One repair list.</h1><p>The original audit is complete. Closing repairs have since been implemented and verified in the expanded closing review; other findings remain identified below.</p></header>
<section class="stats"><div><b>6</b>Role agents</div><div><b>${report.execution.recordedRoleDays}</b>Recorded role-days</div><div><b>${tests}/${tests}</b>Scenario tests completed</div><div><b>${repairs.length}</b>Consolidated repair groups</div></section>
<p>The eight tests include assertions that reproduce product gaps. A passing test confirms the recorded behavior; it does not certify that the app is ready for release.</p>
<h2>The jobs tested</h2>${roles.map(r=>`<details><summary>${escape(r.name)} · ${r.recordedRoleDays} recorded days</summary><ol>${r.days.map(d=>`<li><b>${escape(d.businessDate??d.date??('Day '+d.day))}${d.restaurant?' · '+escape(d.restaurant):''}</b><ul>${(d.actions??[]).map(a=>`<li>${escape(typeof a==='string'?a:a.action??a.name??a.title??'Saved workflow action')}</li>`).join('')}</ul></li>`).join('')}</ol><small>Detailed expected/actual evidence is retained in ${escape(r.receipt)}.</small></details>`).join('')}
<h2>What worked</h2><ul>${report.strengths.map(s=>`<li>${escape(s)}</li>`).join('')}</ul>
<p><a href="../closing-simulation/review.html">Open the latest closing repairs and seven-day verification</a></p><h2>The consolidated repair list</h2>${repairs.map(r=>`<article><span class="pill">${escape(r.priority)}</span><h3>${escape(r.area)}</h3><p><b>Status:</b> ${escape(r.status)}</p><p>${escape(r.finding)}</p><p><b>Repair:</b> ${escape(r.next)}</p><small>${escape(r.id)} · ${escape(r.receipts.join(', '))}</small></article>`).join('')}
<h2>Kept separate from defects</h2><ul>${report.separateBoundaries.map(s=>`<li>${escape(s)}</li>`).join('')}</ul>
<footer>${escape(report.proof)}<p>Only simulation tests, audit evidence and this summary were added. No application behavior, real accounts, permissions, stock or schedules were changed by the audit.</p></footer></main></html>`;
fs.writeFileSync(path.join(folder,'review.html'),html);
console.log(JSON.stringify({agents:report.execution.agents,recordedRoleDays:report.execution.recordedRoleDays,tests,pass,fail,repairGroups:repairs.length,report:path.join(folder,'summary.json')}));
