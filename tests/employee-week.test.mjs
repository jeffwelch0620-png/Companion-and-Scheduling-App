import test from 'node:test';
import assert from 'node:assert/strict';
import {employeeShiftWeek} from '../.sites-runtime/shared/employee-week.mjs';

const shift=(id,start,end,extra={})=>({id,kind:'shift',locationId:'berts',ownerId:'cook',revision:1,data:{start,end,position:'Cook',published:true,cancelled:false,...extra.data},...Object.fromEntries(Object.entries(extra).filter(([k])=>k!=='data'))});
const a=shift('a','2026-09-09T13:00:00Z','2026-09-09T19:00:00Z');
const workspace=records=>({location:{id:'berts',timezone:'America/New_York',weekStartsOn:3},records});

test('employee week excludes other people, restaurants, cancelled shifts and other weeks',()=>{
 const w=workspace([a,shift('same-name-person',a.data.start,a.data.end,{ownerId:'other'}),shift('other-location',a.data.start,a.data.end,{locationId:'rudds'}),shift('cancelled',a.data.start,a.data.end,{data:{cancelled:true}}),shift('previous','2026-09-08T13:00:00Z','2026-09-08T19:00:00Z'),shift('next','2026-09-16T13:00:00Z','2026-09-16T19:00:00Z')]);
 const result=employeeShiftWeek(w,a);assert.equal(result.start,'2026-09-09');assert.equal(result.end,'2026-09-15');assert.equal(result.minutes,360);assert.deepEqual(result.days.flatMap(d=>d.shifts.map(s=>s.id)),['a']);assert.equal(result.days[1].shifts.length,0);
 assert.equal(employeeShiftWeek(w,{...a,locationId:'rudds'}).minutes,0);
});
test('split shifts and a station change remain separate selections for the same person',()=>{
 const b=shift('b','2026-09-09T21:00:00Z','2026-09-10T01:00:00Z',{data:{stationName:'Fry'}});
 const r=employeeShiftWeek(workspace([b,a]),a);assert.deepEqual(r.days[0].shifts.map(s=>s.id),['a','b']);assert.equal(r.minutes,600);assert.equal(r.days[0].shifts[1].data.stationName,'Fry');
});
test('overnight and DST durations use actual instants, grouped on the local start date',()=>{
 const overnight=shift('overnight','2026-09-16T02:00:00Z','2026-09-16T06:00:00Z');
 const r=employeeShiftWeek(workspace([overnight]),overnight);assert.equal(r.start,'2026-09-09');assert.equal(r.days[6].shifts[0].id,'overnight');assert.equal(r.minutes,240);
 const dst=shift('dst','2026-11-01T04:00:00Z','2026-11-01T08:00:00Z');assert.equal(employeeShiftWeek(workspace([dst]),dst).minutes,240);
});
test('selected cancelled shift stays inspectable without contributing hours',()=>{
 const cancelled=shift('cancelled',a.data.start,a.data.end,{data:{cancelled:true}});const r=employeeShiftWeek(workspace([a,cancelled]),cancelled);assert.equal(r.days[0].shifts.length,2);assert.equal(r.minutes,360);
});
