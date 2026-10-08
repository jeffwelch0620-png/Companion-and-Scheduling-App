import type {Workspace} from './types';
import {calendarDate} from './schedule-policy';
import {localDate,localInstant,nextDate} from './local-time';
import {AppError,requireThat} from './validation';

export function wasteReportQuery(w:Workspace,dataset:string,url:URL,revision:number){
 const today=localDate(new Date().toISOString(),w.location.timezone),from=calendarDate(url.searchParams.get('from')??today,'Start date'),through=calendarDate(url.searchParams.get('through')??today,'End date');
 requireThat(from<=through&&Date.parse(through)-Date.parse(from)<=30*86400000,'Choose up to 31 days in date order.');
 const after=Number(url.searchParams.get('after')??0);requireThat(Number.isSafeInteger(after)&&after>=0,'Invalid waste cursor.');
 if(after)requireThat(url.searchParams.has('revision')&&Number(url.searchParams.get('revision'))===revision,'Food records changed. Refresh the waste report from its first page.',409);
 let start:string,end:string;try{start=localInstant(from,'00:00',w.location.timezone,'earlier');end=localInstant(nextDate(through),'00:00',w.location.timezone,'earlier')}catch{throw new AppError(400,'This report date boundary needs review in the restaurant timezone.')}
 const sql=`WITH observations AS (
  SELECT h.sequence,h.record_id,h.revision,r.title,json_extract(h.event,'$.waste') AS waste,
   EXISTS(SELECT 1 FROM food_history v WHERE v.location_id=h.location_id AND v.record_id=h.record_id AND json_extract(v.event,'$.wasteVoid.wasteRevision')=h.revision) AS voided,
   EXISTS(SELECT 1 FROM food_history v WHERE v.location_id=h.location_id AND v.record_id=h.record_id AND json_extract(v.event,'$.invoiceVoid.invoiceRevision')=json_extract(h.event,'$.waste.cost.sku.priceSource.invoiceRevision')) AS invalid_price
  FROM food_history h JOIN food_records r ON r.id=h.record_id AND r.location_id=h.location_id
  WHERE h.location_id=? AND r.dataset=? AND h.at>=? AND h.at<? AND json_type(h.event,'$.waste')='object'
 ), priced AS (SELECT *,CASE WHEN invalid_price=0 AND json_type(waste,'$.cost.estimatedCents')='integer' THEN json_extract(waste,'$.cost.estimatedCents') ELSE NULL END AS estimate FROM observations) `;
 const summary="count(*) AS entries,coalesce(sum(voided),0) AS voided,coalesce(sum(CASE WHEN voided=0 AND estimate IS NOT NULL THEN 1 ELSE 0 END),0) AS costed,total(CASE WHEN voided=0 THEN estimate ELSE NULL END) AS estimate";
 return {from,through,after,sql,summary,args:[w.location.id,dataset,start,end]};
}
