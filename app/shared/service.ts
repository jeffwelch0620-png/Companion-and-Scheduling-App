import {ideaReviewer} from './staff-ideas';
import {synchronizePositionAchievements} from './position-achievements';
import {recognitionParticipant} from './recognition';
import { capabilities, type Command, type CommandResult, type Location, type Member, type WorkRecord, type Workspace } from './types';
import { applyCommand, publicWorkspace, visible } from './domain';
import { recoveredFor } from './recovered-standards';
import { resolveSourceDraft } from './source-drafts';
import { AppError, id, object, requireThat, text } from './validation';
import { cookieValue, employeeCookie, employeeIdentity, requireIdentityLocation, type WorkspaceIdentity } from './employee-session';
import { recordAdministratorIdentity } from './administrator-identity';
import { canonicalJobRole } from './job-role';
import {checkFiledEquipmentTag} from './equipment-history';
import {checkFiledComplianceSource,checkFiledComplianceSuccessor} from './compliance-history';
import {guestManager} from './guest-reviews';
import {hireScheduler,type HireCandidate} from './hire-handoff';
import {resolveFoodOrder} from './food-order-bridge';
import {requireRestaurantAccess,restaurantAccess,permitsRestaurant,restaurantAccessWriteGuard} from './restaurant-access';

type Database = Pick<D1Database, 'prepare' | 'batch'>;
type MemberRow = { id: string; auth_user_id: string | null; email: string; location_id: string; name: string; area: string; position: string; capabilities: string; qualifications: string; revision: number; active?:number; schedule_only?:number; schedule_jobs?:string; employment?:string };
type RecordRow = { id: string; location_id: string; kind: WorkRecord['kind']; owner_id: string; area: string; revision: number; data: string; updated_at: string };
export function memberFromRow(r: MemberRow): Member {
  const caps: unknown = JSON.parse(r.capabilities), qualifications: unknown = JSON.parse(r.qualifications);
  requireThat(Array.isArray(caps) && caps.every(c => capabilities.includes(c)) && Array.isArray(qualifications) && qualifications.every(q => typeof q === 'string'), 'Account setup needs attention.', 503);
  return { id: r.id, locationId: r.location_id, name: r.name, area: r.area, position: canonicalJobRole(r.position), capabilities: caps, qualifications, ...(r.schedule_only?{scheduleOnly:true}:{}),...(r.schedule_jobs?{scheduleJobs:JSON.parse(r.schedule_jobs)}:{}) };
}
export function recordFromRow(r: RecordRow): WorkRecord { const data=JSON.parse(r.data);if(r.kind==='task'){delete data.dishHandoffReceiptView;delete data.dishHandoffPendingIds;}if(r.kind==='learningcase')delete data.readSourceState;if(r.kind==='achievement')delete data.readEvidenceCurrent;return { id: r.id, locationId: r.location_id, kind: r.kind, ownerId: r.owner_id, area: r.area, revision: r.revision, data, updatedAt: r.updated_at } as WorkRecord; }
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff' } }); }

export async function boundedJson(stream: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<unknown> {
  requireThat(stream, 'A request body is required.');
  const reader = stream.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > maxBytes) { await reader.cancel(); throw new AppError(413, 'This request is too large.'); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new AppError(400, 'The request could not be read.'); }
}

