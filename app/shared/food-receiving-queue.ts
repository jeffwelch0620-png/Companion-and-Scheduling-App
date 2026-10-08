import type {FoodInvoiceLine} from './food-invoice';
import type {Workspace} from './types';
import {requireThat,text} from './validation';

export type ReceivingFilter='pending'|'rejected'|'unreplaced'|'replacements'|'excess'|'all';
export type ReceivingQueue={revision:number;filter:ReceivingFilter;query:string;total:number;totals:{active:number;pending:number;rejected:number;voided:number;excess:number;unreplaced:number;replacements:number};entries:{sequence:number;recordId:string;invoiceRevision:number;currentTitle:string;controlNumber:string;invoice:FoodInvoiceLine;accepted:number;rejected:number;remaining:number;receipts:number;extraQuantity:number;extraEntries:number;extraReturned:number;extraReturnEntries:number;replacementReturned:number;replacementReturnEntries:number;replacementEntries:number;replacementQuantity:number;replacementRemaining:number;voided:boolean}[];next:number|null};
type DB=Pick<D1Database,'prepare'|'batch'>;
type Row={sequence:number;record_id:string;revision:number;title:string;source_key:string;invoice:string;accepted:number;rejected:number;remaining:number;receipts:number;extraQuantity:number;extraEntries:number;extraReturned:number;extraReturnEntries:number;replacementReturned:number;replacementReturnEntries:number;replacementEntries:number;replacementQuantity:number;replacementRemaining:number;voided:number};

