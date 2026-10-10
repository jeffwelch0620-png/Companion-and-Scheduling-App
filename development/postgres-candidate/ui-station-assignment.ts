import {canScheduleJob,type Member,type Workspace,type RecordOf} from '../../app/shared/types';
import {stationById} from '../../app/shared/station-assignment';
import {isCheckoutLabel} from './ui-store-configuration.mjs';
export {stationById,shiftStationName} from '../../app/shared/station-assignment';
export function stationAssignmentIssue(w:Workspace,person:Member,job:string,stationId?:string|null) {
 if(!stationId)return '';
 const station=stationById(w,stationId),setup=station?.data.setup;
 if(person.locationId!==w.location.id||!station||station.data.status!=='active'||station.area!==person.area)return 'Choose an active station in this employee’s department.';
 if(isCheckoutLabel(w,person.position)||isCheckoutLabel(w,job))return 'Checkout jobs use their scheduling job without station training.';
 if(!setup||!setup.jobs.includes(job))return 'This station is not configured for the selected scheduling job.';
 if(!setup.allJobMembers&&!setup.memberIds.includes(person.id))return 'This employee has not been added to this station’s scheduling list.';
 if(!canScheduleJob(person,job))return 'This employee needs the underlying scheduling job first.';
 return '';
}
export function selectableStations(w:Workspace,person:Member,job:string) {
 return w.records.filter((r):r is RecordOf<'station'>=>r.kind==='station'&&!stationAssignmentIssue(w,person,job,r.id)).sort((a,b)=>a.data.title.localeCompare(b.data.title));
}
