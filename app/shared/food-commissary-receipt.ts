import {id,instant,object,requireThat,text} from './validation';

// Separate from FoodTransfer: a receipt is the first and only required action.
// This local boundary records history/revisions; it does not invent a perpetual
// ledger or reinterpret legacy dispatch records as stock movements.
export type CommissaryReceiptContext={
  actorId:string;canReceive:boolean;receivingLocationId:string;sourceLocationId:string;owningRestaurantId:string;
  product:{id:string;revision:number;unit:string};sourceRevision:number;destinationRevision:number;
};
export type CommissaryReceipt={
  schemaVersion:'jmax-commissary-receipt.v1';id:string;requestId:string;revision:1;
  sourceLocationId:string;destinationLocationId:string;owningRestaurantId:string;
  productId:string;productRevision:number;quantity:number;unit:string;
  receivedAt:string;recordedAt:string;receivedBy:string;note:string;
  status:'recorded';stockPosting:'not-connected';
};
export type CommissaryReceiptEvent={action:'receipt-recorded';receiptId:string;at:string;by:string;revision:1};
type Result={receipt:CommissaryReceipt;sourceRevision:number;destinationRevision:number};
export interface CommissaryReceiptTransaction {
  request(destination:string,actor:string,request:string):Promise<{fingerprint:string;result:Result}|null>;
  locationRevision(location:string):Promise<number>;
  addReceipt(receipt:CommissaryReceipt):Promise<void>;
  addHistory(event:CommissaryReceiptEvent):Promise<void>;
  advanceRevision(location:string,expected:number):Promise<void>;
  rememberRequest(destination:string,actor:string,request:string,fingerprint:string,result:Result):Promise<void>;
}
export interface CommissaryReceiptStore {
  // Adapter MUST provide one isolated all-or-nothing transaction, with unique
  // request/receipt keys and compare-and-swap revisions. No live adapter exists.
  transaction<T>(work:(tx:CommissaryReceiptTransaction)=>Promise<T>):Promise<T>;
}
function revision(value:unknown,minimum=1){requireThat(Number.isSafeInteger(value)&&Number(value)>=minimum&&Number(value)<Number.MAX_SAFE_INTEGER,'An exact current source revision is required.');return Number(value);}
export function prepareCommissaryReceipt(value:unknown,context:CommissaryReceiptContext,recordedAt:string,receiptId:string):CommissaryReceipt {
  requireThat(context.canReceive,'Only an authorized receiving manager can record receipt.',403);
  const row=object(value),at=instant(recordedAt),receivedAt=instant(row.receivedAt,'Receipt time');
  requireThat(receivedAt<=at,'Receipt cannot be recorded before arrival.');
  requireThat(row.confirmed===true,'Confirm the product actually arrived.');
  const source=id(row.sourceLocationId),destination=id(row.destinationLocationId),owner=id(row.owningRestaurantId),product=id(row.productId);
  requireThat(source===context.sourceLocationId && destination===context.receivingLocationId && owner===context.owningRestaurantId && product===context.product.id,'Receipt source, destination, owner or product needs review.',403);
  requireThat(source!==destination,'Receipt must move between different physical locations.');
  requireThat(revision(row.productRevision)===context.product.revision,'Product definition changed. Refresh before saving.',409);
  requireThat(revision(row.sourceRevision,0)===context.sourceRevision && revision(row.destinationRevision,0)===context.destinationRevision,'Location records changed. Refresh before saving.',409);
  requireThat(typeof row.quantity==='number'&&Number.isFinite(row.quantity)&&row.quantity>0&&row.quantity<=1000000,'Enter the actual positive received quantity.');
  const unit=text(row.unit,'Measured unit',60);requireThat(unit===context.product.unit,'Use the reviewed product unit; conversion is not established.',409);
  // Explicit reconstruction: no dispatch, pickup time or invented sent event.
  return {schemaVersion:'jmax-commissary-receipt.v1',id:id(receiptId),requestId:id(row.requestId),revision:1,sourceLocationId:source,destinationLocationId:destination,owningRestaurantId:owner,productId:product,productRevision:context.product.revision,quantity:row.quantity,unit,receivedAt,recordedAt:at,receivedBy:id(context.actorId),note:text(row.note??'','Receipt note',1000,true),status:'recorded',stockPosting:'not-connected'};
}
export async function saveCommissaryReceipt(store:CommissaryReceiptStore,value:unknown,context:CommissaryReceiptContext,recordedAt:string,receiptId:string):Promise<Result>{
  const receipt=prepareCommissaryReceipt(value,context,recordedAt,receiptId);
  // Stable action fields omit generated ID/time so a legitimate retry returns
  // the original saved receipt, even if recording time or generated ID changes.
  const fingerprint=JSON.stringify({source:receipt.sourceLocationId,destination:receipt.destinationLocationId,owner:receipt.owningRestaurantId,product:receipt.productId,productRevision:receipt.productRevision,quantity:receipt.quantity,unit:receipt.unit,receivedAt:receipt.receivedAt,note:receipt.note,sourceRevision:context.sourceRevision,destinationRevision:context.destinationRevision});
  return store.transaction(async tx=>{
    const prior=await tx.request(receipt.destinationLocationId,receipt.receivedBy,receipt.requestId);
    if(prior){requireThat(prior.fingerprint===fingerprint,'This request identifier was used for different receipt details.',409);return prior.result;}
    requireThat(await tx.locationRevision(receipt.sourceLocationId)===context.sourceRevision && await tx.locationRevision(receipt.destinationLocationId)===context.destinationRevision,'Source or destination changed. Refresh before saving.',409);
    const result={receipt,sourceRevision:context.sourceRevision+1,destinationRevision:context.destinationRevision+1};
    await tx.addReceipt(receipt);
    await tx.addHistory({action:'receipt-recorded',receiptId:receipt.id,at:receipt.recordedAt,by:receipt.receivedBy,revision:1});
    await tx.advanceRevision(receipt.sourceLocationId,context.sourceRevision);
    await tx.advanceRevision(receipt.destinationLocationId,context.destinationRevision);
    await tx.rememberRequest(receipt.destinationLocationId,receipt.receivedBy,receipt.requestId,fingerprint,result);
    return result;
  });
}
