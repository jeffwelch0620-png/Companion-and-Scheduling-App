import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptSavedToastFinancialDay} from '../.sites-runtime/shared/toast-saved-financial-adapter.mjs';
const scope={locationId:'berts',businessDate:'2026-10-01',timezone:'America/New_York'},mapping={...scope,restaurantGuid:'6e09b799-f05e-4a86-9867-511b0bb23325'};
const now=Date.parse('2026-10-02T15:00:00Z');
const evidence={businessDayVerified:true,correctionsApplied:true,dayClosed:true,refundsReconciled:true};
// Synthetic fields follow Toast's public Order/Check/Selection/TimeEntry schemas;
// these are not real restaurant receipts or employees.
const selection=(guid,extra={})=>({guid,voided:false,deferred:false,selectionType:'NONE',price:10,appliedDiscounts:[],modifiers:[],...extra});
const discount=(guid,amount)=>({guid,processingState:null,discountAmount:amount+0.1,nonTaxDiscountAmount:amount});
function input(){
  const base={toast_restaurant_guid:mapping.restaurantGuid,business_date:scope.businessDate,fetched_at:'2026-10-02T10:00:00Z',ingestion_metadata:{paginationComplete:true}};
  return {evidence,sales:{...base,report_kind:'sales',payload:[{guid:'order',businessDate:20261001,voided:false,deleted:false,excessFood:false,checks:[{guid:'check',voided:false,deleted:false,amount:100,
    appliedDiscounts:[discount('check-discount',2)],selections:[selection('food',{appliedDiscounts:[discount('item-discount',1)],modifiers:[selection('modifier',{appliedDiscounts:[discount('modifier-discount',0.5)]})]}),selection('gift',{deferred:true,price:20}),selection('house',{selectionType:'HOUSE_ACCOUNT_PAY_BALANCE',price:10})],
    appliedServiceCharges:[{serviceChargeCategory:'FUNDRAISING_CAMPAIGN',chargeAmount:5}],payments:[{guid:'payment',refundStatus:'PARTIAL',refund:{refundBusinessDate:20261001,refundAmount:4,tipRefundAmount:9}}]}]}]},
    labor:{...base,report_kind:'labor',payload:[{guid:'entry',businessDate:'20261001',deleted:false,outDate:'2026-10-01T20:00:00Z',regularHours:2,overtimeHours:0,hourlyWage:15,employeeReference:{guid:'private-person'}}]}};
}
const adapt=(i=input())=>adaptSavedToastFinancialDay(i,scope,mapping,now);
test('validated synthetic saved arrays produce adjusted sales, tax-exclusive discounts and aggregate hours/pay',()=>{
  const result=adapt();assert.equal(result.day.netSales.value,6100);assert.equal(result.day.discounts.value,350);assert.equal(result.day.workedHours.value,2);assert.equal(result.day.laborSpend.value,3000);
  assert.equal(result.regularHourlyPayComponent.value,3000);assert.equal(result.day.observationAge,'older');
});
test('existing pagination metadata alone cannot finalize financial values',()=>{
  const i=input();delete i.evidence;const r=adapt(i);assert.equal(r.day.netSales.state,'incomplete');assert.equal(r.day.netSales.value,null);assert.equal(r.day.workedHours.value,null);assert.equal(r.regularHourlyPayComponent.value,null);
  i.evidence={...evidence,refundsReconciled:false};const d=adapt(i).day;assert.equal(d.netSales.value,null);assert.equal(d.discounts.value,350);
});
test('no invented overtime factor or salary wages; hours and regular component remain distinct',()=>{
  const i=input();i.labor.payload[0].overtimeHours=1;let r=adapt(i);assert.equal(r.day.workedHours.value,3);assert.equal(r.day.laborSpend.value,null);assert.equal(r.regularHourlyPayComponent.value,3000);
  i.labor.payload[0].hourlyWage=null;r=adapt(i);assert.equal(r.day.workedHours.value,3);assert.equal(r.day.laborSpend.value,null);assert.equal(r.regularHourlyPayComponent.value,null);
});
test('unfinished labor, missing monetary fields, duplicates and cross-day refunds withhold affected feed',()=>{
  for(const edit of [i=>i.labor.payload[0].outDate=null,i=>i.labor.payload.push({...i.labor.payload[0]}),i=>delete i.labor.payload[0].regularHours]){
    const i=input();edit(i);assert.equal(adapt(i).day.workedHours.value,null);
  }
  for(const edit of [i=>delete i.sales.payload[0].checks[0].amount,i=>i.sales.payload.push({...i.sales.payload[0]}),i=>i.sales.payload[0].checks[0].payments[0].refund.refundBusinessDate=20260930]){
    const i=input();edit(i);assert.equal(adapt(i).day.netSales.value,null);
  }
});
test('deleted/void/excess-food orders and deleted labor cannot inflate totals',()=>{
  const i=input();for(const [guid,key] of [['void','voided'],['deleted','deleted'],['excess','excessFood']])i.sales.payload.push({...i.sales.payload[0],guid,[key]:true});
  i.labor.payload.push({...i.labor.payload[0],guid:'deleted-entry',deleted:true});const r=adapt(i);assert.equal(r.day.netSales.value,6100);assert.equal(r.day.workedHours.value,2);
});
test('empty verified arrays yield explicit zero; absent feeds stay unknown',()=>{
  const i=input();i.sales.payload=[];i.labor.payload=[];assert.equal(adapt(i).day.netSales.value,0);assert.equal(adapt(i).day.laborSpend.value,0);
  i.sales=null;i.labor=null;assert.equal(adapt(i).day.coverage,'unavailable');
});
test('source scope is rejected and raw/pay/upsell fields never escape',()=>{
  const i=input();i.labor.payload[0].employeeReference.guid='SECRET-EMPLOYEE';i.sales.payload[0].token='SECRET-TOKEN';
  const text=JSON.stringify(adapt(i));assert.equal(text.includes('SECRET'),false);assert.equal(text.includes('hourlyWage'),false);assert.equal(text.includes('employeeReference'),false);
  assert.equal(adapt(i).day.upsells.state,'unavailable');i.sales.business_date='2026-09-30';assert.throws(()=>adapt(i));
});
