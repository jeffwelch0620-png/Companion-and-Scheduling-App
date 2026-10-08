import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleSalesCheck} from '../.sites-runtime/shared/schedule-sales.mjs';
const hours={scope:'restaurant',publishedMinutes:67125,plannedMinutes:68325,draftMinutes:1200};
test('a 56k week is a stated sales assumption with deterministic hours and productivity, not a labor budget',()=>{
 for(const q of ['Can you do a check and see of the scheduled hours look good against a 56k week','How do hours compare to $56,000 weekly sales?','weekly revenue of 56 thousand']){
  const s=scheduleSalesCheck(q,hours);assert.equal(s.weeklySales,56000);assert.equal(s.published.scheduledHours,1118.75);assert.equal(s.published.salesPerScheduledHour,50.06);assert.equal(s.plannedIncludingDrafts.scheduledHours,1138.75);assert.equal(s.includesDrafts,true);
 }
 assert.equal(scheduleSalesCheck('against a 56.5k week',hours).weeklySales,56500);
 assert.equal(scheduleSalesCheck('against a $56k week',{...hours,publishedMinutes:0}).published.salesPerScheduledHour,null);
});
test('ambiguous money, labor budgets and partial permission scopes do not become restaurant sales calculations',()=>{
 for(const q of ['56k labor budget','Is a 56k labor week okay?','$56k–$60k week','56k or 60k weekly sales','-$56k week','€56k week','CAD 56k week','56k employees each week','56000 hours this week','a 0k week','a 999999999k week','nothing about sales'])assert.equal(scheduleSalesCheck(q,hours),null,q);
 for(const scope of ['own schedule','authorized departments'])assert.equal(scheduleSalesCheck('a 56k week',{...hours,scope}),null);
});
