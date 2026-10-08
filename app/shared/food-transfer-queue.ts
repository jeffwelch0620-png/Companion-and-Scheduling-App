import {requireThat,text} from './validation';
import type {TransferPage} from './food-transfer';
import {transferWindow} from './food-transfer-window';

// Search only the immutable dispatch identity and route names. Never search private notes
// or combine unlike item quantities. Result counts describe transfers, not inventory.
export function transferQueueQuery(url:URL,location:string,dataset:string,revision:number,timezone:string,allowedLocationIds?:readonly string[]){
 const view=url.searchParams.get('view')??'incoming',status=url.searchParams.get('status')??'sent';
 const query=text(url.searchParams.get('q')??'','Transfer search',100,true).toLowerCase();
 const before=Number(url.searchParams.get('before')??0);
 requireThat(view==='incoming'||view==='outgoing','Choose incoming or outgoing transfers.');
 requireThat(['sent','received','differences','voided','all'].includes(status),'Choose a transfer status.');
 requireThat(Number.isSafeInteger(before)&&before>=0,'Invalid transfer cursor.');
 if(before)requireThat(url.searchParams.has('revision')&&Number(url.searchParams.get('revision'))===revision,'Transfers changed. Refresh from the first page.',409);
 const column=view==='incoming'?'destination_id':'source_id';
 const {window,start,end}=transferWindow(url.searchParams.get('from')??'',url.searchParams.get('through')??'',timezone);
 const dateSql=start?" AND julianday(json_extract(data,'$.dispatch.dispatchedAt'))>=julianday(?) AND julianday(json_extract(data,'$.dispatch.dispatchedAt'))<julianday(?)":'';
 const placeholders=allowedLocationIds?.map(()=>'?').join(',');
 const scopeSql=allowedLocationIds?allowedLocationIds.length?` AND source_id IN (${placeholders}) AND destination_id IN (${placeholders})`:' AND 1=0':'';
 const sql=`WITH scoped AS (
  SELECT *,CASE WHEN status<>'voided' AND (coalesce(json_extract(data,'$.receipt.rejected'),0)>0 OR coalesce(json_extract(data,'$.receipt.missing'),0)>0) THEN 1 ELSE 0 END AS difference
  FROM food_transfers WHERE ${column}=? AND dataset=?${scopeSql}${dateSql}
   AND (?='' OR instr(lower(coalesce(json_extract(data,'$.dispatch.reference'),'')||' '||coalesce(json_extract(data,'$.dispatch.item.title'),'')||' '||coalesce(json_extract(data,'$.dispatch.item.controlNumber'),'')||' '||coalesce(json_extract(data,'$.sourceName'),'')||' '||coalesce(json_extract(data,'$.destinationName'),'')),?)>0)
 ) `;
 const condition=status==='all'?'1=1':status==='differences'?'difference=1':`status='${status}'`;
 return {query,before,sql,condition,window,args:[location,dataset,...(allowedLocationIds?[...allowedLocationIds,...allowedLocationIds]:[]),...(start?[start,end]:[]),query,query]};
}
export type TransferTotals=TransferPage['totals'];
