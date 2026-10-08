import {prepareCommissaryReceipt,type CommissaryReceiptContext} from './food-commissary-receipt';
import {id,instant,object,requireThat,text} from './validation';

// Isolated, unapproved SQL design. No route, production binding or live IDs.
type Statement={bind(...values:unknown[]):Statement;first<T=Record<string,unknown>>():Promise<T|null>};
type DraftDatabase={prepare(sql:string):Statement;batch(statements:Statement[]):Promise<unknown>};
export type DraftReceiptMapping={
 id:string;revision:number;batchId:string;batchRevision:number;consumingRestaurantId:string;productionLocationId:string;
};
export async function postDraftCommissaryReceipt(db:DraftDatabase,value:unknown,context:CommissaryReceiptContext,mapping:DraftReceiptMapping,at:string,receiptId:string){
 const receipt=prepareCommissaryReceipt(value,context,at,receiptId);
 for(const v of [mapping.id,mapping.batchId,mapping.consumingRestaurantId,mapping.productionLocationId])id(v);
 for(const v of [mapping.revision,mapping.batchRevision])requireThat(Number.isSafeInteger(v)&&v>0,'Reviewed mapping and batch revisions are required.');
 mapping={id:mapping.id,revision:mapping.revision,batchId:mapping.batchId,batchRevision:mapping.batchRevision,consumingRestaurantId:mapping.consumingRestaurantId,productionLocationId:mapping.productionLocationId};
 const fingerprint=JSON.stringify({source:receipt.sourceLocationId,destination:receipt.destinationLocationId,owner:receipt.owningRestaurantId,product:receipt.productId,productRevision:receipt.productRevision,quantity:receipt.quantity,unit:receipt.unit,receivedAt:receipt.receivedAt,note:receipt.note,sourceRevision:context.sourceRevision,destinationRevision:context.destinationRevision,mapping});
 const prior=async()=>db.prepare('SELECT fingerprint,data FROM draft_food_receipts WHERE destination_location_id=? AND actor_id=? AND request_id=?').bind(receipt.destinationLocationId,receipt.receivedBy,receipt.requestId).first<{fingerprint:string;data:string}>();
 const replay=(saved:{fingerprint:string;data:string})=>{requireThat(saved.fingerprint===fingerprint,'Request already used for different receipt details.',409);return JSON.parse(saved.data);};
 const previous=await prior();if(previous)return replay(previous);
 const result={schemaVersion:'jmax-draft-stock-receipt.v1',receipt:{...receipt,stockPosting:'draft-local-ledger'},mapping:{...mapping},sourceRevision:context.sourceRevision+1,destinationRevision:context.destinationRevision+1};
 const sql=(s:string,...args:unknown[])=>db.prepare(s).bind(...args);
 // D1 batch is the transaction boundary. Guard observes approved mapping and
 // both stock revisions inside that boundary; no read-before-write race.
 const statements=[sql(`INSERT INTO draft_food_receipt_guards(id,ok) SELECT ?,CASE WHEN EXISTS(
 SELECT 1 FROM draft_food_receipt_mappings m JOIN draft_food_batches b ON b.id=m.batch_id
 JOIN draft_food_balances s ON s.batch_id=b.id AND s.location_id=m.source_location_id
 JOIN draft_food_balances d ON d.batch_id=b.id AND d.location_id=m.destination_location_id
 WHERE m.id=? AND m.revision=? AND m.approved=1 AND b.id=? AND b.batch_revision=?
 AND m.consuming_restaurant_id=? AND b.production_location_id=? AND b.owner_restaurant_id=?
 AND b.product_id=? AND b.product_revision=? AND b.unit=? AND m.source_location_id=? AND m.destination_location_id=?
 AND s.revision=? AND d.revision=? AND s.quantity>=?) THEN 1 ELSE 0 END`,
 receipt.id,mapping.id,mapping.revision,mapping.batchId,mapping.batchRevision,mapping.consumingRestaurantId,mapping.productionLocationId,receipt.owningRestaurantId,receipt.productId,receipt.productRevision,receipt.unit,receipt.sourceLocationId,receipt.destinationLocationId,context.sourceRevision,context.destinationRevision,receipt.quantity),
 sql('INSERT INTO draft_food_receipts(id,destination_location_id,actor_id,request_id,fingerprint,data) VALUES(?,?,?,?,?,?)',receipt.id,receipt.destinationLocationId,receipt.receivedBy,receipt.requestId,fingerprint,JSON.stringify(result)),
 sql('INSERT INTO draft_food_receipt_heads(receipt_id,revision,effective_quantity) VALUES(?,1,?)',receipt.id,receipt.quantity),
 sql('UPDATE draft_food_balances SET quantity=quantity-?,revision=revision+1 WHERE batch_id=? AND location_id=?',receipt.quantity,mapping.batchId,receipt.sourceLocationId),
 sql('UPDATE draft_food_balances SET quantity=quantity+?,revision=revision+1 WHERE batch_id=? AND location_id=?',receipt.quantity,mapping.batchId,receipt.destinationLocationId),
 sql("INSERT INTO draft_food_movements(receipt_id,leg,batch_id,location_id,quantity_delta) VALUES(?,'source',?,?,?)",receipt.id,mapping.batchId,receipt.sourceLocationId,-receipt.quantity),
 sql("INSERT INTO draft_food_movements(receipt_id,leg,batch_id,location_id,quantity_delta) VALUES(?,'destination',?,?,?)",receipt.id,mapping.batchId,receipt.destinationLocationId,receipt.quantity),
 sql('DELETE FROM draft_food_receipt_guards WHERE id=?',receipt.id)];
 try{await db.batch(statements);}catch(error){
  // Concurrent identical requests can race at the unique request key. Only a
  // committed identical receipt counts as a successful retry.
  const saved=await prior();if(saved)return replay(saved);throw error;
 }
 return result;
}

