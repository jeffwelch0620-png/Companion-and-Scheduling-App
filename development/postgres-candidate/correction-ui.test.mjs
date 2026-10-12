import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import React from '../../node_modules/react/index.js';import {renderToStaticMarkup} from '../../node_modules/react-dom/server.node.js';
import {hasCorrectionAccess,correctionAccessKey,correctionReadCurrent,checkedCorrection,checkedCompletedShift,loadCorrectionBoard,loadCorrectionDetail,correctionFields,correctionInput,correctionDecision,defaultCorrectionRange,correctionRangeMessage} from './correction-client.mjs';
import {CorrectionForm,CorrectionDetailView,CompletedShiftCorrections} from './runtime/ui-reference/ui-corrections.mjs';import {ScheduleScreenSender} from './schedule-screen-client.mjs';
function fixture(){const scope='fictional-correction',owner=randomUUID(),person=randomUUID(),authorPerson=randomUUID(),shift=randomUUID(),w={location:{id:scope,revision:20,timezone:'America/Chicago',configuration:{operatingDepartments:['Kitchen','Service'],dishDepartment:'Kitchen',dishPosition:'Steward',dishAliases:['Steward']}},me:{id:randomUUID(),name:'Fictional manager',position:'Cook',area:'Kitchen',capabilities:['schedule.correct']},members:[],records:[],scheduleRevision:12};const original={id:shift,restaurant_id:scope,member_id:owner,department:'Kitchen',revision:1,starts_at:'2020-05-01T13:00:17.321Z',ends_at:'2020-05-01T15:00:17.321Z',position:'Cook'};const effective={start:original.starts_at,end:original.ends_at,position:'Cook'};const r={id:randomUUID(),kind:'shift-correction',locationId:scope,ownerId:owner,area:'Kitchen',revision:1,updatedAt:'2020-05-02T12:00:00Z',data:{shiftId:shift,sourceRevision:1,currentSourceRevision:1,employeeName:'Current employee',employeeNameAtEntry:'Prior employee',historicalNameLabel:'name at time of entry',original,timezone:'America/Chicago',shiftLocalDate:'2020-05-01',effectiveLocalDate:'2020-05-01',positionOptions:['Cook','Corrected Cook'],effectiveSummary:effective,appliedRevision:0,proposal:{...effective,position:'Corrected Cook'},proposalBaseRevision:0,authorId:w.me.id,authorName:'Current author',authorNameAtEntry:'Prior author',reason:'Fictional reason',decisionNote:'',status:'pending',actions:{canPropose:false,canApprove:true,canReject:true,canWithdraw:false},warnings:{sourceChanged:false,hasOriginalTasks:false,hasOriginalClosings:false}}};const s={shiftId:shift,sourceRevision:1,currentSourceRevision:1,ownerId:owner,area:'Kitchen',employeeName:'Current employee',originalSummary:effective,effectiveSummary:effective,positionOptions:['Cook','Corrected Cook'],timezone:'America/Chicago',effectiveLocalDate:'2020-05-01',recordRevision:0,correction:null,canPropose:true,correctionRevision:4};return {w,r,s,person,authorPerson};}
const fixtureRange={from:'2020-05-01',to:'2020-05-31'};
const loadFixtureBoard=(call,w)=>loadCorrectionBoard(async path=>{const result=await call(path),url=new URL(path,'http://fictional.invalid');return {...result,body:result.body&&url.searchParams.has('from')?{...result.body,from:url.searchParams.get('from'),to:url.searchParams.get('to')}:result.body};},w,fixtureRange);
const view=f=>({location:f.w.location,workspaceRevision:20,scheduleRevision:12,me:f.w.me});
const stamp=f=>({actorId:f.w.me.id,locationId:f.w.location.id,accessKey:correctionAccessKey(f.w),correctionRevision:4,scheduleRevision:12});
function event(f,revision=1,before=null){const r=f.r,d=r.data;return {revision,action:revision===1?'correction.propose':'correction.approve',actorId:f.w.me.id,actorName:'Current actor',actorNameAtEntry:'Prior actor',historicalNameLabel:'name at time of entry',at:r.updatedAt,note:'Fictional reason',before,after:{id:r.id,restaurant_id:r.locationId,member_id:r.ownerId,department:r.area,shift_id:d.shiftId,source_revision:d.sourceRevision,person_id:f.person,employee_name_at_entry:d.employeeNameAtEntry,author_person_id:f.authorPerson,author_name_at_entry:d.authorNameAtEntry,updated_at:r.updatedAt,revision,timezone:d.timezone,shift_local_date:d.shiftLocalDate,original_snapshot:d.original,effective_summary:d.effectiveSummary,proposal_summary:d.proposal,status:d.status,reason:d.reason,decision_note:d.decisionNote,author_id:d.authorId,applied_revision:d.appliedRevision,proposal_base_revision:d.proposalBaseRevision}};}
const render=(c,p)=>renderToStaticMarkup(React.createElement(c,p));const controls={send:async()=>true,onError:()=>{},onCancel:()=>{},onBack:()=>{},call:async()=>({status:403})};
const detail=f=>({source:null,record:f.r,events:[event(f)],complete:true,...stamp(f)});
test('correction navigation requires explicit capability, rejects checkout and keeps private data outside workspace',()=>{
 const f=fixture();assert.equal(hasCorrectionAccess(f.w),true);for(const me of [{...f.w.me,position:'GM',capabilities:['location.manage']},{...f.w.me,position:'Steward'}]){const w={...f.w,me};assert.equal(hasCorrectionAccess(w),false);assert.doesNotMatch(render(CompletedShiftCorrections,{w,...controls}),/Current employee|Submit planned correction/);}assert.deepEqual(f.w.records,[]);
});
test('source review renders original/effective summaries and explicit own-person approval warning',()=>{
 const f=fixture(),html=render(CorrectionForm,{w:f.w,source:f.s,...controls});assert.match(html,/original captured timezone: America\/Chicago/);assert.match(html,/own shift requires approval/);assert.match(html,/Reason for correction/);assert.match(html,/hours worked or pay/);assert.match(html,/Submit planned correction/);
 const h=render(CorrectionDetailView,{w:f.w,data:detail(f),...controls});assert.match(h,/Original planned shift/);assert.match(h,/Effective planned summary/);assert.match(h,/awaiting approval/);assert.match(h,/Prior employee/);assert.match(h,/Current actor/);assert.match(h,/Prior actor/);assert.match(h,/Approve correction/);assert.doesNotMatch(h,/Withdraw proposal|Correct planned details/);
});
test('malformed correction records and incomplete/private stale histories have no actions',()=>{
 const f=fixture();for(const change of [r=>r.data.status='unknown',r=>r.data.actions.canApprove='yes',r=>r.data.original.member_id=randomUUID(),r=>r.data.timezone='Invalid/Zone',r=>r.data.shiftLocalDate='2020-05-02',r=>r.data.warnings.sourceChanged=true,r=>r.revision=1000]){const r=structuredClone(f.r);change(r);assert.throws(()=>checkedCorrection(f.w,r));const html=render(CorrectionDetailView,{w:f.w,data:{...detail(f),record:r},...controls});assert.match(html,/needs review/);assert.doesNotMatch(html,/Approve correction|Withdraw proposal|Correct planned details/);}
 for(const data of [{...detail(f),complete:false},{...detail(f),events:[]},{...detail(f),actorId:randomUUID()},{...detail(f),accessKey:'stale'}])assert.doesNotMatch(render(CorrectionDetailView,{w:f.w,data,...controls}),/Approve correction/);
});
test('only server-projected decision flags authorize controls and payloads',()=>{
 const f=fixture();f.r.data.actions={canPropose:false,canApprove:false,canReject:false,canWithdraw:true};const html=render(CorrectionDetailView,{w:f.w,data:detail(f),...controls});assert.match(html,/Withdraw proposal/);assert.doesNotMatch(html,/Approve correction|Reject correction/);assert.throws(()=>correctionDecision(f.w,f.r,'correction.approve','Reason'));assert.deepEqual(correctionDecision(f.w,f.r,'correction.withdraw','  Reason  '),{note:'Reason'});assert.throws(()=>correctionDecision(f.w,f.r,'correction.withdraw',' '));
 f.r.data.warnings.sourceChanged=true;assert.match(render(CorrectionDetailView,{w:f.w,data:detail(f),...controls}),/requires reconciliation/);assert.doesNotMatch(render(CorrectionDetailView,{w:f.w,data:detail(f),...controls}),/Approve correction/);
});
test('DST correction fields round-trip exact original seconds and require explicit repeated-hour selection after edits',()=>{
 const f=fixture(),input=(s,fields)=>correctionInput(f.w,s,{...fields,reason:'Reason',position:'Corrected Cook'},'2031-01-01T00:00:00Z');assert.equal(correctionFields(f.s).startOccurrence,'');assert.equal(input(f.s,correctionFields(f.s)).start,f.s.effectiveSummary.start);
 for(const start of ['2020-11-01T06:30:17.321Z','2020-11-01T07:30:17.321Z']){const s=structuredClone(f.s);s.originalSummary={start,end:'2020-11-01T09:00:17.321Z',position:'Cook'};s.effectiveSummary=s.originalSummary;s.effectiveLocalDate='2020-11-01';const fields=correctionFields(s);assert.ok(fields.startOccurrence);assert.equal(input(s,fields).start,start);}
 assert.throws(()=>input(f.s,{...correctionFields(f.s),startDate:'2020-11-01',startTime:'01:30',startOccurrence:'',endDate:'2020-11-01',endTime:'03:30',endOccurrence:''}),/occurs twice/);assert.throws(()=>input(f.s,{...correctionFields(f.s),startDate:'2020-03-08',startTime:'02:30',startOccurrence:''}),/does not exist/);
 const s=structuredClone(f.s);s.originalSummary={...s.originalSummary,start:'2020-05-01T13:00:17.321000Z'};s.effectiveSummary=s.originalSummary;assert.equal(input(s,correctionFields(s)).start,'2020-05-01T13:00:17.321Z');s.originalSummary={...s.originalSummary,start:'2020-05-01T13:00:17.321001Z'};s.effectiveSummary=s.originalSummary;assert.throws(()=>input(s,correctionFields(s)),/sub-millisecond/);
});
test('correction input binds current source and ledger versions and rejects no-op, future and excessive periods',()=>{
 const f=fixture(),fields={...correctionFields(f.s),reason:'Reason'};assert.throws(()=>correctionInput(f.w,f.s,fields,'2031-01-01T00:00:00Z'),/at least one/);const input=correctionInput(f.w,f.s,{...fields,position:'Corrected Cook'},'2031-01-01T00:00:00Z');assert.equal(input.shiftRevision,1);assert.equal(input.expectedCorrectionRevision,0);assert.equal(input.reason,'Reason');
 assert.throws(()=>correctionInput(f.w,f.s,{...fields,position:'Corrected Cook',endDate:'2032-01-01'},'2031-01-01T00:00:00Z'));assert.throws(()=>correctionInput(f.w,f.s,{...fields,position:'Corrected Cook',endDate:'2020-05-03'},'2031-01-01T00:00:00Z'));assert.throws(()=>correctionInput(f.w,{...f.s,canPropose:false},{...fields,position:'Corrected Cook'}));
});
test('complete board paging pins asOf and ignores unrelated workspace writes',async()=>{
 const f=fixture(),s2=structuredClone(f.s);s2.shiftId=randomUUID();const sources=[f.s,s2].sort((a,b)=>a.shiftId.localeCompare(b.shiftId)),calls=[];let viewers=0;
 const call=async path=>{calls.push(path);if(path==='/schedule-viewer'){viewers++;return {status:200,body:{...view(f),location:{...f.w.location,revision:20+viewers},workspaceRevision:20+viewers}};}if(path.startsWith('/shift-corrections'))return {status:200,body:{items:[f.r],nextCursor:null,rangeComplete:true,correctionRevision:4}};const fence=path.includes('limit=1&'),after=path.includes('after=');return {status:200,body:{items:fence?[]:after?[sources[1]]:[sources[0]],nextCursor:fence||after?null:sources[0].shiftId,rangeComplete:fence||after,correctionRevision:4,scheduleRevision:12,asOf:'2020-06-01T00:00:00Z'}};};
 const loaded=await loadFixtureBoard(call,f.w);assert.equal(loaded.sources.length,2);assert.equal(loaded.records.length,1);assert.equal(loaded.complete,true);assert.ok(calls.find(p=>p.includes('after=')).includes('asOf=2020-06-01T00%3A00%3A00Z'));assert.equal(calls.length,6);assert.equal(correctionReadCurrent({...f.w,location:{...f.w.location,revision:100}},loaded),true);
 assert.equal(correctionReadCurrent({...f.w,me:{...f.w.me,capabilities:[]}},loaded),false);
});
test('board isolates malformed rows and rejects failed pages, repeated cursors or changed snapshot counters',async()=>{
 const f=fixture(),bad=structuredClone(f.r);bad.id=randomUUID();bad.data.status='bad';const sourcePage={items:[f.s],nextCursor:null,rangeComplete:true,correctionRevision:4,scheduleRevision:12,asOf:'2020-06-01T00:00:00Z'};
 const call=async path=>({status:200,body:path==='/schedule-viewer'?view(f):path.startsWith('/completed-shifts')?sourcePage:{items:[f.r,bad].sort((a,b)=>a.id.localeCompare(b.id)),nextCursor:null,rangeComplete:true,correctionRevision:4}});
 const loaded=await loadFixtureBoard(call,f.w);assert.equal(loaded.records.length,1);assert.equal(loaded.invalid,1);assert.equal(loaded.complete,false);
 await assert.rejects(loadFixtureBoard(async p=>p.startsWith('/shift-corrections')?{status:503}:call(p),f.w),/No partial history/);
 await assert.rejects(loadFixtureBoard(async p=>{const r=await call(p);if(p.startsWith('/completed-shifts'))r.body={...sourcePage,nextCursor:f.s.shiftId,rangeComplete:false};return r;},f.w),/needs review/);
 await assert.rejects(loadFixtureBoard(async p=>{const r=await call(p);if(p.startsWith('/shift-corrections'))r.body={...r.body,correctionRevision:5};return r;},f.w),/changed while loading/);
});
test('uncorrected source detail is re-read and permission changes discard it',async()=>{
 const f=fixture(),paths=[];const call=async p=>{paths.push(p);return {status:200,body:p==='/schedule-viewer'?view(f):f.s};};const loaded=await loadCorrectionDetail(call,f.w,f.s.shiftId,{source:true});assert.equal(loaded.record,null);assert.deepEqual(loaded.events,[]);assert.equal(paths.length,4);
 let n=0;await assert.rejects(loadCorrectionDetail(async p=>p==='/schedule-viewer'&&++n===2?{status:200,body:{...view(f),me:{...f.w.me,capabilities:[]}}}:call(p),f.w,f.s.shiftId,{source:true}),/access changed/);
});
test('history drains pages, validates the full before/after chain and rejects missing or foreign snapshots',async()=>{
 const f=fixture(),first=event(f);f.r.revision=2;f.r.data.status='applied';f.r.data.effectiveSummary=f.r.data.proposal;f.r.data.appliedRevision=2;f.r.data.decisionNote='Independent approval';f.r.data.actions={canPropose:true,canApprove:false,canReject:false,canWithdraw:false};const second=event(f,2,first.after),pages=[];
 const call=async p=>{if(p==='/schedule-viewer')return {status:200,body:view(f)};if(!p.startsWith('/shift-correction-history'))return {status:200,body:f.r};pages.push(p);const early=p.includes('after=0');return {status:200,body:{items:early?[first]:[second],nextCursor:early?1:null,historyComplete:!early,recordRevision:2,correctionRevision:4}};};
 const loaded=await loadCorrectionDetail(call,f.w,f.r.id);assert.equal(loaded.events.length,2);assert.equal(pages.length,2);
 for(const mutation of [e=>e.before.revision=9,e=>e.after.original_snapshot.member_id=randomUUID(),e=>e.after.effective_summary.position='Wrong final value',e=>e.revision=3]){const e=structuredClone(second);mutation(e);await assert.rejects(loadCorrectionDetail(async p=>p.startsWith('/shift-correction-history')&&p.includes('after=1')?{status:200,body:{items:[e],nextCursor:null,historyComplete:true,recordRevision:2,correctionRevision:4}}:call(p),f.w,f.r.id),/needs review/);}
});
test('source and ledger mismatches or counter changes never enable private mutation controls',async()=>{
 const f=fixture(),s={...f.s,recordRevision:1,correction:f.r,canPropose:false};assert.doesNotThrow(()=>checkedCompletedShift(f.w,s));assert.throws(()=>checkedCompletedShift(f.w,{...s,recordRevision:2}));let reads=0;
 const call=async p=>({status:200,body:p==='/schedule-viewer'?view(f):p.startsWith('/shift-correction-history')?{items:[event(f)],nextCursor:null,historyComplete:true,recordRevision:1,correctionRevision:4}:{...s,correctionRevision:++reads%2?4:5}});await assert.rejects(loadCorrectionDetail(call,f.w,f.s.shiftId,{source:true}),/history changed/);
});
test('uncertain correction confirmations retain exact intent, while definitive conflicts require fresh review',async()=>{
 const f=fixture(),sender=new ScheduleScreenSender();let command;await assert.rejects(sender.send(async(_,c)=>{command=structuredClone(c);throw Error('Lost response after commit');},f.w.location.id,'correction.approve',{note:'Reason'},f.r));assert.ok(sender.pending);
 await assert.rejects(sender.send(async()=>{},f.w.location.id,'correction.approve',{note:'Changed'},f.r),/previous submission/);await assert.rejects(sender.retry(async()=>({status:200,body:{}})),/could not be confirmed/);assert.ok(sender.pending);
 const result=await sender.retry(async(_,c)=>{assert.deepEqual(c,command);return {status:200,body:{requestId:c.requestId,recordId:f.r.id,revision:2,workspaceRevision:21,appliedAt:'2020-05-02T12:00:00Z',replayed:true,correctionStatus:'applied',effectiveRevision:2}};});assert.equal(result.replayed,true);assert.equal(sender.pending,null);
 await assert.rejects(sender.send(async()=>({status:409,body:{error:{code:'ownership_notice_unresolved'}}}),f.w.location.id,'correction.approve',{note:'Reason'},f.r),/recipients require configuration/);assert.equal(sender.pending,null);
});
test('pending proposal receipt is not confused with an applied effective summary',async()=>{
 const f=fixture(),sender=new ScheduleScreenSender(),input=correctionInput(f.w,f.s,{...correctionFields(f.s),position:'Corrected Cook',reason:'Reason'});const receipt=c=>({requestId:c.requestId,recordId:f.r.id,revision:1,workspaceRevision:21,appliedAt:'2020-05-02T12:00:00Z',replayed:false,correctionStatus:'pending',effectiveRevision:0});
 await assert.rejects(sender.send(async(_,c)=>({status:200,body:{...receipt(c),effectiveRevision:1}}),f.w.location.id,'correction.propose',input),/could not be confirmed/);assert.ok(sender.pending);assert.equal((await sender.retry(async(_,c)=>({status:200,body:receipt(c)}))).correctionStatus,'pending');assert.equal(sender.pending,null);
});

