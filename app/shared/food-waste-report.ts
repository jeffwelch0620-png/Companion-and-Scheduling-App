import type {FoodWaste} from './food-waste';
import type {Workspace} from './types';
import {requireThat} from './validation';
import {wasteReportQuery} from './food-waste-query';

export type WasteTotals={entries:number;voided:number;active:number;costed:number;uncosted:number;knownEstimatedCents:number|null};
export type WasteReport={from:string;through:string;timezone:string;revision:number;totals:WasteTotals;reasons:(WasteTotals&{reason:string})[];entries:{sequence:number;recordId:string;revision:number;waste:FoodWaste;currentTitle:string;voided:boolean;priceSourceVoided:boolean}[];next:number|null};
type DB=Pick<D1Database,'prepare'|'batch'>;
export type TotalRow={entries:number;voided:number;costed:number;estimate:number;reason?:string};
export const wasteTotals=(r:TotalRow):WasteTotals=>({entries:r.entries,voided:r.voided,active:r.entries-r.voided,costed:r.costed,uncosted:r.entries-r.voided-r.costed,knownEstimatedCents:Number.isSafeInteger(r.estimate)?r.estimate:null});
export async function wasteReport(db:DB,w:Workspace,dataset:string,url:URL,revision:number,exportAll=false):Promise<WasteReport>{
 const {from,through,after,sql,summary,args}=wasteReportQuery(w,dataset,url,revision);
 if(exportAll){requireThat(after===0,'A waste export must include the whole selected range.');requireThat(url.searchParams.has('revision')&&url.searchParams.get('revision')!==''&&Number(url.searchParams.get('revision'))===revision,'Food records changed. Refresh the waste report before downloading.',409);}
 const result=await db.batch([
  db.prepare(sql+`SELECT ${summary} FROM priced`).bind(...args),
  db.prepare(sql+`SELECT json_extract(waste,'$.reason') AS reason,${summary} FROM priced GROUP BY reason`).bind(...args),
  db.prepare(sql+'SELECT sequence,record_id,revision,title,waste,voided,invalid_price FROM priced WHERE sequence>? ORDER BY sequence LIMIT ?').bind(...args,after,exportAll?501:21),
 ]);
 if(exportAll)requireThat(result[2].results.length<=500,'This range has more than 500 waste entries. Narrow the dates; no partial export was produced.',413);
 const entries=(result[2].results as {sequence:number;record_id:string;revision:number;title:string;waste:string;voided:number;invalid_price:number}[]).slice(0,exportAll?500:20).map(r=>({sequence:r.sequence,recordId:r.record_id,revision:r.revision,currentTitle:r.title,waste:JSON.parse(r.waste) as FoodWaste,voided:!!r.voided,priceSourceVoided:!!r.invalid_price}));
 return {from,through,timezone:w.location.timezone,revision,totals:wasteTotals(result[0].results[0] as TotalRow),reasons:(result[1].results as TotalRow[]).map(r=>({...wasteTotals(r),reason:r.reason!})),entries,next:!exportAll&&result[2].results.length>20?entries.at(-1)!.sequence:null};
}
