import {authenticateWorkspace,workspace} from './service';
import {maintenanceManager,maintenanceOwner} from './maintenance';
import {buildServiceCostReport,costReportRange,type ServiceCostSource} from './maintenance-cost-report';
import {AppError,id,requireThat} from './validation';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff',...(status===405?{Allow:'GET'}:{})}});
type SourceRow=Omit<ServiceCostSource,'cost'>&{costJson:string|null};
export async function handleServiceCostReport(request:Request,binding?:D1Database){
 try{
  requireThat(request.method==='GET','Method not allowed.',405);
  const p=new URL(request.url).searchParams;
  requireThat([...p.keys()].every(k=>['locationId','from','through'].includes(k))&&['locationId','from','through'].every(k=>p.getAll(k).length===1),'Choose one restaurant and one service date range.');
  const locationId=id(p.get('locationId')),auth=await authenticateWorkspace(request,binding),initial=await workspace(auth.db,auth.identity,locationId),w=initial.value;
  requireThat(maintenanceManager(w.me),'Restaurant manager access is required.',403);
  const now=new Date().toISOString(),range=costReportRange(p.get('from'),p.get('through'),now,w.location.timezone),owner=maintenanceOwner(w.me);
  // Apply visibility before the row bound; hidden retired/filed plans cannot
  // change a manager's overflow or counts. Only the latest cost event is loaded.
  const result=await auth.db.prepare(`SELECT r.id AS planId,r.revision AS planRevision,json_extract(r.data,'$.status') AS planStatus,r.archived_at AS archivedAt,
   json_extract(s.value,'$.id') AS serviceId,json_extract(s.value,'$.date') AS serviceDate,
   json_extract(s.value,'$.plan.title') AS planTitle,json_extract(s.value,'$.plan.equipment') AS equipment,
   json_extract(s.value,'$.plan.asset.id') AS assetId,json_extract(s.value,'$.plan.asset.facts.assetTag') AS assetTag,json_extract(s.value,'$.plan.asset.facts.title') AS assetTitle,
   json_extract(s.value,'$.evidence') AS serviceEvidence,json_extract(s.value,'$.voided.reason') AS voidReason,json_extract(s.value,'$.costHistory[#-1]') AS costJson
   FROM records r JOIN json_each(r.data,'$.services') s
   WHERE r.location_id=? AND r.kind='maintenance' AND (?=1 OR (r.archived_at IS NULL AND json_extract(r.data,'$.status')='active'))
   AND json_extract(s.value,'$.date')>=? AND json_extract(s.value,'$.date')<=?
   ORDER BY json_extract(s.value,'$.date') DESC,r.id,s.key LIMIT 501`).bind(locationId,owner?1:0,range.from,range.through).all<SourceRow>();
  requireThat(result.results.length<=500,'More than 500 service records match. Narrow the service dates; no partial total is shown.',413);
  const rows=result.results.map(({costJson,...s})=>({...s,cost:costJson?JSON.parse(costJson):null}));
  const fresh=await authenticateWorkspace(request,binding);
  const current=await fresh.db.prepare('SELECT m.revision AS memberRevision,l.revision AS locationRevision FROM memberships m JOIN locations l ON l.id=m.location_id WHERE m.id=? AND m.location_id=? AND m.auth_user_id=? AND m.active=1').bind(w.me.id,locationId,auth.identity.authUserId).first<{memberRevision:number;locationRevision:number}>();
  requireThat(fresh.authUserId===auth.authUserId&&current?.memberRevision===initial.membershipRevision&&current?.locationRevision===w.location.revision,'The workspace or your access changed. Refresh before reviewing costs.',409);
  return json(buildServiceCostReport(w,range,rows,now));
 }catch(e){return json({error:e instanceof AppError?e.message:'The service-cost review is unavailable.'},e instanceof AppError?e.status:503);}
}
