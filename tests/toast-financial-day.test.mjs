import test from 'node:test';
import assert from 'node:assert/strict';
import {projectToastFinancialDay,aggregateToastFinancialDays,toastComparisonDate} from '../.sites-runtime/shared/toast-financial-day.mjs';
const now=Date.parse('2026-10-02T15:00:00Z');
const scope={locationId:'berts',businessDate:'2026-10-01',timezone:'America/New_York'};
const mapping={locationId:'berts',restaurantGuid:'6e09b799-f05e-4a86-9867-511b0bb23325',timezone:'America/New_York'};
function input(){
  const evidence={paginationComplete:true,correctionsApplied:true,dayClosed:true};
  return {schemaVersion:'jmax-toast-financial-day.v1',...scope,source:{system:'toast',restaurantGuid:mapping.restaurantGuid},asOf:'2026-10-02T10:00:00Z',
    netSales:{value:10000,basis:'toast-net-sales-excluding-tax-tips-refunds-adjusted',evidence},
    workedHours:{value:2,basis:'actual-worked-hours-regular-plus-overtime',evidence},
    laborSpend:{value:2000,basis:'gross-hourly-pay-including-overtime-excluding-salary-tax-benefits',evidence},
    discounts:{value:100,basis:'toast-discounts-excluding-tax',evidence}};
}
function project(row=input(),s=scope,m=mapping){return projectToastFinancialDay(row,s,m,now);}
test('absent, missing and incomplete financial data never become zero',()=>{
  const absent=project(null);assert.equal(absent.netSales.value,null);assert.equal(absent.coverage,'unavailable');
  const row=input();delete row.laborSpend;row.netSales.evidence={...row.netSales.evidence,correctionsApplied:false};
  const day=project(row);assert.equal(day.netSales.state,'incomplete');assert.equal(day.netSales.value,null);assert.equal(day.laborSpend.value,null);
  assert.equal(day.coverage,'provisional');
});
test('finalized historical coverage is usable despite observation age',()=>{
  const day=project();assert.equal(day.observationAge,'older');assert.equal(day.coverage,'finalized');assert.equal(day.netSales.value,10000);
  const row=input();row.netSales.evidence={...row.netSales.evidence,dayClosed:false};assert.equal(project(row).netSales.value,null);
});
test('group ratios use summed amounts and hours, not average daily ratios',()=>{
  const one=project(),row=input();row.businessDate='2026-09-30';row.netSales.value=30000;row.workedHours.value=10;row.laborSpend.value=9000;row.discounts.value=300;
  const two=project(row,{...scope,businessDate:row.businessDate});const group=aggregateToastFinancialDays([one,two]);
  assert.equal(group.netSales.value,40000);assert.ok(Math.abs(group.salesPerLaborHour.value-400/12)<1e-10);assert.ok(Math.abs(group.laborPercent.value-27.5)<1e-10);assert.equal(group.discountPercent.value,1);
  assert.deepEqual(group.period,{start:'2026-09-30',end:'2026-10-01'});
});
test('zero denominators yield unavailable ratios; explicit zero amounts remain available',()=>{
  const row=input();row.netSales.value=0;row.workedHours.value=0;row.laborSpend.value=0;row.discounts.value=0;
  const group=aggregateToastFinancialDays([project(row)]);assert.equal(group.netSales.state,'available');assert.equal(group.laborPercent.value,null);assert.equal(group.salesPerLaborHour.reason,'nonpositive-denominator');
});
test('only allowlisted aggregate fields pass; raw data, salary details and upsells do not',()=>{
  const row=input();row.orders=[{private:'secret'}];row.employees=[{wage:'secret'}];row.managerSalary='secret';row.source.token='secret';row.laborSpend.employeePay='secret';row.upsells={value:100};
  const day=project(row,{...scope,token:'secret'});assert.equal(JSON.stringify(day).includes('secret'),false);assert.deepEqual(day.upsells,{state:'unavailable',reason:'mapping-not-defined'});
});
test('scope, basis, timestamps and aggregate values are validated',()=>{
  for(const edit of [r=>r.locationId='rudds',r=>r.source.restaurantGuid='bad',r=>r.netSales.basis='gross-sales',r=>r.workedHours.value=-1,r=>r.laborSpend.value=1.5,r=>r.asOf='2026-10-03T00:00:00Z',r=>delete r.discounts.evidence.dayClosed]){
    const row=input();edit(row);assert.throws(()=>project(row));
  }
});
test('duplicate days and mixed pay bases cannot inflate or mislabel summaries',()=>{
  assert.throws(()=>aggregateToastFinancialDays([project(),project()]));
  const row=input();row.businessDate='2026-09-30';row.laborSpend.basis='gross-pay-including-salary-excluding-tax-benefits';
  assert.throws(()=>aggregateToastFinancialDays([project(),project(row,{...scope,businessDate:row.businessDate})]));
});
test('missing expected day withholds the affected aggregate and ratios',()=>{
  const missing=projectToastFinancialDay(null,{...scope,businessDate:'2026-09-30'},mapping,now);
  const group=aggregateToastFinancialDays([project(),missing]);assert.equal(group.netSales.value,null);assert.equal(group.laborPercent.value,null);assert.equal(group.coverage,'incomplete');assert.equal(group.asOf,null);
});
test('comparisons honor same weekday and Papa ordinal weekday without date fallback',()=>{
  assert.equal(toastComparisonDate('berts','2026-10-02'),'2026-09-25');assert.equal(toastComparisonDate('rudds','2026-01-02'),'2025-12-26');
  assert.equal(toastComparisonDate('papa','2026-10-02'),'2025-10-03');assert.equal(toastComparisonDate('papa','2026-10-30'),'2025-10-31');assert.equal(toastComparisonDate('papa','2026-08-31'),null);
  assert.throws(()=>toastComparisonDate('unknown','2026-10-02'));
});
