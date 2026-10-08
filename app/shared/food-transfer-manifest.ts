import type {FoodTransfer,TransferReceipt} from './food-transfer';
import type {TransferParcel} from './food-transfer-parcels';
import {calendarDate} from './schedule-policy';
import {localInstant,nextDate} from './local-time';
import {requireThat,text} from './validation';

export type ManifestParcel=Pick<TransferParcel,'id'|'tripReference'|'parcelReference'|'quantity'|'departedAt'>&{arrivedAt:string|null};
export type ManifestEntry={id:string;revision:number;reference:string;sourceName:string;destinationName:string;status:FoodTransfer['status'];item:FoodTransfer['dispatch']['item'];dispatched:number;receipt:Pick<TransferReceipt,'accepted'|'rejected'|'missing'|'complete'|'receivedAt'>|null;parcels:ManifestParcel[]};
export type TransferManifest={kind:'trip-manifest';locationId:string;restaurant:string;dataset:'demo'|'operating';date:string;timezone:string;tripReference:string;direction:'incoming'|'outgoing';generatedAt:string;revision:number;complete:true;counts:{transfers:number;parcels:number;arrived:number;awaiting:number};entries:ManifestEntry[]};
type ManifestRow={id:string;revision:number;status:FoodTransfer['status'];source_name:string;destination_name:string;dispatch:string;receipt:string|null;parcel:string};
export async function readTransferManifest(db:Pick<D1Database,'prepare'>,url:URL,location:{id:string;name:string;timezone:string},dataset:'demo'|'operating',revision:number,allowedLocationIds?:readonly string[]):Promise<TransferManifest>{
 const date=calendarDate(url.searchParams.get('date'),'Trip departure date'),tripReference=text(url.searchParams.get('trip'),'Exact trip reference',150),direction=url.searchParams.get('view')??'outgoing';
 requireThat(direction==='incoming'||direction==='outgoing','Choose incoming or outgoing transfers.');
 requireThat(!url.searchParams.has('recordId'),'Choose a manifest or a single transfer.');
 const start=localInstant(date,'00:00',location.timezone),end=localInstant(nextDate(date),'00:00',location.timezone);
 const column=direction==='incoming'?'destination_id':'source_id';
 const placeholders=allowedLocationIds?.map(()=>'?').join(',');
 const scopeSql=allowedLocationIds?allowedLocationIds.length?` AND t.source_id IN (${placeholders}) AND t.destination_id IN (${placeholders})`:' AND 1=0':'';
 // Match the exact stored label and restaurant day. Limit before decoding; never return a partial manifest.
 const result=await db.prepare(`SELECT t.id,t.revision,t.status,json_extract(t.data,'$.sourceName') AS source_name,json_extract(t.data,'$.destinationName') AS destination_name,json_extract(t.data,'$.dispatch') AS dispatch,json_extract(t.data,'$.receipt') AS receipt,p.value AS parcel
 FROM food_transfers t,json_each(t.data,'$.parcels') p
 WHERE t.${column}=? AND t.dataset=?${scopeSql} AND t.status<>'voided' AND json_extract(p.value,'$.void') IS NULL
 AND json_extract(p.value,'$.tripReference')=? AND julianday(json_extract(p.value,'$.departedAt'))>=julianday(?) AND julianday(json_extract(p.value,'$.departedAt'))<julianday(?)
 ORDER BY t.sequence,CAST(p.key AS INTEGER) LIMIT 201`).bind(location.id,dataset,...(allowedLocationIds?[...allowedLocationIds,...allowedLocationIds]:[]),tripReference,start,end).all<ManifestRow>();
 requireThat(result.results.length<=200,'This trip has more than 200 matching parcels. Review the individual transfers; no partial manifest was produced.',413);
 const groups=new Map<string,ManifestEntry>();let arrived=0;
 for(const row of result.results){
  const d=JSON.parse(row.dispatch) as FoodTransfer['dispatch'],receipt=row.receipt?JSON.parse(row.receipt) as TransferReceipt:null,p=JSON.parse(row.parcel) as TransferParcel;
  let entry=groups.get(row.id);if(!entry){entry={id:row.id,revision:row.revision,status:row.status,reference:d.reference,sourceName:row.source_name,destinationName:row.destination_name,item:d.item,dispatched:d.quantity,receipt:receipt?{accepted:receipt.accepted,rejected:receipt.rejected,missing:receipt.missing,complete:receipt.complete,receivedAt:receipt.receivedAt}:null,parcels:[]};groups.set(row.id,entry);}
  entry.parcels.push({id:p.id,tripReference:p.tripReference,parcelReference:p.parcelReference,quantity:p.quantity,departedAt:p.departedAt,arrivedAt:p.arrival?.arrivedAt??null});if(p.arrival)arrived++;
 }
 return {kind:'trip-manifest',locationId:location.id,restaurant:location.name,dataset,date,timezone:location.timezone,tripReference,direction,generatedAt:new Date().toISOString(),revision,complete:true,counts:{transfers:groups.size,parcels:result.results.length,arrived,awaiting:result.results.length-arrived},entries:[...groups.values()]};
}
// Only transport rows are exported: cumulative receiving quantities must never look like per-parcel quantities.
export function transferManifestCsv(m:TransferManifest){
 const cell=(v:string|number)=>{let s=String(v);if(typeof v==='string'&&/^[\s]*[=+\-@\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
 const rows:(string|number)[][]=[['snapshot_at_utc','restaurant','dataset','departure_day','timezone','direction','exact_trip_reference','food_revision','transfer_id','transfer_revision','transfer_reference','source','destination','item','control_number','original_count_unit','pack_count','unit_quantity','unit_uom','parcel_id','parcel_reference','parcel_quantity','departed_at_utc','arrival_recorded_at_utc','receiving_boundary']];
 for(const e of m.entries)for(const p of e.parcels){const pack=e.item.pack;rows.push([m.generatedAt,m.restaurant,m.dataset,m.date,m.timezone,m.direction,m.tripReference,m.revision,e.id,e.revision,e.reference,e.sourceName,e.destinationName,e.item.title,e.item.controlNumber,pack.purchaseUnit,pack.packCount??'',pack.unitQty??'',pack.unitUOM,p.id,p.parcelReference,p.quantity,p.departedAt,p.arrivedAt??'','Transport snapshot only; review the whole transfer destination check separately.']);}
 return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
