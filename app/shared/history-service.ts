import { authenticateWorkspace, boundedJson, recordFromRow, workspace } from './service';
import {restaurantAccessWriteGuard,requireRestaurantAccess} from './restaurant-access';
import { publicWorkspace, visible } from './domain';
import { canFileRecord, historyBatchSize, historyManager, historyPlan, recordDependencies } from './record-history';
import { personName, type WorkRecord, type Workspace } from './types';
import { AppError, id, object, requireThat, text } from './validation';
import { localDate, localInstant, nextDate } from './local-time';
import { checkinReader } from './shift-checkin';

type Database=Pick<D1Database,'prepare'|'batch'>;
type Stored={id:string;location_id:string;kind:WorkRecord['kind'];owner_id:string;area:string;revision:number;data:string;updated_at:string;archived_at:string|null;archived_by:string|null};
type Selection={id:string;revision:number};
export type HistoryItem={record:WorkRecord;archivedAt:string;archivedBy:string};
export type HistoryPage={items:HistoryItem[];nextCursor:string|null;formerMembers:{id:string;name:string}[]};
export type HistoryPreview={records:{id:string;revision:number;label:string;kind:string}[];workspaceRevision:number;activeCount:number;remainingCandidates:number;before:string};
export type HistoryRestore={records:WorkRecord[];workspaceRevision:number;activeCount:number};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff'}});
const recordKinds=['learningcase','achievement','opening','catering','recognition','staffidea','compliance','equipment','hirechecklist','maintenance','servicecontact','promotion','hirehandoff','guestreview','shift','attendance','shiftcheckin','message','request','leadership','availability','close','task','handoff','goal','development','feedback','order','coverage','staffing'];
function date(value:unknown,label:string){const v=text(value,label,10);requireThat(/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,'Choose a valid '+label.toLowerCase()+'.');return v;}
function cutoff(w:Workspace,value:unknown,at:string){const before=date(value,'History date');requireThat(before<=nextDate(localDate(at,w.location.timezone),-30),'Keep at least the most recent 30 days in the active workspace.');return before;}
async function dependencies(db:Database,w:Workspace,initial:Stored[]){
  const loaded=new Map<string,WorkRecord>(w.records.map(r=>[r.id,r]));for(const row of initial)loaded.set(row.id,recordFromRow(row));
  const archived=new Map<string,Stored>(initial.filter(r=>r.archived_at).map(r=>[r.id,r]));
  let frontier=initial.map(recordFromRow);const attempted=new Set<string>();
  for(let depth=0;frontier.length;depth++){
    const ids=[...new Set(frontier.flatMap(recordDependencies))].filter(id=>!loaded.has(id)&&!attempted.has(id));
    if(!ids.length)break;requireThat(depth<8&&archived.size+ids.length<=200,'This history chain needs a smaller review. Open the related records separately.',409);
    const statements=[];for(let i=0;i<ids.length;i+=50){const part=ids.slice(i,i+50);for(const id of part)attempted.add(id);statements.push(db.prepare(`SELECT * FROM records WHERE location_id=? AND id IN (${part.map(()=>'?').join(',')})`).bind(w.location.id,...part));}
    const rows=(await db.batch(statements)).flatMap(r=>r.results as Stored[]);frontier=rows.map(recordFromRow);
    for(const row of rows){loaded.set(row.id,recordFromRow(row));if(row.archived_at)archived.set(row.id,row);}
  }
  return {w:{...w,records:[...loaded.values()]},archived:[...archived.values()]};
}
async function restorePlan(db:Database,w:Workspace,recordId:string){
  const row=await db.prepare('SELECT * FROM records WHERE location_id=? AND id=? AND archived_at IS NOT NULL').bind(w.location.id,recordId).first<Stored>();
  requireThat(row,'This record is not in history. Reload before trying again.',404);
  // A check-in carries its immutable shift snapshot. Restore only the response,
  // never the schedule, so the employee can correct their own archived words.
  const record=recordFromRow(row);
  if(record.kind==='shiftcheckin'){
    requireThat(w.me.position!=='Dishwasher'&&checkinReader(record,w.me),'You cannot restore this check-in.',403);
    requireThat(w.records.length<3000,'File older completed work before restoring this record.',409);
    return [record];
  }
  const bundle=await dependencies(db,w,[row]);
  requireThat(historyManager(w)&&bundle.archived.every(r=>visible(recordFromRow(r),w.me,bundle.w)&&canFileRecord(bundle.w,recordFromRow(r))),'You cannot restore these records. Ask the responsible manager.',403);
  requireThat(bundle.archived.length<=historyBatchSize,'Restore the related records first, then open this record again.',409);
  requireThat(w.records.length+bundle.archived.length<=3000,'File older completed work before restoring these records.',409);
  const safe=publicWorkspace(bundle.w).records;
  return bundle.archived.map(row=>safe.find(r=>r.id===row.id)!);
}
async function listHistory(db:Database,w:Workspace,url:URL):Promise<HistoryPage>{
  const params:unknown[]=[w.location.id],where=['location_id=?','archived_at IS NOT NULL'];
  const kind=url.searchParams.get('kind');if(kind){requireThat(recordKinds.includes(kind),'Choose an available record type.');where.push('kind=?');params.push(kind)}
  const dateExpression="julianday(CASE kind WHEN 'shift' THEN json_extract(data,'$.start') WHEN 'attendance' THEN json_extract(data,'$.shift.start') WHEN 'shiftcheckin' THEN json_extract(data,'$.shift.start') ELSE updated_at END)";
  const from=url.searchParams.get('from'),through=url.searchParams.get('through');
  if(from){where.push(dateExpression+'>=julianday(?)');params.push(localInstant(date(from,'Start date'),'00:00',w.location.timezone,'earlier'))}if(through){where.push(dateExpression+'<julianday(?)');params.push(localInstant(nextDate(date(through,'End date')),'00:00',w.location.timezone,'earlier'))}requireThat(!from||!through||from<=through,'The end date must follow the start date.');
  const cursor=url.searchParams.get('cursor');if(cursor){const row=await db.prepare('SELECT id,archived_at FROM records WHERE location_id=? AND id=? AND archived_at IS NOT NULL').bind(w.location.id,id(cursor)).first<{id:string;archived_at:string}>();requireThat(row,'History changed. Return to the first page.',409);where.push('(archived_at<? OR (archived_at=? AND id<?))');params.push(row.archived_at,row.archived_at,row.id)}
  const rows=(await db.prepare(`SELECT * FROM records WHERE ${where.join(' AND ')} ORDER BY archived_at DESC,id DESC LIMIT 51`).bind(...params).all<Stored>()).results;
  const page=rows.slice(0,50),bundle=await dependencies(db,w,page),safe=publicWorkspace(bundle.w);
  return {items:page.flatMap(row=>{const record=safe.records.find(r=>r.id===row.id);return record?[{record,archivedAt:row.archived_at!,archivedBy:personName(w,row.archived_by??undefined,'Manager')}]:[]}),nextCursor:rows.length>50?page.at(-1)!.id:null,formerMembers:safe.formerMembers??[]};
}
function selection(value:unknown):Selection[]{requireThat(Array.isArray(value)&&value.length>0&&value.length<=historyBatchSize,'Review 1–50 records at a time.');const rows=value.map(v=>{const r=object(v);requireThat(Number.isInteger(r.revision)&&Number(r.revision)>0,'A current record revision is required.');return {id:id(r.id),revision:Number(r.revision)}});requireThat(new Set(rows.map(r=>r.id)).size===rows.length,'Choose each record once.');return rows;}
async function digest(value:unknown){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');}

export async function handleRecordHistory(request:Request,binding?:D1Database):Promise<Response>{
  try{
    requireThat(['GET','POST'].includes(request.method),'Method not allowed.',405);
    const {db,identity}=await authenticateWorkspace(request,binding),url=new URL(request.url);
    let body:Record<string,unknown>={};
    if(request.method==='POST'){requireThat(request.headers.get('Origin')===url.origin&&request.headers.get('Sec-Fetch-Site')!=='cross-site','Open this action from JMAX.',403);requireThat(request.headers.get('Content-Type')?.split(';')[0]==='application/json','Use a JSON request.',415);body=object(await boundedJson(request.body,20000));}
    const locationId=id(request.method==='GET'?url.searchParams.get('locationId'):body.locationId),{value:w,membershipRevision}=await workspace(db,identity,locationId),at=new Date().toISOString();
    const reply=async(value:unknown)=>{
      const fresh=await authenticateWorkspace(request,binding);
      requireThat(fresh.authUserId===identity.authUserId,'Your sign-in changed. Reopen history.',409);
      await workspace(fresh.db,fresh.identity,locationId);
      const current=await fresh.db.prepare('SELECT m.revision AS memberRevision,l.revision AS locationRevision FROM memberships m JOIN locations l ON l.id=m.location_id WHERE m.id=? AND m.location_id=? AND m.auth_user_id=? AND m.active=1').bind(w.me.id,locationId,identity.authUserId).first<{memberRevision:number;locationRevision:number}>();
      requireThat(current&&current.memberRevision===membershipRevision&&current.locationRevision===w.location.revision,'The workspace or your access changed. Reopen history.',409);
      return json(value);
    };
    if(request.method==='GET'){
      if(url.searchParams.has('preview')){requireThat(historyManager(w),'A manager must review completed records.',403);const before=cutoff(w,url.searchParams.get('before'),at),plan=historyPlan(w,before),safe=publicWorkspace(w);return await reply({records:plan.records.map(r=>{const shown=safe.records.find(s=>s.id===r.id);return {id:r.id,revision:r.revision,label:shown?(shown.kind==='equipment'?shown.data.assetTag+' · '+shown.data.title:'title' in shown.data?shown.data.title:personName(w,shown.ownerId)+' · '+shown.kind):'Private completed record',kind:shown?r.kind:'private'}}),workspaceRevision:w.location.revision,activeCount:w.records.length,remainingCandidates:plan.remainingCandidates,before} satisfies HistoryPreview);}
      if(url.searchParams.has('restore'))return await reply({records:await restorePlan(db,w,id(url.searchParams.get('restore'))),workspaceRevision:w.location.revision,activeCount:w.records.length} satisfies HistoryRestore);
      if(url.searchParams.has('recordId')){const row=await db.prepare('SELECT * FROM records WHERE location_id=? AND id=? AND archived_at IS NOT NULL').bind(locationId,id(url.searchParams.get('recordId'))).first<Stored>();requireThat(row,'This history record is unavailable.',404);const bundle=await dependencies(db,w,[row]),safe=publicWorkspace(bundle.w);const shown=safe.records.find(r=>r.id===row.id);requireThat(shown,'This history record is unavailable.',404);return await reply({workspace:safe,recordId:row.id,archivedAt:row.archived_at,canRestore:shown.kind==='shiftcheckin'?w.me.position!=='Dishwasher'&&checkinReader(shown,w.me):bundle.archived.every(r=>visible(recordFromRow(r),w.me,bundle.w)&&canFileRecord(bundle.w,recordFromRow(r)))&&historyManager(w)});}
      return await reply(await listHistory(db,w,url));
    }
    requireThat(body.action==='restore'||historyManager(w),'A manager must review completed records.',403);
    requireThat(body.confirmed===true,'Confirm the exact reviewed records.');
    requireThat(body.action==='archive'||body.action==='restore','Choose file or restore.');
    const requestId=id(body.requestId),fingerprint=await digest(body),rows=selection(body.records);
    const prior=await db.prepare('SELECT fingerprint,result FROM command_receipts WHERE location_id=? AND actor_id=? AND request_id=?').bind(locationId,w.me.id,requestId).first<{fingerprint:string;result:string}>();
    if(prior){requireThat(prior.fingerprint===fingerprint,'This request identifier already belongs to another change.',409);return json(JSON.parse(prior.result));}
    requireThat(body.workspaceRevision===w.location.revision,'The workspace changed. Review the records again before saving.',409);
    const archiving=body.action==='archive';
    const planned=archiving?historyPlan(w,cutoff(w,body.before,at)).records:await restorePlan(db,w,id(body.recordId));
    requireThat(planned.length===rows.length&&planned.every(r=>rows.some(s=>s.id===r.id&&s.revision===r.revision)),'The review changed. Reload the exact records before saving.',409);
    const token=crypto.randomUUID(),gate='EXISTS(SELECT 1 FROM locations WHERE id=? AND last_command=?)';
    const result={action:body.action,count:rows.length,workspaceRevision:w.location.revision+1};
    const policy=await restaurantAccessWriteGuard(db,identity,locationId);
    const statements=[db.prepare(`UPDATE locations SET revision=revision+1,last_command=? WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM memberships WHERE id=? AND auth_user_id=? AND active=1 AND revision=?) AND ${policy.sql}`).bind(token,locationId,w.location.revision,w.me.id,identity.authUserId,membershipRevision,...policy.values)];
    for(const row of rows){statements.push(db.prepare(`UPDATE records SET archived_at=?,archived_by=?,revision=revision+1${archiving?'':',updated_at=?'} WHERE location_id=? AND id=? AND revision=? AND archived_at IS ${archiving?'NULL':'NOT NULL'} AND ${gate}`).bind(...(archiving?[at,w.me.id]:[null,null,at]),locationId,row.id,row.revision,locationId,token));statements.push(db.prepare(`INSERT INTO audit_events(id,location_id,actor_id,action,record_id,at,revision) SELECT ?,?,?,?,?,?,? WHERE ${gate}`).bind(crypto.randomUUID(),locationId,w.me.id,'history.'+body.action,row.id,at,w.location.revision+1,locationId,token));}
    statements.push(db.prepare(`INSERT INTO command_receipts(location_id,actor_id,request_id,fingerprint,result) SELECT ?,?,?,?,? WHERE ${gate}`).bind(locationId,w.me.id,requestId,fingerprint,JSON.stringify(result),locationId,token));
    const changed=await db.batch(statements);
    if(!changed[0].meta.changes){await requireRestaurantAccess(db,identity,locationId);const repeated=await db.prepare('SELECT fingerprint,result FROM command_receipts WHERE location_id=? AND actor_id=? AND request_id=?').bind(locationId,w.me.id,requestId).first<{fingerprint:string;result:string}>();if(repeated&&repeated.fingerprint===fingerprint)return json(JSON.parse(repeated.result));throw new AppError(409,'The workspace or your access changed. Reload before trying again.');}
    return json(result);
  }catch(e){if(e instanceof AppError)return json({error:e.message},e.status);console.error(JSON.stringify({event:'record_history_failed',errorType:e instanceof Error?e.name:'unknown'}));return json({error:'History could not confirm this change. Retrying the same request is safe.'},503);}
}
