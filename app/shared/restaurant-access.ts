import {requireThat} from './validation';
import type {WorkspaceIdentity} from './employee-session';

type Database=Pick<D1Database,'prepare'|'batch'>;
export type RestaurantAccess={kind:'restaurant'|'jay'|'rudd'|'commissary';home_location_id:string;revision:number};
export type RestaurantScope='restaurant'|'commissary-food';
export const ownerRestaurants=['berts','rudds','papa','comm'] as const;
export const commissaryRestaurants=['berts','rudds'] as const;

// This table is installed by the server operator. Account titles, capabilities,
// browser fields and ordinary Employee access edits cannot assign these seats.
// Empty configuration never grants group ownership to the first person signing in.
export async function restaurantAccess(db:Database,authUserId:string):Promise<RestaurantAccess>{
 const grant=await db.prepare('SELECT kind,home_location_id,revision FROM restaurant_access WHERE auth_user_id=?').bind(authUserId).first<RestaurantAccess>();
 if(grant){
  requireThat(['restaurant','jay','rudd','commissary'].includes(grant.kind)&&grant.revision>0,'Restaurant access needs review.',403);
  requireThat(grant.kind!=='commissary'||grant.home_location_id==='comm','Commissary access needs review.',403);
  if(grant.kind==='commissary')requireThat(await db.prepare("SELECT id FROM memberships WHERE auth_user_id=? AND location_id='comm' AND active=1 AND schedule_only=0").bind(authUserId).first(),'Commissary access is not active.',403);
  return grant;
 }
 // Include unclaimed duplicates of the same personal email. A second setup
 // code must not turn the same employee into a new cross-restaurant identity.
 const memberships=await db.prepare(`SELECT DISTINCT location_id FROM memberships WHERE active=1 AND (auth_user_id=? OR (email<>'' AND lower(email) IN (SELECT lower(email) FROM memberships WHERE auth_user_id=? AND email<>'')))`).bind(authUserId,authUserId).all<{location_id:string}>();
 requireThat(memberships.results.length===1,'Your restaurant assignment needs review. Multiple memberships do not grant access to other restaurants.',403);
 return {kind:'restaurant',home_location_id:memberships.results[0].location_id,revision:0};
}
export function permitsRestaurant(access:RestaurantAccess,locationId:string,scope:RestaurantScope='restaurant'){
 if(access.kind==='jay'||access.kind==='rudd')return ownerRestaurants.some(id=>id===locationId);
 if(locationId===access.home_location_id)return true;
 return access.kind==='commissary'&&scope==='commissary-food'&&commissaryRestaurants.some(id=>id===locationId);
}
export async function requireRestaurantAccess(db:Database,identity:WorkspaceIdentity,locationId:string,scope:RestaurantScope='restaurant'){
 // Owner and staff codes remain pinned. Commissary codes have the separately
 // verified Food exception, and their home membership must remain active.
 const access=await restaurantAccess(db,identity.authUserId);
 if(identity.source==='setup-code'){
  const sessionMember=await db.prepare('SELECT id FROM memberships WHERE id=? AND auth_user_id=? AND location_id=? AND active=1 AND revision=?').bind(identity.memberId,identity.authUserId,identity.locationId,identity.membershipRevision).first();
  requireThat(sessionMember,'Your access changed. Please sign in again.',401);
  requireThat(identity.locationId===locationId||(identity.locationId==='comm'&&access.kind==='commissary'&&scope==='commissary-food'),'No access to this restaurant.',403);
 }
 requireThat(permitsRestaurant(access,locationId,scope),'No access to this restaurant.',403);
 return access;
}
export async function requirePersonalRestaurantAssignment(db:Database,email:string,locationId:string,authUserId?:string|null){
 const rows=await db.prepare(`SELECT DISTINCT m.location_id,a.kind,a.home_location_id,a.revision FROM memberships m LEFT JOIN restaurant_access a ON a.auth_user_id=m.auth_user_id WHERE m.active=1 AND (lower(m.email)=lower(?) OR (? IS NOT NULL AND m.auth_user_id=?))`).bind(email,authUserId??null,authUserId??null).all<{location_id:string;kind:RestaurantAccess['kind']|null;home_location_id:string|null;revision:number|null}>();
 if(!rows.results.some(r=>r.location_id!==locationId))return;
 const grant=rows.results.find(r=>r.kind&&r.home_location_id&&(r.kind!=='restaurant'||r.home_location_id===locationId));
 requireThat(grant?.kind&&grant.home_location_id&&permitsRestaurant({kind:grant.kind,home_location_id:grant.home_location_id,revision:grant.revision??0},locationId,'commissary-food'),'This person is assigned to another restaurant. Only the verified Jay, Rudd or commissary access grants allow multiple restaurants.',403);
}
// Carry the policy check into the same transaction as the write. A revoked
// grant must invalidate a prepared command even if membership revisions stayed.
export async function restaurantAccessWriteGuard(db:Database,identity:WorkspaceIdentity,locationId:string,scope:RestaurantScope='restaurant'){
 const access=await requireRestaurantAccess(db,identity,locationId,scope);
 if(access.revision>0)return {sql:"EXISTS(SELECT 1 FROM restaurant_access a WHERE a.auth_user_id=? AND a.kind=? AND a.home_location_id=? AND a.revision=? AND (a.kind<>'commissary' OR EXISTS(SELECT 1 FROM memberships m WHERE m.auth_user_id=a.auth_user_id AND m.location_id='comm' AND m.active=1 AND m.schedule_only=0)))"+(identity.source==='setup-code'?' AND EXISTS(SELECT 1 FROM memberships WHERE id=? AND auth_user_id=? AND location_id=? AND active=1 AND revision=?)':''),values:[identity.authUserId,access.kind,access.home_location_id,access.revision,...(identity.source==='setup-code'?[identity.memberId,identity.authUserId,identity.locationId,identity.membershipRevision]:[])]};
 return {sql:`NOT EXISTS(SELECT 1 FROM restaurant_access WHERE auth_user_id=?) AND NOT EXISTS(SELECT 1 FROM memberships WHERE active=1 AND location_id<>? AND (auth_user_id=? OR (email<>'' AND lower(email) IN (SELECT lower(email) FROM memberships WHERE auth_user_id=? AND email<>''))))`,values:[identity.authUserId,locationId,identity.authUserId,identity.authUserId]};
}
