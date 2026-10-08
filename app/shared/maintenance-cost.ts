import type {Maintenance,MaintenanceService} from './maintenance';
import type {CommandContext} from './followthrough';
import {contactOwner} from './service-contacts';
import {calendarDate} from './schedule-policy';
import {localDate} from './local-time';
import {requireThat,text} from './validation';

export type ServiceCost={id:string;by:string;at:string;note:string}&({kind:'recorded';amountCents:number;currency:'USD';documentDate:string;sourceRef:string;allocation:string}|{kind:'withdrawn'});
export function serviceCost(entry:MaintenanceService){const last=entry.costHistory?.at(-1);return last?.kind==='recorded'?last:null;}
export function maintenanceCosts(d:Maintenance){
 let amountCents=0,recorded=0,missing=0,voided=0;
 for(const s of d.services){if(s.voided){voided++;continue;}const cost=serviceCost(s);if(cost){amountCents+=cost.amountCents;recorded++;}else missing++;}
 return {amountCents,recorded,missing,voided};
}
export function maintenanceMoney(cents:number){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);}
export function serviceCostCents(value:unknown){
 requireThat(typeof value==='string'&&/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/.test(value),'Enter a USD amount from 0 to 9,999,999.99 with at most two decimal places.');
 const [whole,fraction='']=value.split('.');return Number(whole)*100+Number(fraction.padEnd(2,'0'));
}
export function applyMaintenanceCost(c:CommandContext,r:import('./types').RecordOf<'maintenance'>,note:string){
 const {me,input,command,at,w,save,history}=c,owner=contactOwner(me);
 const entry=r.data.services.find(s=>s.id===input.serviceId);requireThat(entry&&!entry.voided,'Choose an unvoided completed service.');
 const prior=entry.costHistory??[];
 requireThat(owner||r.data.status==='active'&&me.id===r.data.managerId&&prior.length===0,'Only the assigned manager records the first cost. An owner makes cost corrections.',403);
 requireThat(prior.length<20,'This service reached its cost history limit. Retain the evidence and request owner follow-up.');
 requireThat(!r.data.services.some(s=>s.costHistory?.some(x=>x.id===command.requestId)),'This cost reference is already recorded. Use a new request.',409);
 requireThat(input.confirmed===true,'Confirm the evidence and the amount allocated to this service only.');
 let event:ServiceCost;
 if(command.action==='maintenance.cost-withdraw'){
  requireThat(owner,'Only an owner withdraws a recorded cost.',403);requireThat(serviceCost(entry),'There is no current cost to withdraw.');
  event={id:command.requestId,kind:'withdrawn',by:me.id,at,note};
 }else{
  const amountCents=serviceCostCents(input.amount),documentDate=calendarDate(input.documentDate,'Cost evidence date');
  requireThat(documentDate<=localDate(at,w.location.timezone),'Cost evidence cannot be dated in the future.');
  event={id:command.requestId,kind:'recorded',amountCents,currency:'USD',documentDate,sourceRef:text(input.sourceRef,'Invoice or no-charge evidence reference',2000),allocation:text(input.allocation,'Amount allocation and included charges',1000),by:me.id,at,note};
 }
 save({...r,data:{...r.data,services:r.data.services.map(s=>s===entry?{...s,costHistory:[...prior,event]}:s),history:[...r.data.history,history(event.kind==='withdrawn'?'service-cost-withdrawn':prior.length?'service-cost-corrected':'service-cost-recorded',note)]}});
}