test('effective reporting date is validated in captured timezone and rendered separately from original date',()=>{
 const f=fixture();f.r.data.status='applied';f.r.data.effectiveSummary={start:'2020-11-02T00:30:00Z',end:'2020-11-02T01:30:00Z',position:'Cook'};f.r.data.proposal=f.r.data.effectiveSummary;f.r.data.appliedRevision=1;f.r.data.effectiveLocalDate='2020-11-01';f.r.data.actions={canPropose:true,canApprove:false,canReject:false,canWithdraw:false};
 const html=render(CorrectionDetailView,{w:f.w,data:detail(f),...controls});assert.match(html,/Original date:.*2020-05-01/);assert.match(html,/Effective reporting date:.*2020-11-01/);
 const wrong=structuredClone(f.r);wrong.data.effectiveLocalDate='2020-11-02';assert.throws(()=>checkedCorrection(f.w,wrong));assert.doesNotMatch(render(CorrectionDetailView,{w:f.w,data:{...detail(f),record:wrong},...controls}),/Correct planned details/);
 assert.throws(()=>checkedCompletedShift(f.w,{...f.s,effectiveLocalDate:'2020-05-02'}));
});
test('position inputs use the database 100-character bound and unknown-job responses require fresh review',async()=>{
 const f=fixture(),fields={...correctionFields(f.s),position:'X'.repeat(101),reason:'Reason'};assert.throws(()=>correctionInput(f.w,f.s,fields));assert.match(render(CorrectionForm,{w:f.w,source:f.s,...controls}),/<select(?=[^>]*name="position")[^>]*>/);
 const sender=new ScheduleScreenSender(),input=correctionInput(f.w,f.s,{...fields,position:'Unknown job'});await assert.rejects(sender.send(async()=>({status:400,body:{error:{code:'correction_position_unknown'}}}),f.w.location.id,'correction.propose',input),/active scheduling job at this store/);assert.equal(sender.pending,null);
});

