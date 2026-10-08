import {displayTime} from './local-time';
import type {RecordOf} from './types';

// A saved edit is evidence of a change, not a snapshot of the previous hours.
// Do not send private manager notes to the model just to explain an edit.
export function scheduleChangeContext(shift:RecordOf<'shift'>,timezone:string){
 const edit=[...(shift.data.history??[])].reverse().find(h=>h.action==='edited');
 return {recordedEdit:!!edit,lastEditAt:edit?.at??null,lastEditLocal:edit?displayTime(edit.at,timezone):null,previousHoursAvailable:false};
}