export async function receivingQueue(db:DB,w:Workspace,dataset:string,url:URL,revision:number):Promise<ReceivingQueue>{
 const filter=url.searchParams.get('filter')??'pending';requireThat(filter==='pending'||filter==='rejected'||filter==='unreplaced'||filter==='replacements'||filter==='excess'||filter==='all','Choose a delivery review view.');
 const query=text(url.searchParams.get('q')??'','Invoice search',100,true).toLowerCase(),before=Number(url.searchParams.get('before')??0);
 requireThat(Number.isSafeInteger(before)&&before>=0,'Invalid delivery queue cursor.');
 if(before)requireThat(url.searchParams.has('revision')&&Number(url.searchParams.get('revision'))===revision,'Food records changed. Refresh the delivery queue from its first page.',409);
 // Aggregation stays in storage. Never transfer the full catalog or event history to the daily workspace.
 // Each join includes store and record identity; quantities stay in their own invoice units.
 const sql=`WITH invoice_voids AS (
  SELECT record_id,json_extract(event,'$.invoiceVoid.invoiceRevision') AS invoice_revision FROM food_history
  WHERE location_id=? AND json_type(event,'$.invoiceVoid')='object' GROUP BY record_id,invoice_revision
 ), receipt_voids AS (
  SELECT record_id,json_extract(event,'$.receivingVoid.receivingRevision') AS receiving_revision FROM food_history
  WHERE location_id=? AND json_type(event,'$.receivingVoid')='object' GROUP BY record_id,receiving_revision
 ), invoices AS (
  SELECT h.sequence,h.record_id,h.revision,r.title,r.source_key,json_extract(h.event,'$.invoiceLine') AS invoice,
   CASE WHEN v.invoice_revision IS NULL THEN 0 ELSE 1 END AS voided
  FROM food_history h JOIN food_records r ON r.id=h.record_id AND r.location_id=h.location_id
   LEFT JOIN invoice_voids v ON v.record_id=h.record_id AND v.invoice_revision=h.revision
  WHERE h.location_id=? AND r.dataset=? AND json_extract(h.event,'$.action')='fooditem.invoice' AND json_type(h.event,'$.invoiceLine')='object'
 ), deliveries AS (
  SELECT h.record_id,json_extract(h.event,'$.receiving.invoiceRevision') AS invoice_revision,count(*) AS receipts,
   total(json_extract(h.event,'$.receiving.accepted')) AS accepted,total(json_extract(h.event,'$.receiving.rejected')) AS rejected
  FROM food_history h JOIN food_records r ON r.id=h.record_id AND r.location_id=h.location_id
   LEFT JOIN receipt_voids v ON v.record_id=h.record_id AND v.receiving_revision=h.revision
  WHERE h.location_id=? AND r.dataset=? AND json_type(h.event,'$.receiving')='object'
   AND v.receiving_revision IS NULL
  GROUP BY h.record_id,invoice_revision
 ), extras AS (
  SELECT h.record_id,json_extract(h.event,'$.excess.invoiceRevision') AS invoice_revision,count(*) AS extraEntries,total(json_extract(h.event,'$.excess.quantity')) AS extraQuantity
  FROM food_history h JOIN food_records r ON r.id=h.record_id AND r.location_id=h.location_id
  WHERE h.location_id=? AND r.dataset=? AND json_type(h.event,'$.excess')='object'
   AND NOT EXISTS(SELECT 1 FROM food_history v WHERE v.location_id=h.location_id AND v.record_id=h.record_id AND json_extract(v.event,'$.excessVoid.excessRevision')=h.revision)
  GROUP BY h.record_id,invoice_revision
 ), extra_returns AS (
  SELECT h.record_id,json_extract(h.event,'$.excessReturn.excess.invoiceRevision') AS invoice_revision,count(*) AS extraReturnEntries,total(json_extract(h.event,'$.excessReturn.quantity')) AS extraReturned
  FROM food_history h JOIN food_records r ON r.id=h.record_id AND r.location_id=h.location_id
  WHERE h.location_id=? AND r.dataset=? AND json_type(h.event,'$.excessReturn')='object'
   AND NOT EXISTS(SELECT 1 FROM food_history v WHERE v.location_id=h.location_id AND v.record_id=h.record_id AND json_extract(v.event,'$.excessReturnVoid.returnRevision')=h.revision)
  GROUP BY h.record_id,invoice_revision
 ), replacement_returns AS (
  SELECT h.record_id,json_extract(h.event,'$.replacementReturn.replacement.receiving.invoiceRevision') AS invoice_revision,count(*) AS replacementReturnEntries,total(json_extract(h.event,'$.replacementReturn.quantity')) AS replacementReturned
  FROM food_history h JOIN food_records r ON r.id=h.record_id AND r.location_id=h.location_id
  WHERE h.location_id=? AND r.dataset=? AND json_type(h.event,'$.replacementReturn')='object'
   AND NOT EXISTS(SELECT 1 FROM food_history v WHERE v.location_id=h.location_id AND v.record_id=h.record_id AND json_extract(v.event,'$.replacementReturnVoid.returnRevision')=h.revision)
  GROUP BY h.record_id,invoice_revision
 ), replacements AS (
  SELECT h.record_id,json_extract(s.event,'$.receiving.invoiceRevision') AS invoice_revision,
   count(*) AS replacementEntries,total(json_extract(h.event,'$.replacement.quantity')) AS replacementQuantity
  FROM food_history h JOIN food_records r ON r.id=h.record_id AND r.location_id=h.location_id
   JOIN food_history s ON s.location_id=h.location_id AND s.record_id=h.record_id AND s.revision=json_extract(h.event,'$.replacement.receivingRevision')
   LEFT JOIN receipt_voids v ON v.record_id=s.record_id AND v.receiving_revision=s.revision
  WHERE h.location_id=? AND r.dataset=? AND json_type(h.event,'$.replacement')='object'
   AND json_type(s.event,'$.receiving')='object' AND v.receiving_revision IS NULL
   AND json_extract(h.event,'$.replacement.invoiceUnit')=json_extract(s.event,'$.receiving.invoice.invoiceUnit')
   AND NOT EXISTS(SELECT 1 FROM food_history v WHERE v.location_id=h.location_id AND v.record_id=h.record_id AND json_extract(v.event,'$.replacementVoid.replacementRevision')=h.revision)
  GROUP BY h.record_id,invoice_revision
 ), checked AS (
  SELECT i.*,coalesce(z.replacementReturned,0) AS replacementReturned,coalesce(z.replacementReturnEntries,0) AS replacementReturnEntries,coalesce(x.replacementEntries,0) AS replacementEntries,coalesce(x.replacementQuantity,0) AS replacementQuantity,coalesce(p.extraReturnEntries,0) AS extraReturnEntries,coalesce(p.extraReturned,0) AS extraReturned,coalesce(e.extraEntries,0) AS extraEntries,coalesce(e.extraQuantity,0) AS extraQuantity,coalesce(d.receipts,0) AS receipts,coalesce(d.accepted,0) AS accepted,coalesce(d.rejected,0) AS rejected,
   max(0,json_extract(i.invoice,'$.quantity')-coalesce(d.accepted,0)-coalesce(d.rejected,0)) AS remaining
  FROM invoices i LEFT JOIN deliveries d ON d.record_id=i.record_id AND d.invoice_revision=i.revision LEFT JOIN extras e ON e.record_id=i.record_id AND e.invoice_revision=i.revision LEFT JOIN extra_returns p ON p.record_id=i.record_id AND p.invoice_revision=i.revision LEFT JOIN replacement_returns z ON z.record_id=i.record_id AND z.invoice_revision=i.revision LEFT JOIN replacements x ON x.record_id=i.record_id AND x.invoice_revision=i.revision
  WHERE (?='' OR instr(lower(i.title||' '||i.source_key||' '||json_extract(i.invoice,'$.sku.vendor')||' '||json_extract(i.invoice,'$.invoiceNumber')),?)>0)
 ), marked AS (SELECT *,CASE WHEN voided=0 AND remaining>1.7763568394002505e-15*max(1,json_extract(invoice,'$.quantity')) THEN 1 ELSE 0 END AS pending,
   CASE WHEN rejected-replacementQuantity>1.7763568394002505e-15*rejected THEN rejected-replacementQuantity ELSE 0 END AS replacementRemaining
   FROM checked) `;
 const args=[w.location.id,w.location.id,w.location.id,dataset,w.location.id,dataset,w.location.id,dataset,w.location.id,dataset,w.location.id,dataset,w.location.id,dataset,query,query];
 const condition=filter==='pending'?'pending=1':filter==='rejected'?'voided=0 AND rejected>0':filter==='unreplaced'?'voided=0 AND replacementRemaining>0':filter==='replacements'?'voided=0 AND replacementEntries>0':filter==='excess'?'voided=0 AND extraEntries>0':'1=1';
 const result=await db.batch([
  db.prepare(sql+'SELECT coalesce(sum(1-voided),0) AS active,coalesce(sum(pending),0) AS pending,coalesce(sum(CASE WHEN voided=0 AND rejected>0 THEN 1 ELSE 0 END),0) AS rejected,coalesce(sum(voided),0) AS voided,coalesce(sum(CASE WHEN voided=0 AND extraEntries>0 THEN 1 ELSE 0 END),0) AS excess,coalesce(sum(CASE WHEN voided=0 AND replacementRemaining>0 THEN 1 ELSE 0 END),0) AS unreplaced,coalesce(sum(CASE WHEN voided=0 AND replacementEntries>0 THEN 1 ELSE 0 END),0) AS replacements FROM marked').bind(...args),
  db.prepare(sql+`SELECT count(*) AS total FROM marked WHERE ${condition}`).bind(...args),
  db.prepare(sql+`SELECT sequence,record_id,revision,title,source_key,invoice,accepted,rejected,remaining,receipts,extraEntries,extraQuantity,extraReturned,extraReturnEntries,replacementReturned,replacementReturnEntries,replacementEntries,replacementQuantity,replacementRemaining,voided FROM marked WHERE ${condition} AND (?=0 OR sequence<?) ORDER BY sequence DESC LIMIT 21`).bind(...args,before,before),
 ]);
 const rows=result[2].results as Row[];
 const entries=rows.slice(0,20).map(r=>({sequence:r.sequence,recordId:r.record_id,invoiceRevision:r.revision,currentTitle:r.title,controlNumber:r.source_key,invoice:JSON.parse(r.invoice) as FoodInvoiceLine,accepted:r.accepted,rejected:r.rejected,remaining:r.remaining,receipts:r.receipts,extraEntries:r.extraEntries,extraQuantity:r.extraQuantity,extraReturned:r.extraReturned,extraReturnEntries:r.extraReturnEntries,replacementReturned:r.replacementReturned,replacementReturnEntries:r.replacementReturnEntries,replacementEntries:r.replacementEntries,replacementQuantity:r.replacementQuantity,replacementRemaining:r.replacementRemaining,voided:!!r.voided}));
 return {revision,filter,query,total:(result[1].results[0] as {total:number}).total,totals:result[0].results[0] as ReceivingQueue['totals'],entries,next:rows.length>20?entries.at(-1)!.sequence:null};
}
