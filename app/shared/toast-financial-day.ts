import {instant, object, requireThat} from './validation';
import {calendarDate} from './schedule-policy';
import {validateToastDayMapping, type ToastDayMapping, type ToastDayScope} from './toast-day';

// Aggregate-only boundary. An authenticated server adapter must calculate these
// amounts; raw Toast orders/time entries and employee pay never cross it.
export type FinancialBasis = 'toast-net-sales-excluding-tax-tips-refunds-adjusted' |
  'actual-worked-hours-regular-plus-overtime' |
  'gross-hourly-pay-including-overtime-excluding-salary-tax-benefits' |
  'gross-pay-including-salary-excluding-tax-benefits' |
  'toast-discounts-excluding-tax';
type Evidence = {paginationComplete:boolean; correctionsApplied:boolean; dayClosed:boolean};
type Metric = {state:'unavailable'|'incomplete'|'available'; value:number|null; unit:'cents'|'hours'; basis:FinancialBasis|null; evidence:Evidence|null};
export type FinancialDay = {
  schemaVersion:'jmax-toast-financial-day.v1'; locationId:string; businessDate:string; timezone:string;
  asOf:string|null; coverage:'unavailable'|'provisional'|'finalized'; observationAge:'unknown'|'recent'|'older';
  netSales:Metric; workedHours:Metric; laborSpend:Metric; discounts:Metric;
  upsells:{state:'unavailable'; reason:'mapping-not-defined'};
};
const bases = {
  netSales:['toast-net-sales-excluding-tax-tips-refunds-adjusted'],
  workedHours:['actual-worked-hours-regular-plus-overtime'],
  laborSpend:['gross-hourly-pay-including-overtime-excluding-salary-tax-benefits','gross-pay-including-salary-excluding-tax-benefits'],
  discounts:['toast-discounts-excluding-tax'],
} as const;
type MetricName=keyof typeof bases;
function unavailable(unit:'cents'|'hours'):Metric {return {state:'unavailable',value:null,unit,basis:null,evidence:null};}
function metric(value:unknown,name:MetricName):Metric {
  const unit=name==='workedHours'?'hours':'cents';
  if(value===null || value===undefined)return unavailable(unit);
  const row=object(value), e=object(row.evidence);
  requireThat((bases[name] as readonly unknown[]).includes(row.basis),'Unsupported financial basis.');
  for(const key of ['paginationComplete','correctionsApplied','dayClosed'])requireThat(typeof e[key]==='boolean','Financial completeness evidence is required.');
  const evidence:Evidence={paginationComplete:e.paginationComplete as boolean,correctionsApplied:e.correctionsApplied as boolean,dayClosed:e.dayClosed as boolean};
  if(row.value===null)return {state:'unavailable',value:null,unit,basis:row.basis as FinancialBasis,evidence};
  requireThat(typeof row.value==='number' && Number.isFinite(row.value) && (unit==='hours'?row.value>=0:Number.isSafeInteger(row.value)) && (name==='netSales' || row.value>=0),'Invalid financial aggregate.');
  const complete=evidence.paginationComplete && evidence.correctionsApplied && evidence.dayClosed;
  return {state:complete?'available':'incomplete',value:complete?row.value as number:null,unit,basis:row.basis as FinancialBasis,evidence};
}
export function missingToastFinancialDay(scope:ToastDayScope):FinancialDay {
  return {schemaVersion:'jmax-toast-financial-day.v1',locationId:scope.locationId,businessDate:scope.businessDate,timezone:scope.timezone,asOf:null,coverage:'unavailable',observationAge:'unknown',netSales:unavailable('cents'),workedHours:unavailable('hours'),laborSpend:unavailable('cents'),discounts:unavailable('cents'),upsells:{state:'unavailable',reason:'mapping-not-defined'}};
}
export function projectToastFinancialDay(value:unknown,scope:ToastDayScope,mapping:ToastDayMapping,now:number):FinancialDay {
  validateToastDayMapping(mapping,scope);
  calendarDate(scope.businessDate,'Business date');
  if(value===null)return missingToastFinancialDay(scope);
  const row=object(value),source=object(row.source), asOf=instant(row.asOf);
  requireThat(row.schemaVersion==='jmax-toast-financial-day.v1','Unsupported financial response.');
  requireThat(row.locationId===scope.locationId && row.businessDate===scope.businessDate && row.timezone===scope.timezone && source.system==='toast' && source.restaurantGuid===mapping.restaurantGuid,'Financial response scope does not match.');
  requireThat(Number.isFinite(now) && Date.parse(asOf)<=now,'Invalid financial observation time.');
  const netSales=metric(row.netSales,'netSales'),workedHours=metric(row.workedHours,'workedHours'),laborSpend=metric(row.laborSpend,'laborSpend'),discounts=metric(row.discounts,'discounts');
  const metrics=[netSales,workedHours,laborSpend,discounts];
  // Older finalized days remain usable as history. Age alone is not evidence
  // that the business date is incomplete; late corrections still need ingestion.
  const coverage=metrics.every(m=>m.state==='available')?'finalized':metrics.every(m=>m.state==='unavailable')?'unavailable':'provisional';
  return {schemaVersion:'jmax-toast-financial-day.v1',locationId:scope.locationId,businessDate:scope.businessDate,timezone:scope.timezone,asOf,coverage,observationAge:now-Date.parse(asOf)>1800000?'older':'recent',netSales,workedHours,laborSpend,discounts,upsells:{state:'unavailable',reason:'mapping-not-defined'}};
}
function sum(days:FinancialDay[],name:MetricName):Metric {
  const rows=days.map(d=>d[name]),unit=name==='workedHours'?'hours':'cents';
  if(!rows.length || rows.some(m=>m.state!=='available' || m.value===null))return unavailable(unit);
  requireThat(rows.every(m=>m.basis===rows[0].basis),'Cannot combine different financial bases.');
  const value=rows.reduce((total,m)=>total+(m.value as number),0);
  requireThat(Number.isFinite(value) && (unit==='hours' || Number.isSafeInteger(value)),'Financial aggregate exceeds supported range.');
  return {state:'available',value,unit,basis:rows[0].basis,evidence:{paginationComplete:true,correctionsApplied:true,dayClosed:true}};
}
function ratio(numerator:Metric,denominator:Metric,multiplier:number){
  if(numerator.value===null || denominator.value===null)return {state:'unavailable' as const,value:null,reason:'missing-aggregate' as const};
  if(denominator.value<=0)return {state:'unavailable' as const,value:null,reason:'nonpositive-denominator' as const};
  const value=numerator.value/denominator.value*multiplier;
  requireThat(Number.isFinite(value),'Financial ratio exceeds supported range.');
  return {state:'available' as const,value,reason:null};
}
// Call with the complete expected set of restaurant-days, using missing records
// for absent days. This function cannot infer omitted restaurants or dates.
export function aggregateToastFinancialDays(days:FinancialDay[]){
  const keys=days.map(d=>`${d.locationId}:${d.businessDate}`);
  requireThat(new Set(keys).size===keys.length,'Duplicate financial day.');
  const netSales=sum(days,'netSales'),workedHours=sum(days,'workedHours'),laborSpend=sum(days,'laborSpend'),discounts=sum(days,'discounts');
  return {schemaVersion:'jmax-toast-financial-summary.v1' as const,
    period:days.length?{start:days.map(d=>d.businessDate).sort()[0],end:days.map(d=>d.businessDate).sort().at(-1)}:null,
    restaurantDays:keys,asOf:days.length && days.every(d=>d.asOf!==null)?days.map(d=>d.asOf as string).sort()[0]:null,
    coverage:days.length && days.every(d=>d.coverage==='finalized')?'finalized':'incomplete',
    netSales,workedHours,laborSpend,discounts,
    salesPerLaborHour:{...ratio(netSales,workedHours,0.01),unit:'dollars-per-hour'},laborPercent:{...ratio(laborSpend,netSales,100),unit:'percent'},discountPercent:{...ratio(discounts,netSales,100),unit:'percent-of-net-sales'},
    upsells:{state:'unavailable' as const,reason:'mapping-not-defined' as const}};
}
export function toastComparisonDate(locationId:string,businessDate:string):string|null {
  calendarDate(businessDate,'Business date');
  const date=new Date(`${businessDate}T12:00:00Z`);
  if(locationId==='berts' || locationId==='rudds'){date.setUTCDate(date.getUTCDate()-7);return date.toISOString().slice(0,10);}
  requireThat(locationId==='papa','Unknown comparison restaurant.');
  const ordinal=Math.floor((date.getUTCDate()-1)/7),first=new Date(Date.UTC(date.getUTCFullYear()-1,date.getUTCMonth(),1,12));
  const day=1+(date.getUTCDay()-first.getUTCDay()+7)%7+ordinal*7;
  const candidate=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),day,12));
  return candidate.getUTCMonth()===date.getUTCMonth()?candidate.toISOString().slice(0,10):null;
}
