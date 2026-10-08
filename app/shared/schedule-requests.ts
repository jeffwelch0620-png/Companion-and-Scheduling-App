import { localDate } from './local-time';
import type { RecordOf, WorkRecord } from './types';

export type ScheduleRequestRecord = RecordOf<'request'> | RecordOf<'availability'>;
export type RequestStage = 'pending' | 'approved' | 'history';

export function isScheduleRequest(record:WorkRecord):record is ScheduleRequestRecord {
  return record.kind==='request'||record.kind==='availability';
}

// Keep unanswered requests visible even after their dates have passed.
export function requestStage(record:ScheduleRequestRecord,now:string,zone:string):RequestStage {
  if(['pending','accepted-by-replacement'].includes(record.data.status))return 'pending';
  const ended=record.kind==='availability'
    ?record.data.endDate<localDate(now,zone)
    :Date.parse(record.data.end)<=Date.parse(now);
  return record.data.status==='approved'&&!ended?'approved':'history';
}

export function requestStatus(record:ScheduleRequestRecord) {
  if(record.data.status==='accepted-by-replacement')return 'Awaiting approval';
  if(record.data.status==='pending')return record.kind==='request'&&record.data.type==='swap'?'Awaiting coworker':'Awaiting approval';
  return ({approved:'Approved',declined:'Declined',superseded:'Replaced'} as const)[record.data.status];
}

export function requestTitle(record:ScheduleRequestRecord) {
  return record.kind==='availability'?record.data.title:({ 'time-off':'Time off',swap:'Shift cover',availability:'Availability' } as const)[record.data.type];
}