test('default board range counts 14 store-local calendar days across DST and renders editable dates',()=>{
 const f=fixture();assert.deepEqual(defaultCorrectionRange(f.w,'2020-11-02T03:00:00Z'),{from:'2020-10-19',to:'2020-11-01'});assert.deepEqual(defaultCorrectionRange(f.w,'2020-03-09T03:00:00Z'),{from:'2020-02-24',to:'2020-03-08'});
 const html=render(CompletedShiftCorrections,{w:f.w,...controls});assert.match(html,/Correction date range/);assert.match(html,/last 14 calendar days/);assert.match(html,/Original shift dates in America\/Chicago/);assert.match(html,/Load selected dates/);
});

test('every board page and fence carries the same date range and cutoff; schedule churn does not restart it',async()=>{
 const f=fixture(),paths=[],ids=[randomUUID(),randomUUID()].sort();let viewers=0,pages=0;
 const call=async path=>{paths.push(path);if(path==='/schedule-viewer')return {status:200,body:{...view(f),scheduleRevision:12+viewers++}};
  const url=new URL(path,'http://fictional.invalid');assert.equal(url.searchParams.get('from'),fixtureRange.from);assert.equal(url.searchParams.get('to'),fixtureRange.to);
  if(path.startsWith('/shift-corrections'))return {status:200,body:{items:[f.r],nextCursor:null,rangeComplete:true,correctionRevision:4,...fixtureRange}};
  const fence=url.searchParams.get('limit')==='1',last=url.searchParams.has('after');if(last||fence)assert.equal(url.searchParams.get('asOf'),'2020-06-01T00:00:00Z');if(!fence)pages++;
  return {status:200,body:{items:fence?[]:[{...f.s,shiftId:ids[last?1:0]}],nextCursor:fence||last?null:ids[0],rangeComplete:fence||last,correctionRevision:4,scheduleRevision:20+pages,asOf:'2020-06-01T00:00:00Z',...fixtureRange}};
 };
 const loaded=await loadCorrectionBoard(call,f.w,fixtureRange);assert.equal(pages,2);assert.equal(viewers,2);assert.equal(loaded.sources.length,2);assert.equal(correctionReadCurrent({...f.w,scheduleRevision:999},loaded),true);
 assert.equal(correctionReadCurrent({...f.w,scheduleRevision:999},detail(f)),false);
 for(const range of [{from:'2020-05-01'},{from:'2020-02-30',to:'2020-03-01'},{from:'2020-05-02',to:'2020-05-01'}])await assert.rejects(loadCorrectionBoard(call,f.w,range),/valid start and end date/);
 await assert.rejects(loadCorrectionBoard(async path=>{const r=await call(path);if(path.includes('limit=1&'))r.body.asOf='2020-06-02T00:00:00Z';return r;},f.w,fixtureRange),/changed while loading/);
 await assert.rejects(loadCorrectionBoard(async path=>{const r=await call(path);if(path.includes('limit=1&'))r.body.from='2020-04-01';return r;},f.w,fixtureRange),/needs review/);
});