export async function correctDraftCommissaryReceipt(db:DraftDatabase,value:unknown,context:CommissaryReceiptContext&{canCorrect:boolean},at:string,correctionId:string){
 requireThat(context.canCorrect,'Explicit correction authority is required.',403);
 const row=object(value),receiptId=id(row.receiptId),requestId=id(row.requestId),actor=id(context.actorId),reason=text(row.reason,'Correction reason',1000);
 at=instant(at);correctionId=id(correctionId);
 for(const v of [row.expectedReceiptRevision,context.sourceRevision,context.destinationRevision])requireThat(Number.isSafeInteger(v)&&Number(v)>=0&&Number(v)<Number.MAX_SAFE_INTEGER,'Exact current revisions are required.');
 requireThat(Number(row.expectedReceiptRevision)>0,'Receipt revision is required.');
 requireThat(row.confirmed===true,'Confirm the corrected received amount.');
 requireThat(typeof row.correctedQuantity==='number'&&Number.isFinite(row.correctedQuantity)&&row.correctedQuantity>=0&&row.correctedQuantity<=1000000,'Enter a nonnegative corrected received quantity; zero reverses the receipt.');
 const original=await db.prepare('SELECT data FROM draft_food_receipts WHERE id=?').bind(receiptId).first<{data:string}>();requireThat(original,'Original receipt not found.',404);
 const saved=JSON.parse(original!.data),r=saved.receipt,m=saved.mapping;
 requireThat(context.sourceLocationId===r.sourceLocationId&&context.receivingLocationId===r.destinationLocationId&&context.owningRestaurantId===r.owningRestaurantId&&context.product.id===r.productId&&context.product.revision===r.productRevision&&context.product.unit===r.unit,'Correction cannot change receipt ownership, locations, product or unit.',403);
 requireThat(at>=r.recordedAt,'Correction cannot precede the original receipt.');
 const fingerprint=JSON.stringify({receiptId,expectedRevision:row.expectedReceiptRevision,quantity:row.correctedQuantity,reason,sourceRevision:context.sourceRevision,destinationRevision:context.destinationRevision});
 const prior=async()=>db.prepare('SELECT fingerprint,data FROM draft_food_corrections WHERE receipt_id=? AND actor_id=? AND request_id=?').bind(receiptId,actor,requestId).first<{fingerprint:string;data:string}>();
 const replay=(s:{fingerprint:string;data:string})=>{requireThat(s.fingerprint===fingerprint,'Request already used for different correction details.',409);return JSON.parse(s.data);};
 const previous=await prior();if(previous)return replay(previous);
 const head=await db.prepare('SELECT revision,effective_quantity FROM draft_food_receipt_heads WHERE receipt_id=?').bind(receiptId).first<{revision:number;effective_quantity:number}>();
 requireThat(head&&head.revision===row.expectedReceiptRevision,'Receipt changed. Refresh before correcting.',409);
 const delta=row.correctedQuantity-head!.effective_quantity;requireThat(delta!==0,'No quantity change to post.');
 const result={schemaVersion:'jmax-draft-stock-correction.v1',id:correctionId,receiptId,requestId,revision:head!.revision+1,previousQuantity:head!.effective_quantity,correctedQuantity:row.correctedQuantity,quantityDelta:delta,reason,recordedAt:at,recordedBy:actor,kind:row.correctedQuantity===0?'reversal':'correction',originalReceipt:r,mapping:m,stockPosting:'draft-local-ledger'};
 const sql=(s:string,...a:unknown[])=>db.prepare(s).bind(...a);
 const statements=[sql(`INSERT INTO draft_food_receipt_guards(id,ok) SELECT ?,CASE WHEN EXISTS(
 SELECT 1 FROM draft_food_receipt_heads h JOIN draft_food_batches b ON b.id=?
 JOIN draft_food_balances s ON s.batch_id=b.id AND s.location_id=?
 JOIN draft_food_balances d ON d.batch_id=b.id AND d.location_id=?
 WHERE h.receipt_id=? AND h.revision=? AND h.effective_quantity=?
 AND b.product_id=? AND b.product_revision=? AND b.owner_restaurant_id=? AND b.production_location_id=? AND b.unit=? AND b.batch_revision=?
 AND s.revision=? AND d.revision=? AND s.quantity-?>=0 AND d.quantity+?>=0) THEN 1 ELSE 0 END`,
 correctionId,m.batchId,r.sourceLocationId,r.destinationLocationId,receiptId,head!.revision,head!.effective_quantity,r.productId,r.productRevision,r.owningRestaurantId,m.productionLocationId,r.unit,m.batchRevision,context.sourceRevision,context.destinationRevision,delta,delta),
 sql('INSERT INTO draft_food_corrections(id,receipt_id,actor_id,request_id,expected_revision,fingerprint,data) VALUES(?,?,?,?,?,?,?)',correctionId,receiptId,actor,requestId,head!.revision,fingerprint,JSON.stringify(result)),
 sql('UPDATE draft_food_balances SET quantity=quantity-?,revision=revision+1 WHERE batch_id=? AND location_id=?',delta,m.batchId,r.sourceLocationId),
 sql('UPDATE draft_food_balances SET quantity=quantity+?,revision=revision+1 WHERE batch_id=? AND location_id=?',delta,m.batchId,r.destinationLocationId),
 sql("INSERT INTO draft_food_correction_movements VALUES(?,'source',?,?,?)",correctionId,m.batchId,r.sourceLocationId,-delta),
 sql("INSERT INTO draft_food_correction_movements VALUES(?,'destination',?,?,?)",correctionId,m.batchId,r.destinationLocationId,delta),
 sql('UPDATE draft_food_receipt_heads SET revision=revision+1,effective_quantity=? WHERE receipt_id=?',row.correctedQuantity,receiptId),
 sql('DELETE FROM draft_food_receipt_guards WHERE id=?',correctionId)];
 try{await db.batch(statements);}catch(error){const p=await prior();if(p)return replay(p);throw error;}
 return result;
}