export async function workspace(db: Database, identity: WorkspaceIdentity, locationId: string): Promise<{ value: Workspace; membershipRevision: number; membershipRows: MemberRow[] }> {
  requireIdentityLocation(identity,locationId);
  await requireRestaurantAccess(db,identity,locationId);
  // A batch provides one consistent read before the compare-and-swap transaction.
  const rows = await db.batch([
    db.prepare('SELECT id, name, timezone, revision, week_starts_on AS weekStartsOn FROM locations WHERE id = ?').bind(locationId),
    db.prepare('SELECT * FROM memberships WHERE location_id = ?').bind(locationId),
    db.prepare("SELECT * FROM records WHERE location_id = ? AND archived_at IS NULL AND kind NOT IN ('fooditem','foodrecipe') ORDER BY updated_at DESC LIMIT 3001").bind(locationId),
    db.prepare('SELECT id,name FROM memberships WHERE location_id = ? AND active = 0 AND schedule_only = 0').bind(locationId),
    db.prepare(`SELECT DISTINCT owner_id AS personId, json_extract(data,'$.standardId') AS standardId, json_extract(data,'$.standardRevision') AS standardRevision FROM records WHERE location_id=? AND owner_id IN (SELECT id FROM memberships WHERE location_id=? AND auth_user_id=? AND active=1) AND kind='goal' AND json_extract(data,'$.automaticLearning')=1 AND json_extract(data,'$.type')='development' AND json_extract(data,'$.phase')='closed' AND json_extract(data,'$.standardId') IS NOT NULL`).bind(locationId,locationId,identity.authUserId),
  ]);
  const location = rows[0].results[0] as Location | undefined, members = rows[1].results as MemberRow[];
  const mine = members.find(m => m.auth_user_id === identity.authUserId && m.active === 1 && (identity.source==='sites'||(m.id===identity.memberId&&m.revision===identity.membershipRevision)));
  requireThat(location && mine, 'No access to this restaurant.', 403);
  requireThat(rows[2].results.length <= 3000, 'This workspace needs records archived before more can be loaded.', 503);
  const hireCandidates:HireCandidate[]=members.flatMap(m=>{const e=m.employment?JSON.parse(m.employment):{};return e.hireDate?[{id:m.id,name:m.name,area:m.area,position:canonicalJobRole(m.position),revision:m.revision,active:m.active===1,scheduleOnly:m.schedule_only===1,hireDate:e.hireDate,status:e.status??'active'}]:[]});
  return { membershipRows: members, membershipRevision: mine.revision, value: { location, me: memberFromRow(mine), members: members.filter(m=>m.active===1||m.schedule_only===1).map(memberFromRow), hireCandidates, records: (rows[2].results as RecordRow[]).map(recordFromRow),formerMembers:rows[3].results as {id:string;name:string}[],learningHistory:(rows[4].results as NonNullable<Workspace['learningHistory']>).filter(r=>r.personId===mine.id) } };
}

async function receipt(db: Database, locationId: string, actorId: string, requestId: string, fingerprint: string) {
  const row = await db.prepare('SELECT fingerprint, result FROM command_receipts WHERE location_id = ? AND actor_id = ? AND request_id = ?').bind(locationId, actorId, requestId).first<{fingerprint: string; result: string}>();
  if (!row) return null;
  requireThat(row.fingerprint === fingerprint, 'This request identifier was already used for a different change.', 409);
  return JSON.parse(row.result) as CommandResult;
}

// Reading a message does not change its content, schedule or approval state.
// Merge the reader into the saved JSON atomically, without taking the restaurant
// revision lock or invalidating an in-flight manager/AI review. Replies still
// advance the record revision and reset readers through the normal command path.
async function markMessageRead(db:Database,identity:WorkspaceIdentity,command:Command):Promise<CommandResult>{
  requireIdentityLocation(identity,command.locationId);
  await requireRestaurantAccess(db,identity,command.locationId);
  requireThat(command.recordId&&Number.isInteger(command.expectedRevision),'Open a saved message before marking it read.');
  const scopedMember=identity.source==='setup-code'?identity.memberId:null;
  const rows=await db.batch([
    db.prepare('SELECT revision FROM locations WHERE id=?').bind(command.locationId),
    db.prepare('SELECT * FROM memberships WHERE location_id=? AND auth_user_id=? AND active=1 AND (? IS NULL OR id=?)').bind(command.locationId,identity.authUserId,scopedMember,scopedMember),
    db.prepare("SELECT * FROM records WHERE location_id=? AND id=? AND kind='message' AND archived_at IS NULL").bind(command.locationId,command.recordId),
  ]);
  const member=rows[1].results[0] as MemberRow|undefined;
  requireThat(member&&rows[0].results.length&& (identity.source==='sites'||member.revision===identity.membershipRevision),'No access to this restaurant.',403);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(command)));
  const fingerprint=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  const prior=await receipt(db,command.locationId,member.id,command.requestId,fingerprint);if(prior)return prior;
  const stored=rows[2].results[0] as RecordRow|undefined,record=stored?recordFromRow(stored):undefined;
  requireThat(record&&visible(record,memberFromRow(member)),'Record not found.',404);
  requireThat(record.revision===command.expectedRevision,'This message changed. Open the latest message before marking it read.',409);
  const result={recordId:record.id,revision:record.revision,workspaceRevision:Number((rows[0].results[0] as {revision:number}).revision)};
  const policy=await restaurantAccessWriteGuard(db,identity,command.locationId);
  const authority=`EXISTS(SELECT 1 FROM memberships WHERE id=? AND location_id=? AND auth_user_id=? AND active=1 AND revision=?) AND ${policy.sql}`;
  const authorityValues=[member.id,command.locationId,identity.authUserId,member.revision,...policy.values];
  await db.batch([
    db.prepare(`UPDATE records SET data=json_insert(data,'$.readBy[#]',?) WHERE id=? AND location_id=? AND revision=? AND archived_at IS NULL AND ${authority} AND NOT EXISTS(SELECT 1 FROM json_each(records.data,'$.readBy') WHERE value=?) AND NOT EXISTS(SELECT 1 FROM command_receipts WHERE location_id=? AND actor_id=? AND request_id=? AND fingerprint<>?)`).bind(member.id,record.id,command.locationId,record.revision,...authorityValues,member.id,command.locationId,member.id,command.requestId,fingerprint),
    db.prepare(`INSERT INTO command_receipts(location_id,actor_id,request_id,fingerprint,result) SELECT ?,?,?,?,? WHERE ${authority} AND EXISTS(SELECT 1 FROM records WHERE id=? AND location_id=? AND revision=? AND archived_at IS NULL AND EXISTS(SELECT 1 FROM json_each(records.data,'$.readBy') WHERE value=?)) ON CONFLICT(location_id,actor_id,request_id) DO NOTHING`).bind(command.locationId,member.id,command.requestId,fingerprint,JSON.stringify(result),...authorityValues,record.id,command.locationId,record.revision,member.id),
  ]);
  const saved=await receipt(db,command.locationId,member.id,command.requestId,fingerprint);
  requireThat(saved,'The message or your access changed. Open the latest message before trying again.',409);
  return saved;
}

