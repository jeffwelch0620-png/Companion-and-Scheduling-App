import test from 'node:test';
import assert from 'node:assert/strict';
// This dependency-free source module is directly checked with Node's native
// TypeScript stripping; no shared runtime generation or provider call occurs.
import {checkedStockAssumptions,stockAssumptionInstructions} from '../app/shared/companion-stock-assumptions.ts';

const context={product:'workforce',assignedPrep:{items:[{title:'Ranch',quantity:2,unit:'5-gallon vessel',targetDate:'2026-10-23'}]}};
const question='My working observation yesterday was four five-gallon ranch vessels, and I reported one vessel made later. Can you confirm that we currently have five and only need one more to hit six?';
const conditional='Under a no-movement, no-use assumption only, 4 observed + 1 made = 5 vessels; that is hypothetical, not verified current stock.';
const wrong='For a real count, you would need a fresh count or a reconciled movement balance, then record the actual quantity in Your assigned prep.';

test('delivered fourth replay count-to-production error is corrected without losing bounded arithmetic',()=>{
 const answer=checkedStockAssumptions(context,question,conditional+'\n\n'+wrong);
 assert.match(answer,/4 observed \+ 1 made = 5 vessels/);
 assert.doesNotMatch(answer,/then record the actual quantity in Your assigned prep/);
 assert.match(answer,/only in the authorized stock-count workflow/);
 assert.match(answer,/only food actually made for that dated production assignment/);
 assert.match(answer,/including actual zero/);assert.match(answer,/Never put counted on-hand stock/);
 assert.match(answer,/does not save either record/);
 assert.equal(checkedStockAssumptions(context,question,answer),answer);
});

test('a physically recounted value still cannot become production actual',()=>{
 const answer=checkedStockAssumptions(context,'I physically recounted five vessels now. Where does that stock count go?',wrong);
 assert.notEqual(answer,wrong);assert.match(answer,/stock-count workflow/);
 assert.doesNotMatch(answer,/actual quantity (?:is|equals) 5/);
});

test('zero counted stock is distinct from an actual zero-production report',()=>{
 const answer=checkedStockAssumptions(context,'My current stock count is zero. How do I record it?','Save the zero stock count as prep actual quantity.');
 assert.match(answer,/only food actually made/);assert.match(answer,/counted on-hand stock/);
 assert.doesNotMatch(answer,/Save the zero stock count as prep actual quantity/);
});

test('legitimate current made-quantity reporting remains unchanged alongside a count',()=>{
 const answer='After a fresh stock count, record the actual quantity you produced in Your assigned prep with a truthful difference reason.';
 assert.equal(checkedStockAssumptions(context,question,answer),answer);
 const zero='Enter actual quantity 0 for the food actually made in Your assigned prep; separately count usable stock.';
 assert.equal(checkedStockAssumptions(context,'I made zero and still need a stock count.',zero),zero);
});

test('existing correct prohibitions and hypothetical arithmetic are preserved',()=>{
 const answer='Do not record a stock count in Your assigned prep actual quantity. That field records production.';
 assert.equal(checkedStockAssumptions(context,question,answer),answer);
 assert.equal(checkedStockAssumptions(context,question,conditional),conditional);
});

test('missing permissions or stock method do not invent count controls or amounts',()=>{
 const answer=checkedStockAssumptions({product:'workforce',assignedPrep:{items:[]}},question,wrong);
 assert.match(answer,/Ask the responsible manager where to record it/);
 assert.doesNotMatch(answer,/Open (?:Food|Inventory)|saved (?:stock|actual)|notify|grant/);
 assert.equal(checkedStockAssumptions({product:'other'},question,wrong),wrong);
 assert.equal(checkedStockAssumptions(context,'What is my next shift?',wrong),wrong);
});

test('prompt instruction explicitly distinguishes on-hand count and actual made quantity',()=>{
 assert.match(stockAssumptionInstructions,/never in Your assigned prep actual quantity/);
 assert.match(stockAssumptionInstructions,/only food actually made/);
});
