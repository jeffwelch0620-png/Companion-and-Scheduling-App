import {localInstant} from './local-time';

// All transfer entry uses the selected restaurant's wall clock, never the device zone.
export function transferLocalTimestamp(date:string,time:string,zone:string,occurrence=''){
 if(!/^\d{2}:\d{2}(:\d{2})?$/.test(time)||Number(time.slice(6)||0)>59)throw Error('Choose a valid restaurant time.');
 return new Date(Date.parse(localInstant(date,time.slice(0,5),zone,occurrence))+Number(time.slice(6)||0)*1000).toISOString();
}
export function transferFormTimestamp(f:FormData,zone:string){
 return transferLocalTimestamp(String(f.get('date')??''),String(f.get('time')??''),zone,String(f.get('occurrence')??''));
}
