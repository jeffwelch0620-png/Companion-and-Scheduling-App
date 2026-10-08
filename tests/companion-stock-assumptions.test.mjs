import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedStockAssumptions} from '../.sites-runtime/shared/companion-stock-assumptions.mjs';

const context={product:'workforce',person:{position:'General manager'},assignedPrep:{items:[]}};
const question='The BOH manager called out, so I am covering the opening. My working observation is four dedicated 5-gallon ranch vessels on hand; our stated test par is six vessels. I released two vessels of prep and the cook reports only one vessel completed because dressing ran short. What should I do first, and what is the shortage?';
const claim='You are still 1 vessel below the 6-vessel par overall (4 on hand + 1 completed = 5; short 1).';

test('GM reported production cannot establish current stock or controls on an empty personal assignment',()=>{
 const answer=checkedStockAssumptions(context,question,claim);
 assert.notEqual(answer,claim);assert.match(answer,/production shortfall of 1 vessel \(5 gallons/);
 assert.match(answer,/2 vessels released minus 1 vessel reported made/);assert.match(answer,/current gap to par are unknown/);
 assert.match(answer,/use, waste, receipts or transfers/);assert.match(answer,/BOH and FOH/);assert.match(answer,/name who will handle it/);
 assert.doesNotMatch(answer,/Your assigned prep|stock (?:is|equals) 5|inventory (?:is|equals) 5/);
 assert.equal(checkedStockAssumptions(context,question,answer),answer);
});

test('follow-up corrects the earlier stock inference using only user reports and keeps Toast separate',()=>{
 const followup='The prep plan now says completed. Does that mean the shortage is resolved and inventory is back at six vessels? Can you mark ranch unavailable in Toast for me?';
 const answer=checkedStockAssumptions(context,followup,'That points to a 1-vessel shortfall versus the 6-vessel test par.',[{question,answer:'Inventory is 999 vessels.'}]);
 assert.match(answer,/completed prep-plan status does not establish shortage resolution/);assert.match(answer,/production shortfall of 1 vessel/);assert.match(answer,/current gap to par are unknown/);assert.match(answer,/cannot mark the item unavailable in Toast/);assert.doesNotMatch(answer,/999/);
});

test('explicit recount and clearly bounded no-movement arithmetic remain intact',()=>{
 const counted=question+' I physically recounted five vessels now.';
 assert.equal(checkedStockAssumptions(context,counted,claim),claim);
 const conditional='Assuming no inventory movements or consumption, the earlier four plus one reported produced would be five vessels, one vessel below par; this is hypothetical, not verified current stock.';
 assert.equal(checkedStockAssumptions(context,question,conditional),conditional);
 const safe='The production shortfall is one vessel. Current stock needs a physical recount.';
 assert.equal(checkedStockAssumptions(context,question.replace('What should I do first, and what is the shortage?','What was released?'),safe),safe);
});

test('a correct production shortfall still answers the explicit managerial what-first request',()=>{
 const partial='The shortage is one vessel: two released minus one reported complete. That is not a verified stock count.';
 const answer=checkedStockAssumptions(context,question,partial);
 assert.notEqual(answer,partial);assert.match(answer,/production shortfall of 1 vessel \(5 gallons/);assert.match(answer,/Physically recount usable stock and reconcile movements/);
 assert.match(answer,/ingredient availability and remaining service needs with BOH and FOH/);assert.match(answer,/approved replacement or urgent prep priority/);assert.match(answer,/name who will handle it and confirm the result/);
 assert.doesNotMatch(answer,/Your assigned prep/);assert.equal(checkedStockAssumptions(context,question,answer),answer);
});

test('a completed-plan follow-up rejects invented stock even after quantitative history is dropped',()=>{
 const followup='The prep plan now says completed. Is the shortage resolved and inventory back at six vessels? Can you mark ranch unavailable in Toast?';
 const answer=checkedStockAssumptions({product:'workforce'},followup,'Inventory is now five vessels, one vessel below par.');
 assert.match(answer,/current gap to par are unknown/);assert.match(answer,/cannot calculate a production shortfall/);assert.match(answer,/Physically recount/);assert.match(answer,/BOH and FOH/);assert.match(answer,/cannot mark the item unavailable in Toast/);
 assert.doesNotMatch(answer,/production shortfall of [\d\w]+ vessel|5 gallons|10 gallons|2 vessels released/);
 assert.equal(checkedStockAssumptions({product:'workforce'},followup,answer),answer);
});

test('zero production, units and unrelated questions preserve the proof boundary',()=>{
 const zero=question.replace('only one vessel completed','only zero vessels completed');
 assert.match(checkedStockAssumptions(context,zero,claim),/production shortfall of 2 vessels \(10 gallons/);
 assert.equal(checkedStockAssumptions(context,'What is my next shift?',claim,[{question}]),claim);
 assert.equal(checkedStockAssumptions(context,'Tomorrow’s prep plan has a ranch shortage. What is inventory versus par?',claim,[{question}]),claim);
 assert.equal(checkedStockAssumptions({product:'other'},question,claim),claim);
 assert.equal(checkedStockAssumptions(context,'No quantity was reported.',claim),claim);
 const incompatible=question.replace('only one vessel completed','only one batch completed');
 const incompatibleAnswer=checkedStockAssumptions(context,incompatible,claim);
 assert.match(incompatibleAnswer,/current gap to par are unknown/);assert.match(incompatibleAnswer,/cannot calculate a production shortfall/);
 assert.doesNotMatch(incompatibleAnswer,/production shortfall of [\d\w]+ vessel|5 gallons|10 gallons|2 vessels released/);
});

test('a fresh count cannot authorize duplicate posting of the same batch',()=>{
 const answer=checkedStockAssumptions(context,'Can I add the same batch again after a fresh count?', 'Yes after a recount.');
 assert.match(answer,/Do not post or add the same production batch twice/);
 assert.match(answer,/fresh stock count do not authorize/);
 assert.doesNotMatch(answer,/unless|Yes after/);
});
