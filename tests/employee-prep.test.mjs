import test from 'node:test';
import assert from 'node:assert/strict';
import {employeePrep} from '../.sites-runtime/shared/employee-prep.mjs';
const w={location:{id:'berts'},me:{id:'cook',scheduleOnly:false}};
const line={definitionId:'dressing',foodRecordId:'ranch',foodRevision:2,title:'Ranch cups',plannedQty:12,countUnit:'cup',completedAt:null,assignedTo:'cook'};
const plan={id:'plan',revision:3,kind:'plan',locationId:'berts',dataset:'operating',status:'released',targetDate:'2026-10-08',track:'daily',lines:[line]};
test('only unfinished explicitly assigned released work reaches the employee',()=>{
 const variants=[plan,{...plan,id:'draft',status:'draft'},{...plan,id:'other-store',locationId:'rudds'},{...plan,id:'demo',dataset:'demo'},{...plan,id:'other-person',lines:[{...line,assignedTo:'someone-else'}]},{...plan,id:'unassigned',lines:[{...line,assignedTo:undefined}]},{...plan,id:'done',lines:[{...line,completedAt:'now'}]},{...plan,id:'zero',lines:[{...line,plannedQty:0}]}];
 const before=JSON.stringify(variants),items=employeePrep(w,variants,'operating');assert.equal(items.length,1);assert.equal(items[0].quantity,12);assert.equal(items[0].planId,'plan');assert.equal(JSON.stringify(variants),before);
});
test('schedule-only membership cannot read prep, even with an assignment',()=>{
 assert.throws(()=>employeePrep({...w,me:{...w.me,scheduleOnly:true}},[plan],'operating'),e=>e.status===403);
});
test('bulk work retains its track and is sorted by production day',()=>{
 const items=employeePrep(w,[{...plan,id:'later',targetDate:'2026-10-10'}, {...plan,id:'bulk',track:'bulk'}],'operating');assert.deepEqual(items.map(i=>i.planId),['bulk','later']);assert.equal(items[0].track,'bulk');
});
