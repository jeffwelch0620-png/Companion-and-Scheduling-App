import type {FoodClaim,ClaimLatest} from './food-claim';
import type {Workspace} from './types';
import {localDate} from './local-time';
import {requireThat,text} from './validation';
export type ClaimFilter='pending'|'due'|'closed'|'cancelled'|'all';
export type ClaimQueue={revision:number;today:string;filter:ClaimFilter;query:string;total:number;totals:{pending:number;due:number;closed:number;cancelled:number};entries:{sequence:number;recordId:string;claimRevision:number;currentTitle:string;controlNumber:string;claim:FoodClaim;latest?:ClaimLatest}[];next:number|null};
export async function claimQueue(db:Pick<D1Database,'prepare'|'batch'>,w:Workspace,dataset:string,url:URL,revision:number):Promise<ClaimQueue>{
 const filter=url.searchParams.get('filter')??'pending';requireThat(['pending','due','closed','cancelled','all'].includes(filter),'Choose a supplier issue view.');
 const query=text(url.searchParams.get('q')??'','Supplier issue search',100,true).toLowerCase(),before=Number(url.searchParams.get('before')??0),today=localDate(new Date().toISOString(),w.location.timezone);
 requireThat(Number.isSafeInteger(before)&&before>=0,'Invalid supplier issue page.');
 if(before)requireThat(url.searchParams.has('revision')&&Number(url.searchParams.get('revision'))===revision,'Food records changed. Refresh supplier issues from the first page.',409);
 if(before)requireThat(url.searchParams.get('day')===today,'The restaurant day changed. Refresh supplier issues from the first page.',409);
 const sql=`WITH updates AS (
 SELECT record_id,revision,json_extract(event,'$.claimUpdate') AS update_json,
 row_number() OVER(PARTITION BY record_id,json_extract(event,'$.claimUpdate.claimRevision') ORDER BY sequence DESC) AS rank
 FROM food_history WHERE location_id=? AND json_type(event,'$.claimUpdate')='object'
 ), claims AS (
 SELECT h.sequence,h.record_id,h.revision,r.title,r.source_key,json_extract(h.event,'$.supplierClaim') AS claim_json,
 u.update_json,u.revision AS update_revision,coalesce(json_extract(u.update_json,'$.state'),'pending') AS state,
 coalesce(json_extract(u.update_json,'$.followUpDate'),json_extract(h.event,'$.supplierClaim.followUpDate')) AS follow_up
 FROM food_history h JOIN food_records r ON r.id=h.record_id AND r.location_id=h.location_id
 LEFT JOIN updates u ON u.record_id=h.record_id AND json_extract(u.update_json,'$.claimRevision')=h.revision AND u.rank=1
 WHERE h.location_id=? AND r.dataset=? AND json_type(h.event,'$.supplierClaim')='object'
 ), searched AS (
 SELECT * FROM claims WHERE (?='' OR instr(lower(title||' '||source_key||' '||json_extract(claim_json,'$.reference')||' '||json_extract(claim_json,'$.invoice.invoiceNumber')||' '||json_extract(claim_json,'$.invoice.sku.vendor')),?)>0)
 ) `;
 const args=[w.location.id,w.location.id,dataset,query,query],condition=filter==='all'?'1=1':filter==='due'?"state='pending' AND follow_up<=?":'state=?',selected=filter==='all'?[]:[filter==='due'?today:filter];
 const rows=await db.batch([
 db.prepare(sql+"SELECT coalesce(sum(state='pending'),0) AS pending,coalesce(sum(state='pending' AND follow_up<=?),0) AS due,coalesce(sum(state='closed'),0) AS closed,coalesce(sum(state='cancelled'),0) AS cancelled FROM searched").bind(...args,today),
 db.prepare(sql+`SELECT count(*) AS total FROM searched WHERE ${condition}`).bind(...args,...selected),
 db.prepare(sql+`SELECT * FROM searched WHERE ${condition} AND (?=0 OR sequence<?) ORDER BY sequence DESC LIMIT 21`).bind(...args,...selected,before,before)]);
 type Row={sequence:number;record_id:string;revision:number;title:string;source_key:string;claim_json:string;update_json:string|null;update_revision:number|null};
 const data=rows[2].results as Row[],entries=data.slice(0,20).map(r=>({sequence:r.sequence,recordId:r.record_id,claimRevision:r.revision,currentTitle:r.title,controlNumber:r.source_key,claim:JSON.parse(r.claim_json) as FoodClaim,...(r.update_json?{latest:{...JSON.parse(r.update_json),revision:r.update_revision} as ClaimLatest}:{})}));
 return {revision,today,filter:filter as ClaimFilter,query,total:(rows[1].results[0] as {total:number}).total,totals:rows[0].results[0] as ClaimQueue['totals'],entries,next:data.length>20?entries.at(-1)!.sequence:null};
}
