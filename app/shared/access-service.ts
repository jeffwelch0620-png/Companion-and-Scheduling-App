import {requirePersonalRestaurantAssignment,restaurantAccessWriteGuard} from './restaurant-access';
import { authenticateWorkspace, boundedJson, memberFromRow, requireLocationAdministrator } from './service';
import { capabilities, type WorkRecord } from './types';
import { AppError, id, object, requireThat, text } from './validation';
import { configuredToast } from './toast-connection';
import type { ToastRoster } from './toast-roster';
import type { AccessCommand, AccessProfile, AccessResult, AccessReview, AccessState, Employment, ResponsibilityCount, AccessHistory } from './access-types';
import { calendarDate } from './schedule-policy';
import { localDate } from './local-time';
import { canonicalJobRole } from './job-role';
import { administratorRequestView, type AdministratorRequestRow } from './administrator-identity';

type Database=Pick<D1Database,'prepare'|'batch'>;
type AccountRow={id:string;location_id:string;email:string;auth_user_id:string|null;name:string;area:string;position:string;capabilities:string;qualifications:string;active:number;schedule_only?:number;revision:number;employment:string};
type ReviewRow={id:string;restaurant_guid:string;employee_id:string;source_at:string;source:string;data:string;status:AccessReview['status'];member_id:string|null;revision:number;updated_at:string};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff'}});
const activeEmployment=(hireDate:string|null=null):Employment=>({status:'active',hireDate,endedDate:null,departureReason:null,archivedAt:null});
const employment=(r:AccountRow):Employment=>r.employment?JSON.parse(r.employment):activeEmployment();
function reviewFromRow(r:ReviewRow):AccessReview {const data=JSON.parse(r.data);return {id:r.id,restaurantGuid:r.restaurant_guid,employeeId:r.employee_id,sourceAt:r.source_at,source:JSON.parse(r.source),profile:data.profile,note:data.note,status:r.status,memberId:r.member_id,revision:r.revision,updatedAt:r.updated_at};}
function profile(value:unknown,complete:boolean):AccessProfile {
  const p=object(value),name=text(p.name,'Name',200,!complete),email=text(p.email,'Login email',254,!complete).toLowerCase();
  const area=text(p.area,'Department',40,!complete),position=canonicalJobRole(text(p.position,'Primary job',100,!complete));
  requireThat(!email&&!complete||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'Use a personal login email.');
  requireThat(!area&&!complete||['BOH','FOH','Executive'].includes(area),'Choose a department.');
  requireThat(Array.isArray(p.capabilities)&&p.capabilities.length<=capabilities.length&&p.capabilities.every(c=>capabilities.includes(c)),'Choose valid permissions.');
  requireThat(Array.isArray(p.qualifications)&&p.qualifications.length<=40,'Review the station clearances.');
  const qualifications=[...new Set(p.qualifications.map(q=>text(q,'Station clearance',100)))];
  const caps=[...new Set(p.capabilities)] as AccessProfile['capabilities'];
  requireThat(!caps.includes('operations.store')||caps.includes('tasks.manage'),'Whole-restaurant operating access also requires task management.');
  requireThat(position!=='Dishwasher'||(area==='BOH'&&caps.length===0&&qualifications.every(q=>q==='Dishwasher')),'Dishwasher access uses BOH with no management permissions and only Dishwasher station clearances.');
  return {name,email,area,position,capabilities:caps,qualifications};
}
// Counts only; private employee notes and assessments never appear in access setup.
function parseResponsibilities(records:{kind:WorkRecord['kind'];owner_id:string;data:string}[]){return records.map(r=>({...r,data:JSON.parse(r.data)}))}
function outstanding(records:ReturnType<typeof parseResponsibilities>,memberId:string,now:string) {
  const open=records.filter(r=>{
    const d=r.data;
    switch(r.kind){
      case 'maintenance':return d.status==='active'&&d.managerId===memberId;
      case 'compliance':return d.status!=='closed'&&d.responsibleId===memberId;
      case 'hirehandoff':return ['awaiting-ack','accepted'].includes(d.status)&&d.schedulerId===memberId;
      case 'catering':return d.managerId===memberId&&!['completed','cancelled'].includes(d.status);
      case 'promotion':return d.managerId===memberId&&(d.status==='draft'||d.status==='review'||d.status==='approved'&&!d.internal?.outcomes?.length);
      case 'staffidea':return d.status!=='closed'&&d.managerId===memberId;
      case 'guestreview':return d.status!=='closed'&&d.managerId===memberId;
      case 'incident':return d.status!=='resolved'&&d.followUp?.ownerId===memberId;
      case 'managerlog':return d.status!=='resolved'&&r.owner_id===memberId;
      case 'shiftentry':return d.status==='draft'&&r.owner_id===memberId;
      case 'meeting':return d.status==='active'&&[r.owner_id,d.managerId].includes(memberId);
      case 'shift':return r.owner_id===memberId&&!d.cancelled&&!d.releasedAt&&d.end>now;
      case 'leadership':return r.owner_id===memberId&&d.active&&d.end>now;
      case 'close':return !['closed','cancelled'].includes(d.phase)&&[r.owner_id,d.managerId,d.verifierId,d.correction?.personId].includes(memberId);
      case 'task':return d.phase!=='closed'&&[r.owner_id,d.incomingId].includes(memberId);
      case 'handoff':return !['resolved','cancelled'].includes(d.phase)&&(d.phase==='accepted'?[r.owner_id,d.incomingId]:[r.owner_id,d.outgoingId,d.incomingId]).includes(memberId);
      case 'development':return !['approved','cancelled'].includes(d.phase)&&[r.owner_id,d.managerId,d.approverId].includes(memberId);
      case 'goal':return !['closed','cancelled','declined'].includes(d.phase)&&[r.owner_id,d.managerId].includes(memberId);
      case 'order':return r.owner_id===memberId&&d.status!=='approved';
      case 'request':return ['pending','accepted-by-replacement'].includes(d.status)&&[r.owner_id,d.replacementId].includes(memberId);
      case 'coverage':return d.status==='open'&&d.end>now&&(r.owner_id===memberId||d.volunteers?.some((v:{personId:string})=>v.personId===memberId));
      case 'availability':return d.status==='pending'&&r.owner_id===memberId;
      case 'feedback':return d.shared&&d.status!=='closed'&&r.owner_id===memberId;
      case 'staffing':return d.status==='draft'&&r.owner_id===memberId;
      default:return false;
    }
  });
  const labels:Partial<Record<WorkRecord['kind'],string>>={catering:'Active catering event briefs',staffidea:'Staff idea follow-up',maintenance:'Active maintenance plans',promotion:'Offers awaiting review or outcome',hirehandoff:'First-shift scheduling handoff',guestreview:'Guest review follow-up',compliance:'Inspection or permit follow-up',incident:'Restricted incident follow-up',managerlog:'Manager Log follow-up',shiftentry:'Draft shift summaries',meeting:'Active one-on-ones',shift:'Upcoming shifts',leadership:'Dated leadership',close:'Closing responsibilities',task:'Operational tasks',handoff:'Handoffs',development:'Development reviews',goal:'Goals',order:'Food-order requests',request:'Schedule requests',coverage:'Coverage offers',availability:'Availability requests',feedback:'Shared follow-up',staffing:'Staffing drafts'};
  const responsibilities:ResponsibilityCount[]=Object.entries(labels).map(([kind,category])=>({category,count:open.filter(r=>r.kind===kind).length})).filter(r=>r.count);
  return {outstanding:open.length,responsibilities};
}
async function snapshot(db:Database,locationId:string,bindings:unknown) {
  const result=await db.batch([
    db.prepare('SELECT revision,timezone FROM locations WHERE id=?').bind(locationId),
    db.prepare('SELECT * FROM memberships WHERE location_id=? ORDER BY name').bind(locationId),
    db.prepare('SELECT * FROM access_reviews WHERE location_id=? ORDER BY updated_at DESC').bind(locationId),
    db.prepare('SELECT data,restaurant_guid,retrieved_at FROM toast_rosters WHERE location_id=?').bind(locationId),
    db.prepare('SELECT kind,owner_id,data FROM records WHERE location_id=? AND archived_at IS NULL LIMIT 3001').bind(locationId),
    db.prepare("SELECT id,actor_id AS actorId,target_id AS targetId,action,note,at,json_extract(after,'$.employment') AS employment FROM access_changes WHERE location_id=? ORDER BY at DESC LIMIT 500").bind(locationId),
    db.prepare('SELECT r.* FROM administrator_requests r JOIN memberships m ON m.id=r.member_id WHERE m.location_id=?').bind(locationId),
  ]);
  requireThat(result[4].results.length<=3000,'This workspace needs records archived before access setup can continue.',503);
  const accounts=result[1].results as AccountRow[],reviews=(result[2].results as ReviewRow[]).map(reviewFromRow);
  const saved=result[3].results[0] as {data:string;restaurant_guid:string;retrieved_at:string}|undefined;
  const config=configuredToast(bindings,locationId),rosterMismatch=!!(config&&saved&&config.restaurantGuid!==saved.restaurant_guid);
  const roster=saved&&!rosterMismatch?JSON.parse(saved.data) as ToastRoster:null,now=new Date().toISOString();
  const history=(result[5].results as (Omit<AccessHistory,'employment'>&{employment:string|null})[]).map(r=>({...r,employment:r.employment?JSON.parse(r.employment) as Employment:undefined}));
  const administratorRequests=result[6].results as AdministratorRequestRow[];
  const responsibilities=parseResponsibilities(result[4].results as {kind:WorkRecord['kind'];owner_id:string;data:string}[]);
  const state:AccessState={accounts:accounts.map(r=>{const request=administratorRequests.find(a=>a.member_id===r.id);return {...memberFromRow(r),email:r.email,claimed:!!r.auth_user_id,active:!!r.active,revision:r.revision,employment:employment(r),...(request?{administratorRequest:administratorRequestView(request)}:{}),...outstanding(responsibilities,r.id,now)}}),reviews,roster,rosterMismatch,history};
  return {state,accounts,administratorRequests,workspaceRevision:Number((result[0].results[0] as {revision:number}|undefined)?.revision),timezone:String((result[0].results[0] as {timezone:string}).timezone),saved};
}
async function previous(db:Database,c:AccessCommand,actorId:string,fingerprint:string):Promise<AccessResult|null> {
  const row=await db.prepare('SELECT fingerprint,result FROM command_receipts WHERE location_id=? AND actor_id=? AND request_id=?').bind(c.locationId,actorId,c.requestId).first<{fingerprint:string;result:string}>();
  if(!row)return null;
  requireThat(row.fingerprint===fingerprint,'This request identifier was already used for a different change.',409);
  return JSON.parse(row.result);
}
export async function handleAccess(request:Request,binding?:D1Database,bindings?:unknown):Promise<Response>{
  try{
    requireThat(['GET','POST'].includes(request.method),'Method not allowed.',405);
    const {db,identity,authUserId}=await authenticateWorkspace(request,binding),url=new URL(request.url);
    let c:AccessCommand|undefined;
    if(request.method==='POST'){
      requireThat(request.headers.get('Origin')===url.origin&&request.headers.get('Sec-Fetch-Site')!=='cross-site','Open this action from your JMAX workspace.',403);
      requireThat(request.headers.get('Content-Type')?.split(';')[0]==='application/json','Use a JSON request.',415);
      const b=object(await boundedJson(request.body,20000));
      requireThat(['administrator.add','administrator.approve','administrator.cancel','administrator.resend','review.save','review.apply','account.save','account.suspend','hire.save','hire.activate','account.archive','account.rehire'].includes(String(b.action)),'Unknown access action.');
      c={requestId:id(b.requestId),locationId:id(b.locationId),action:b.action as AccessCommand['action'],input:object(b.input)};
      if(b.recordId!==undefined){c.recordId=id(b.recordId);requireThat(Number.isInteger(b.expectedRevision)&&Number(b.expectedRevision)>0,'An exact revision is required.');c.expectedRevision=Number(b.expectedRevision);}
    }
    const locationId=c?.locationId??id(url.searchParams.get('locationId'));
    const actor=await requireLocationAdministrator(db,identity,locationId);
    if(!c)return json((await snapshot(db,locationId,bindings)).state);
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('access:'+JSON.stringify(c)));
    const fingerprint=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
    const prior=await previous(db,c,actor.member.id,fingerprint);if(prior)return json(prior);
    const snap=await snapshot(db,locationId,bindings),input=c.input,now=new Date().toISOString(),token=crypto.randomUUID(),note=text(input.note,'Review note',2000);
    let targetId=c.recordId??crypto.randomUUID(),revision=1,before:object|null=null,after:unknown,extraGate='',extraValues:(string|number|null)[]=[];
    const gate='EXISTS(SELECT 1 FROM locations WHERE id=? AND last_command=?)';
    const changes:D1PreparedStatement[]=[];
    const target=(targetId:string,expected:unknown)=>{
      const r=snap.accounts.find(a=>a.id===targetId);requireThat(r,'Employee account not found at this restaurant.',404);
      requireThat(r.revision===expected,'This account changed. Reload and review it again.',409);
      requireThat(r.id!==actor.member.id,'Another administrator must change your own access.',403);return r;
    };
    const checkProfile=(p:AccessProfile,existing?:AccountRow,verifyClearances=true)=>{
      const invitation=existing?snap.administratorRequests.find(r=>r.member_id===existing.id&&r.kind==='invitation'&&r.status!=='approved'):undefined;
      requireThat(!invitation,'Finish or cancel this administrator invitation through its verified sign-in review.',409);
      requireThat(!snap.accounts.some(a=>a.email===p.email&&a.id!==existing?.id),'This login email already belongs to a Companion account. Select that account explicitly.',409);
      requireThat(!existing?.auth_user_id||existing.email===p.email,'An account that has signed in keeps its verified login identity. Contact the account owner to resolve an identity change.',409);
      const priorCaps=existing?JSON.parse(existing.capabilities) as string[]:[],priorQualifications=existing?JSON.parse(existing.qualifications) as string[]:[];
      requireThat(!p.capabilities.includes('location.manage')||priorCaps.includes('location.manage')||c.action==='administrator.add','Use Add administrator and verified sign-in approval to grant administrator access.',403);
      if(verifyClearances&&JSON.stringify(priorQualifications)!==JSON.stringify(p.qualifications))requireThat(input.clearancesConfirmed===true,'Confirm the station clearances against approved training records.');
      if(existing&&snap.state.accounts.find(a=>a.id===existing.id)?.outstanding){
        requireThat(existing.area===p.area&&existing.position===p.position&&priorCaps.every(cap=>p.capabilities.includes(cap as AccessProfile['capabilities'][number]))&&priorQualifications.every(q=>p.qualifications.includes(q)),'This person still has assigned work. Reassign it before reducing their role or permissions; access can be suspended immediately if needed.',409);
      }
    };
    const writeAccount=async(p:AccessProfile,existing?:AccountRow,lifecycle=existing?employment(existing):activeEmployment(),enabled=true)=>{
      checkProfile(p,existing,enabled);
      if(enabled)await requirePersonalRestaurantAssignment(db,p.email,locationId,existing?.auth_user_id);
      if(existing){
        changes.push(db.prepare('UPDATE memberships SET name=?,email=?,area=?,position=?,capabilities=?,qualifications=?,active=?,schedule_only=CASE WHEN ?=1 THEN 0 ELSE schedule_only END,employment=?,revision=revision+1 WHERE id=? AND '+gate).bind(p.name,p.email,p.area,p.position,JSON.stringify(p.capabilities),JSON.stringify(p.qualifications),Number(enabled),Number(enabled),JSON.stringify(lifecycle),existing.id,locationId,token));
      }else{
        changes.push(db.prepare('INSERT INTO memberships(id,location_id,name,email,area,position,capabilities,qualifications,active,employment,revision) SELECT ?,?,?,?,?,?,?,?,?,?,1 WHERE '+gate).bind(targetId,locationId,p.name,p.email,p.area,p.position,JSON.stringify(p.capabilities),JSON.stringify(p.qualifications),Number(enabled),JSON.stringify(lifecycle),locationId,token));
      }
    };
    if(c.action==='administrator.add'){
      requireThat(!c.recordId,'Use the existing account to change its access.');
      requireThat(input.identityConfirmed===true,'Confirm the identity and restaurant administrator access.');
      // Administrator setup is independent of employment dates, POS identities and training.
      // Copy only the granting administrator's current permissions; never accept client-supplied powers.
      const p=profile({name:input.name,email:input.email,area:'Executive',position:input.coOwner===true?'Co-owner':'Administrator',capabilities:[...actor.member.capabilities],qualifications:[]},true);
      await writeAccount(p,undefined,activeEmployment(),false);
      const invitationId=crypto.randomUUID(),expiresAt=new Date(Date.parse(now)+7*24*60*60*1000).toISOString();
      changes.push(db.prepare(`INSERT INTO administrator_requests(member_id,request_id,kind,status,member_revision,created_at,expires_at) SELECT ?,?,'invitation','invited',1,?,? WHERE ${gate}`).bind(targetId,invitationId,now,expiresAt,locationId,token));
      after={...p,memberId:targetId,active:false,employment:activeEmployment(),revision,administratorRequest:{requestId:invitationId,kind:'invitation',status:'invited',expiresAt}};
    }else if(['administrator.approve','administrator.cancel','administrator.resend'].includes(c.action)){
      requireThat(c.recordId,'Choose the saved administrator request.');
      const existing=target(c.recordId,c.expectedRevision),request=snap.administratorRequests.find(r=>r.member_id===existing.id);
      requireThat(request&&input.administratorRequestId===request.request_id,'This administrator request changed. Reload and review it again.',409);
      requireThat(employment(existing).status==='active'&&JSON.parse(existing.capabilities).includes('location.manage'),'This administrator account is no longer eligible.',409);
      targetId=existing.id;revision=existing.revision+1;before=snap.state.accounts.find(a=>a.id===existing.id)??null;
      extraGate=' AND EXISTS(SELECT 1 FROM memberships WHERE id=? AND revision=?) AND EXISTS(SELECT 1 FROM administrator_requests WHERE member_id=? AND request_id=? AND status=?)';extraValues=[existing.id,existing.revision,existing.id,request.request_id,request.status];
      if(c.action==='administrator.approve'){
        requireThat(request.status==='requested'&&request.expires_at>now&&request.member_revision===existing.revision&&request.verified_email===existing.email&&request.requested_auth_user_id&&request.browser_subject,'Have this person sign in with their own matching account, then review a current request.',409);
        await requirePersonalRestaurantAssignment(db,existing.email,locationId,request.requested_auth_user_id);
        requireThat(input.identityConfirmed===true,'Confirm with the person that this is their own sign-in account.');
        requireThat(request.kind==='recovery'?existing.active===1:existing.active===0,'This account’s access changed. Reload and review it again.',409);
        requireThat((JSON.parse(existing.capabilities) as string[]).every(cap=>actor.member.capabilities.includes(cap as AccessProfile['capabilities'][number])),'An administrator with these permissions must approve this request.',403);
        const linked=await db.prepare('SELECT principal_id FROM browser_identity_links WHERE subject_id=?').bind(request.browser_subject).first<{principal_id:string}>();
        requireThat((linked?.principal_id??request.browser_subject)===request.requested_auth_user_id,'This browser identity changed. Restart the sign-in review.',409);
        requireThat(!(await db.prepare('SELECT id FROM memberships WHERE auth_user_id=? AND location_id=? AND id<>?').bind(request.requested_auth_user_id,locationId,existing.id).first()),'This verified sign-in already belongs to another person at this restaurant.',409);
        extraGate+=' AND EXISTS(SELECT 1 FROM administrator_requests WHERE member_id=? AND expires_at>?) AND COALESCE((SELECT principal_id FROM browser_identity_links WHERE subject_id=?),?)=?';extraValues.push(existing.id,now,request.browser_subject,request.browser_subject,request.requested_auth_user_id);
        const configuredIdentity=request.kind==='recovery'&&existing.auth_user_id?await db.prepare('SELECT auth_user_id,revision FROM restaurant_access WHERE auth_user_id=?').bind(existing.auth_user_id).first<{auth_user_id:string;revision:number}>():null;
        // Recover the sign-in to the same canonical person, preserving the
        // server-managed grant rather than duplicating or reassigning owner seats.
        const approvedIdentity=configuredIdentity?.auth_user_id??request.requested_auth_user_id;
        if(configuredIdentity){
          extraGate+=' AND EXISTS(SELECT 1 FROM restaurant_access WHERE auth_user_id=? AND revision=?)';extraValues.push(configuredIdentity.auth_user_id,configuredIdentity.revision);
          changes.push(db.prepare('DELETE FROM browser_identity_links WHERE principal_id=? AND '+gate).bind(approvedIdentity,locationId,token));
          changes.push(db.prepare('INSERT INTO browser_identity_links(subject_id,principal_id,linked_at) SELECT ?,?,? WHERE '+gate).bind(request.browser_subject,approvedIdentity,Date.parse(now),locationId,token));
        }
        changes.push(db.prepare('UPDATE memberships SET auth_user_id=?,active=1,revision=revision+1 WHERE id=? AND '+gate).bind(approvedIdentity,targetId,locationId,token));
        changes.push(db.prepare('DELETE FROM employee_sessions WHERE member_id=? AND '+gate).bind(targetId,locationId,token));
        changes.push(db.prepare('DELETE FROM employee_setup_codes WHERE member_id=? AND '+gate).bind(targetId,locationId,token));
        changes.push(db.prepare("UPDATE administrator_requests SET status='approved' WHERE member_id=? AND "+gate).bind(targetId,locationId,token));
        after={...before,active:true,claimed:true,revision,administratorRequest:{...administratorRequestView(request),status:'approved'},identityVerification:{browserSubject:request.browser_subject,authUserId:approvedIdentity,verifiedAt:request.verified_at}};
      }else if(c.action==='administrator.cancel'){
        requireThat(request.status==='invited'||request.status==='requested','This request is already closed.',409);
        changes.push(db.prepare("UPDATE administrator_requests SET status='cancelled' WHERE member_id=? AND "+gate).bind(targetId,locationId,token));
        // Cancelling recovery must not revoke the owner's existing working devices.
        revision=existing.revision;after={...before,administratorRequest:{...administratorRequestView(request),status:'cancelled'}};
      }else{
        requireThat(request.kind==='invitation'&&request.status!=='approved'&&existing.active===0,'Only an unapproved invitation can be restarted.',409);
        const requestId=crypto.randomUUID(),expiresAt=new Date(Date.parse(now)+7*24*60*60*1000).toISOString();
        changes.push(db.prepare("UPDATE administrator_requests SET request_id=?,status='invited',member_revision=?,requested_auth_user_id=NULL,browser_subject=NULL,verified_email=NULL,created_at=?,verified_at=NULL,expires_at=? WHERE member_id=? AND "+gate).bind(requestId,existing.revision,now,expiresAt,targetId,locationId,token));
        revision=existing.revision;after={...before,administratorRequest:{requestId,kind:'invitation',status:'invited',expiresAt}};
      }
    }else if(c.action==='hire.save'){
      const existing=c.recordId?target(c.recordId,c.expectedRevision):undefined;
      requireThat(!existing||employment(existing).status==='onboarding','Use the existing employee or rehire workflow instead of creating another hire record.',409);
      const lifecycle:Employment={...activeEmployment(calendarDate(input.hireDate,'Hire / start date')),status:'onboarding'},p=profile(input.profile,true);
      targetId=existing?.id??targetId;revision=(existing?.revision??0)+1;before=existing?snap.state.accounts.find(a=>a.id===existing.id)??null:null;
      if(existing){extraGate=' AND EXISTS(SELECT 1 FROM memberships WHERE id=? AND revision=?)';extraValues=[existing.id,existing.revision];}
      await writeAccount(p,existing,lifecycle,false);after={...p,memberId:targetId,active:false,employment:lifecycle,revision};
    }else if(c.action==='review.save'){
      const roster=snap.state.roster;
      requireThat(roster&&input.sourceAt===roster.retrievedAt&&input.restaurantGuid===roster.restaurantGuid,'The Toast roster changed or is unavailable. Reload it before reviewing.',409);
      const person=roster.employees.find(p=>p.toastEmployeeId===input.employeeId);requireThat(person,'Toast employee not found.',404);
      const old=snap.state.reviews.find(r=>r.restaurantGuid===roster.restaurantGuid&&r.employeeId===person.toastEmployeeId);
      requireThat(old?old.id===c.recordId&&old.revision===c.expectedRevision:!c.recordId,'This roster review changed. Reload and review it again.',409);
      requireThat(!old?.memberId,'This Toast record is already linked. Manage its existing Companion access.',409);
      const status=input.exclude===true?'excluded':'draft',p=profile(input.profile,false);
      requireThat(status==='excluded'||!person.archived,'Archived Toast records cannot be enabled.');
      targetId=old?.id??targetId;revision=(old?.revision??0)+1;before=old??null;
      after={id:targetId,restaurantGuid:roster.restaurantGuid,employeeId:person.toastEmployeeId,sourceAt:roster.retrievedAt,source:person,profile:p,note,status,memberId:null,revision,updatedAt:now};
      extraGate=' AND EXISTS(SELECT 1 FROM toast_rosters WHERE location_id=? AND restaurant_guid=? AND retrieved_at=?)';extraValues=[locationId,roster.restaurantGuid,roster.retrievedAt];
      changes.push(db.prepare('INSERT INTO access_reviews(id,location_id,restaurant_guid,employee_id,source_at,source,data,status,member_id,revision,updated_at) SELECT ?,?,?,?,?,?,?,?,NULL,?,? WHERE '+gate+' ON CONFLICT(id) DO UPDATE SET source_at=excluded.source_at,source=excluded.source,data=excluded.data,status=excluded.status,revision=excluded.revision,updated_at=excluded.updated_at').bind(targetId,locationId,roster.restaurantGuid,person.toastEmployeeId,roster.retrievedAt,JSON.stringify(person),JSON.stringify({profile:p,note}),status,revision,now,locationId,token));
    }else if(c.action==='review.apply'){
      const review=snap.state.reviews.find(r=>r.id===c?.recordId);
      requireThat(review&&review.revision===c.expectedRevision,'This review changed. Reload and review it again.',409);
      requireThat(review.status==='draft'&&!review.memberId,'Only an unlinked draft review can enable access.',409);
      const roster=snap.state.roster,person=roster?.employees.find(p=>p.toastEmployeeId===review.employeeId);
      requireThat(roster&&roster.restaurantGuid===review.restaurantGuid&&roster.retrievedAt===review.sourceAt&&person&&!person.archived&&JSON.stringify(person)===JSON.stringify(review.source),'Toast details changed. Save a fresh review before enabling access.',409);
      requireThat(input.identityConfirmed===true,'Confirm this is an individual employee and that their login email is correct.');
      const p=profile(review.profile,true);
      const existing=input.memberId?target(id(input.memberId),input.memberRevision):undefined;
      requireThat(!existing||existing.email===p.email,'The selected existing account must have the reviewed login email.',409);
      const priorLinks=existing?snap.state.reviews.filter(r=>r.memberId===existing.id&&r.status==='applied'):[];
      if(priorLinks.length){
        requireThat(input.replaceArchivedToastLink===true,'This account already has a Toast link. Explicitly confirm replacing a retired Toast record after a checked rehire.',409);
        requireThat(priorLinks.length===1&&priorLinks[0].restaurantGuid===roster.restaurantGuid&&roster.employees.some(p=>p.toastEmployeeId===priorLinks[0].employeeId&&p.archived),'Only one currently archived Toast record from this restaurant can be replaced.',409);
        const rehire=await db.prepare("SELECT after FROM access_changes WHERE location_id=? AND target_id=? AND action='account.rehire' ORDER BY at DESC LIMIT 1").bind(locationId,existing!.id).first<{after:string}>();
        const checkedReturn=rehire?JSON.parse(rehire.after):null;
        requireThat(existing!.active===1&&employment(existing!).status==='active'&&checkedReturn?.memberId===existing!.id&&checkedReturn?.email===existing!.email&&Number.isInteger(checkedReturn?.revision)&&checkedReturn.revision<=existing!.revision&&JSON.stringify(checkedReturn?.employment)===JSON.stringify(employment(existing!)),'Complete a checked rehire before replacing the retired Toast identity.',409);
        const old=priorLinks[0];
        extraGate+=' AND EXISTS(SELECT 1 FROM access_reviews WHERE id=? AND member_id=? AND status=\'applied\' AND revision=?)';extraValues.push(old.id,existing!.id,old.revision);
        changes.push(db.prepare("UPDATE access_reviews SET data=json_set(data,'$.retiredMemberId',member_id),member_id=NULL,status='excluded',revision=revision+1,updated_at=? WHERE id=? AND "+gate).bind(now,old.id,locationId,token));
      }
      targetId=existing?.id??crypto.randomUUID();revision=existing?.revision??1;before=existing?{...snap.state.accounts.find(a=>a.id===existing.id)}:null;
      // Linking an existing identity preserves its permissions, training and
      // suspended state. All access edits use the separate account action.
      if(!existing)await writeAccount(p);
      extraGate+=' AND EXISTS(SELECT 1 FROM toast_rosters WHERE location_id=? AND restaurant_guid=? AND retrieved_at=?)';extraValues.push(locationId,roster.restaurantGuid,roster.retrievedAt);
      if(existing){extraGate+=' AND EXISTS(SELECT 1 FROM memberships WHERE id=? AND revision=?)';extraValues.push(existing.id,existing.revision);}
      changes.push(db.prepare("UPDATE access_reviews SET status='applied',member_id=?,revision=revision+1,updated_at=? WHERE id=? AND "+gate).bind(targetId,now,review.id,locationId,token));
      after=existing?{...before,reviewId:review.id,...(priorLinks.length?{replacedToastReviewId:priorLinks[0].id}:{} )}:{...p,active:true,memberId:targetId,reviewId:review.id};
    }else{
      requireThat(c.recordId,'Choose an employee account.');
      const existing=target(c.recordId,c.expectedRevision);
      const lifecycle=employment(existing);
      targetId=existing.id;revision=existing.revision+1;before=snap.state.accounts.find(a=>a.id===existing.id)??null;
      extraGate=' AND EXISTS(SELECT 1 FROM memberships WHERE id=? AND revision=?)';extraValues=[existing.id,existing.revision];
      if(c.action==='account.archive'){
        requireThat(lifecycle.status!=='archived','This employee is already archived.',409);
        requireThat(input.confirmed===true,'Confirm the employee has left and that you reviewed the remaining responsibilities.');
        requireThat(['quit','terminated','other'].includes(String(input.departureReason)),'Choose quit, terminated or another departure reason.');
        const endedDate=calendarDate(input.endedDate,'Last employment date');
        requireThat(endedDate<=localDate(now,snap.timezone),'Archiving blocks access now. Use a last employment date that is today or earlier.');
        requireThat(lifecycle.status==='onboarding'||!lifecycle.hireDate||endedDate>=lifecycle.hireDate,'The last employment date cannot precede the hire date.');
        const archived:Employment={...lifecycle,status:'archived',endedDate,departureReason:input.departureReason as Employment['departureReason'],archivedAt:now};
        changes.push(db.prepare("UPDATE memberships SET active=0,schedule_only=0,schedule_jobs='[]',employment=?,revision=revision+1 WHERE id=? AND "+gate).bind(JSON.stringify(archived),targetId,locationId,token));
        after={...before,active:false,employment:archived,revision};
      }else if(c.action==='hire.activate'||c.action==='account.rehire'){
        requireThat(lifecycle.status===(c.action==='hire.activate'?'onboarding':'archived'),'Use the workflow matching this employee’s current status.',409);
        requireThat(input.identityConfirmed===true,'Confirm the employee identity and permissions before enabling access.');
        const p=profile(c.action==='hire.activate'?snap.state.accounts.find(a=>a.id===existing.id):input.profile,true);
        requireThat(!p.qualifications.length||input.clearancesConfirmed===true,'Recheck station clearances against approved training records.');
        const restored=activeEmployment(c.action==='hire.activate'?lifecycle.hireDate:calendarDate(input.hireDate,'Rehire date'));
        if(c.action==='account.rehire'&&lifecycle.endedDate)requireThat(restored.hireDate!>=lifecycle.endedDate,'The rehire date cannot precede the previous departure.');
        await writeAccount(p,existing,restored);after={...p,memberId:targetId,active:true,employment:restored,revision};
      }else if(c.action==='account.suspend'){
        requireThat(existing.active,'This access is already suspended.',409);
        changes.push(db.prepare('UPDATE memberships SET active=0,revision=revision+1 WHERE id=? AND '+gate).bind(targetId,locationId,token));
        after={...before,active:false,revision};
      }else{
        requireThat(lifecycle.status==='active','Use new-hire activation or the explicit rehire workflow. An archived employee cannot be restored by editing access.',409);
        requireThat(input.identityConfirmed===true,'Confirm the employee identity and reviewed permissions.');
        const p=profile(input.profile,true);await writeAccount(p,existing);after={...p,active:true,memberId:targetId};
      }
    }
    const result:AccessResult={recordId:targetId,revision};
    const policyGuard=await restaurantAccessWriteGuard(db,identity,locationId);
    const lock=db.prepare('UPDATE locations SET revision=revision+1,last_command=? WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM memberships WHERE id=? AND auth_user_id=? AND active=1 AND revision=?)'+extraGate+' AND ('+policyGuard.sql+')')
      .bind(token,locationId,snap.workspaceRevision,actor.member.id,authUserId,actor.revision,...extraValues,...policyGuard.values);
    changes.push(db.prepare('INSERT INTO command_receipts(location_id,actor_id,request_id,fingerprint,result) SELECT ?,?,?,?,? WHERE '+gate).bind(locationId,actor.member.id,c.requestId,fingerprint,JSON.stringify(result),locationId,token));
    changes.push(db.prepare('INSERT INTO access_changes(id,location_id,actor_id,target_id,action,before,after,note,at) SELECT ?,?,?,?,?,?,?,?,? WHERE '+gate).bind(token,locationId,actor.member.id,targetId,c.action,before?JSON.stringify(before):null,JSON.stringify(after),note,now,locationId,token));
    changes.push(db.prepare('INSERT INTO audit_events(id,location_id,actor_id,action,record_id,at,revision) SELECT ?,?,?,?,?,?,? WHERE '+gate).bind(token,locationId,actor.member.id,c.action,targetId,now,snap.workspaceRevision+1,locationId,token));
    const committed=await db.batch([lock,...changes]);
    if(!committed[0].meta.changes){const repeated=await previous(db,c,actor.member.id,fingerprint);if(repeated)return json(repeated);throw new AppError(409,'Access, assigned work or the roster changed while saving. Reload and review before trying again.');}
    return json(result);
  }catch(error){
    if(error instanceof AppError)return json({error:error.message},error.status);
    return json({error:'Access setup could not confirm this change. Retry the same request or reload before editing.'},503);
  }
}
