import {id, object, requireThat} from './validation';
import {toastSourceInstant} from './toast-source-time';
import {calendarDate} from './schedule-policy';

export type ToastDayScope = {locationId:string; businessDate:string; timezone:string};
export type ToastDayMapping = {locationId:string; restaurantGuid:string; timezone:string};
export type ToastDayFeed = {
  state:'unavailable'|'incomplete'|'empty'|'available';
  freshness:'unknown'|'current'|'stale';
  recordCount:number|null;
  importedRecordCount:number|null;
  checkedAt:string|null;
  dataThrough:string|null;
  paginationComplete:boolean;
  correctionsApplied:boolean;
  dayClosed:boolean;
};
// A display/readiness window, not a polling schedule or an operating policy.
export const toastDayFreshnessSeconds=1800;
const guid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateToastDayMapping(mapping:ToastDayMapping,scope:ToastDayScope){
  requireThat(mapping.locationId===scope.locationId && mapping.timezone===scope.timezone && guid.test(mapping.restaurantGuid),'Toast restaurant mapping needs review.',503);
}
function missing():ToastDayFeed {
  return {state:'unavailable',freshness:'unknown',recordCount:null,importedRecordCount:null,checkedAt:null,dataThrough:null,paginationComplete:false,correctionsApplied:false,dayClosed:false};
}
function feed(value:unknown,now:number):ToastDayFeed {
  if(value===null)return missing();
  const row=object(value), checkedAt=toastSourceInstant(row.checkedAt),dataThrough=toastSourceInstant(row.dataThrough);
  requireThat(Date.parse(dataThrough)<=Date.parse(checkedAt) && Date.parse(checkedAt)<=now,'Invalid Toast observation time.');
  for(const key of ['paginationComplete','correctionsApplied','dayClosed'])requireThat(typeof row[key]==='boolean','Toast completeness evidence is required.');
  requireThat(Number.isSafeInteger(row.recordCount) && Number(row.recordCount)>=0,'Invalid Toast record count.');
  const complete=row.paginationComplete && row.correctionsApplied && row.dayClosed;
  const freshness=now-Date.parse(dataThrough)>toastDayFreshnessSeconds*1000?'stale':'current';
  return {
    state:complete?(row.recordCount===0?'empty':'available'):'incomplete',freshness,
    // Partial or old reads cannot masquerade as current operating totals.
    recordCount:complete && freshness==='current'?Number(row.recordCount):null,
    // Snapshot size is distinct from a reconciled operating total.
    importedRecordCount:Number(row.recordCount),
    checkedAt,dataThrough,paginationComplete:row.paginationComplete as boolean,
    correctionsApplied:row.correctionsApplied as boolean,dayClosed:row.dayClosed as boolean,
  };
}
export function projectToastDay(value:unknown,scope:ToastDayScope,mapping:ToastDayMapping,now:number){
  validateToastDayMapping(mapping,scope);
  const row=object(value);
  requireThat(row.schemaVersion==='jmax-toast-day-read.v1','Unsupported Toast day response.');
  requireThat(id(row.locationId)===scope.locationId && calendarDate(row.businessDate,'Business date')===scope.businessDate && row.timezone===scope.timezone,'Toast response scope does not match.');
  const source=object(row.source);
  requireThat(source.system==='toast' && source.restaurantGuid===mapping.restaurantGuid,'Toast source does not match.');
  // Reconstruct the response. Raw orders, employee details, tokens, provider
  // errors and unrecognized fields must never pass through this boundary.
  return {orders:feed(row.orders,now),labor:feed(row.labor,now)};
}
export function missingToastDay(){return {orders:missing(),labor:missing()};}
