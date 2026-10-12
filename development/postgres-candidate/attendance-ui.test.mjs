import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import React from '../../node_modules/react/index.js';import {renderToStaticMarkup} from '../../node_modules/react-dom/server.node.js';
import {attendanceAreas,attendanceAccessKey,attendanceReadCurrent,checkedAttendance,canRecordAttendance,loadAttendanceRange,loadShiftAttendance,loadAttendanceDetail,attendancePatterns,attendanceFields,attendanceInput,attendanceDecision} from './attendance-client.mjs';
import {AttendanceForm,AttendanceDetailView,AttendancePatternSummary,ShiftAttendance,ShiftAttendanceEntries} from './runtime/ui-reference/ui-attendance.mjs';
import {ScheduleScreenSender} from './schedule-screen-client.mjs';
function fixture(){const actor=randomUUID(),owner=randomUUID(),shiftId=randomUUID(),id=randomUUID(),w={location:{id:'fictional',revision:8,timezone:'America/Chicago',configuration:{operatingDepartments:['Kitchen','Service'],dishDepartment:'Kitchen',dishPosition:'Steward',dishAliases:['Steward']}},me:{id:actor,name:'Fictional manager',capabilities:[]},members:[],attendanceRevision:8,attendanceAreas:['Kitchen'],records:[]};const r={id,kind:'attendance',ownerId:owner,locationId:'fictional',area:'Kitchen',revision:1,updatedAt:'2020-05-01T16:00:00Z',data:{title:'Fictional employee · Called in',employeeName:'Fictional employee',employeeNameAtEntry:'Fictional prior name',historicalNameLabel:'name at time of entry',shiftId,shiftRevision:2,shift:{start:'2020-05-01T13:00:00Z',end:'2020-05-01T15:00:00Z',position:'Cook',timezone:'America/Chicago'},type:'call-in',reportedAt:'2020-05-01T12:00:17.321Z',note:'Fictional private note',facts:{contact:'unknown',coverage:'unknown',emergency:'unknown'},status:'recorded',review:null,actions:{canCorrect:true,canVoid:true,canReview:true,canReopen:false}}};const shift={id:shiftId,kind:'shift',locationId:'fictional',area:'Kitchen',ownerId:owner,revision:2,data:{start:r.data.shift.start,end:r.data.shift.end,published:true,cancelled:false,position:'Cook',attendanceActions:{canRecord:true}}};return {w,r,shift};}
const viewer=w=>({location:w.location,me:w.me,workspaceRevision:w.location.revision,attendanceRevision:w.attendanceRevision,attendanceAreas:w.attendanceAreas});
const result=(f,records=[f.r])=>({records,invalid:0,complete:true,from:'2020-05-01',to:'2020-05-01',shiftId:null,attendanceRevision:8,accessKey:attendanceAccessKey(f.w),workspaceRevision:8,actorId:f.w.me.id,locationId:'fictional'});
function event(f,revision=1,before=null){const r=f.r;return {revision,action:revision===1?'attendance.record':'attendance.correct',actorId:f.w.me.id,actorName:'Fictional current manager',actorNameAtEntry:'Fictional prior manager',historicalNameLabel:'name at time of entry',at:'2020-05-01T16:00:00Z',changeReason:revision===1?'':'Fictional correction reason',before,after:{id:r.id,restaurant_id:'fictional',member_id:r.ownerId,department:r.area,revision,shift_id:r.data.shiftId,shift_revision:r.data.shiftRevision,shift_snapshot:r.data.shift,attendance_type:r.data.type,reported_at:r.data.reportedAt,note:r.data.note,facts:r.data.facts,status:r.data.status}};}
const render=(C,props)=>renderToStaticMarkup(React.createElement(C,props));
const controls={send:async()=>true,onError:()=>{},onCancel:()=>{},onBack:()=>{},onSelect:()=>{}};

