import type {Command} from './types';
import type {InvoiceCatalogReview,InvoiceCatalogMatch} from './invoice-catalog-review';
import type {InvoiceFileSource,InvoiceCsvRow} from './food-invoice-csv';
import {invoiceEntryKey} from './food-invoice';
import {requireThat,text} from './validation';

export const invoiceBatchLimit=25;
export type InvoiceChoice={recordNumber:number;itemId:string;skuId:string};
export type InvoiceBatchLine={row:InvoiceCsvRow;match:InvoiceCatalogMatch;state:'queued'|'saved'|'uncertain'|'rejected';command?:Command;message?:string};
export type InvoiceBatch={locationId:string;dataset:'demo'|'operating';file:Omit<InvoiceFileSource,'row'>;sourceNote:string;lines:InvoiceBatchLine[];revisions:Record<string,number>};
export function prepareInvoiceBatch(review:InvoiceCatalogReview,file:Omit<InvoiceFileSource,'row'>,choices:InvoiceChoice[],sourceNote:string,confirmed:boolean):InvoiceBatch{
 requireThat(confirmed===true,'Check every selected item, pack, unit and net amount against the source invoice.');
 const note=text(sourceNote,'Invoice source reference',1000);
 requireThat(choices.length>0&&choices.length<=invoiceBatchLimit,`Choose 1 to ${invoiceBatchLimit} lines per group.`);
 const seen=new Set<number>(),identities=new Set<string>(),revisions:Record<string,number>=Object.create(null);
 const lines=choices.map(choice=>{
  requireThat(!seen.has(choice.recordNumber),'Choose each source row only once.');seen.add(choice.recordNumber);
  const entry=review.entries.find(e=>e.row.recordNumber===choice.recordNumber);
  requireThat(entry&&entry.saved.state==='not-recorded','Refresh saved lines before selecting an unrecorded source row.');
  const match=entry.matches.find(m=>m.itemId===choice.itemId&&m.skuId===choice.skuId);
  requireThat(match&&!match.issue,'Choose a compatible item and supplier pack for every selected line.');
  requireThat(Number.isSafeInteger(match.itemRevision)&&match.itemRevision>0,'Refresh this item before saving.');
  const identity=invoiceEntryKey(entry.row.vendor,entry.row.invoiceNumber,entry.row.lineReference);
  requireThat(!identities.has(identity),'Selected rows repeat a supplier invoice line.');identities.add(identity);
  requireThat(!Object.hasOwn(revisions,match.itemId)||revisions[match.itemId]===match.itemRevision,'Item versions differ. Refresh matches first.');
  revisions[match.itemId]=match.itemRevision;
  return {row:{...entry.row},match:{...match},state:'queued' as const};
 }).sort((a,b)=>a.row.recordNumber-b.row.recordNumber);
 return {locationId:review.locationId,dataset:review.dataset,file:{...file},sourceNote:note,lines,revisions};
}
// One existing writer request at a time. An uncertain result retains its exact
// request ID and body; only a deliberate retry can resume it. No automatic retry.
export async function advanceInvoiceBatch(batch:InvoiceBatch,send:(command:Command)=>Promise<Response>,newId:()=>string=()=>crypto.randomUUID()):Promise<InvoiceBatch>{
 const next:InvoiceBatch=structuredClone(batch),index=next.lines.findIndex(l=>l.state!=='saved');
 if(index<0||next.lines[index].state==='rejected')return next;
 const line=next.lines[index],row=line.row;
 const command=line.command??{requestId:newId(),locationId:next.locationId,action:'fooditem.invoice',recordId:line.match.itemId,expectedRevision:next.revisions[line.match.itemId],input:{...row,skuId:line.match.skuId,sourceNote:next.sourceNote,confirmed:true,fileSource:{...next.file,row}}};
 line.command=command;
 try{
  const response=await send(command);
  // Invalid or missing response bodies are uncertain even on error status.
  const value=await response.json() as Record<string,unknown>;
  if(!response.ok){
   line.state=response.status>=400&&response.status<500?'rejected':'uncertain';
   line.message=typeof value?.error==='string'?value.error:'Save was not confirmed. Refresh saved lines before making a new selection.';
  }else if(value?.recordId!==command.recordId||value.revision!==Number(command.expectedRevision)+1||!Number.isSafeInteger(value.foodRevision)||value.added!==0||value.existing!==0){
   line.state='uncertain';line.message='Unexpected save response. Retry the same pending line or end this group and refresh saved lines.';
  }else{
   line.state='saved';line.message=undefined;next.revisions[line.match.itemId]=Number(value.revision);
  }
 }catch{
  line.state='uncertain';line.message='Connection interrupted. This line may already be saved. Retry the same pending line or end this group and refresh saved lines.';
 }
 return next;
}
