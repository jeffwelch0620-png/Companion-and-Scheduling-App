import type {FoodPack,FoodItem} from './food-model';
import {packAmount} from './food-model';
import {instant,requireThat,text} from './validation';
import type {TransferItemMatch} from './food-transfer-match';
import type {TransferParcel,ParcelTotals} from './food-transfer-parcels';
import type {TransferWindow} from './food-transfer-window';
import {receiptUnitQuantities,type ReceiptQuantitySource} from './food-transfer-receipt-units';

export type TransferDispatch={reference:string;quantity:number;dispatchedAt:string;note:string;by:string;byName:string;recordedAt:string;item:{id:string;revision:number;title:string;controlNumber:string;pack:FoodPack}};
// Quantities are cumulative for the whole transfer, not per-trip increments.
// Missing `complete` on older receipts means the original final check.
export type TransferReceipt={accepted:number;rejected:number;missing:number;complete?:boolean;receivedAt:string;reason:string;note:string;by:string;byName:string;recordedAt:string;quantitySource?:ReceiptQuantitySource};
export type FoodTransfer={id:string;sequence:number;revision:number;sourceId:string;destinationId:string;sourceName:string;destinationName:string;dataset:'demo'|'operating';status:'sent'|'received'|'voided';dispatch:TransferDispatch;receipt:TransferReceipt|null;destinationMatch?:TransferItemMatch|null;parcels?:TransferParcel[];parcelTotals?:ParcelTotals};
export type TransferEvent={revision:number;action:'sent'|'received'|'receipt-progress'|'receipt-corrected'|'voided'|'item-matched'|'item-match-cleared'|'parcel-departed'|'parcel-arrived'|'parcel-reopened'|'parcel-voided';at:string;by:string;byName:string;reason:string;receipt?:TransferReceipt;destinationMatch?:TransferItemMatch|null;parcel?:TransferParcel};
export type TransferPage={revision:number;entries:FoodTransfer[];next:number|null;routes:{id:string;name:string}[];query:string;window:TransferWindow;total:number;totals:{open:number;final:number;differences:number;voided:number}};
export type TransferDetail={transfer:FoodTransfer;events:TransferEvent[];next:number|null;destinationMatchReview?:'unmatched'|'current'|'changed'|'unavailable'};
export const transferPending=(dispatch:TransferDispatch,receipt:TransferReceipt|null)=>receipt?.complete===false?Math.max(0,dispatch.quantity-receipt.accepted-receipt.rejected):receipt?0:dispatch.quantity;
export function transferQuantity(v:unknown,label:string){
 requireThat((typeof v==='number'||typeof v==='string'&&v.trim()!=='')&&Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=1000000,`Enter ${label} from zero to 1,000,000.`);return Number(v);
}
export function transferDispatch(input:Record<string,unknown>,item:FoodItem,id:string,revision:number,at:string,by:string,byName:string):TransferDispatch{
 requireThat(item.active&&!item.needsReview&&item.purchaseUnit&&packAmount(item),'Review the active item and its complete count pack before recording a transfer.');
 const quantity=transferQuantity(input.quantity,'the dispatched quantity');requireThat(quantity>0,'Dispatched quantity must be greater than zero.');
 const dispatchedAt=instant(input.dispatchedAt,'Dispatch time');requireThat(dispatchedAt<=at,'An actual dispatch cannot be in the future.');
 requireThat(input.confirmed===true,'Confirm the goods actually left in the stated count unit.');
 return {reference:text(input.reference,'Transfer reference',150),quantity,dispatchedAt,note:text(input.note??'','Dispatch note',1000,true),by,byName,recordedAt:at,item:{id,revision,title:item.title,controlNumber:item.controlNumber,pack:{purchaseUnit:item.purchaseUnit,packCount:item.packCount,unitQty:item.unitQty,unitUOM:item.unitUOM}}};
}
export function transferReceipt(input:Record<string,unknown>,dispatch:TransferDispatch,at:string,by:string,byName:string,match?:TransferItemMatch|null):TransferReceipt{
 const {accepted,rejected,missing,quantitySource}=receiptUnitQuantities(input,dispatch,match);
 requireThat(input.complete===undefined||typeof input.complete==='boolean','Choose whether the delivery check is final.');
 const complete=input.complete!==false,tolerance=Number.EPSILON*Math.max(1,dispatch.quantity)*8;
 if(complete)requireThat(Math.abs(accepted+rejected+missing-dispatch.quantity)<=tolerance,'A final check must account for the entire dispatched quantity as accepted, rejected or missing in its original unit.');
 else{
  requireThat(missing===0,'Goods still awaited are pending, not missing. Enter zero missing until the final check.');
  requireThat(accepted+rejected>0&&accepted+rejected<dispatch.quantity-tolerance,'An open check must record some arrived goods and leave some of the dispatch pending. Use a final check when all goods are accounted for.');
 }
 const receivedAt=instant(input.receivedAt,'Delivery check time');requireThat(receivedAt>=dispatch.dispatchedAt&&receivedAt<=at,'Delivery check must follow dispatch and cannot be in the future.');
 requireThat(input.confirmed===true,'Confirm the cumulative delivery totals and their conversion to the original dispatch unit.');
 return {accepted,rejected,missing,complete,receivedAt,reason:text(input.reason??'','Difference reason',1000,rejected+missing===0),note:text(input.note??'','Receipt note',1000,true),by,byName,recordedAt:at,...(quantitySource?{quantitySource}:{})};
}
