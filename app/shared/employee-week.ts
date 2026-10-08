import {localDate,nextDate} from './local-time';
import {type RecordOf,type Workspace} from './types';

// A view over records already authorized by the server. Never fall back to a
// name match: two people with the same name must keep separate schedules.
export function employeeShiftWeek(w:Workspace,selected:RecordOf<'shift'>) {
 const date=localDate(selected.data.start,w.location.timezone);
 const start=nextDate(date,-((new Date(date+'T12:00:00Z').getUTCDay()-(w.location.weekStartsOn??1)+7)%7));
 const end=nextDate(start,7);
 const shifts=w.records.filter((r):r is RecordOf<'shift'>=>r.kind==='shift'&&r.locationId===w.location.id&&selected.locationId===w.location.id&&r.ownerId===selected.ownerId&&(!r.data.cancelled||r.id===selected.id)&&localDate(r.data.start,w.location.timezone)>=start&&localDate(r.data.start,w.location.timezone)<end).sort((a,b)=>a.data.start.localeCompare(b.data.start)||a.id.localeCompare(b.id));
 const days=Array.from({length:7},(_,i)=>{const day=nextDate(start,i);return {date:day,shifts:shifts.filter(r=>localDate(r.data.start,w.location.timezone)===day)}});
 const minutes=shifts.filter(r=>!r.data.cancelled).reduce((total,r)=>total+(Date.parse(r.data.end)-Date.parse(r.data.start))/60000,0);
 return {start,end:nextDate(end,-1),days,minutes,hasDrafts:shifts.some(r=>!r.data.cancelled&&!r.data.published)};
}
