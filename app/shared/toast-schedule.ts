import { boundedJson } from './service';
import { calendarDate } from './schedule-policy';
import { localDate, localInstant, nextDate } from './local-time';
import { AppError, object, requireThat } from './validation';

export type ToastScheduledShift={toastShiftId:string;externalId:string|null;toastEmployeeId:string;toastJobId:string;start:string;end:string;deleted:boolean;modifiedAt:string};
export type ToastScheduleSnapshot={restaurantGuid:string;weekStart:string;timezone:string;retrievedAt:string;source:'toast-labor-scheduled-shifts';shifts:ToastScheduledShift[]};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function guid(value:unknown){requireThat(typeof value==='string'&&uuid.test(value),'Toast returned an invalid schedule identifier.',502);return value.toLowerCase()}
function sourceObject(value:unknown){requireThat(value!==null&&typeof value==='object'&&!Array.isArray(value),'Toast returned an incomplete schedule record.',502);return object(value)}
function date(value:unknown){
  requireThat(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)$/.test(value)&&Number.isFinite(Date.parse(value)),'Toast returned an invalid schedule time.',502);
  // Date.parse silently rolls nonexistent days such as February 30 forward.
  // Validate the source calendar before converting its offset-aware instant.
  const calendar=value.slice(0,10),noon=Date.parse(calendar+'T12:00:00Z');
  requireThat(Number.isFinite(noon)&&new Date(noon).toISOString().slice(0,10)===calendar,'Toast returned an invalid schedule calendar date.',502);
  return new Date(value).toISOString();
}
export class ToastScheduleReadError extends AppError {
  constructor(public upstreamStatus:number){super(upstreamStatus===429?429:503,upstreamStatus===429?'Toast is limiting schedule reads. Try again later.':'Toast could not provide the scheduled shifts. Check the connection and labor read access.')}
}

// These are planned POS shifts, not worked time entries. Their presence does not
// establish that the separate Toast Scheduling/Sling UI has the same records.
export function normalizeToastSchedule(value:unknown,restaurantGuid:string,weekStart:string,timezone:string,retrievedAt=new Date().toISOString()):ToastScheduleSnapshot {
  calendarDate(weekStart,'Week starting');const end=nextDate(weekStart,7),ids=new Set<string>();
  requireThat(Array.isArray(value)&&value.length<=2000,'Toast returned an unexpected weekly schedule.',502);
  const shifts=value.map(v=>{
    const row=sourceObject(v),toastShiftId=guid(row.guid);requireThat(!ids.has(toastShiftId),'Toast returned duplicate shift identifiers.',502);ids.add(toastShiftId);
    const start=date(row.inDate),end=date(row.outDate);
    requireThat(Date.parse(end)>Date.parse(start),'Toast returned a shift with invalid duration.',502);
    requireThat(typeof row.deleted==='boolean','Toast returned an incomplete shift status.',502);
    requireThat(row.externalId==null||typeof row.externalId==='string'&&row.externalId.length<=200,'Toast returned an invalid external shift identifier.',502);
    return {toastShiftId,externalId:row.externalId??null,toastEmployeeId:guid(sourceObject(row.employeeReference).guid),toastJobId:guid(sourceObject(row.jobReference).guid),start,end,deleted:row.deleted,modifiedAt:date(row.modifiedDate)};
  }).filter(r=>localDate(r.start,timezone)>=weekStart&&localDate(r.start,timezone)<end).sort((a,b)=>a.start.localeCompare(b.start)||a.toastShiftId.localeCompare(b.toastShiftId));
  return {restaurantGuid:guid(restaurantGuid),weekStart,timezone,retrievedAt,source:'toast-labor-scheduled-shifts',shifts};
}

export async function fetchToastSchedule(config:{restaurantGuid:string;accessToken:string;host:string},weekStart:string,timezone:string,fetcher:typeof fetch=fetch):Promise<ToastScheduleSnapshot> {
  calendarDate(weekStart,'Week starting');
  requireThat(['https://ws-api.toasttab.com','https://ws-sandbox-api.toasttab.com'].includes(config.host)&&uuid.test(config.restaurantGuid)&&!!config.accessToken,'Toast restaurant and access are required.',503);
  // GET filters on outDate < endDate. Extend through the day after the week to
  // include Sunday overnight shifts, then filter on the local starting date.
  const query=new URLSearchParams({startDate:localInstant(weekStart,'00:00',timezone),endDate:localInstant(nextDate(weekStart,8),'00:00',timezone)});
  const response=await fetcher(`${config.host}/labor/v1/shifts?${query}`,{method:'GET',redirect:'manual',headers:{Authorization:`Bearer ${config.accessToken}`,'Toast-Restaurant-External-ID':config.restaurantGuid,Accept:'application/json'},signal:AbortSignal.timeout(20000)});
  if(!response.ok){await response.body?.cancel();throw new ToastScheduleReadError(response.status);}
  // The documented endpoint returns the whole requested array with HTTP 200.
  // Do not present partial success or an advertised continuation as a full week.
  if(response.status!==200||response.headers.has('Content-Range')||/\brel\s*=\s*["']?next\b/i.test(response.headers.get('Link')??'')||response.headers.has('Toast-Next-Page-Token')){await response.body?.cancel();throw new AppError(502,'Toast returned an incomplete schedule response. The JMAX schedule has not changed.');}
  return normalizeToastSchedule(await boundedJson(response.body,4_000_000),config.restaurantGuid,weekStart,timezone);
}
