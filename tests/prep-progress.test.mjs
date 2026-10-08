import test from 'node:test';
import assert from 'node:assert/strict';
import {prepProgress} from '../.sites-runtime/shared/prep-progress.mjs';
const line={title:'Dressing cups',plannedQty:10,completedAt:null,completedQty:null,countUnit:'cup',completionNote:''};
const plan={id:'p',locationId:'berts',dataset:'operating',status:'released',targetDate:'2026-10-08',track:'daily',lines:[line]};
test('manager progress exposes unassigned unfinished work and excludes drafts and foreign records',()=>{
 const rows=prepProgress([plan,{...plan,status:'draft'},{...plan,locationId:'rudds'},{...plan,dataset:'demo'}],'berts','operating');assert.equal(rows.length,1);assert.equal(rows[0].unassigned,1);assert.equal(rows[0].remaining,1);
});
test('a completed plan with reported shortage stays visible for manager follow-through',()=>{
 const rows=prepProgress([{...plan,status:'completed',lines:[{...line,completedAt:'now',completedQty:6,completionNote:'Ran out of dressing'}]}],'berts','operating');assert.equal(rows[0].remaining,0);assert.equal(rows[0].shortages[0].actual,6);assert.match(rows[0].shortages[0].note,/Ran out/);
});
test('fully completed quantities do not create a false prep exception',()=>{
 assert.deepEqual(prepProgress([{...plan,status:'completed',lines:[{...line,completedAt:'now',completedQty:10}]}],'berts','operating'),[]);
});
