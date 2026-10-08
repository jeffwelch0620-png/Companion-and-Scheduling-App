import type {Workspace} from './types';
import type {FoodPack} from './food-model';
import {requireThat} from './validation';
import {wasteReportQuery} from './food-waste-query';
import {wasteTotals,type TotalRow,type WasteTotals} from './food-waste-report';

export type WasteItemGroup=WasteTotals&{sequence:number;recordId:string;title:string;controlNumber:string;storageArea:string;nameBasis:'entry snapshot'|'current catalog fallback';pack:FoodPack;activeQuantity:number|null};
export type WasteItemReport={kind:'waste-items';locationId:string;dataset:string;from:string;through:string;timezone:string;revision:number;totalGroups:number;groups:WasteItemGroup[];after:number;next:number|null};
type GroupRow=TotalRow&{group_sequence:number;record_id:string;item_title:string;control_number:string|null;storage_area:string|null;name_basis:WasteItemGroup['nameBasis'];purchase_unit:string;pack_count:number|null;unit_qty:number|null;unit_uom:string;quantity:number};
export async function wasteItemReport(db:Pick<D1Database,'prepare'|'batch'>,w:Workspace,dataset:string,url:URL,revision:number):Promise<WasteItemReport>{
 requireThat(url.searchParams.has('revision')&&url.searchParams.get('revision')!==''&&Number(url.searchParams.get('revision'))===revision,'Food records changed. Refresh the waste report before reviewing items.',409);
 const {from,through,after,sql,summary,args}=wasteReportQuery(w,dataset,url,revision);
 requireThat(after<=1000000&&after%20===0,'Invalid waste item page.');
 // Group exact immutable pack/identity fields, not serialized JSON key order.
 // No unit conversion or catalog replacement may reinterpret a past observation.
 const grouped=sql+`, named AS (SELECT *,
  CASE WHEN json_type(waste,'$.item')='object' THEN json_extract(waste,'$.item.title') ELSE title END AS item_title,
  CASE WHEN json_type(waste,'$.item')='object' THEN 'entry snapshot' ELSE 'current catalog fallback' END AS name_basis,
  json_extract(waste,'$.item.controlNumber') AS control_number,json_extract(waste,'$.item.storageArea') AS storage_area,
  json_extract(waste,'$.pack.purchaseUnit') AS purchase_unit,json_extract(waste,'$.pack.packCount') AS pack_count,
  json_extract(waste,'$.pack.unitQty') AS unit_qty,json_extract(waste,'$.pack.unitUOM') AS unit_uom FROM priced),
  grouped AS (SELECT min(sequence) AS group_sequence,record_id,item_title,name_basis,control_number,storage_area,purchase_unit,pack_count,unit_qty,unit_uom,
   total(CASE WHEN voided=0 THEN json_extract(waste,'$.quantity') ELSE NULL END) AS quantity,${summary}
   FROM named GROUP BY record_id,item_title,name_basis,control_number,storage_area,purchase_unit,pack_count,unit_qty,unit_uom) `;
 const rows=await db.batch([
  db.prepare(grouped+'SELECT count(*) AS total FROM grouped').bind(...args),
  db.prepare(grouped+'SELECT * FROM grouped ORDER BY estimate DESC,group_sequence ASC LIMIT 21 OFFSET ?').bind(...args,after),
 ]);
 const groups=(rows[1].results as GroupRow[]).slice(0,20).map(r=>({...wasteTotals(r),sequence:r.group_sequence,recordId:r.record_id,title:r.item_title,controlNumber:r.control_number??'',storageArea:r.storage_area??'',nameBasis:r.name_basis,pack:{purchaseUnit:r.purchase_unit,packCount:r.pack_count,unitQty:r.unit_qty,unitUOM:r.unit_uom},activeQuantity:Number.isFinite(r.quantity)&&r.quantity>=0&&r.quantity<=Number.MAX_SAFE_INTEGER?r.quantity:null}));
 return {kind:'waste-items',locationId:w.location.id,dataset,from,through,timezone:w.location.timezone,revision,totalGroups:Number((rows[0].results[0] as {total:number}).total),groups,after,next:rows[1].results.length>20?after+20:null};
}