test('attendance controls use current server areas/actions and configured checkout access, never manager titles',()=>{
 const f=fixture();assert.deepEqual(attendanceAreas(f.w),['Kitchen']);assert.equal(canRecordAttendance(f.w,f.shift),true);
 const hidden={...f.w,attendanceAreas:[],me:{...f.w.me,position:'GM',capabilities:['location.manage']}};assert.equal(canRecordAttendance(hidden,f.shift),false);assert.doesNotMatch(render(AttendanceForm,{w:hidden,shift:f.shift,...controls}),/Save attendance/);
 assert.doesNotMatch(render(ShiftAttendance,{w:hidden,shift:f.shift,call:async()=>({status:403}),...controls,onHistory:()=>{}}),/Fictional private note|Record attendance/);
});
test('forms reuse explicit known-fact choices, reasons, captured timezone and no inferred worked hours',()=>{
 const f=fixture(),html=render(AttendanceForm,{w:f.w,record:f.r,...controls,now:'2020-05-02T12:00:00Z'});assert.match(html,/America\/Chicago/);assert.match(html,/Reason for correction/);assert.match(html,/An unknown detail stays unknown/);assert.match(html,/does not|stay in place/);
 const detail=render(AttendanceDetailView,{w:f.w,data:{record:f.r,events:[event(f)],complete:true,attendanceRevision:8,accessKey:attendanceAccessKey(f.w),workspaceRevision:8,actorId:f.w.me.id,locationId:'fictional'},...controls});assert.match(detail,/Name at time of entry: Fictional prior name/);assert.match(detail,/Fictional current manager/);assert.match(detail,/Fictional prior manager/);assert.match(detail,/do not establish hours worked or pay/);assert.match(detail,/Review this entry/);
});
test('malformed entries and denied or exhausted action flags render no mutation controls',()=>{
 const f=fixture();for(const mutation of [r=>r.data.type='unknown',r=>r.data.facts.contact='bad',r=>r.area='Other',r=>r.data.shift.timezone='Invalid/Zone']){const r=structuredClone(f.r);mutation(r);assert.throws(()=>checkedAttendance(f.w,r));const html=render(AttendanceDetailView,{w:f.w,data:{record:r,events:[event(f)],complete:true,attendanceRevision:8,accessKey:attendanceAccessKey(f.w),workspaceRevision:8,actorId:f.w.me.id,locationId:'fictional'},...controls});assert.match(html,/needs review/);assert.doesNotMatch(html,/Correct attendance entry|Review this entry|Void mistaken/);}
 const r=structuredClone(f.r);r.data.status='voided';r.data.actions={canCorrect:false,canVoid:false,canReview:false,canReopen:false};const g={...f,r};assert.doesNotMatch(render(AttendanceDetailView,{w:f.w,data:{record:r,events:[event(g)],complete:true,attendanceRevision:8,accessKey:attendanceAccessKey(f.w),workspaceRevision:8,actorId:f.w.me.id,locationId:'fictional'},...controls}),/Correct attendance entry|Review this entry|Void mistaken/);assert.throws(()=>attendanceDecision(f.w,r,'attendance.void','Reason'));
});
test('unchanged times retain exact seconds and both repeated-hour instants; new ambiguous or missing hours require review',()=>{
 const f=fixture(),input=(r,fields)=>attendanceInput(f.w,{...fields,type:r.data.type,note:r.data.note,facts:r.data.facts,changeReason:'Fictional reason'},r,undefined,'2031-01-01T00:00:00Z');
 assert.equal(attendanceFields(f.w,f.r).repeated,'');assert.equal(input(f.r,attendanceFields(f.w,f.r)).reportedAt,f.r.data.reportedAt);
 for(const instant of ['2020-11-01T06:30:17.321Z','2020-11-01T07:30:17.321Z']){const r=structuredClone(f.r);r.data.reportedAt=instant;const fields=attendanceFields(f.w,r);assert.ok(fields.repeated);assert.equal(input(r,fields).reportedAt,instant);}
 assert.throws(()=>input(f.r,{date:'2020-11-01',time:'01:30',repeated:''}),/occurs twice/);assert.throws(()=>input(f.r,{date:'2020-03-08',time:'02:30',repeated:''}),/does not exist/);
 assert.throws(()=>attendanceInput(f.w,{...attendanceFields(f.w,f.r),type:'no-show',note:'Fact',facts:f.r.data.facts,changeReason:'Reason'},f.r),/reported time/);
});
test('date-range pagination drains all pages; partial or malformed ranges never produce complete totals',async()=>{
 const f=fixture(),second=structuredClone(f.r);second.id=randomUUID();second.data.type='other';const records=[f.r,second].sort((a,b)=>a.id.localeCompare(b.id)),calls=[];
 const call=async path=>{calls.push(path);return {status:200,body:path==='/schedule-viewer'?viewer(f.w):{items:path.includes('after=')?[records[1]]:[records[0]],nextCursor:path.includes('after=')?null:records[0].id,attendanceRevision:8,shiftId:null,workspaceRevision:8,rangeComplete:path.includes('after='),from:'2020-05-01',to:'2020-05-01'}};};
 const loaded=await loadAttendanceRange(call,f.w,'2020-05-01','2020-05-01');assert.equal(loaded.records.length,2);assert.equal(calls.filter(p=>p.startsWith('/attendance?')).length,2);assert.equal(attendancePatterns(loaded)[0].shifts,1);assert.equal(attendancePatterns(loaded)[0].entries,2);
 await assert.rejects(loadAttendanceRange(async p=>p.includes('after=')?{status:503}:call(p),f.w,'2020-05-01','2020-05-01'),/No partial totals/);
 await assert.rejects(loadAttendanceRange(async p=>p==='/schedule-viewer'?{status:200,body:viewer(f.w)}:{status:200,body:null},f.w,'2020-05-01','2020-05-01'),/needs review/);
 await assert.rejects(loadAttendanceRange(async()=>{throw Error('Internal transport detail');},f.w,'2020-05-01','2020-05-01'),/No partial totals/);
 const bad=structuredClone(f.r);bad.data.type='bad';const isolated=await loadAttendanceRange(async p=>({status:200,body:p==='/schedule-viewer'?viewer(f.w):{items:[records[0],{...bad,id:randomUUID()}],nextCursor:null,rangeComplete:true,shiftId:null,attendanceRevision:8,workspaceRevision:8,from:'2020-05-01',to:'2020-05-01'}}),f.w,'2020-05-01','2020-05-01');assert.equal(isolated.records.length,1);assert.equal(isolated.complete,false);assert.throws(()=>attendancePatterns(isolated));assert.doesNotMatch(render(AttendancePatternSummary,{data:isolated,...controls}),/1 shifts|1 entries/);
});
test('scope revisions retry the whole range; revoked identity or repeated cursors fail safely',async()=>{
 const f=fixture();let pages=0;const call=async path=>({status:200,body:path==='/schedule-viewer'?viewer(f.w):{items:[f.r],nextCursor:null,rangeComplete:true,shiftId:null,attendanceRevision:++pages===1?9:8,workspaceRevision:8,from:'2020-05-01',to:'2020-05-01'}});assert.equal((await loadAttendanceRange(call,f.w,'2020-05-01','2020-05-01')).records.length,1);assert.equal(pages,2);
 await assert.rejects(loadAttendanceRange(async()=>({status:200,body:{...viewer(f.w),attendanceAreas:[]}}),f.w,'2020-05-01','2020-05-01'),/access changed/);
 await assert.rejects(loadAttendanceRange(async path=>({status:200,body:path==='/schedule-viewer'?viewer(f.w):{items:[f.r],nextCursor:f.r.id,rangeComplete:false,shiftId:null,attendanceRevision:8,workspaceRevision:8,from:'2020-05-01',to:'2020-05-01'}}),f.w,'2020-05-01','2020-05-01'),/needs review/);
});
test('pattern counts exclude voided entries and count each original shift once without attendance rates',()=>{
 const f=fixture(),other=structuredClone(f.r),voided=structuredClone(f.r);other.id=randomUUID();other.data.type='late';voided.id=randomUUID();voided.data.status='voided';const data=result(f,[f.r,other,voided]),row=attendancePatterns(data)[0];assert.equal(row.shifts,1);assert.equal(row.entries,2);assert.equal(row.pending,2);assert.match(render(AttendancePatternSummary,{data,...controls}),/1 shift.*2 entries/);assert.throws(()=>attendancePatterns({...data,complete:false}));
});
test('detail loads complete version-bound history and rejects missing, foreign or discontinuous events',async()=>{
 const f=fixture();f.r.revision=2;const first=event(f,1),second=event(f,2,first.after);const calls=[];
 const call=async path=>{calls.push(path);return {status:200,body:path==='/schedule-viewer'?viewer(f.w):path.startsWith('/attendance-history/')?{items:path.includes('after=0')?[first]:[second],nextCursor:path.includes('after=0')?1:null,historyComplete:!path.includes('after=0'),recordRevision:2,attendanceRevision:8}:f.r};};
 const loaded=await loadAttendanceDetail(call,f.w,f.r.id);assert.equal(loaded.events.length,2);assert.equal(calls.filter(p=>p.startsWith('/attendance-history/')).length,2);
 for(const mutation of [e=>e.after.member_id=randomUUID(),e=>e.before.revision=7,e=>e.revision=4]){const changed=structuredClone(second);mutation(changed);await assert.rejects(loadAttendanceDetail(async p=>p.startsWith('/attendance-history/')&&p.includes('after=1')?{status:200,body:{items:[changed],nextCursor:null,historyComplete:true,recordRevision:2,attendanceRevision:8}}:call(p),f.w,f.r.id),/needs review/);}
});
test('uncertain attendance saves freeze exact commands, validate confirmations and clear conflicts for fresh review',async()=>{
 const f=fixture(),sender=new ScheduleScreenSender(),input=attendanceInput(f.w,{...attendanceFields(f.w,f.r),type:f.r.data.type,note:'Updated facts',facts:f.r.data.facts,changeReason:'Reason'},f.r,undefined,'2031-01-01T00:00:00Z');let original;
 await assert.rejects(sender.send(async(_,c)=>{original=structuredClone(c);throw Error('Lost response after commit');},'fictional','attendance.correct',input,f.r));assert.ok(sender.pending);await assert.rejects(sender.send(async()=>{},'fictional','attendance.correct',{...input,note:'Different'},f.r),/previous submission/);
 await assert.rejects(sender.retry(async()=>({status:200,body:{}})),/could not be confirmed/);assert.ok(sender.pending);
 const replay=await sender.retry(async(_,c)=>{assert.deepEqual(c,original);return {status:200,body:{recordId:f.r.id,revision:2,workspaceRevision:9,requestId:c.requestId,appliedAt:'2020-05-01T16:00:00Z',replayed:true}};});assert.equal(replay.replayed,true);assert.equal(sender.pending,null);
 await assert.rejects(sender.send(async()=>({status:409,body:{error:{code:'attendance_duplicate'}}}),'fictional','attendance.correct',input,f.r),/already recorded/);assert.equal(sender.pending,null);
});

