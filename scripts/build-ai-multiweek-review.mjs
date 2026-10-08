import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const dir=path.resolve('evidence/ai-multiweek');
const slugs=['server','host','back-window','pizza','prep-cook','gm'];
const errors=[];
const exists=file=>fs.existsSync(path.join(dir,file));
const read=file=>{if(!exists(file))return null;try{return JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));}catch(e){errors.push({file,error:e.message});return null;}};
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,file))).digest('hex');
const validGrade=value=>typeof value==='number'&&[0,1,2].includes(value)?value:null;
function gradeRows(review){
 if(!review)return [];
 for(const key of ['grades','turnGrades','turns'])if(Array.isArray(review[key]))return review[key];
 for(const key of ['days','results'])if(Array.isArray(review[key]))return review[key].flatMap(d=>(d.turns??[]).map((t,i)=>({...t,day:d.day,week:d.week,turn:t.turn??i+1})));
 return [];
}
const label=item=>typeof item==='string'?item:(item?.reason??item?.detail??item?.description??item?.assessment??item?.actual??item?.id??JSON.stringify(item));
function stats(turns){const graded=turns.filter(t=>t.grade!==null);return {answers:turns.length,graded:graded.length,pending:turns.length-graded.length,score:graded.reduce((n,t)=>n+t.grade,0),maxScore:turns.length*2,gradedMaxScore:graded.length*2,full:graded.filter(t=>t.grade===2).length,partial:graded.filter(t=>t.grade===1).length,failed:graded.filter(t=>t.grade===0).length};}
function loadCapture(slug,suffix,cases){
 const file=`${slug}-replies${suffix}.json`,reviewFile=`${slug}-review${suffix}.json`,capture=read(file);if(!capture)return null;
 const review=read(reviewFile),captureSha256=hash(file),declaredHash=review?.captureSha256??review?.provenance?.captureSha256??review?.execution?.captureSha256;
 const reviewSource=review?.sourceFingerprint??review?.provenance?.sourceFingerprint;
 const reviewCompiled=review?.compiledFingerprint??review?.provenance?.compiledFingerprint;
 const fingerprintMismatch=!!review&&((reviewSource&&capture.sourceFingerprint&&reviewSource!==capture.sourceFingerprint)||(reviewCompiled&&capture.compiledFingerprint&&reviewCompiled!==capture.compiledFingerprint));
 // Latest reviews must identify the exact response bytes, not just a code build.
 // Historical initial/archived evidence predates this contract and is labeled.
 const reviewBound=!!review&&!fingerprintMismatch&&(declaredHash?declaredHash===captureSha256:suffix!=='-verified');
 const reviewBinding={status:!review?'pending review':reviewBound?(declaredHash?'exact capture SHA256 matched':'historical review without exact capture hash'):'pending: review does not identify this exact capture',declaredHash:declaredHash??null,exactHashMatched:!!declaredHash&&declaredHash===captureSha256,fingerprintMismatch,gradesUsed:reviewBound};
 const grades=reviewBound?gradeRows(review):[],expected=new Map(cases.cases.map(c=>[Number(c.day),c]));
 const seen=new Set();let duplicateDays=false;
 const days=(capture.results??[]).map(result=>{
  const day=Number(result.day),fixture=expected.get(day);if(seen.has(day))duplicateDays=true;seen.add(day);
  const turns=(result.turns??[]).map((t,i)=>{
   const g=grades.find(g=>Number(g.day??g.absoluteDay)===day&&Number(g.turn??g.turnInDay)===i+1);
   const grade=validGrade(g?.grade)??validGrade(g?.score)??({full:2,partial:1,failed:0}[g?.grade]??null),citations=t.sources??[];
   const contextSources=t.context?.evidence?.map(e=>e.source)??[];
   return {turn:i+1,question:t.question??(i?fixture?.followup:fixture?.question)??'',answer:t.answer??'',rawAnswer:t.rawAnswer??'',grade,
    reason:g?.reason??g?.assessment??g?.detail??(grade===null?'Independent grade pending.':''),citations,
    appStatus:t.appStatus??null,providerStatus:t.providerMeta?.status??null,status:t.status??null,workUnchanged:t.workUnchanged??null,
    citationCount:citations.length,hasReturnedCitations:citations.length>0,
    citationsMatchedContext:citations.every(s=>contextSources.some(c=>c.id===s.id&&c.revision===s.revision&&c.kind===s.kind)),
    expectedFacts:result.expectedFacts??fixture?.expectedFacts??[],expectedActions:result.expectedActions??fixture?.expectedActions??[],prohibitedClaims:result.prohibitedClaims??fixture?.prohibitedClaims??[],
    context:t.context??null,providerMeta:t.providerMeta??null,providerHistoryCount:t.providerHistoryCount??null,conversationTurnCount:t.conversationTurnCount??null};
  });
  return {day,week:Number(result.week??fixture?.week??Math.ceil(day/7)),dayInWeek:Number(result.dayInWeek??fixture?.dayInWeek??(day-1)%7+1),scenario:result.scenario??fixture?.scenario??'',at:result.at??fixture?.at,events:result.events??fixture?.events??[],turns};
 }).sort((a,b)=>a.day-b.day);
 const turns=days.flatMap(d=>d.turns),complete=!duplicateDays&&days.length===expected.size&&days.every(d=>expected.has(d.day)&&d.turns.length===2);
 const rawRemaining=reviewBound?(review?.summary?.remaining??review?.remaining??review?.remainingDefects):[reviewBinding.status];
 const remaining=Array.isArray(rawRemaining)?rawRemaining:(review?.defects??review?.findings??[]);
 return {key:suffix?suffix.slice(1):'initial',file,reviewFile:review?reviewFile:null,complete,realProvider:capture.realProvider===true,model:capture.model??null,sourceFingerprint:capture.sourceFingerprint??null,compiledFingerprint:capture.compiledFingerprint??null,
  captureSha256,reviewSha256:review?hash(reviewFile):null,reviewBinding,days,summary:stats(turns),declaredReviewSummary:review?.summary??null,
  remaining,findings:reviewBound?(review?.defects??review?.findings??[]):[],fixtureLimitations:review?.fixtureLimitations??review?.coverageLimitations??[],
  continuity:capture.continuity??null};
}
function receipt(file){
 if(!exists(file))return null;
 const text=fs.readFileSync(path.join(dir,file),'utf8'),last=re=>[...text.matchAll(re)].at(-1)?.[1];
 const tests=Number(last(/(?:^|\n)[^\n]*?\btests\s+(\d+)\s*(?:\r?\n|$)/g));
 const pass=Number(last(/(?:^|\n)[^\n]*?\bpass\s+(\d+)\s*(?:\r?\n|$)/g));
 const fail=Number(last(/(?:^|\n)[^\n]*?\bfail\s+(\d+)\s*(?:\r?\n|$)/g));
 return {file,tests:Number.isFinite(tests)?tests:null,pass:Number.isFinite(pass)?pass:null,fail:Number.isFinite(fail)?fail:null,completed:Number.isFinite(tests)&&Number.isFinite(pass)&&Number.isFinite(fail),sha256:hash(file)};
}
function closingEvidence(name){
 const file=`closing/${name}.json`,data=read(file);if(!data)return {name,file,status:'pending',days:[]};
 const days=data.days??[],actions=days.flatMap(d=>d.actions??[]),roles=new Set(actions.map(a=>a.role).filter(Boolean));
 return {name,file,status:'executed evidence available',scope:data.scope??data.execution??'',days,roles:[...roles],
  counts:{days:days.length,actions:actions.length,boundaryChecks:Array.isArray(data.checks)?data.checks.length:0,
   roleDays:days.reduce((n,d)=>n+new Set((d.actions??[]).map(a=>a.role).filter(Boolean)).size,0),
   commands:data.totals?.commands??null,accepted:data.totals?.accepted??null,rejected:data.totals?.rejected??null,closedAssignments:data.totals?.closedAssignments??null,releasedShifts:data.totals?.releasedShifts??null},
  summary:data.summary??data.totals??null,checks:data.checks??[],findings:data.findings??data.gaps??[],limitations:data.limitations??[],sha256:hash(file)};
}
function postFixEvidence(){
 const file='post-fix-rechecks.json',reviewFile='post-fix-recheck-review.json',capture=read(file);
 if(!capture)return {file,status:'pending targeted receipt',results:[],summary:stats([])};
 const captureSha256=hash(file),review=read(reviewFile),declaredHash=review?.captureSha256??review?.provenance?.captureSha256;
 const reviewBound=!!review&&declaredHash===captureSha256;
 const reviews=review?(reviewBound?(review.reviews??gradeRows(review)):[]):(capture.reviews??[]);
 const results=(capture.results??[]).map(result=>({...result,turns:(result.turns??[]).map((turn,i)=>{
  const g=reviews.find(g=>g.role===result.role&&Number(g.day)===Number(result.day)&&Number(g.turn)===i+1);
  const sources=turn.sources??[],available=turn.context?.evidence?.map(e=>e.source)??[];
  return {...turn,turn:i+1,grade:validGrade(g?.grade)??validGrade(g?.score),reason:g?.reason??'Targeted independent grade pending.',citationCount:sources.length,citationsMatchedContext:sources.every(s=>available.some(a=>a.id===s.id&&a.revision===s.revision&&a.kind===s.kind))};
 })}));
 const turns=results.flatMap(r=>r.turns),summary=stats(turns);
 return {file,reviewFile:review?reviewFile:null,status:'targeted receipt available',realProvider:capture.realProvider===true,at:capture.at,model:capture.model,scope:capture.scope,sourceFingerprint:capture.sourceFingerprint,compiledFingerprint:capture.compiledFingerprint,captureSha256,reviewSha256:review?hash(reviewFile):null,
  reviewBinding:{gradesUsed:review?reviewBound:true,exactHashMatched:reviewBound,embeddedReview:!review&&reviews.length>0},results,rawCapture:capture,rawReview:review,
  summary:{...summary,actualReplies:turns.length,realProviderReplies:capture.realProvider===true?turns.length:0,allHandler200:turns.length>0&&turns.every(t=>t.appStatus===200),allProvider200:turns.length>0&&turns.every(t=>t.providerMeta?.status===200),allWorkUnchanged:turns.length>0&&turns.every(t=>t.workUnchanged===true),returnedCitationsMatchContext:turns.every(t=>t.citationsMatchedContext),answersWithoutCitations:turns.filter(t=>!t.citationCount).length},
  boundary:'Targeted fresh-session checks are separate from the full 28-day replay. They do not replace any selected full-run answer or grade. Successful requests and unchanged work do not prove helpfulness, physical completion or production deployment.'};
}
function validate(){
 const summary=JSON.parse(fs.readFileSync(path.join(dir,'summary.json'),'utf8'));
 const html=fs.readFileSync(path.join(dir,'review.html'),'utf8');
 const match=html.match(/<script id="review-data" type="application\/json">([\s\S]*?)<\/script>/);assert.ok(match,'Standalone data missing');
 const payload=JSON.parse(match[1]);assert.deepEqual(payload.summary,summary);
 for(const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);
 const chosen=payload.roles.flatMap(r=>r.captures[r.selectedKey].days.flatMap(d=>d.turns));
 const uniqueReal=new Map(payload.roles.flatMap(r=>Object.values(r.captures).filter(c=>c.realProvider).map(c=>[r.slug+':'+c.captureSha256,c])));
 assert.equal(summary.totalRealRepliesAcrossPreservedCaptures,[...uniqueReal.values()].reduce((n,c)=>n+c.summary.answers,0),'Provider reply count must deduplicate copied archive aliases');
 assert.equal(summary.postFixRechecks.actualReplies??0,payload.postFix.results.reduce((n,r)=>n+r.turns.length,0),'Targeted recheck reply count must stay separate');
 assert.equal(chosen.length,summary.selected.answers);assert.equal(chosen.filter(t=>t.grade===null).length,summary.selected.pending);
 assert.equal(summary.selected.full+summary.selected.partial+summary.selected.failed+summary.selected.pending,summary.selected.answers);
 assert.equal(chosen.filter(t=>t.grade!==null).reduce((n,t)=>n+t.grade,0),summary.selected.score);
 for(const r of payload.roles){assert.ok(r.captures[r.selectedKey].complete,`${r.slug}: selected capture is partial`);if(r.selectedKey==='verified')assert.equal(r.captures.verified.complete,true);
  for(const capture of Object.values(r.captures))if(!capture.reviewBinding.gradesUsed)assert.ok(capture.days.every(d=>d.turns.every(t=>t.grade===null)),'Unbound review must remain pending');
  if(r.captures.verified?.reviewBinding.gradesUsed)assert.equal(r.captures.verified.reviewBinding.exactHashMatched,true,'Latest grades require exact capture binding');}
 assert.ok(!/<(?:script|link|iframe|img)\b[^>]*(?:src|href)=["']https?:/i.test(html),'Report should load without external resources');
 // Exercise the offline selector/rendering logic without a browser or service.
 // This checks data/controls, not visual layout or native-browser behavior.
 class Element{
  constructor(tag){this.tag=tag;this.children=[];this.textContent='';this._value='';this.classList={toggle(){}};}
  append(...nodes){this.children.push(...nodes);}
  click(){this.onclick?.();}
  replaceChildren(...nodes){this.children=[...nodes];this._value='';}
  set value(v){this._value=String(v);}
  get value(){return this._value||(this.tag==='select'?this.children[0]?.value??'':'');}
  get firstElementChild(){return this.children[0];}
 }
 const nodes=new Map(),selects=new Set(['capture','week','day','closingView','closingWeek','closingDay']);
 const el=id=>{if(!nodes.has(id))nodes.set(id,new Element(selects.has(id)?'select':'div'));return nodes.get(id);};
 el('review-data').textContent=match[1];el('closingView').value='employee';
 const sandbox={document:{getElementById:el,createElement:tag=>new Element(tag)}};vm.createContext(sandbox);
 for(const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(script[1]).runInContext(sandbox);
 const textOf=n=>n.textContent+' '+n.children.map(textOf).join(' ');let visited=0;
 for(const [i,r]of payload.roles.entries())for(const capture of Object.values(r.captures).filter(c=>c.complete)){
  el('roles').children[i].onclick();el('capture').value=capture.key;el('capture').onchange();
  for(const day of capture.days){el('week').value=day.week;el('week').onchange();el('day').value=day.day;el('day').onchange();
   for(const turn of day.turns)assert.ok(textOf(el('conversation')).includes(turn.question),'Selected actual question not rendered');visited++;
  }
 }
 for(const c of payload.closing.filter(c=>c.days.length)){el('closingView').value=c.name;el('closingView').onchange();const last=c.days.at(-1);el('closingWeek').value=last.week??Math.ceil(last.day/7);el('closingWeek').onchange();el('closingDay').value=last.day;el('closingDay').onchange();assert.ok(el('closingDayDetails').children.length>0);}
 console.log(JSON.stringify({validation:'passed',roles:payload.roles.length,selectedAnswers:summary.selected.answers,pendingGrades:summary.selected.pending,selectorDaysExercised:visited,visualLayout:'not browser-tested',htmlBytes:Buffer.byteLength(html),files:['evidence/ai-multiweek/review.html','evidence/ai-multiweek/summary.json']}));
}
if(process.argv.includes('--validate')){validate();process.exit(0);}
const roles=slugs.map(slug=>{
 const cases=read(`${slug}-cases.json`);if(!cases)return null;
 const initial=loadCapture(slug,'',cases),verified=loadCapture(slug,'-verified',cases),captures={};
 if(initial)captures.initial=initial;if(verified)captures.verified=verified;
 // Archived full replays remain distinct evidence, never selected-day composites.
 const archived=fs.readdirSync(dir).filter(file=>new RegExp(`^${slug}-replies-verified-?\\d+\\.json$`).test(file)).sort();
 for(const file of archived){const suffix=file.slice(`${slug}-replies`.length,-5),capture=loadCapture(slug,suffix,cases);if(capture)captures[capture.key]=capture;}
 const selectedKey=verified?.complete?'verified':initial?.complete?'initial':null;
 const canonical=new Map();
 for(const capture of [captures.verified,...Object.values(captures).filter(c=>c.key!=='verified')].filter(Boolean)){
  if(canonical.has(capture.captureSha256))capture.aliasOf=canonical.get(capture.captureSha256);else canonical.set(capture.captureSha256,capture.file);
 }
 if(!selectedKey){errors.push({slug,error:'No complete capture available; role excluded from selected answer totals.'});return {slug,role:cases.role,captures,selectedKey:null,plannedDays:cases.cases.length};}
 return {slug,role:cases.role,captures,selectedKey,plannedDays:cases.cases.length,verifiedPending:!!verified&&!verified.complete};
}).filter(Boolean);
const usable=roles.filter(r=>r.selectedKey),selectedTurns=usable.flatMap(r=>r.captures[r.selectedKey].days.flatMap(d=>d.turns));
const realBundles=roles.flatMap(r=>Object.values(r.captures).filter(c=>c.realProvider).map(c=>({slug:r.slug,...c})));
const uniqueRealBundles=[...new Map(realBundles.map(c=>[c.slug+':'+c.captureSha256,c])).values()];
const closing=[closingEvidence('employee'),closingEvidence('manager')];
const postFix=postFixEvidence();
const receipts=fs.readdirSync(dir).filter(f=>/tests?|checks?/i.test(f)&&f.endsWith('.txt')).sort((a,b)=>Number(b.includes('-final'))-Number(a.includes('-final'))||a.localeCompare(b)).map(receipt).filter(Boolean);
const runtimeFiles=fs.readdirSync(dir).filter(f=>/runtime|fingerprint/i.test(f)&&f.endsWith('.json')).map(file=>({file,data:read(file),sha256:hash(file)}));
const finalExecution=exists('execution-final.json')?{file:'execution-final.json',data:read('execution-final.json'),sha256:hash('execution-final.json')}:null;
const summary={generatedAt:new Date().toISOString(),roles:roles.length,plannedRoleDays:roles.reduce((n,r)=>n+r.plannedDays,0),selected:stats(selectedTurns),
 totalRealRepliesAcrossPreservedCaptures:uniqueRealBundles.reduce((n,c)=>n+c.days.reduce((m,d)=>m+d.turns.length,0),0),uniqueRealCaptureCount:uniqueRealBundles.length,realCaptureFileCount:realBundles.length,copiedCaptureAliasCount:realBundles.length-uniqueRealBundles.length,
 selectedExecution:{realProvider:selectedTurns.length>0&&usable.every(r=>r.captures[r.selectedKey].realProvider),allHandler200:selectedTurns.length>0&&selectedTurns.every(t=>t.appStatus===200),allProvider200:selectedTurns.length>0&&selectedTurns.every(t=>t.providerStatus===200),allWorkUnchanged:selectedTurns.length>0&&selectedTurns.every(t=>t.workUnchanged===true),citationsMatchedDeliveredContext:selectedTurns.length>0&&selectedTurns.every(t=>t.citationsMatchedContext),answersWithReturnedCitations:selectedTurns.filter(t=>t.hasReturnedCitations).length,answersWithoutReturnedCitations:selectedTurns.filter(t=>!t.hasReturnedCitations).length,returnedCitationCount:selectedTurns.reduce((n,t)=>n+t.citationCount,0),citationBoundary:'Matching checks every returned citation. An empty list has no unmatched citation; absence is counted separately and does not prove source support.'},
 roles:roles.map(r=>({slug:r.slug,role:r.role,selectedKey:r.selectedKey,captureFile:r.selectedKey?r.captures[r.selectedKey].file:null,reviewFile:r.selectedKey?r.captures[r.selectedKey].reviewFile:null,
  summary:r.selectedKey?r.captures[r.selectedKey].summary:null,preservedCaptures:Object.values(r.captures).map(c=>({file:c.file,aliasOf:c.aliasOf??null,complete:c.complete,realProvider:c.realProvider,answers:c.summary.answers,sourceFingerprint:c.sourceFingerprint,compiledFingerprint:c.compiledFingerprint,captureSha256:c.captureSha256,reviewSha256:c.reviewSha256,reviewBinding:c.reviewBinding})),
  remaining:r.selectedKey?r.captures[r.selectedKey].remaining:['Capture or independent review pending.']})),
 tests:{receipts,latestRegression:receipt('regression-tests-final.txt'),finalExecution,initialRegression:receipt('current-tests.txt'),newClosing:receipt('closing-tests.txt'),typecheck:exists('current-typecheck.txt')?{file:'current-typecheck.txt',bytes:fs.statSync(path.join(dir,'current-typecheck.txt')).size,note:'Preserved compiler output. Empty output alone does not prove process exit status.'}:null},
 closing:closing.map(c=>({name:c.name,file:c.file,status:c.status,scope:c.scope,counts:c.counts,summary:c.summary,sha256:c.sha256})),
 postFixRechecks:{file:postFix.file,reviewFile:postFix.reviewFile??null,status:postFix.status,...postFix.summary,realProvider:postFix.realProvider??null,sourceFingerprint:postFix.sourceFingerprint??null,compiledFingerprint:postFix.compiledFingerprint??null,captureSha256:postFix.captureSha256??null,reviewSha256:postFix.reviewSha256??null,reviewBinding:postFix.reviewBinding??null,boundary:postFix.boundary??'Targeted receipt pending; no checks inferred.'},
 sourceMetadata:runtimeFiles,readWarnings:errors,
 composition:'Per role, prefer the complete latest verified 28-day capture when available; otherwise use its complete initial capture. Never assemble different days from different passes. Missing independent grades remain pending. Preserved initial and numbered verified captures/reviews are available for comparison. Provider reply totals deduplicate identical capture files by role and SHA256; a copied archive alias is the same execution.',
 proofBoundary:'Real provider replies through authenticated local handlers, fictional identities/approvals/work and disposable databases. Executed closing checks prove local workflow gates, not physical restaurant cleaning or inspection. No live restaurant integration, production deployment, payroll clock, inventory balance or sent message is established.',
 rubric:'2 = useful and accurate; 1 = partial or omitted next action; 0 = material wrong or unsupported direction. Pending = no matching independent turn grade. Request success and unchanged work are measured separately from helpfulness.'};
fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify(summary,null,2)+'\n');
const data=JSON.stringify({summary,roles:usable,closing,postFix}).replaceAll('<','\\u003c');
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>JMAX · Four weeks of real Companion replies</title><style>
:root{font-family:system-ui,-apple-system,sans-serif;color:#102748;background:#edf3fa;--navy:#0b2146;--blue:#147de2;--line:#d9e3f1}*{box-sizing:border-box}body{margin:0}header{background:linear-gradient(115deg,#167ddd,#104b91 55%,#0b2146);color:#fff;padding:36px max(22px,calc((100vw - 1240px)/2))}.eyebrow{font-size:12px;letter-spacing:.14em;font-weight:700}h1{font-size:clamp(27px,4vw,42px);margin:12px 0}header p{max-width:850px;color:#dfedff;line-height:1.6}main{max-width:1240px;margin:24px auto;padding:0 20px}h2{font-size:21px;margin:0 0 14px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.panel,.stat{background:#fff;border:1px solid var(--line);border-radius:16px;padding:20px;margin-bottom:16px;box-shadow:0 5px 18px #0b214609}.stat strong{display:block;font-size:30px}.muted{color:#516783;font-size:14px}.notice{background:#e7f1fe;border-left:4px solid var(--blue)}p,li{line-height:1.6}.roles{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px}button,select,input{font:inherit;border:1px solid #bccce0;border-radius:10px;padding:11px;background:white;color:var(--navy)}button{cursor:pointer;text-align:left}button strong{display:block}button.active{background:var(--navy);color:white;border-color:var(--navy)}button span{font-size:13px;display:block;margin-top:7px}.controls{display:flex;gap:12px;flex-wrap:wrap;align-items:end;margin-bottom:18px}label{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:600}select{min-width:130px}.badge{display:inline-block;font-size:12px;font-weight:650;border-radius:7px;padding:6px 9px;margin:0 6px 7px 0;background:#e7f1fe;color:#145790}.full{background:#ddf4e8;color:#126044}.partial{background:#fff0cf;color:#895814}.failed{background:#ffe3e2;color:#942b32}.pending{background:#edf0f5;color:#4c607c}.question{font-weight:650;background:#eaf2fd;border-radius:10px;padding:14px}.answer{white-space:pre-wrap;line-height:1.65;font-size:15px}.reason{border-top:1px solid var(--line);padding-top:12px;color:#344c6a}details{margin:14px 0}summary{cursor:pointer;font-weight:600;color:#174e88}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.5;background:#f4f7fb;border-radius:10px;padding:14px;max-height:520px;overflow:auto}.sources{font-size:13px;padding-left:20px}a{color:#0b65ba;text-decoration-thickness:1px}.caption{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px}.capture{font-size:12px;color:#496480}.finding{border-left:4px solid #e6b355}.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border-bottom:1px solid var(--line);padding:10px;text-align:left}th{color:#516783;font-weight:600}.empty{padding:24px;text-align:center;color:#516783}footer{padding:24px 0;color:#516783;font-size:13px}.proofrow{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:800px){.grid{grid-template-columns:1fr 1fr}.roles{grid-template-columns:1fr 1fr}.proofrow{grid-template-columns:1fr}header{padding:26px 20px}}@media(max-width:480px){.grid,.roles{grid-template-columns:1fr}.panel{padding:16px}.controls label{width:100%}select{width:100%}}@media print{.controls,.roles{display:none}details{break-inside:avoid}header{background:#0b2146!important;print-color-adjust:exact}.panel{box-shadow:none}}
</style></head><body><header><div class="eyebrow">JMAX · LOCAL FICTIONAL REVIEW</div><h1>Four weeks with the Companion</h1><p>Explore actual conversations across restaurant jobs, their independent grades, and executed closing workflows. Initial captures remain preserved; a complete verified replay takes priority when it is available.</p></header><main>
<div id="stats" class="grid"></div><section class="panel notice"><h2>What this evidence proves</h2><p id="boundary"></p><p id="composition"></p><p id="rubric"></p><p>Counts come from the saved captures, individual grades, test receipts and executed closing JSON. A pending grade is never counted as a full answer. These are bounded scenarios, not a statistical accuracy guarantee.</p></section>
<h2>Explore the delivered replies</h2><div id="roles" class="roles"></div><div class="controls"><label>Capture<select id="capture"></select></label><label>Week<select id="week"></select></label><label>Day<select id="day"></select></label></div><div id="roleOverview" class="panel"></div><div id="conversation"></div><section id="remaining" class="panel finding"></section>
<section class="panel"><h2>Separate targeted checks after fixes</h2><div id="postFix"></div></section>
<section class="panel"><h2>Executed employee and manager closing</h2><p>These checks execute saved workflow handlers with fictional human events. They prove readiness, permission, correction, independent-check and release gates; they do not prove anyone physically cleaned a restaurant.</p><div id="closingStats" class="proofrow"></div><div class="controls"><label>View<select id="closingView"><option value="employee">Employee journeys</option><option value="manager">Manager journey</option></select></label><label>Week<select id="closingWeek"></select></label><label>Day<select id="closingDay"></select></label></div><div id="closingDayDetails"></div></section>
<section class="panel"><h2>Validation receipts and source versions</h2><div id="receipts"></div><div id="fingerprints"></div><p><a href="summary.json">Open calculated summary</a> · <a href="case-audit.json">Case continuity audit</a></p><p class="muted">A compiled fingerprint identifies the modules loaded for a capture. It does not imply that later source edits were included in that earlier run. The raw capture and initial module metadata remain preserved.</p></section><footer>Generated <span id="generated"></span>. This file works offline; no provider call, account access or external script is needed to read it.</footer></main>
<script id="review-data" type="application/json">${data}</script><script>
const data=JSON.parse(document.getElementById('review-data').textContent),$=id=>document.getElementById(id);let roleIndex=0;
const node=(tag,value,cls)=>{const n=document.createElement(tag);if(value!==undefined)n.textContent=value;if(cls)n.className=cls;return n;};
const link=(title,file)=>{const a=node('a',title);a.href=file;return a;};
const json=(title,value)=>{const d=node('details');d.append(node('summary',title),node('pre',JSON.stringify(value,null,2)));return d;};
const gradeName=g=>g===2?'Full · 2':g===1?'Partial · 1':g===0?'Failed · 0':'Grade pending';
const gradeClass=g=>g===2?'full':g===1?'partial':g===0?'failed':'pending';
function fillSelect(id,values,current){$(id).replaceChildren(...values.map(v=>{const o=node('option',v.label);o.value=v.value;return o}));if(values.some(v=>String(v.value)===String(current)))$(id).value=current;}
const total=data.summary.selected;
for(const [value,label] of [[data.summary.totalRealRepliesAcrossPreservedCaptures,'real replies across preserved captures'],[total.full,'fully helpful selected answers'],[total.partial+' / '+total.failed,'partial / failed selected answers'],[total.pending,'selected answers awaiting grading']]){const s=node('div','','stat');s.append(node('strong',value),node('span',label,'muted'));$('stats').append(s);}
$('boundary').textContent=data.summary.proofBoundary;$('composition').textContent=data.summary.composition;$('rubric').textContent=data.summary.rubric;$('generated').textContent=data.summary.generatedAt;
function selected(){const r=data.roles[roleIndex];return {r,c:r.captures[$('capture').value]??r.captures[r.selectedKey]};}
function weeks(){const {c}=selected(),current=$('week').value;fillSelect('week',[...new Set(c.days.map(d=>d.week))].map(w=>({value:w,label:'Week '+w})),current);days();}
function days(){const {c}=selected(),current=$('day').value;fillSelect('day',c.days.filter(d=>String(d.week)===$('week').value).map(d=>({value:d.day,label:'Day '+d.dayInWeek+' · overall '+d.day})),current);show();}
function show(){const {r,c}=selected(),day=c.days.find(d=>String(d.day)===$('day').value);$('conversation').replaceChildren();$('roleOverview').replaceChildren();$('remaining').replaceChildren();if(!day)return;
 const s=c.summary;$('roleOverview').append(node('h2',r.role),node('p',s.full+' full · '+s.partial+' partial · '+s.failed+' failed · '+s.pending+' pending. Graded score '+s.score+' / '+s.gradedMaxScore+'.'),node('p',day.scenario,'muted'));
 const cap=node('div','','caption');cap.append(link('Reply capture',c.file));if(c.reviewFile)cap.append(link('Independent review',c.reviewFile));else cap.append(node('span','Independent review pending','badge pending'));cap.append(node('span','Complete '+c.days.length+'-day '+c.key+' capture','capture'));$('roleOverview').append(cap);
 const table=node('table'),head=node('tr');for(const h of ['Week','Answers','Full','Partial','Failed','Pending'])head.append(node('th',h));table.append(head);
 for(const w of [...new Set(c.days.map(d=>d.week))]){const ts=c.days.filter(d=>d.week===w).flatMap(d=>d.turns),row=node('tr');for(const v of [w,ts.length,ts.filter(t=>t.grade===2).length,ts.filter(t=>t.grade===1).length,ts.filter(t=>t.grade===0).length,ts.filter(t=>t.grade===null).length])row.append(node('td',v));table.append(row)}const scroll=node('div','','scroll');scroll.append(table);$('roleOverview').append(scroll);
 for(const t of day.turns){const panel=node('article','','panel');panel.append(node('span',t.turn===1?'First question':'Follow-up','badge'),node('span',gradeName(t.grade),'badge '+gradeClass(t.grade)),node('span',t.workUnchanged===true?'Saved work unchanged':t.workUnchanged===false?'Work-state receipt differs':'Work-state receipt missing','badge'),node('p',t.question,'question'),node('div',t.answer||'No delivered answer captured.','answer'),node('p',t.reason,'reason'));
  const list=node('ul','','sources');for(const s of t.citations)list.append(node('li',s.title+' · '+s.kind+' · '+s.id+' · revision '+s.revision));if(!t.citations.length)list.append(node('li','No citations returned.'));panel.append(list);
  const raw=node('details');raw.append(node('summary','Raw provider reply'),node('div',t.rawAnswer||'No separate raw reply captured.','answer'));panel.append(raw,json('Current context supplied for this reply',t.context),json('Expected facts, actions and prohibited claims',{facts:t.expectedFacts,actions:t.expectedActions,prohibited:t.prohibitedClaims}),json('Request and history receipt',{appStatus:t.appStatus,providerStatus:t.providerStatus,status:t.status,workUnchanged:t.workUnchanged,citationCount:t.citationCount,hasReturnedCitations:t.hasReturnedCitations,citationsMatchedContext:t.citationsMatchedContext,providerHistoryCount:t.providerHistoryCount,conversationTurnCount:t.conversationTurnCount,providerMeta:t.providerMeta}));$('conversation').append(panel);
 }
 $('conversation').append(json('Explicit fictional events for this day',day.events));$('remaining').append(node('h2','Independent findings for this capture'));
 if(c.summary.pending)$('remaining').append(node('p',c.summary.pending+' answers still await matching independent turn grades. Missing findings must not be read as passing results.','badge pending'));
 const items=c.remaining??[];if(items.length){const list=node('ul');for(const item of items)list.append(node('li',typeof item==='string'?item:(item.reason??item.detail??item.description??item.actual??item.id??JSON.stringify(item))));$('remaining').append(list);}else if(!c.summary.pending)$('remaining').append(node('p','No remaining finding is listed in this capture’s independent review.'));else $('remaining').append(node('p','Independent findings pending.'));
 if(c.findings?.length)$('remaining').append(json('Detailed findings',c.findings));if(c.fixtureLimitations?.length)$('remaining').append(json('Fixture limitations',c.fixtureLimitations));if(c.aliasOf)$('remaining').append(node('p','This preserved file is a byte-identical alias of '+c.aliasOf+' and is counted once in provider execution totals.','muted'));$('remaining').append(json('Capture versions and continuity',{capture:c.file,aliasOf:c.aliasOf??null,sourceFingerprint:c.sourceFingerprint,compiledFingerprint:c.compiledFingerprint,model:c.model,sha256:c.captureSha256,reviewSha256:c.reviewSha256,reviewBinding:c.reviewBinding,continuity:c.continuity}));
 Array.from($('roles').children).forEach((b,i)=>b.classList.toggle('active',i===roleIndex));}
for(const [i,r]of data.roles.entries()){const c=r.captures[r.selectedKey],b=node('button');b.append(node('strong',r.role),node('span',c.summary.full+' full · '+c.summary.partial+' partial · '+c.summary.failed+' failed · '+c.summary.pending+' pending'));b.onclick=()=>{roleIndex=i;fillSelect('capture',Object.values(r.captures).filter(c=>c.complete).map(c=>({value:c.key,label:c.key==='verified'?'Latest verified full replay':c.key==='initial'?'Preserved initial run':'Preserved verified run '+c.key.slice('verified'.length).replace(/^-/,'')})),r.selectedKey);weeks()};$('roles').append(b)}$('capture').onchange=weeks;$('week').onchange=days;$('day').onchange=show;if($('roles').firstElementChild)$('roles').firstElementChild.click();else $('conversation').append(node('p','Complete real captures are pending.','empty'));
for(const c of data.closing){const p=node('div','','panel');p.append(node('h3',c.name==='employee'?'Employee workflow execution':'Manager workflow execution'));if(c.counts){p.append(node('p',c.counts.days+' days · '+c.counts.actions+' documented actions · '+c.counts.boundaryChecks+' separate boundary checks.'));if(c.counts.commands!==null)p.append(node('p',c.counts.commands+' commands: '+c.counts.accepted+' accepted, '+c.counts.rejected+' rejected.'));if(c.counts.closedAssignments!==null)p.append(node('p',c.counts.closedAssignments+' closed assignments · '+c.counts.releasedShifts+' released shifts.'));}else p.append(node('p','Executed evidence pending.'));p.append(link('Executed '+c.name+' evidence',c.file));$('closingStats').append(p);}
function closingWeeks(){const c=data.closing.find(c=>c.name===$('closingView').value);fillSelect('closingWeek',[...new Set(c.days.map(d=>d.week??Math.ceil(d.day/7)))].map(w=>({value:w,label:'Week '+w})),$('closingWeek').value);closingDays();}
function closingDays(){const c=data.closing.find(c=>c.name===$('closingView').value);fillSelect('closingDay',c.days.filter(d=>String(d.week??Math.ceil(d.day/7))===$('closingWeek').value).map(d=>({value:d.day,label:'Day '+(d.dayInWeek??(d.day-1)%7+1)+' · overall '+d.day})),$('closingDay').value);closingShow();}
function closingShow(){const c=data.closing.find(c=>c.name===$('closingView').value),day=c.days.find(d=>String(d.day)===$('closingDay').value);$('closingDayDetails').replaceChildren();if(!day){$('closingDayDetails').append(node('p','Executed day evidence pending.'));return;} $('closingDayDetails').append(node('h3',day.scenario??'Executed closing day'));for(const a of day.actions??[]){const d=node('details');d.append(node('summary',(a.role?a.role+' · ':'')+a.action),node('p',typeof a.expected==='string'?'Expected: '+a.expected:'Expected result below'),node('pre',JSON.stringify({expected:a.expected,actual:a.actual,proof:a.proof??a.source,repro:a.repro},null,2)));$('closingDayDetails').append(d)}$('closingDayDetails').append(json('Workflow limitations',c.limitations));if(c.checks.length)$('closingDayDetails').append(json('Executed rejection and boundary checks',c.checks));}
$('closingView').onchange=closingWeeks;$('closingWeek').onchange=closingDays;$('closingDay').onchange=closingShow;closingWeeks();
const recheck=data.postFix;
if(!recheck.results.length)$('postFix').append(node('p','Targeted reply capture or review is pending. The full replay above remains unchanged.','badge pending'));
else{const s=recheck.summary;$('postFix').append(node('p',s.actualReplies+' actual targeted replies · '+s.full+' full · '+s.partial+' partial · '+s.failed+' failed · '+s.pending+' pending.'),node('p',recheck.boundary,'muted'),link('Targeted reply receipt',recheck.file));if(recheck.reviewFile)$('postFix').append(link('Targeted independent review',recheck.reviewFile));
 for(const result of recheck.results)for(const turn of result.turns){const details=node('details');details.append(node('summary',result.role+' · day '+result.day+' · '+gradeName(turn.grade)),node('p',turn.question,'question'),node('div',turn.answer,'answer'),node('p',turn.reason,'reason'),json('Returned citations',turn.sources??[]),json('Actual supplied context',turn.context),json('Raw provider reply',turn.rawAnswer));$('postFix').append(details);}
 $('postFix').append(json('Targeted execution and source versions',{summary:recheck.summary,scope:recheck.scope,model:recheck.model,sourceFingerprint:recheck.sourceFingerprint,compiledFingerprint:recheck.compiledFingerprint,captureSha256:recheck.captureSha256,reviewSha256:recheck.reviewSha256,reviewBinding:recheck.reviewBinding}),json('Full targeted capture',recheck.rawCapture));if(recheck.rawReview)$('postFix').append(json('Full targeted review',recheck.rawReview));}
for(const [title,r]of [['Latest final regression receipt',data.summary.tests.latestRegression],['Initial regression receipt',data.summary.tests.initialRegression],['New closing-check receipt',data.summary.tests.newClosing]]){const p=node('p');p.append(node('strong',title+': '));if(r?.completed)p.append(node('span',r.pass+' passed, '+r.fail+' failed, '+r.tests+' tests. '),link('Open receipt',r.file));else p.append(node('span','receipt pending; no executed test count inferred.','badge pending'));$('receipts').append(p);}if(data.summary.tests.finalExecution){$('receipts').append(link('Final process results',data.summary.tests.finalExecution.file),json('Final test, typecheck and build process results',data.summary.tests.finalExecution.data));}else $('receipts').append(node('p','Final process results pending; empty compiler output is not an exit-status receipt.','badge pending'));if(data.summary.tests.receipts.length)$('receipts').append(json('All available test receipts',data.summary.tests.receipts));if(data.summary.tests.typecheck)$('receipts').append(json('Typecheck output boundary',data.summary.tests.typecheck));$('fingerprints').append(json('Compiled-runtime metadata',data.summary.sourceMetadata));if(data.summary.readWarnings.length)$('receipts').append(json('File-read warnings',data.summary.readWarnings));
</script></body></html>`;
fs.writeFileSync(path.join(dir,'review.html'),html);
validate();
console.log(JSON.stringify({summary:summary.selected,realReplies:summary.totalRealRepliesAcrossPreservedCaptures,regenerate:'node scripts/build-ai-multiweek-review.mjs',validate:'node scripts/build-ai-multiweek-review.mjs --validate'}));
