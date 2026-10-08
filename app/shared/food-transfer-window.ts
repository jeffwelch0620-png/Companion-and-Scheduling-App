import {calendarDate} from './schedule-policy';
import {localInstant,nextDate} from './local-time';
import {AppError,requireThat} from './validation';

export type TransferWindow={from:string;through:string;timezone:string};
// Calendar days in the selected restaurant. End is exclusive; DST days are not 24 hours.
export function transferWindow(from:string,through:string,timezone:string){
 const window:TransferWindow={from,through,timezone};
 if(!from&&!through)return {window,start:'',end:''};
 calendarDate(from,'Dispatch start date');calendarDate(through,'Dispatch end date');
 requireThat(from<=through&&Date.parse(through)-Date.parse(from)<=365*86400000,'Choose up to 366 dispatch days in date order.');
 try{return {window,start:localInstant(from,'00:00',timezone,'earlier'),end:localInstant(nextDate(through),'00:00',timezone,'earlier')}}
 catch{throw new AppError(400,'This dispatch date boundary needs review in the restaurant timezone.')}
}