test('attendance-only freshness ignores unrelated global/scheduling changes but not access or attendance changes',async()=>{
 const f=fixture(),other=structuredClone(f.r);other.id=randomUUID();other.data.type='other';const entries=[f.r,other].sort((a,b)=>a.id.localeCompare(b.id));let viewers=0,pages=0;
 const loaded=await loadAttendanceRange(async path=>{
  if(path==='/schedule-viewer'){viewers++;const v=viewer(f.w),n=viewers===1?8:10;return {status:200,body:{...v,location:{...v.location,revision:n},workspaceRevision:n,scheduleRevision:viewers,inputRevision:viewers,leadershipOptions:[{unrelated:viewers}]}};}
  pages++;return {status:200,body:{items:path.includes('after=')?[entries[1]]:[entries[0]],nextCursor:path.includes('after=')?null:entries[0].id,rangeComplete:path.includes('after='),from:'2020-05-01',to:'2020-05-01',shiftId:null,attendanceRevision:8,workspaceRevision:8+pages}};
 },f.w,'2020-05-01','2020-05-01');
 assert.equal(pages,2);assert.equal(viewers,2);assert.equal(attendanceReadCurrent({...f.w,location:{...f.w.location,revision:10}},loaded),true);
 assert.equal(attendanceReadCurrent({...f.w,attendanceRevision:9},loaded),false);assert.equal(attendanceReadCurrent({...f.w,attendanceAreas:[]},loaded),false);
 assert.equal(attendanceReadCurrent({...f.w,me:{...f.w.me,capabilities:['people.manage']}},loaded),false);
 const data={record:f.r,events:[event(f)],complete:true,attendanceRevision:8,accessKey:attendanceAccessKey(f.w),workspaceRevision:8,actorId:f.w.me.id,locationId:'fictional'};
 assert.match(render(AttendanceDetailView,{w:{...f.w,location:{...f.w.location,revision:10}},data,...controls}),/Review this entry/);
 assert.doesNotMatch(render(AttendanceDetailView,{w:{...f.w,attendanceRevision:9},data,...controls}),/Review this entry/);
});

