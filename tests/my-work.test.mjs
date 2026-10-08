import test from 'node:test';
import assert from 'node:assert/strict';
import { myWork } from '../.sites-runtime/shared/my-work.mjs';
import { workforceContext } from '../.sites-runtime/shared/workforce-context.mjs';
import { qualityWorkspace } from './companion-quality-fixture.mjs';

function fixture(){
 const f=qualityWorkspace();f.w.records=f.w.records.filter(r=>r.kind==='standard');f.w.me=f.employee;f.employee.position='Cook';f.employee.qualifications=['Cook'];f.employee.scheduleJobs=['Cook'];
 f.expo.data={...f.guide('Grill','Grill')};
 for(const [id,title,guide] of [['fry','Fry',f.fry],['grill','Grill',f.expo]])f.add(id,'station','manager',{title,status:'active',levels:[],independentLevel:null,setup:{jobs:['Cook'],allJobMembers:true,memberIds:[],standardIds:[guide.id],goals:[],managerId:'manager'}});
 const shift=(id,station,start,end,extra={})=>f.add(id,'shift','employee',{personId:'employee',position:'Cook',stationId:station,stationName:station==='fry'?'Fry':'Grill',start,end,published:true,cancelled:false,...extra});
 const fry=shift('monday','fry','2026-09-14T20:00:00Z','2026-09-15T03:00:00Z');
 const grill=shift('tuesday','grill','2026-09-15T20:00:00Z','2026-09-16T03:00:00Z');
 return {...f,shift,fryShift:fry,grillShift:grill};
}

test('personal work follows the actual station on each published shift, including overnight',()=>{
 const f=fixture();
 for(const at of ['2026-09-14T21:00:00Z','2026-09-15T02:00:00Z']){const w=myWork(f.w,at);assert.equal(w.station,'Fry');assert.equal(w.current,true);assert.deepEqual(w.guides.map(g=>g.id),[f.fry.id]);}
 const ended=myWork(f.w,'2026-09-15T03:00:00Z');assert.equal(ended.station,'Fry');assert.equal(ended.current,false);assert.equal(ended.checkoutPending,true);
 f.fryShift.data.releasedAt='2026-09-15T03:05:00Z';const next=myWork(f.w,'2026-09-15T03:06:00Z');assert.equal(next.station,'Grill');assert.equal(next.checkoutPending,false);
 assert.equal(myWork(f.w,'2026-09-15T21:00:00Z').station,'Grill');
});
test('draft, cancelled, released, other-person and other-restaurant shifts cannot select the station',()=>{
 for(const change of [s=>s.data.published=false,s=>s.data.cancelled=true,s=>s.data.releasedAt='2026-09-14T20:30:00Z',s=>s.ownerId='manager',s=>s.locationId='elsewhere']){const f=fixture();change(f.fryShift);const work=myWork(f.w,'2026-09-14T21:00:00Z');assert.equal(work.station,'Grill');assert.deepEqual(work.upcomingShifts.map(s=>s.id),['tuesday']);}
});

test('upcoming shifts keep the overnight assignment until it ends and stay within the coming week',()=>{
 const f=fixture();f.shift('far-future','fry','2026-10-14T20:00:00Z','2026-10-15T03:00:00Z');
 assert.deepEqual(myWork(f.w,'2026-09-15T02:30:00Z').upcomingShifts.map(s=>s.id),['monday','tuesday']);
 assert.deepEqual(myWork(f.w,'2026-09-15T03:00:00Z').upcomingShifts.map(s=>s.id),['tuesday']);
});
test('eligible stations are never treated as an assignment and overlapping shifts fail closed',()=>{
 const f=fixture();delete f.fryShift.data.stationId;delete f.fryShift.data.stationName;
 const work=myWork(f.w,'2026-09-14T21:00:00Z');assert.equal(work.station,'Cook');assert.deepEqual(work.guides,[]);
 f.shift('overlap','grill','2026-09-14T20:00:00Z','2026-09-15T03:00:00Z');
 const conflict=myWork(f.w,'2026-09-14T21:00:00Z');assert.equal(conflict.ambiguous,true);assert.equal(conflict.shift,undefined);assert.deepEqual(conflict.guides,[]);
});
test('only approved linked instructions and live personal goals surface; dish has no guides',()=>{
 const f=fixture(),at='2026-09-14T21:00:00Z';
 f.add('active','goal','employee',{title:'Practice Fry',phase:'active',stationLearning:{stationId:'fry'},managerId:'manager',due:'2026-09-20T12:00:00Z',history:[]});
 f.add('declined','goal','employee',{title:'Declined',phase:'declined',stationLearning:{stationId:'fry'}});
 assert.deepEqual(myWork(f.w,at).relatedGoals.map(g=>g.id),['active']);
 f.fry.data.status='draft';assert.deepEqual(myWork(f.w,at).guides,[]);
 f.fry.data.status='approved';f.w.me={...f.employee,position:'Dishwasher'};assert.deepEqual(myWork(f.w,at).guides,[]);
});
test('JMAX receives the assigned station without an attachment and refreshes after station changes',()=>{
 const f=fixture(),at='2026-09-14T21:00:00Z';
 const today=workforceContext(f.w,'What should I do for my shift today?',at);
 assert.equal(today.context.myShift.station,'Fry');assert.equal(today.context.myShift.job,'Cook');assert.equal(today.evidence[1].source.id,f.fry.id);
 assert.ok(JSON.stringify(today.context).includes('Place the Fry card'));
 const tomorrow=workforceContext(f.w,'What should I do for my shift today?','2026-09-15T21:00:00Z',[{id:f.fry.id,revision:1,kind:'standard',title:f.fry.data.title}]);
 assert.equal(tomorrow.context.myShift.station,'Grill');assert.equal(tomorrow.evidence[1].source.id,f.expo.id);
 const explicit=workforceContext(f.w,'Explain Grill.',at);assert.equal(explicit.evidence[1].source.id,f.expo.id);
});

test('personal assignments surface their real next step without exposing others or completed work',()=>{
 const f=fixture(),at='2026-09-14T21:00:00Z';
 const task=(id,owner,phase,due)=>f.add(id,'task',owner,{title:id,detail:'Fictional assignment',kind:'task',phase,due,history:[]});
 task('mine','employee','open',at);task('waiting','employee','verification',at);
 task('completed','employee','closed',at);task('someone-else','manager','open',at);
 task('later','employee','open','2026-09-20T21:00:00Z');
 const duties=myWork(f.w,at).duties;
 assert.deepEqual(duties.map(d=>d.record.id),['mine','waiting']);
 assert.equal(duties[0].next,'Work through this assignment');
 assert.equal(duties[1].lane,'waiting');
});