async function commit(db: Database, identity: WorkspaceIdentity, command: Command): Promise<CommandResult> {
  requireThat(!['fooditem','foodrecipe'].includes(command.action.split('.')[0]),'Open the food workspace to change food records.');
  if(command.action==='message.read')return markMessageRead(db,identity,command);
  const {authUserId}=identity;
  const { value: w, membershipRevision, membershipRows } = await workspace(db, identity, command.locationId);
  const policy=await restaurantAccessWriteGuard(db,identity,command.locationId);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(command)));
  const fingerprint = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  const prior = await receipt(db, w.location.id, w.me.id, command.requestId, fingerprint); if (prior) return prior;
  const at = new Date().toISOString(),foodOrder=await resolveFoodOrder(db,w,identity.authUserId,command,at);
  const primaryChanges = applyCommand(w, command, at,undefined,false,command.action==='standard.from-source'?resolveSourceDraft(w,command):undefined,foodOrder.resolved);
  const changed = [...primaryChanges,...synchronizePositionAchievements(w,primaryChanges,at)], token = crypto.randomUUID();
  if(command.action==='shiftcheckin.submit'){
    const existing=await db.prepare("SELECT id FROM records WHERE location_id=? AND kind='shiftcheckin' AND json_extract(data,'$.shiftId')=? LIMIT 1").bind(w.location.id,id(command.input.shiftId)).first();
    requireThat(!existing,'This shift already has a check-in. Open Work history if it has been filed, then restore and correct your original response.',409);
  }
  if(command.action==='equipment.create'){const asset=changed.find(r=>r.kind==='equipment');if(asset?.kind==='equipment')await checkFiledEquipmentTag(db,w.location.id,asset.data.assetTag);}
  if(['compliance.create','compliance.correct'].includes(command.action)){const source=changed.find(r=>r.kind==='compliance');if(source?.kind==='compliance')await checkFiledComplianceSource(db,w.location.id,source.data);}
  if(command.action==='compliance.renewal-link')await checkFiledComplianceSuccessor(db,w.location.id,id(command.input.previousId));
  const knownIds=new Set(w.records.map(r=>r.id));
  const hireGuards:{id:string;revision:number}[]=[];
  const hiringReviewGuards:{id:string;revision:number}[]=[];
  if(command.action==='opening.applicant-hiring-review'){
    const opening=changed.find(r=>r.kind==='opening');
    requireThat(opening?.kind==='opening','The staffing request changed. Refresh and review again.',409);
    const review=opening.data.applicants?.find(a=>a.id===command.input.applicantId)?.hiringReview;
    requireThat(review,'The hiring review was not produced.',500);
    // Use the same membership snapshot that authorized the review. Re-reading
    // newer revisions here could accept authority revoked after validation.
    const participants=new Set([opening.data.managerId,review.approverId,...review.interviews.map(i=>i.personId)]);
    for(const participantId of participants){
      const row=membershipRows.find(m=>m.id===participantId&&m.location_id===w.location.id&&m.active===1&&!m.schedule_only);
      requireThat(row,'A hiring participant’s access changed. Refresh and review again.',409);
      hiringReviewGuards.push({id:row.id,revision:row.revision});
    }
  }
  if(['opening.link-handoff','opening.review-handoff'].includes(command.action)){
    const h=w.records.find(r=>r.kind==='hirehandoff'&&r.id===command.input.handoffId);
    requireThat(h?.kind==='hirehandoff','The handoff changed. Refresh and review again.',409);
    const employee=w.hireCandidates?.find(m=>m.id===h.ownerId);requireThat(employee,'Employee setup changed. Refresh and review again.',409);hireGuards.push(employee);
    const scheduler=await db.prepare('SELECT * FROM memberships WHERE id=? AND location_id=? AND active=1 AND schedule_only=0').bind(h.data.schedulerId,w.location.id).first<MemberRow>();
    requireThat(scheduler&&hireScheduler(memberFromRow(scheduler),h.area),'The scheduler’s access changed. Review this handoff.',409);hireGuards.push(scheduler);
    if(command.action==='opening.link-handoff'){
      const duplicate=await db.prepare("SELECT r.id FROM records r, json_each(r.data,'$.onboarding.links') l WHERE r.location_id=? AND r.kind='opening' AND json_extract(l.value,'$.released') IS NULL AND json_extract(l.value,'$.employeeId')=? AND json_extract(l.value,'$.hireDate')=? LIMIT 1").bind(w.location.id,h.ownerId,h.data.hireDate).first();
      requireThat(!duplicate,'This hire is already linked to a staffing request, possibly in Work history. Restore and release the earlier link first.',409);
    }
  }
  if(command.action.startsWith('hirechecklist.')){
    const checklist=changed.find(r=>r.kind==='hirechecklist');
    if(checklist?.kind==='hirechecklist'){
      if(command.action!=='hirechecklist.cancel'){
        const employee=w.hireCandidates?.find(m=>m.id===checklist.ownerId);
        requireThat(employee,'Employee setup changed. Refresh and review it again.',409);hireGuards.push(employee);
      }
      if(command.action==='hirechecklist.create'){
        const duplicate=await db.prepare("SELECT id FROM records WHERE location_id=? AND kind='hirechecklist' AND owner_id=? AND json_extract(data,'$.hireDate')=? LIMIT 1").bind(w.location.id,checklist.ownerId,checklist.data.hireDate).first();
        requireThat(!duplicate,'This hire already has a checklist. Open Work history to restore the original.',409);
      }
    }
  }
  if(command.action.startsWith('hirehandoff.')&&!['hirehandoff.cancel','hirehandoff.note'].includes(command.action)){
    const hire=changed.find(r=>r.kind==='hirehandoff');
    if(hire?.kind==='hirehandoff'){
      const employee=w.hireCandidates?.find(m=>m.id===hire.ownerId);
      requireThat(employee,'Employee setup changed. Refresh and review it again.',409);hireGuards.push(employee);
      const scheduler=await db.prepare('SELECT * FROM memberships WHERE id=? AND location_id=? AND active=1 AND schedule_only=0').bind(hire.data.schedulerId,w.location.id).first<MemberRow>();
      requireThat(scheduler&&hireScheduler(memberFromRow(scheduler),hire.area),'The scheduler’s access changed. Have the coordinator correct this handoff.',409);hireGuards.push(scheduler);
      if(command.action==='hirehandoff.create'){
        const duplicate=await db.prepare("SELECT id FROM records WHERE location_id=? AND kind='hirehandoff' AND owner_id=? AND json_extract(data,'$.hireDate')=? LIMIT 1").bind(w.location.id,hire.ownerId,hire.data.hireDate).first();
        requireThat(!duplicate,'This hire already has a handoff. Open Work history to restore the original.',409);
      }
    }
  }
  if(['recognition.submit','recognition.correct','recognition.publish'].includes(command.action)){
    const recognition=changed.find(r=>r.kind==='recognition');
    if(recognition?.kind==='recognition'){
      const recipient=await db.prepare('SELECT * FROM memberships WHERE id=? AND location_id=? AND active=1 AND schedule_only=0').bind(recognition.data.recipientId,w.location.id).first<MemberRow>();
      requireThat(recipient&&recognitionParticipant(memberFromRow(recipient)),'The recipient’s access changed. Refresh and review this thank-you.',409);hireGuards.push(recipient);
    }
  }
  if(command.action==='staffidea.assign'){
    const idea=changed.find(r=>r.kind==='staffidea');
    if(idea?.kind==='staffidea'){
      const reviewer=await db.prepare('SELECT * FROM memberships WHERE id=? AND location_id=? AND active=1 AND schedule_only=0').bind(idea.data.managerId,w.location.id).first<MemberRow>();
      requireThat(reviewer&&reviewer.id!==idea.ownerId&&ideaReviewer(memberFromRow(reviewer),idea.area),'The reviewer changed. Refresh and choose a current reviewer.',409);hireGuards.push(reviewer);
    }
  }
  let guestAssignee:MemberRow|null=null;
  if(['opening.applicant-add','opening.applicant-recheck','opening.applicant-reopen'].includes(command.action)||command.action==='opening.applicant-update'&&!['closed','withdrawn'].includes(String(command.input.stage))||['opening.link-handoff','opening.review-handoff','opening.create','opening.revise','opening.submit','opening.approve','catering.create','catering.revise','catering.submit','catering.publish','guestreview.create','guestreview.correct','guestreview.return','guestreview.reopen','promotion.create','promotion.correct','promotion.submit','promotion.approve','maintenance.create','maintenance.revise'].includes(command.action)){
    const guest=changed.find(r=>r.kind==='opening'||r.kind==='catering'||r.kind==='guestreview'||r.kind==='promotion'||r.kind==='maintenance');
    if(guest?.kind==='opening'||guest?.kind==='catering'||guest?.kind==='guestreview'||guest?.kind==='promotion'||guest?.kind==='maintenance'){
      guestAssignee=await db.prepare('SELECT * FROM memberships WHERE id=? AND location_id=? AND active=1 AND schedule_only=0').bind(guest.data.managerId,w.location.id).first<MemberRow>();
      requireThat(guestAssignee&&guestManager(memberFromRow(guestAssignee)),'The assigned manager’s access changed. Refresh and choose a current manager.',409);
    }
  }
  if(command.action==='guestreview.create'||command.action==='guestreview.correct'){
    const candidate=changed.find(r=>r.kind==='guestreview');
    if(candidate?.kind==='guestreview'){
      const d=candidate.data;
      const duplicate=await db.prepare("SELECT id FROM records WHERE location_id=? AND kind='guestreview' AND id<>? AND json_extract(data,'$.channel')=? AND (lower(json_extract(data,'$.reference'))=lower(?) OR (?<>'' AND json_extract(data,'$.sourceUrl')=?)) LIMIT 1").bind(w.location.id,candidate.id,d.channel,d.reference,d.sourceUrl,d.sourceUrl).first();
      requireThat(!duplicate,'This feedback is already recorded. Open Work history if it has been filed, then restore the original follow-up.',409);
    }
  }
  requireThat(w.records.length+changed.filter(r=>!knownIds.has(r.id)).length<=3000,'This workspace needs records archived before this change can be saved.',503);
  const target = changed.find(r => r.kind === command.action.split('.')[0] && (!command.recordId || r.id === command.recordId));
  requireThat(target, 'No result was produced.', 500);
  const result = { recordId: target.id, revision: target.revision, workspaceRevision: w.location.revision + 1 };
  const gated = 'EXISTS (SELECT 1 FROM locations WHERE id = ? AND last_command = ?)';
  const assigneeGuard=guestAssignee?' AND EXISTS (SELECT 1 FROM memberships WHERE id=? AND location_id=? AND active=1 AND schedule_only=0 AND revision=?)':'';
  const hireGuard=hireGuards.map(()=> ' AND EXISTS (SELECT 1 FROM memberships WHERE id=? AND location_id=? AND revision=?)').join('');
  const hiringReviewGuard=hiringReviewGuards.map(()=> ' AND EXISTS (SELECT 1 FROM memberships WHERE id=? AND location_id=? AND active=1 AND schedule_only=0 AND revision=?)').join('');
  const foodGuard=foodOrder.foodRevision===null?'':' AND EXISTS(SELECT 1 FROM food_state WHERE location_id=? AND revision=?)';
  const statements = [db.prepare(`UPDATE locations SET revision = revision + 1, last_command = ? WHERE id = ? AND revision = ? AND EXISTS (SELECT 1 FROM memberships WHERE id = ? AND auth_user_id = ? AND active = 1 AND revision = ?) AND ${policy.sql}${assigneeGuard}${hireGuard}${hiringReviewGuard}${foodGuard}`)
    .bind(token, w.location.id, w.location.revision, w.me.id, authUserId, membershipRevision,...policy.values,...(guestAssignee?[guestAssignee.id,w.location.id,guestAssignee.revision]:[]),...hireGuards.flatMap(m=>[m.id,w.location.id,m.revision]),...hiringReviewGuards.flatMap(m=>[m.id,w.location.id,m.revision]),...(foodOrder.foodRevision===null?[]:[w.location.id,foodOrder.foodRevision]))];
  for (const r of changed) {
    const data = JSON.stringify(r.data); requireThat(new TextEncoder().encode(data).byteLength <= 512000, 'This record is full. Start a new record.');
    statements.push(db.prepare(`INSERT INTO records (id, location_id, kind, owner_id, area, revision, data, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${gated} ON CONFLICT(id) DO UPDATE SET owner_id = excluded.owner_id, area = excluded.area, revision = excluded.revision, data = excluded.data, updated_at = excluded.updated_at`)
      .bind(r.id, r.locationId, r.kind, r.ownerId, r.area, r.revision, data, at, w.location.id, token));
  }
  statements.push(db.prepare(`INSERT INTO command_receipts (location_id, actor_id, request_id, fingerprint, result) SELECT ?, ?, ?, ?, ? WHERE ${gated}`).bind(w.location.id, w.me.id, command.requestId, fingerprint, JSON.stringify(result), w.location.id, token));
  statements.push(db.prepare(`INSERT INTO audit_events (id, location_id, actor_id, action, record_id, at, revision) SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${gated}`).bind(token, w.location.id, w.me.id, command.action, target.id, at, result.workspaceRevision, w.location.id, token));
  const committed = await db.batch(statements);
  if (!committed[0].meta.changes) {
    await requireRestaurantAccess(db,identity,w.location.id);
    const repeated = await receipt(db, w.location.id, w.me.id, command.requestId, fingerprint); if (repeated) return repeated;
    throw new AppError(409, 'Someone changed this workspace while you were saving. Refresh and review before trying again.');
  }
  return result;
}

