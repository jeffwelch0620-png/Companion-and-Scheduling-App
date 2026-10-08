import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedHypotheticalScheduleScope} from '../.sites-runtime/shared/schedule-sales.mjs';

const question='New weekly labor scenario, not live restaurant data: $62000 weekly sales, 900 published hours and 20 additional draft hours. My saved GM view may show only my own schedule. Calculate sales per published hour and per planned hour and explain the difference without treating drafts as published or using whole-store sales with my restricted saved hours.';

test('fourth real GM scope regression cannot attribute hypothetical hours to saved own schedule',()=>{
 const raw='Sales per published hour is $68.89 and planned is $67.39. Your saved GM view is an own-schedule view, so these hours are the restricted hours in that snapshot, not whole-store hours.';
 const answer=checkedHypotheticalScheduleScope(question,raw);
 assert.match(answer,/\$68\.89/);assert.match(answer,/\$67\.39/);
 assert.match(answer,/900 \+ 20 = 920/);
 assert.match(answer,/quantities came from your question/);
 assert.match(answer,/not a readout of the saved GM schedule/);
 assert.doesNotMatch(answer,/these hours are the restricted hours/i);
 assert.match(answer,/same restaurant, week and department scope/);
});

test('direct self-contained hypothetical boundary works on readback without prior context',()=>{
 const q='Use a hypothetical $45,000 weekly sales, 650 published hours and 50 draft hours. Calculate sales per published hour and per planned hour; my saved view might only include me.';
 const answer=checkedHypotheticalScheduleScope(q,'Using your own saved 650 hours gives $69.23.');
 assert.match(answer,/\$69\.23/);assert.match(answer,/\$64\.29/);
 assert.match(answer,/650 \+ 50 = 700/);
 assert.match(answer,/Drafts are not published hours/);
 assert.match(answer,/not a labor percentage or staffing decision/);
 assert.equal(checkedHypotheticalScheduleScope(q,answer),answer);
});

test('ambiguous, actual-saved, unrelated and labor-cost questions remain outside the productivity guard',()=>{
 const raw='Current authorized schedule facts and provenance stay as supplied.';
 for(const q of [
  'Read my actual saved schedule: $62000 weekly sales, 900 published hours and 20 draft hours. Calculate sales per published hour and per planned hour.',
  'Hypothetical $62000 weekly sales with 900–950 published hours and 20 draft hours. Calculate sales per published hour and per planned hour.',
  'Hypothetical $62000–$64000 weekly sales, 900 published hours and 20 draft hours. Calculate sales per published hour and per planned hour.',
  'Hypothetical €62000 weekly sales, 900 published hours and 20 draft hours. Calculate sales per published hour and per planned hour.',
  'Hypothetical -$62000 weekly sales, 900 published hours and 20 draft hours. Calculate sales per published hour and per planned hour.',
  'Hypothetical $62000 weekly sales or $64000 weekly sales, 900 published hours and 20 draft hours. Calculate sales per published hour and per planned hour.',
  'Hypothetical $62000 weekly sales, 900 published hours or 950 published hours, and 20 draft hours. Calculate sales per published hour and per planned hour.',
  'On the same hypothetical sales/hour scope use $23/hour and a32% labor target. Calculate labor percentage.',
  'Who owns the closing task now?'
 ])assert.equal(checkedHypotheticalScheduleScope(q,raw),raw,q);
});
