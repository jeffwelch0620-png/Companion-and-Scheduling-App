import type {FoodSupplierReturn} from './food-return';
import type {Workspace} from './types';
import {requireThat,text} from './validation';

export type ReturnFilter='unmatched'|'matched'|'voided'|'all';
export type ReturnQueue={revision:number;filter:ReturnFilter;query:string;total:number;totals:{active:number;unmatched:number;matched:number;voided:number};entries:{sequence:number;recordId:string;returnRevision:number;currentTitle:string;controlNumber:string;returned:FoodSupplierReturn;quantity:number;matched:number;remaining:number;matches:number;voided:boolean}[];next:number|null};
type DB=Pick<D1Database,'prepare'|'batch'>;
type Row={sequence:number;record_id:string;revision:number;title:string;source_key:string;returned:string;quantity:number;matched:number;remaining:number;matches:number;voided:number};

export async function returnQueue(db:DB,w:Workspace,dataset:string,url:URL,revision:number):Promise<ReturnQueue>{
 const filter=url.searchParams.get('filter')??'unmatched';requireThat(['unmatched','matched','voided','all'].includes(filter),'Choose unmatched, fully matched, voided or all returns.');
 const query=text(url.searchParams.get('q')??'','Return search',100,true).toLowerCase(),before=Number(url.searchParams.get('before')??0);
 requireThat(Number.isSafeInteger(before)&&before>=0,'Invalid return queue cursor.');
 if(before)requireThat(url.searchParams.has('revision')&&Number(url.searchParams.get('revision'))===revision,'Food records changed. Refresh the return queue from its first page.',409);
 // Counts span the whole search; per-return quantities stay in their original units.
 const sql=`WITH return_voids AS (
  SELECT record_id,json_extract(event,'$.supplierReturnVoid.returnRevision') AS target FROM food_history
  WHERE location_id=? AND json_type(event,'$.supplierReturnVoid')='object' GROUP BY record_id,target
 ), match_voids AS (
  SELECT record_id,json_extract(event,'$.returnCreditVoid.matchRevision') AS target FROM food_history
  WHERE location_id=? AND json_type(event,'$.returnCreditVoid')='object' GROUP BY record_id,target
 ), returns AS (
  SELECT h.sequence,h.record_id,h.revision,r.title,r.source_key,json_extract(h.event,'$.supplierReturn') AS returned,
   CASE WHEN v.target IS NULL THEN 0 ELSE 1 END AS voided
  FROM food_history h JOIN food_records r ON r.id=h.record_id AND r.location_id=h.location_id
   LEFT JOIN return_voids v ON v.record_id=h.record_id AND v.target=h.revision
  WHERE h.location_id=? AND r.dataset=? AND json_type(h.event,'$.supplierReturn')='object'
 ), matches AS (
  SELECT h.record_id,json_extract(h.event,'$.returnCredit.returnRevision') AS target,count(*) AS matches,
   total(json_extract(h.event,'$.returnCredit.quantity')) AS matched
  FROM food_history h JOIN food_records r ON r.id=h.record_id AND r.location_id=h.location_id
   LEFT JOIN match_voids v ON v.record_id=h.record_id AND v.target=h.revision
  WHERE h.location_id=? AND r.dataset=? AND json_type(h.event,'$.returnCredit')='object' AND v.target IS NULL
  GROUP BY h.record_id,target
 ), checked AS (
  SELECT r.*,json_extract(r.returned,'$.accepted')+json_extract(r.returned,'$.rejected') AS quantity,
   coalesce(m.matched,0) AS matched,coalesce(m.matches,0) AS matches,
   max(0,json_extract(r.returned,'$.accepted')+json_extract(r.returned,'$.rejected')-coalesce(m.matched,0)) AS remaining
  FROM returns r LEFT JOIN matches m ON m.record_id=r.record_id AND m.target=r.revision
  WHERE (?='' OR instr(lower(r.title||' '||r.source_key||' '||json_extract(r.returned,'$.returnReference')||' '||json_extract(r.returned,'$.receiving.deliveryReference')||' '||json_extract(r.returned,'$.receiving.invoice.invoiceNumber')||' '||json_extract(r.returned,'$.receiving.invoice.sku.vendor')),?)>0)
 ), marked AS (
  SELECT *,CASE WHEN voided=0 AND remaining>1.7763568394002505e-15*max(1,json_extract(returned,'$.receiving.invoice.quantity')) THEN 1 ELSE 0 END AS unmatched FROM checked
 ) `;
 const args=[w.location.id,w.location.id,w.location.id,dataset,w.location.id,dataset,query,query];
 const condition=filter==='unmatched'?'unmatched=1':filter==='matched'?'voided=0 AND unmatched=0':filter==='voided'?'voided=1':'1=1';
 const result=await db.batch([
  db.prepare(sql+'SELECT coalesce(sum(1-voided),0) AS active,coalesce(sum(unmatched),0) AS unmatched,coalesce(sum(CASE WHEN voided=0 AND unmatched=0 THEN 1 ELSE 0 END),0) AS matched,coalesce(sum(voided),0) AS voided FROM marked').bind(...args),
  db.prepare(sql+`SELECT count(*) AS total FROM marked WHERE ${condition}`).bind(...args),
  db.prepare(sql+`SELECT sequence,record_id,revision,title,source_key,returned,quantity,matched,remaining,matches,voided FROM marked WHERE ${condition} AND (?=0 OR sequence<?) ORDER BY sequence DESC LIMIT 21`).bind(...args,before,before),
 ]);
 const rows=result[2].results as Row[],entries=rows.slice(0,20).map(r=>({sequence:r.sequence,recordId:r.record_id,returnRevision:r.revision,currentTitle:r.title,controlNumber:r.source_key,returned:JSON.parse(r.returned) as FoodSupplierReturn,quantity:r.quantity,matched:r.matched,remaining:r.remaining,matches:r.matches,voided:!!r.voided}));
 return {revision,filter:filter as ReturnFilter,query,total:(result[1].results[0] as {total:number}).total,totals:result[0].results[0] as ReturnQueue['totals'],entries,next:rows.length>20?entries.at(-1)!.sequence:null};
}
