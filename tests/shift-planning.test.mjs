import test from 'node:test';
import assert from 'node:assert/strict';
import { schedulingJobs,shiftPeriod,shiftCandidateChecks } from '../.sites-runtime/shared/shift-planning.mjs';

const member={id:'worker',locationId:'berts',name:'Fictional worker',area:'BOH',position:'Cook',scheduleJobs:['Cook','Fry'],qualifications:[],capabilities:[]};
const manager={...member,id:'manager',capabilities:['schedule.manage','schedule.change']};
const record=(id,kind,data,extra={})=>({id,locationId:'berts',ownerId:'worker',area:'BOH',revision:1,kind,data,...extra});
const period={start:'2026-09-11T20:00:00.000Z',end:'2026-09-12T03:00:00.000Z'};
const workspace=records=>({location:{id:'berts',timezone:'America/New_York'},me:manager,members:[manager,member],records});
const input={date:'2026-09-11',startTime:'16:00',endTime:'23:00',overnight:false,startFold:'',endFold:''};

test('the job picker includes scheduling-only roster jobs without inventing clearance',()=>{
  assert.deepEqual(schedulingJobs({...member,qualifications:['Fry']}),['Cook','Fry']);
  assert.deepEqual(member.qualifications,[]);
});
test('shift times require an explicit overnight choice and a real calendar date',()=>{
  assert.deepEqual(shiftPeriod(input,'America/New_York'),period);
  assert.throws(()=>shiftPeriod({...input,startTime:'20:00',endTime:'02:00'},'America/New_York'),/Ends the next day/);
  assert.equal(shiftPeriod({...input,startTime:'20:00',endTime:'02:00',overnight:true},'America/New_York').end,'2026-09-12T06:00:00.000Z');
  assert.throws(()=>shiftPeriod({...input,date:'2026-02-30'},'America/New_York'),/real calendar date/);
  assert.throws(()=>shiftPeriod({...input,overnight:true},'America/New_York'),/24 hours/);
});
test('unchanged repeated-hour edits retain their original instant and changed times require a choice',()=>{
  const fall={...input,date:'2026-11-01',startTime:'01:30',endTime:'03:00'};
  const previous=record('old','shift',{position:'Cook',start:'2026-11-01T06:30:00.000Z',end:'2026-11-01T08:00:00.000Z'});
  assert.equal(shiftPeriod(fall,'America/New_York',previous).start,previous.data.start);
  assert.throws(()=>shiftPeriod(fall,'America/New_York'),/occurs twice/);
  assert.equal(shiftPeriod({...fall,startFold:'earlier'},'America/New_York').start,'2026-11-01T05:30:00.000Z');
  assert.throws(()=>shiftPeriod({...input,date:'2026-03-08',startTime:'02:30'},'America/New_York'),/does not exist/);
});
test('candidate checks distinguish approved blocks from pending requests and omit private reasons',()=>{
  const w=workspace([
    record('overlap','shift',{...period,cancelled:false,published:false}),
    record('off','request',{...period,type:'time-off',status:'approved',note:'Private medical reason'}),
    record('pending','request',{...period,type:'time-off',status:'pending'}),
    record('availability','availability',{startDate:'2026-09-11',endDate:'2026-09-11',days:[5],startMinute:900,endMinute:1020,beforeMinutes:0,afterMinutes:0,status:'approved',title:'Private school detail'})
  ]);
  const result=shiftCandidateChecks(w,member,period,'Cook');
  assert.deepEqual(result.blocking,['Overlapping shift','Approved time off','Approved availability conflict']);
  assert.deepEqual(result.notices,['Pending time-off request overlaps']);
  assert.doesNotMatch(JSON.stringify(result),/medical|school/);
});
test('editing excludes the current shift but counts drafts and respects adjacent boundaries and location',()=>{
  const own=record('own','shift',{...period,cancelled:false,published:false});
  const w=workspace([own,record('adjacent','shift',{start:period.end,end:'2026-09-12T05:00:00Z',cancelled:false}),record('other','shift',{...period,cancelled:false},{locationId:'rudds'})]);
  assert.deepEqual(shiftCandidateChecks(w,member,period,'Cook',own).blocking,[]);
  assert.deepEqual(shiftCandidateChecks(w,member,period,'Cook').blocking,['Overlapping shift']);
  assert.match(shiftCandidateChecks(w,member,period,'Grill',own).blocking[0],/scheduling list/);
});
test('published changes require assigned leadership for the proposed times and department',()=>{
  const own=record('published','shift',{...period,published:true,cancelled:false});
  const w=workspace([own]);assert.match(shiftCandidateChecks(w,member,period,'Cook',own).blocking[0],/scheduling access/);
  w.records.push(record('lead','leadership',{...period,personId:'manager',area:'BOH',active:true},{ownerId:'manager'}));
  assert.deepEqual(shiftCandidateChecks(w,member,period,'Cook',own).blocking,[]);
  assert.match(shiftCandidateChecks(w,member,{...period,end:'2026-09-12T04:00:00.000Z'},'Cook',own).blocking[0],/scheduling access/);
});
