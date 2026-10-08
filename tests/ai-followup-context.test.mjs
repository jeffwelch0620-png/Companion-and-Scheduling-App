import test from 'node:test';
import assert from 'node:assert/strict';
import {currentFollowupFocus,operationalFollowup} from '../.sites-runtime/shared/companion-followup.mjs';
import {qualityWorkspace,at} from './companion-quality-fixture.mjs';
test('changed attached work is reread at its latest readable revision without reusing the stale answer',()=>{
 const f=qualityWorkspace();f.w.me=f.employee;
 const r=f.add('own-task','task',f.employee.id,{title:'Linked silverware',kind:'task',phase:'verification',detail:'Ready for independent review',due:at,history:[]});r.revision=2;
 assert.deepEqual(currentFollowupFocus(f.w,"They've now marked it ready. What is next?",at,{focus:{id:r.id,revision:1,kind:'task',title:r.data.title},sources:[]}),{id:r.id,revision:2});
 r.ownerId='other';r.data.shiftId=undefined;
 assert.equal(currentFollowupFocus(f.w,'What is next?',at,{focus:{id:r.id,revision:1,kind:'task',title:r.data.title},sources:[]}),undefined);
});
test('a new explicit topic never inherits an operational attachment',()=>{
 const f=qualityWorkspace();f.w.me=f.employee;
 const r=f.w.records.find(r=>r.kind==='close');
 assert.equal(currentFollowupFocus(f.w,'Switch topic: what is my availability?',at,{focus:{id:r.id,revision:1,kind:'close',title:'Close'},sources:[]}),undefined);
 for(const q of ['Do I need to do tomorrow’s list now?','Is that two full batches?','What is the last thing we are waiting on?'])assert.equal(operationalFollowup(q),true);
 for(const q of ['What is my time off?','Show a different shift instead'])assert.equal(operationalFollowup(q),false);
});