// Sites' dispatch proxy authenticates the cookie and supplies this identity header.
// Deploy only behind that proxy. A direct public Worker must NOT trust this header.
// Test identities live exclusively in the test harness; there is no local login override here.
export async function authenticateWorkspace(request:Request,binding?:D1Database) {
  // Employee sign-in uses our own revocable session; owner sign-in continues
  // through the Sites proxy. All downstream restaurant/role checks are shared.
  if(cookieValue(request,employeeCookie)!==null){
    requireThat(binding,'Shared storage has not been connected yet.',503);
    const db=binding.withSession('first-primary');
    const identity=await employeeIdentity(request,db);
    requireThat(identity,'Please sign in again.',401);identity.restaurantAccess=await requireRestaurantAccess(db,identity,identity.source==='setup-code'?identity.locationId:'');return {db,identity,authUserId:identity.authUserId};
  }
  const email=request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
  const browserSubject=request.headers.get('oai-authenticated-user-id');
  requireThat(browserSubject&&browserSubject.length<=200&&email&&email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'Sign in to open your workspace.',401);
  requireThat(binding,'Shared storage has not been connected yet.',503);
  const db=binding.withSession('first-primary');
  // This link can only be established while redeeming an authorized setup code.
  const linked=await db.prepare('SELECT principal_id FROM browser_identity_links WHERE subject_id=?').bind(browserSubject).first<{principal_id:string}>();
  const authUserId=linked?.principal_id??browserSubject;
  await db.prepare('UPDATE memberships SET auth_user_id = ?, revision = revision + 1 WHERE email = ? AND active = 1 AND auth_user_id IS NULL').bind(authUserId,email).run();
  const waiting=await recordAdministratorIdentity(db,authUserId,browserSubject,email);
  const registered=await db.prepare('SELECT id FROM memberships WHERE auth_user_id = ? AND active = 1 LIMIT 1').bind(authUserId).first();
  requireThat(registered,waiting?'Your owner sign-in is verified and waiting for approval. Ask another owner to open Employee access, select your name, and approve the verified sign-in. Then press Try again.':'This browser account is not connected to JMAX. If your restaurant access is already enabled, sign in with your JMAX setup code.',403);
  const identity:WorkspaceIdentity={source:'sites',authUserId,restaurantAccess:await restaurantAccess(db,authUserId)};
  return {db,identity,authUserId};
}
export async function requireLocationAdministrator(db:Database,identity:WorkspaceIdentity,locationId:string) {
  requireIdentityLocation(identity,locationId);
  await requireRestaurantAccess(db,identity,locationId);
  const memberId=identity.source==='setup-code'?identity.memberId:null;
  const row=await db.prepare('SELECT * FROM memberships WHERE auth_user_id = ? AND location_id = ? AND active = 1 AND (? IS NULL OR id = ?)').bind(identity.authUserId,locationId,memberId,memberId).first<MemberRow>();
  requireThat(row,'No access to this restaurant.',403);
  requireThat(identity.source==='sites'||row.revision===identity.membershipRevision,'Your access changed. Please sign in again.',401);
  const member=memberFromRow(row);
  requireThat(member.position!=='Dishwasher'&&member.capabilities.includes('location.manage'),'Restaurant setup requires administrator access.',403);
  return {member,revision:row.revision};
}
export async function handleWorkspace(request: Request, binding?: D1Database): Promise<Response> {
  try {
    requireThat(request.method === 'GET' || request.method === 'POST', 'Method not allowed.', 405);
    // Email claims only a provisioned invitation; later checks use stable identity.
    const {db,identity,authUserId}=await authenticateWorkspace(request,binding);
    const url = new URL(request.url);
    if (request.method === 'GET') {
      const locationId = url.searchParams.get('locationId');
      if (!locationId) {
        const memberId=identity.source==='setup-code'?identity.memberId:null;
        const list = await db.prepare('SELECT m.id, m.location_id AS locationId, m.name, m.position, l.name AS locationName FROM memberships m JOIN locations l ON l.id = m.location_id WHERE m.auth_user_id = ? AND m.active = 1 AND (? IS NULL OR m.id = ?) ORDER BY l.name').bind(authUserId,memberId,memberId).all();
        const access=await restaurantAccess(db,authUserId);
        const foodMemberships=access.kind==='commissary'?(await db.prepare('SELECT m.id,m.location_id AS locationId,m.name,m.position,l.name AS locationName FROM memberships m JOIN locations l ON l.id=m.location_id WHERE m.auth_user_id=? AND m.active=1 AND m.schedule_only=0').bind(authUserId).all()).results:[];
        return json({ memberships: list.results.filter(row=>permitsRestaurant(access,String(row.locationId))),commissaryFoodLocations:foodMemberships.filter(row=>permitsRestaurant(access,String(row.locationId),'commissary-food')&&String(row.locationId)!==access.home_location_id) });
      }
      const value=(await workspace(db, identity, id(locationId))).value;
      return json(publicWorkspace({...value,recoveredStandards:recoveredFor(value.me)}));
    }
    requireThat(request.headers.get('Origin') === url.origin && request.headers.get('Sec-Fetch-Site') !== 'cross-site', 'Open this action from your JMAX workspace.', 403);
    requireThat(request.headers.get('Content-Type')?.split(';')[0] === 'application/json', 'Use a JSON request.', 415);
    const body = object(await boundedJson(request.body, 128000));
    const command: Command = { requestId: id(body.requestId), locationId: id(body.locationId), action: text(body.action, 'Action', 60), input: object(body.input) };
    if (body.recordId !== undefined) { command.recordId = id(body.recordId); requireThat(Number.isInteger(body.expectedRevision) && Number(body.expectedRevision) > 0, 'An exact record revision is required.'); command.expectedRevision = Number(body.expectedRevision); }
    return json(await commit(db, identity, command));
  } catch (error) {
    if (error instanceof AppError) return json({ error: error.message }, error.status);
    // Never log employee content, credentials, SQL, or private conversation text.
    console.error(JSON.stringify({ event: 'workspace_request_failed', requestId: crypto.randomUUID(), errorType: error instanceof Error ? error.name : 'unknown' }));
    return json({ error: 'The workspace could not complete this request. Your change has not been confirmed; retrying the same request is safe.' }, 503);
  }
}
