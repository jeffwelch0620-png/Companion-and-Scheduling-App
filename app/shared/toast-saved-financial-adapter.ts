import {object, requireThat} from './validation';
import {toastSourceInstant} from './toast-source-time';
import {projectToastFinancialDay, missingToastFinancialDay} from './toast-financial-day';
import {validateToastDayMapping, type ToastDayScope, type ToastDayMapping} from './toast-day';

// Internal server-only input, matching integrations.toast_report_payloads.
// The caller supplies selected successful batches after authentication. This
// adapter performs no fetch, persistence, or authorization itself.
export type SavedFinancialEvidence={businessDayVerified:boolean;correctionsApplied:boolean;dayClosed:boolean;refundsReconciled:boolean};
const noEvidence:SavedFinancialEvidence={businessDayVerified:false,correctionsApplied:false,dayClosed:false,refundsReconciled:false};
function array(value:unknown):unknown[]{requireThat(Array.isArray(value),'Missing saved array.');return value;}
function bool(value:unknown):boolean{requireThat(typeof value==='boolean','Missing source status.');return value;}
function num(value:unknown):number{requireThat(typeof value==='number' && Number.isFinite(value) && value>=0,'Missing source amount.');return value;}
function cents(value:unknown):number{
  const amount=num(value)*100,rounded=Math.round(amount);
  requireThat(Number.isSafeInteger(rounded) && Math.abs(amount-rounded)<0.000001,'Unsupported source precision.');return rounded;
}
function unique(row:Record<string,unknown>,seen:Set<string>){requireThat(typeof row.guid==='string' && row.guid.length>0 && !seen.has(row.guid),'Duplicate or missing source identity.');seen.add(row.guid);}
function sourceDate(value:unknown,date:string){requireThat(String(value)===date.replaceAll('-',''),'Wrong source business date.');}
function batch(value:unknown,kind:'sales'|'labor',scope:ToastDayScope,mapping:ToastDayMapping,now:number){
  if(value===null)return null;
  const row=object(value);
  requireThat(row.report_kind===kind && row.toast_restaurant_guid===mapping.restaurantGuid && row.business_date===scope.businessDate,'Wrong saved batch scope.');
  const at=toastSourceInstant(row.fetched_at);requireThat(Date.parse(at)<=now,'Future saved batch.');
  const metadata=object(row.ingestion_metadata);
  return {rows:array(row.payload),at,paginationComplete:metadata.paginationComplete===true};
}
function calculateSales(rows:unknown[],date:string){
  let sales=0,discounts=0;
  const orders=new Set<string>(),checks=new Set<string>(),payments=new Set<string>(),discountIds=new Set<string>(),selectionIds=new Set<string>();
  function discountsAt(value:unknown){for(const raw of array(value)){const d=object(raw);unique(d,discountIds);requireThat(d.processingState===null || d.processingState==='APPLIED','Discount not finalized.');discounts+=cents(d.nonTaxDiscountAmount);}}
  function selection(raw:unknown,nested=false){
    const s=object(raw);unique(s,selectionIds);if(bool(s.voided))return 0;
    const deferred=bool(s.deferred);requireThat(typeof s.selectionType==='string','Missing selection classification.');
    if(deferred || s.selectionType==='HOUSE_ACCOUNT_PAY_BALANCE'){
      requireThat(!nested,'Nested deferred revenue requires review.');return cents(s.price);
    }
    discountsAt(s.appliedDiscounts);
    for(const modifier of array(s.modifiers))selection(modifier,true);
    return 0;
  }
  for(const raw of rows){
    const o=object(raw);unique(o,orders);sourceDate(o.businessDate,date);
    if(bool(o.voided) || bool(o.deleted) || bool(o.excessFood))continue;
    for(const rawCheck of array(o.checks)){
      const c=object(rawCheck);unique(c,checks);if(bool(c.voided) || bool(c.deleted))continue;
      let total=cents(c.amount);discountsAt(c.appliedDiscounts);
      for(const s of array(c.selections))total-=selection(s);
      for(const rawCharge of array(c.appliedServiceCharges)){
        const charge=object(rawCharge);requireThat(typeof charge.serviceChargeCategory==='string','Missing service-charge classification.');
        if(charge.serviceChargeCategory==='FUNDRAISING_CAMPAIGN')total-=cents(charge.chargeAmount);
      }
      for(const rawPayment of array(c.payments)){
        const p=object(rawPayment);unique(p,payments);requireThat(['NONE','PARTIAL','FULL'].includes(p.refundStatus as string),'Unverified refund status.');
        if(p.refundStatus!=='NONE'){
          const refund=object(p.refund);sourceDate(refund.refundBusinessDate,date);
          total-=cents(refund.refundAmount); // Never subtract tipRefundAmount.
        }else requireThat(p.refund===null || p.refund===undefined,'Conflicting refund fields.');
      }
      sales+=total;
    }
  }
  requireThat(Number.isSafeInteger(sales) && Number.isSafeInteger(discounts),'Saved totals exceed supported range.');
  return {sales,discounts};
}
function calculateLabor(rows:unknown[],date:string){
  let hours=0,regularPay=0,totalPay=0,regularKnown=true,totalKnown=true;
  const seen=new Set<string>();
  for(const raw of rows){
    const e=object(raw);unique(e,seen);sourceDate(e.businessDate,date);if(bool(e.deleted))continue;
    // An open time entry is not a finalized hours observation.
    toastSourceInstant(e.outDate);const regular=num(e.regularHours),overtime=num(e.overtimeHours);hours+=regular+overtime;
    if(e.hourlyWage===null || e.hourlyWage===undefined){regularKnown=false;totalKnown=false;continue;}
    const wage=num(e.hourlyWage),pay=regular*wage*100;
    requireThat(Number.isFinite(pay),'Unsupported labor amount.');regularPay+=pay;
    if(overtime>0)totalKnown=false; // Toast labor API exposes no overtime factor.
    totalPay+=pay;
  }
  requireThat(Number.isFinite(hours) && Number.isSafeInteger(Math.round(regularPay)) && Number.isSafeInteger(Math.round(totalPay)),'Unsupported labor total.');
  return {hours,regularPay:regularKnown?Math.round(regularPay):null,totalPay:totalKnown?Math.round(totalPay):null};
}
export function adaptSavedToastFinancialDay(input:{sales:unknown;labor:unknown;evidence?:SavedFinancialEvidence},scope:ToastDayScope,mapping:ToastDayMapping,now:number){
  validateToastDayMapping(mapping,scope);
  const e=input.evidence??noEvidence;
  for(const field of ['businessDayVerified','correctionsApplied','dayClosed','refundsReconciled'] as const)bool(e[field]);
  const sales=batch(input.sales,'sales',scope,mapping,now),labor=batch(input.labor,'labor',scope,mapping,now);
  let salesValues:ReturnType<typeof calculateSales>|null=null,laborValues:ReturnType<typeof calculateLabor>|null=null;
  // Invalid/missing payload fields withhold the affected feed, without exposing
  // provider values or employee details in diagnostics.
  try{if(sales)salesValues=calculateSales(sales.rows,scope.businessDate);}catch{salesValues=null;}
  try{if(labor)laborValues=calculateLabor(labor.rows,scope.businessDate);}catch{laborValues=null;}
  const evidence=(paginationComplete:boolean,refunds=false)=>({paginationComplete,correctionsApplied:e.businessDayVerified && e.correctionsApplied && (!refunds || e.refundsReconciled),dayClosed:e.businessDayVerified && e.dayClosed});
  const metric=(value:number|null,basis:string,ev:ReturnType<typeof evidence>)=>({value,basis,evidence:ev});
  const times=[sales?.at,labor?.at].filter((v):v is string=>typeof v==='string').sort();
  const day=!times.length?missingToastFinancialDay(scope):projectToastFinancialDay({schemaVersion:'jmax-toast-financial-day.v1',locationId:scope.locationId,businessDate:scope.businessDate,timezone:scope.timezone,source:{system:'toast',restaurantGuid:mapping.restaurantGuid},asOf:times[0],
    netSales:sales?metric(salesValues?.sales??null,'toast-net-sales-excluding-tax-tips-refunds-adjusted',evidence(sales.paginationComplete,true)):null,
    discounts:sales?metric(salesValues?.discounts??null,'toast-discounts-excluding-tax',evidence(sales.paginationComplete)):null,
    workedHours:labor?metric(laborValues?.hours??null,'actual-worked-hours-regular-plus-overtime',evidence(labor.paginationComplete)):null,
    laborSpend:labor?metric(laborValues?.totalPay??null,'gross-hourly-pay-including-overtime-excluding-salary-tax-benefits',evidence(labor.paginationComplete)):null,
  },scope,mapping,now);
  const regularComplete=!!labor?.paginationComplete && e.businessDayVerified && e.correctionsApplied && e.dayClosed;
  return {day,regularHourlyPayComponent:{state:laborValues?.regularPay===null || !laborValues?'unavailable':regularComplete?'available':'incomplete',value:regularComplete?(laborValues?.regularPay??null):null,unit:'cents',basis:'regular-hour-pay-only-excluding-overtime-salary-tax-benefits'},
    limitations:{sales:salesValues?'refund-and-closeout-evidence-required':'source-fields-unverified',labor:laborValues?.totalPay===null?'wages-salary-or-overtime-unverified':laborValues?'hourly-only-basis':'source-fields-unverified',upsells:'toast-native-mapping-access-unverified'}};
}
