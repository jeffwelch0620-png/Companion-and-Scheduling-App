import type {Workspace} from './types';
import type {ServiceCost} from './maintenance-cost';
import {maintenanceManager,maintenanceOwner} from './maintenance';
import {calendarDate} from './schedule-policy';
import {localDate} from './local-time';
import {requireThat} from './validation';

export type CostReportRange={from:string;through:string};
export type ServiceCostSource={planId:string;planRevision:number;planStatus:string;archivedAt:string|null;serviceId:string;serviceDate:string;planTitle:string;equipment:string;assetId:string|null;assetTag:string|null;assetTitle:string|null;serviceEvidence:string;voidReason:string|null;cost:ServiceCost|null};
export function costReportRange(from:unknown,through:unknown,now:string,zone:string):CostReportRange{
 const start=calendarDate(from,'First service date'),end=calendarDate(through,'Last service date');
 const days=(Date.parse(end+'T12:00:00Z')-Date.parse(start+'T12:00:00Z'))/86400000;
 requireThat(days>=0&&days<366,'Choose 1–366 service dates, with the end on or after the start.');
 requireThat(end<=localDate(now,zone),'Service dates cannot be in the future for this restaurant.');
 return {from:start,through:end};
}
const referenceKey=(r:ServiceCostSource)=>r.cost?.kind==='recorded'?r.cost.documentDate+'|'+r.cost.sourceRef.trim().replace(/\s+/g,' ').toLowerCase():'';
const compareReferenceText=(a:string,b:string)=>a<b?-1:a>b?1:0;
type ReferenceEntry=ServiceCostSource&{includedCents:number|null};
// Group only current, included allocations in this authorized report. A matching
// free-text reference is a review lead, not a supplier identity or a duplicate.
export function serviceCostReferenceGroups(entries:ReferenceEntry[]){
 const grouped=new Map<string,ReferenceEntry[]>();
 for(const row of entries){if(row.includedCents===null)continue;const key=referenceKey(row);const group=grouped.get(key)??[];group.push(row);grouped.set(key,group);}
 return [...grouped.entries()].filter(([,rows])=>rows.length>1).sort(([a],[b])=>compareReferenceText(a,b)).map(([key,rows],i)=>({
  id:'reference-'+(i+1),documentDate:key.slice(0,10),
  normalizedReference:key.slice(11),references:[...new Set(rows.map(r=>r.cost?.kind==='recorded'?r.cost.sourceRef:''))].sort(),
  services:rows.length,plans:new Set(rows.map(r=>r.planId)).size,amountCents:rows.reduce((sum,r)=>sum+r.includedCents!,0),
  members:rows.map(r=>({planId:r.planId,serviceId:r.serviceId})).sort((a,b)=>compareReferenceText(a.planId,b.planId)||compareReferenceText(a.serviceId,b.serviceId)),
 }));
}
export function validServiceCostReferences(r:ServiceCostReport){
 try{
  const expected=serviceCostReferenceGroups(r.entries);
  if(!Array.isArray(r.referenceGroups)||JSON.stringify(expected)!==JSON.stringify(r.referenceGroups)||r.totals.repeatedReferenceGroups!==expected.length)return false;
  return r.entries.every(e=>e.repeatedReference===expected.some(g=>g.members.some(m=>m.planId===e.planId&&m.serviceId===e.serviceId)));
 }catch{return false;}
}
export function buildServiceCostReport(w:Workspace,range:CostReportRange,sources:ServiceCostSource[],now:string){
 requireThat(maintenanceManager(w.me)&&w.me.locationId===w.location.id,'Restaurant manager access is required.',403);
 costReportRange(range.from,range.through,now,w.location.timezone);
 requireThat(sources.length<=500,'More than 500 service records match. Narrow the service dates; no partial total is shown.',413);
 const entries=sources.map(s=>{
  requireThat(s.serviceDate>=range.from&&s.serviceDate<=range.through,'The report scope changed. Refresh the report.',409);
  requireThat(maintenanceOwner(w.me)||s.planStatus==='active'&&!s.archivedAt,'This report includes unavailable history.',403);
  const c=s.cost,valid=c?.kind==='recorded'&&c.currency==='USD'&&Number.isSafeInteger(c.amountCents)&&c.amountCents>=0&&c.amountCents<=999999999&&typeof c.sourceRef==='string'&&!!c.sourceRef.trim()&&typeof c.allocation==='string'&&!!c.allocation.trim()&&/^\d{4}-\d{2}-\d{2}$/.test(c.documentDate);
  return {...s,costStatus:valid?'recorded' as const:c?.kind==='withdrawn'?'withdrawn' as const:c?'invalid' as const:'missing' as const,recordedCents:valid?c.amountCents:null,includedCents:!s.voidReason&&valid?c.amountCents:null,repeatedReference:false};
 }).sort((a,b)=>b.serviceDate.localeCompare(a.serviceDate)||a.planId.localeCompare(b.planId)||a.serviceId.localeCompare(b.serviceId));
 const seen=new Set<string>();for(const r of entries){const key=r.planId+'|'+r.serviceId;requireThat(!seen.has(key),'Duplicate service identities need source review; no total is shown.',409);seen.add(key);}
 const referenceGroups=serviceCostReferenceGroups(entries),repeatedReferenceGroups=referenceGroups.length;
 for(const group of referenceGroups)for(const row of entries)if(group.members.some(m=>m.planId===row.planId&&m.serviceId===row.serviceId))row.repeatedReference=true;
 const aggregate=(rows:typeof entries)=>({services:rows.length,recorded:rows.filter(r=>r.includedCents!==null).length,noCharge:rows.filter(r=>r.includedCents===0).length,unknown:rows.filter(r=>!r.voidReason&&r.includedCents===null).length,voided:rows.filter(r=>r.voidReason).length,amountCents:rows.reduce((n,r)=>n+(r.includedCents??0),0)});
 const groups=new Map<string,{key:string;assetId:string|null;label:string;entries:typeof entries}>();
 for(const r of entries){const key=r.assetId?'asset:'+r.assetId:'unlinked:'+r.planId;const group=groups.get(key)??{key,assetId:r.assetId,label:r.assetId?(r.assetTag??'Unknown tag')+' · '+(r.assetTitle??r.equipment):'No checked asset link · '+r.equipment,entries:[]};group.entries.push(r);groups.set(key,group);}
 return {schemaVersion:'jmax-service-cost-report.v1' as const,complete:true as const,locationId:w.location.id,restaurant:w.location.name,viewerId:w.me.id,workspaceRevision:w.location.revision,timezone:w.location.timezone,generatedAt:now,...range,coverage:maintenanceOwner(w.me)?'active-retired-filed' as const:'active-unfiled' as const,totals:{...aggregate(entries),plans:new Set(entries.map(r=>r.planId)).size,repeatedReferenceGroups},referenceGroups,assets:[...groups.values()].map(g=>({key:g.key,assetId:g.assetId,label:g.label,plans:new Set(g.entries.map(r=>r.planId)).size,...aggregate(g.entries)})),entries};
}
export type ServiceCostReport=ReturnType<typeof buildServiceCostReport>;
const csvCell=(v:string|number|null)=>{let s=String(v??'');if(typeof v==='string'&&/^[\s]*[=+\-@\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
export function serviceCostReportCsv(r:ServiceCostReport){
 requireThat(r.schemaVersion==='jmax-service-cost-report.v1'&&r.complete===true&&r.entries.length===r.totals.services&&r.entries.length<=500&&validServiceCostReferences(r),'A complete service report is required.',409);
 const header=['row_type','restaurant','restaurant_id','snapshot_utc','workspace_revision','from_service_date','through_service_date','timezone','coverage','plan_id','plan_revision','plan_status','filed_at','service_id','service_date','plan_title_at_service','equipment_at_service','asset_id','asset_tag_at_service','asset_title_at_service','service_evidence','void_reason','cost_status','recorded_usd','included_usd','cost_evidence_date','cost_reference','allocation','cost_recorded_at','cost_actor_id','cost_note','repeated_reference_review','reference_review_group','reference_group_services','reference_group_recorded_usd','report_services','report_costed','report_unknown','report_voided','report_known_subtotal_usd','boundary'];
 const common=[r.restaurant,r.locationId,r.generatedAt,r.workspaceRevision,r.from,r.through,r.timezone,r.coverage];
 const amount=(n:number|null)=>n===null?'':(n/100).toFixed(2),boundary='Recorded allocated service costs; not accounting or payment totals. Unknown costs are not zero. Repeated references require allocation review; no automatic deduction. Group subtotals repeat per service; do not sum that column.';
 const summary=['report',...common,...Array(26).fill(''),r.totals.services,r.totals.recorded,r.totals.unknown,r.totals.voided,r.totals.recorded?amount(r.totals.amountCents):'',boundary];
 const rows=r.entries.map(e=>{const c=e.cost,recorded=c?.kind==='recorded'?c:null,group=r.referenceGroups.find(g=>g.members.some(m=>m.planId===e.planId&&m.serviceId===e.serviceId));return ['service',...common,e.planId,e.planRevision,e.planStatus,e.archivedAt,e.serviceId,e.serviceDate,e.planTitle,e.equipment,e.assetId,e.assetTag,e.assetTitle,e.serviceEvidence,e.voidReason,e.costStatus,amount(e.recordedCents),amount(e.includedCents),recorded?.documentDate??'',recorded?.sourceRef??'',recorded?.allocation??'',c?.at??'',c?.by??'',c?.note??'',e.repeatedReference?'Review repeated date/reference':'',group?.id??'',group?.services??'',group?amount(group.amountCents):'',...Array(5).fill(''),boundary]});
 requireThat([summary,...rows].every(row=>row.length===header.length),'Report columns could not be verified.',409);
 return '\uFEFF'+[header,summary,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
export function createServiceCostReportLoader(publish:(r:{data:ServiceCostReport|null;error:string})=>void,fetcher:typeof fetch=fetch){
 let generation=0,controller:AbortController|undefined;
 return {cancel(){generation++;controller?.abort();},async load(locationId:string,viewerId:string,revision:number,range:CostReportRange){
 const run=++generation;controller?.abort();controller=new AbortController();publish({data:null,error:''});
 try{const response=await fetcher('/api/operations/service-costs?'+new URLSearchParams({locationId,...range}),{cache:'no-store',signal:controller.signal}),data=await response.json() as ServiceCostReport&{error?:string};if(run!==generation)return;
 if(!response.ok)throw Error(data.error??'The cost review could not be loaded.');
 if(data?.schemaVersion!=='jmax-service-cost-report.v1'||data.complete!==true||data.locationId!==locationId||data.viewerId!==viewerId||data.workspaceRevision!==revision||data.from!==range.from||data.through!==range.through||!Array.isArray(data.entries)||data.entries.length!==data.totals?.services||data.entries.length>500||!validServiceCostReferences(data))throw Error('The restaurant or source records changed. Refresh the workspace and review again.');
 publish({data,error:''});
 }catch(e){if(run===generation)publish({data:null,error:e instanceof Error?e.message:'The cost review is unavailable.'});}
 }};
}
