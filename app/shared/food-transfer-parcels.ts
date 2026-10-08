import type {FoodTransfer} from './food-transfer';
import {transferQuantity} from './food-transfer';
import {id,instant,requireThat,text} from './validation';

type ActorStamp={at:string;by:string;byName:string};
export type TransferParcel={id:string;tripReference:string;parcelReference:string;quantity:number;departedAt:string;note:string;recorded:ActorStamp;arrival?:ActorStamp&{arrivedAt:string;note:string};void?:ActorStamp&{reason:string}};
export type ParcelTotals={records:number;departed:number;arrived:number;awaitingArrival:number;unassigned:number};
export const parcelActions=['transfer.parcel-depart','transfer.parcel-arrive','transfer.parcel-reopen','transfer.parcel-void'];
const key=(s:string)=>s.toLowerCase().replace(/\s+/g,' ').trim();
export function parcelTotals(d:Pick<FoodTransfer,'dispatch'|'parcels'>):ParcelTotals{
 const active=(d.parcels??[]).filter(p=>!p.void),departed=active.reduce((n,p)=>n+p.quantity,0),arrived=active.filter(p=>p.arrival).reduce((n,p)=>n+p.quantity,0);
 return {records:active.length,departed,arrived,awaitingArrival:Math.max(0,departed-arrived),unassigned:Math.max(0,d.dispatch.quantity-departed)};
}
export function changeParcel(d:FoodTransfer,action:string,input:Record<string,unknown>,loc:string,by:string,byName:string,reviewer:boolean,at:string){
 requireThat(d.status!=='voided','This transfer was voided.',409);
 const parcels=structuredClone(d.parcels??[]),stamp={at,by,byName};
 let parcel:TransferParcel,reason='';
 if(action==='transfer.parcel-depart'){
  requireThat(loc===d.sourceId,'Only the source restaurant can record a parcel departure.',403);
  requireThat(parcels.length<50,'This transfer has reached its 50-parcel record limit, including voided records.',409);
  const tripReference=text(input.tripReference,'Trip reference',150),parcelReference=text(input.parcelReference,'Parcel reference',150);
  requireThat(!parcels.some(p=>!p.void&&key(p.tripReference)===key(tripReference)&&key(p.parcelReference)===key(parcelReference)),'This trip and parcel reference are already recorded for this transfer.',409);
  const quantity=transferQuantity(input.quantity,'the quantity in this parcel'),totals=parcelTotals(d);
  requireThat(quantity>0,'Parcel quantity must be greater than zero.');
  requireThat(quantity<=totals.unassigned+Number.EPSILON*Math.max(1,d.dispatch.quantity)*8,'Parcel quantities exceed the original dispatch. Correct an incorrect parcel record first.',409);
  const departedAt=instant(input.departedAt,'Parcel departure time');
  requireThat(departedAt>=d.dispatch.dispatchedAt&&departedAt<=at,'Parcel departure must be on or after the transfer dispatch and cannot be in the future.');
  requireThat(input.confirmed===true,'Confirm this parcel actually left and its quantity uses the original dispatch unit.');
  parcel={id:crypto.randomUUID(),tripReference,parcelReference,quantity,departedAt,note:text(input.note??'','Parcel note',1000,true),recorded:stamp};
  parcels.push(parcel);
 }else{
  parcel=parcels.find(p=>p.id===id(input.parcelId))!;
  requireThat(parcel,'Parcel not found in this transfer.',404);requireThat(!parcel.void,'This parcel record was voided.',409);
  if(action==='transfer.parcel-arrive'){
   requireThat(loc===d.destinationId,'Only the destination restaurant can record parcel arrival.',403);
   requireThat(!parcel.arrival,'This parcel already has an arrival. Reopen an incorrect arrival first.',409);
   const arrivedAt=instant(input.arrivedAt,'Parcel arrival time');
   requireThat(arrivedAt>=parcel.departedAt&&arrivedAt<=at,'Arrival must follow parcel departure and cannot be in the future.');
   requireThat(input.confirmed===true,'Confirm the entire identified parcel physically arrived. Check accepted and rejected goods separately.');
   parcel.arrival={...stamp,arrivedAt,note:text(input.note??'','Arrival note',1000,true)};
  }else if(action==='transfer.parcel-reopen'){
   requireThat(loc===d.destinationId,'Only the destination restaurant can reopen its parcel arrival.',403);
   requireThat(parcel.arrival,'There is no arrival to reopen.',409);
   requireThat(parcel.arrival.by===by||reviewer,'Only the arrival recorder or purchasing reviewer can reopen this arrival.',403);
   reason=text(input.reason,'Reason for reopening incorrect arrival',1000);delete parcel.arrival;
  }else{
   requireThat(action==='transfer.parcel-void','Unsupported parcel action.');
   requireThat(loc===d.sourceId,'Only the source restaurant can void its parcel record.',403);
   requireThat(parcel.recorded.by===by||reviewer,'Only the departure recorder or purchasing reviewer can void this parcel record.',403);
   requireThat(!parcel.arrival,'The destination must reopen an incorrect arrival before this parcel can be voided.',409);
   reason=text(input.reason,'Reason for voiding incorrect parcel',1000);parcel.void={...stamp,reason};
  }
 }
 return {parcels,parcel:structuredClone(parcel),reason};
}
