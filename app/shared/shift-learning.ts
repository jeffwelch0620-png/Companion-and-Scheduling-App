import { stationById } from './station-assignment';
import { approvedStationGuides } from './station-knowledge';
import { type RecordOf, type Workspace } from './types';

export function guideMatchesStation(guide:RecordOf<'standard'>,station:RecordOf<'station'>) {
  return guide.locationId===station.locationId&&guide.area===station.area&&(station.data.setup?.standardIds.includes(guide.id)||!!guide.data.supersedes&&station.data.setup?.standardIds.includes(guide.data.supersedes.id)||guide.data.position.trim().toLowerCase()===station.data.title.trim().toLowerCase());
}

// A scheduled job is not training clearance. Link only approved material that
// this viewer can already read, for the exact shift's department and station.
export function guidesForShift(w:Workspace, shift:RecordOf<'shift'>) {
  if(shift.locationId!==w.location.id||shift.data.cancelled)return [];
  if(w.me.position==='Dishwasher')return shift.ownerId===w.me.id&&shift.data.published&&shift.area===w.me.area&&shift.data.position==='Dishwasher'?approvedStationGuides(w):[];
  if(shift.data.stationId){const station=stationById(w,shift.data.stationId);if(station?.data.status!=='active')return [];return approvedStationGuides(w).filter(r=>r.area===shift.area&&guideMatchesStation(r,station));}
  return approvedStationGuides(w).filter(r=>r.area===shift.area&&r.data.position===shift.data.position);
}
