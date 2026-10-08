import {packAmount,type FoodItem,type FoodPack} from './food-model';
import type {TransferDispatch} from './food-transfer';
import {requireThat,text} from './validation';

export type TransferItemMatch={item:{id:string;revision:number;title:string;controlNumber:string;pack:FoodPack};destinationUnitsPerDispatchUnit:number;reason:string;at:string;by:string;byName:string};
export function destinationPackRatio(dispatch:TransferDispatch,item:FoodItem){
 requireThat(item.active&&item.countActive&&!item.needsReview,'Choose an active destination item with a reviewed count pack.');
 const source=packAmount(dispatch.item.pack),destination=packAmount(item);
 requireThat(source&&destination&&item.purchaseUnit,'Both original dispatch and destination count packs must be complete.');
 requireThat(source.family===destination.family,'Dispatch and destination units are incompatible. Weight, volume and each cannot be guessed.');
 const ratio=source.value/destination.value;
 requireThat(Number.isFinite(ratio)&&ratio>0&&Number.isFinite(dispatch.quantity*ratio)&&dispatch.quantity*ratio>0&&dispatch.quantity*ratio<=Number.MAX_SAFE_INTEGER,'These packs cannot be converted within the supported quantity range.');
 return ratio;
}
export function matchDestinationItem(input:Record<string,unknown>,dispatch:TransferDispatch,item:FoodItem,itemId:string,itemRevision:number,at:string,by:string,byName:string):TransferItemMatch{
 requireThat(input.confirmed===true,'Confirm the destination record describes the same goods and its count pack was checked.');
 const ratio=destinationPackRatio(dispatch,item);
 return {item:{id:itemId,revision:itemRevision,title:item.title,controlNumber:item.controlNumber,pack:{purchaseUnit:item.purchaseUnit,packCount:item.packCount,unitQty:item.unitQty,unitUOM:item.unitUOM}},destinationUnitsPerDispatchUnit:ratio,reason:text(input.reason,'Item-match evidence or correction reason',1000),at,by,byName};
}