test('100 complete pages succeed; a continuing 100th page asks for a shorter range for either list',async()=>{
 const f=fixture();const key=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
 for(const resource of ['completed-shifts','shift-corrections'])for(const overflow of [false,true]){let pages=0;
  const call=async path=>{if(path==='/schedule-viewer')return {status:200,body:view(f)};const url=new URL(path,'http://fictional.invalid'),fence=url.searchParams.get('limit')==='1',active=path.startsWith('/'+resource)&&!fence;
   if(active)pages++;const n=pages,more=active&&(n<100||overflow);const items=!active?[]:resource==='completed-shifts'?[{...f.s,shiftId:key(n)}]:[{...f.r,id:key(n)}];
   return {status:200,body:{items,nextCursor:more?key(n):null,rangeComplete:!more,correctionRevision:4,scheduleRevision:12,asOf:'2020-06-01T00:00:00Z',...fixtureRange}};
  };
  if(overflow)await assert.rejects(loadCorrectionBoard(call,f.w,fixtureRange),e=>e.message===correctionRangeMessage);else assert.equal((await loadCorrectionBoard(call,f.w,fixtureRange))[resource==='completed-shifts'?'sources':'records'].length,100);
  assert.equal(pages,100);
 }
});

test('position select preserves a retired effective label and refuses malformed option projections',()=>{
 const f=fixture();f.r.data.status='applied';f.r.data.effectiveSummary={...f.s.effectiveSummary,position:'Retired Cook'};f.r.data.proposal=f.r.data.effectiveSummary;f.r.data.appliedRevision=1;f.r.data.actions={canPropose:true,canApprove:false,canReject:false,canWithdraw:false};const s={...f.s,effectiveSummary:f.r.data.effectiveSummary,correction:f.r,recordRevision:1};const html=render(CorrectionForm,{w:f.w,source:s,...controls});assert.match(html,/<select[^>]*name="position"/);assert.match(html,/value="Retired Cook" disabled="" selected=""/);assert.match(html,/retired; choose the original or an active job/);assert.doesNotMatch(html,/<input[^>]*name="position"/);
 for(const options of [undefined,['Other'],['Cook','Cook'],['Cook',7]]){assert.throws(()=>checkedCompletedShift(f.w,{...f.s,positionOptions:options}));assert.throws(()=>checkedCorrection(f.w,{...f.r,data:{...f.r.data,positionOptions:options}}));}
});
