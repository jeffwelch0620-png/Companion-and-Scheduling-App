import { localDate } from './local-time';
import { requireThat } from './validation';

// Counts reservations, including failed answers, so failures cannot bypass the cap.
export function companionDailyLimit(bindings:unknown):number {
  const value=bindings&&typeof bindings==='object'?(bindings as Record<string,unknown>).JMAX_COMPANION_DAILY_LIMIT:undefined;
  if(value===undefined)return 300;
  requireThat(typeof value==='string'&&/^[1-9]\d{0,4}$/.test(value)&&Number(value)<=10000,'The JMAX daily allowance needs an administrator configuration check.',503);
  return Number(value);
}
export async function companionUsage(db:Pick<D1Database,'prepare'>,locationId:string,timezone:string,now:number,limit:number) {
  const day=localDate(new Date(now).toISOString(),timezone);
  const row=await db.prepare('SELECT count FROM companion_daily_usage WHERE location_id=? AND day=?').bind(locationId,day).first<{count:number}>();
  return {day,used:row?.count??0,limit};
}
export const dailyLimitMessage='This restaurant has used today’s JMAX answer allowance. It resets at midnight restaurant time. Your schedule, inbox and training are still available.';
