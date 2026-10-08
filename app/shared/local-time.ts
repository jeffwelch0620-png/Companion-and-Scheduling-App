export function localDate(instant: string, zone: string) {
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(instant)).map(p=>[p.type,p.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export function localClock(instant: string, zone: string) {
  return new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(instant));
}
export function displayTime(instant: string, zone: string) {
  return new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(instant));
}
export function nextDate(date: string, days = 1) { return new Date(Date.parse(`${date}T12:00:00Z`)+days*86400000).toISOString().slice(0,10); }
export function localInstant(date: string, clock: string, zone: string, repeated: string = '') {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(clock)) throw Error('Choose a date and time.');
  const guess=Date.parse(`${date}T${clock}:00Z`), matches:string[]=[];
  if(!Number.isFinite(guess)) throw Error('Choose a valid date and time.');
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  for(let delta=-14*60;delta<=14*60;delta+=15) {
    const stamp=new Date(guess+delta*60000).toISOString(), p=Object.fromEntries(formatter.formatToParts(new Date(stamp)).map(p=>[p.type,p.value]));
    if(`${p.year}-${p.month}-${p.day}`===date && `${p.hour}:${p.minute}`===clock) matches.push(stamp);
  }
  if(!matches.length) throw Error('This local time does not exist because the clocks change. Choose another time.');
  if(matches.length>1 && !['earlier','later'].includes(repeated)) throw Error('This hour occurs twice when the clocks change. Choose the first or second occurrence.');
  return repeated==='later'?matches[matches.length-1]:matches[0];
}