test('per-shift paging keeps previous assignees and labels them without loading a day range',async()=>{
 const f=fixture(),current=structuredClone(f.r);f.shift.ownerId=randomUUID();current.id=randomUUID();current.ownerId=f.shift.ownerId;current.data.employeeName='Fictional current assignee';const entries=[f.r,current].sort((a,b)=>a.id.localeCompare(b.id)),paths=[];
 const loaded=await loadShiftAttendance(async path=>{paths.push(path);return {status:200,body:path==='/schedule-viewer'?viewer(f.w):{items:path.includes('after=')?[entries[1]]:[entries[0]],nextCursor:path.includes('after=')?null:entries[0].id,rangeComplete:path.includes('after='),from:null,to:null,shiftId:f.shift.id,attendanceRevision:8,workspaceRevision:8}};},f.w,f.shift.id);
 assert.equal(loaded.records.length,2);assert.ok(paths.filter(p=>p.startsWith('/attendance?')).every(p=>p.includes('shift='+f.shift.id)&&!p.includes('from=')));
 const html=render(ShiftAttendanceEntries,{shift:f.shift,entries:loaded.records});assert.match(html,/Fictional employee/);assert.match(html,/Fictional current assignee/);assert.equal((html.match(/Previous assignee entry/g)??[]).length,1);
});

test('history uses a separate entry revision and does not restart for unrelated viewer counters',async()=>{
 const f=fixture();f.r.revision=2;const first=event(f,1),second=event(f,2,first.after);let viewers=0,pages=0;
 const call=async path=>{
  if(path==='/schedule-viewer'){viewers++;const v=viewer(f.w);return {status:200,body:{...v,workspaceRevision:8+viewers,location:{...v.location,revision:8+viewers},scheduleRevision:viewers}};}
  if(path.startsWith('/attendance-history/')){pages++;return {status:200,body:{items:path.includes('after=0')?[first]:[second],nextCursor:path.includes('after=0')?1:null,historyComplete:!path.includes('after=0'),recordRevision:2,attendanceRevision:8}};}
  return {status:200,body:f.r};
 };
 assert.equal((await loadAttendanceDetail(call,f.w,f.r.id)).events.length,2);assert.equal(pages,2);assert.equal(viewers,2);
 await assert.rejects(loadAttendanceDetail(async path=>{const response=await call(path);if(path.startsWith('/attendance-history/'))response.body.attendanceRevision=9;return response;},f.w,f.r.id),/history changed/);
});
