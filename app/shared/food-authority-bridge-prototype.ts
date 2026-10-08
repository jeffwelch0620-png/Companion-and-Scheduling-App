import {loadExplicitAuthority,authorityTransactionGuard} from './authority-persistence-prototype';
import {postDraftCommissaryReceipt,type DraftReceiptMapping} from './food-commissary-ledger-prototype';
import type {CommissaryReceiptContext} from './food-commissary-receipt';
import {requireThat} from './validation';
type Database=Pick<D1Database,'prepare'|'batch'>;
export type DraftFoodAuthorityBinding={bindingId:string;bindingRevision:number;organizationId:string;destinationStoreId:string;department:'FOH'|'BOH';context:Omit<CommissaryReceiptContext,'actorId'|'canReceive'>;mapping:DraftReceiptMapping};
// Restricted department-authority mechanics harness, not full receiving policy.
// authUserId, binding and now() are trusted server inputs, NEVER request fields.
export async function postAuthorityBoundDraftReceipt(db:Database,authUserId:string,binding:DraftFoodAuthorityBinding,value:unknown,receiptId:string,now:()=>string){
 requireThat(binding.department==='FOH'||binding.department==='BOH','Reviewed department required.');
 const proof=await loadExplicitAuthority(db,authUserId,binding.organizationId,binding.destinationStoreId,binding.department==='FOH'?'foh.service':'boh.service',{organizationId:binding.organizationId,storeId:binding.destinationStoreId},now());
 requireThat(proof?.allowed&&proof.identity.storeId===binding.destinationStoreId,'Explicit department authority required.',403);
 const recordedAt=now(),c=binding.context;
 const bindingSql=`EXISTS(SELECT 1 FROM prototype_food_receipt_bindings WHERE id=? AND revision=? AND active=1 AND organization_id=? AND mapping_id=? AND source_location_id=? AND destination_location_id=? AND destination_store_id=? AND requesting_person_id=?)`;
 const guard=()=>{const authority=authorityTransactionGuard(proof,now());return {sql:`(${authority.sql}) AND (${bindingSql})`,values:[...authority.values,binding.bindingId,binding.bindingRevision,binding.organizationId,binding.mapping.id,c.sourceLocationId,c.receivingLocationId,binding.destinationStoreId,proof!.identity.personId]};};
 const initial=guard();requireThat(await db.prepare(`SELECT 1 AS allowed WHERE ${initial.sql}`).bind(...initial.values).first(),'Reviewed requesting-manager/storage binding required.',403);
 // Compose into the throwing CHECK guard, not a non-throwing zero-row update.
 // All subsequent receipt/stock/history statements share its atomic D1 batch.
 const pending=new Map<D1PreparedStatement,{sql:string;args:unknown[]}>();
 const guarded:Database={async batch(statements){return db.batch(statements.map(s=>{const p=pending.get(s);if(!p)return s;const fresh=guard();return db.prepare(p.sql.replace(' THEN 1 ELSE 0 END',` AND (${fresh.sql}) THEN 1 ELSE 0 END`)).bind(...p.args,...fresh.values);}));},prepare(sql){
  const isGuard=sql.startsWith('INSERT INTO draft_food_receipt_guards'),isReplay=sql.startsWith('SELECT fingerprint,data FROM draft_food_receipts');
  if(!isGuard&&!isReplay)return db.prepare(sql);
  if(isGuard)requireThat(sql.includes(' THEN 1 ELSE 0 END'),'Unsupported transaction guard.');
  const statement=db.prepare(sql);
  return new Proxy(statement,{get(target,prop){if(prop==='bind')return(...args:unknown[])=>{
   if(isReplay){const fresh=guard();return db.prepare(`${sql} AND (${fresh.sql})`).bind(...args,...fresh.values);}
   const bound=target.bind(...args);pending.set(bound,{sql,args});return bound;
  };const method=Reflect.get(target,prop);return typeof method==='function'?method.bind(target):method;}});
 }};
 // Actor/allowed are reconstructed; spoofed JSON identity fields are discarded
 // by prepareCommissaryReceipt. Persisted requester binding gates the commit.
 return postDraftCommissaryReceipt(guarded,value,{...c,actorId:proof!.identity.personId,canReceive:true},binding.mapping,recordedAt,receiptId);
}
