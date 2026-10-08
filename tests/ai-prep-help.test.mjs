import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {checkedPrepHelp} from '../.sites-runtime/shared/companion-prep-help.mjs';
const capture=JSON.parse(fs.readFileSync(new URL('../evidence/ai-week/prep-cook-replies-fixed.json',import.meta.url)));
const turn=(day,index=1)=>structuredClone(capture.results.find(r=>r.day===day).turns[index]);
const check=t=>checkedPrepHelp(t.context,t.sources,t.question,t.answer);

test('tomorrow-now priority uses current dates and quantities, never future release as urgency',()=>{
 const t=turn(5),answer=check(t);
 assert.notEqual(answer,t.answer);assert.match(answer,/does not tell you to start tomorrow’s prep now/);assert.match(answer,/2026-10-16.*Portioned ranch — 4 3.25 fl oz portion/);assert.match(answer,/2026-10-17.*Julienne green pepper — 1 dedicated lidded bus-tub vessel.*Ranch — 2 5-gallon vessel/);assert.match(answer,/unless your assigned manager directs/);assert.match(answer,/ask your assigned manager to confirm the priority/);
 const asOfLater=structuredClone(t);asOfLater.context.asOf='2026-10-17T20:00:00Z';assert.match(check(asOfLater),/Today \(2026-10-17\).*Julienne green pepper/);
});

test('earlier recorded zero shortage needs manager confirmation, never recipe-only or presumed resolution',()=>{
 const t=turn(4),answer=check(t);
 assert.match(answer,/does not prove.*fixed/);assert.match(answer,/Ask your assigned manager directly whether the ingredient is available/);assert.match(answer,/replacement prep/);assert.match(answer,/remaining service need/);assert.match(answer,/yesterday’s reported actual result separate/);assert.match(answer,/does not save.*notify/);assert.doesNotMatch(answer,/check.*recipe card/i);
 t.context.assignedPrep.managerLabel='Dana (fictional BOH manager)';assert.match(check(t),/Ask Dana \(fictional BOH manager\) directly/);
 const earlier=check(turn(4,0));assert.match(earlier,/2026-10-15: Portioned ranch — 4/);assert.match(earlier,/yesterday’s reported actual quantity and shortage separate/);assert.match(earlier,/Ask your assigned manager directly whether the ingredient is now available/);assert.doesNotMatch(earlier,/Enter actual quantity 0/);
});

test('actual short report uses exact current assignment unit and manager next action',()=>{
 const t=turn(2,0),answer=check(t);
 assert.match(answer,/select Ranch dated 2026-10-13/);assert.match(answer,/actual quantity 1 in its 5-gallon vessel unit/);assert.match(answer,/shortfall is 1 5-gallon vessel/);assert.match(answer,/Save the actual completion report/);assert.match(answer,/Tell your assigned manager directly/);assert.match(answer,/does not save completion.*notify/);
});

test('zero production is recorded in actual quantity field, not just note or false planned output',()=>{
 const t=turn(2,0);t.question='My ranch ingredient is unavailable and I made zero. How do I report that accurately?';t.context.assignedPrep.items=t.context.assignedPrep.items.filter(item=>item.title==='Ranch');t.context.evidence.find(e=>e.source.kind==='food-prep').facts.items=t.context.assignedPrep.items;
 const answer=check(t);assert.match(answer,/actual quantity 0 in its 5-gallon vessel unit/);assert.match(answer,/shortfall is 2 5-gallon vessel/);assert.match(answer,/ingredient-unavailable reason you reported/);assert.match(answer,/note alone is not a substitute/);assert.match(answer,/confirm ingredient availability/);
 t.question='If I tell you zero here, is the prep already recorded and does Morgan get this conversation?';assert.match(check(t),/does not save completion, notify the manager, send this conversation/);
});

test('ambiguous report does not choose a unit or a different assigned line',()=>{
 const t=turn(2,0);t.question='I made zero. How should I report that?';const answer=check(t);
 assert.match(answer,/cannot choose among multiple released lines/);assert.match(answer,/selected item’s listed unit/);assert.doesNotMatch(answer,/select Ranch dated/);
 t.question='I made zero ranch and julienne green pepper. How should I report that?';assert.match(check(t),/cannot choose among multiple released lines/);
 t.context.assignedPrep.items=[t.context.assignedPrep.items.find(item=>item.title==='Ranch')];t.context.assignedPrep.items.push({...t.context.assignedPrep.items[0],targetDate:'2026-10-14',planId:'different-date'});t.context.evidence.find(e=>e.source.kind==='food-prep').facts.items=t.context.assignedPrep.items;t.question='I made zero ranch. How should I report that?';assert.match(check(t),/cannot choose among multiple released lines/);
});

test('uncited, stale, unrelated, or non-shortfall evidence stays with the original answer',()=>{
 const t=turn(5);for(const sources of [[],t.sources.map(s=>({...s,revision:999}))])assert.equal(checkedPrepHelp(t.context,sources,t.question,t.answer),t.answer);
 t.context.assignedPrep.items[0].quantity=99;assert.equal(check(t),t.answer);
 const unrelated=turn(1);unrelated.question='When does my shift end?';assert.equal(check(unrelated),unrelated.answer);
 unrelated.question='I completed one learning goal. How do I report it?';assert.equal(check(unrelated),unrelated.answer);
 const full=turn(2,0);full.question='I made two ranch vessels. How do I report that?';assert.equal(check(full),full.answer);
 const retired=turn(7);assert.equal(check(retired),retired.answer);
});

test('empty personal prep preserves actual GM completed-plan inventory/POS follow-up and never offers phantom recording controls',()=>{
 const gm=JSON.parse(fs.readFileSync(new URL('../evidence/ai-week/gm-replies-final.json',import.meta.url)));
 const t=gm.results.find(r=>r.day===1).turns[1];
 assert.deepEqual(t.context.assignedPrep.items,[]);
 assert.equal(checkedPrepHelp(t.context,t.sources,t.question,t.rawAnswer),t.rawAnswer);
 const empty=turn(2,0);empty.context.assignedPrep.items=[];empty.context.evidence.find(e=>e.source.kind==='food-prep').facts.items=[];
 for(const question of ['I made zero ranch. How do I report that?','Do I need tomorrow’s prep now?','Yesterday I recorded zero because an ingredient was missing. What needs doing today?','Does the completed plan mean the shortage is resolved?'])assert.equal(checkedPrepHelp(empty.context,empty.sources,question,'No personal prep assignment is supplied; confirm the responsible work.'),'No personal prep assignment is supplied; confirm the responsible work.');
 empty.context.assignedPrep.items=[{title:'Invalid unit',quantity:1,targetDate:'2026-10-13'}];empty.context.evidence.find(e=>e.source.kind==='food-prep').facts.items=empty.context.assignedPrep.items;
 assert.equal(checkedPrepHelp(empty.context,empty.sources,'I made zero. How do I report that?','No valid personal assignment.'),'No valid personal assignment.');
});
