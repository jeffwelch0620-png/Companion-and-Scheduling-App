import type {RecordOf,WorkRecord} from './types';
import {overlaps,requireThat} from './validation';

export function timeOffShifts(records:WorkRecord[],request:RecordOf<'request'>){
 return records.filter((r):r is RecordOf<'shift'>=>r.kind==='shift'&&r.locationId===request.locationId&&r.ownerId===request.ownerId&&!r.data.cancelled&&overlaps(r.data,request.data)).sort((a,b)=>a.data.start.localeCompare(b.data.start)||a.id.localeCompare(b.id));
}

export function verifyTimeOffImpact(shifts:RecordOf<'shift'>[],snapshot:unknown){
 requireThat(Array.isArray(snapshot),'Review the affected shifts before approving time off.',409);
 requireThat(snapshot.length===shifts.length&&shifts.every(s=>snapshot.filter(v=>v&&typeof v==='object'&&v.id===s.id&&v.revision===s.revision).length===1),'The affected shifts changed. Refresh and review this request again before approving.',409);
}
