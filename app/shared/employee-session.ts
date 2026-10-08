import { AppError, requireThat } from './validation';
import {permitsRestaurant,type RestaurantAccess,type RestaurantScope} from './restaurant-access';

export const employeeCookie='__Host-jmax-session';
export const sessionSeconds=30*24*60*60;
type Database=Pick<D1Database,'prepare'|'batch'>;
export type WorkspaceIdentity=
  | {source:'sites';authUserId:string;restaurantAccess?:RestaurantAccess}
  | {source:'setup-code';authUserId:string;memberId:string;locationId:string;membershipRevision:number;restaurantAccess?:RestaurantAccess};

export function requireIdentityLocation(identity:WorkspaceIdentity,locationId:string,scope:RestaurantScope='restaurant'){
  requireThat(identity.source==='sites'||identity.locationId===locationId||(scope==='commissary-food'&&identity.locationId==='comm'&&identity.restaurantAccess?.kind==='commissary'&&permitsRestaurant(identity.restaurantAccess,locationId,scope)),'No access to this restaurant.',403);
  if(identity.source==='sites'&&identity.restaurantAccess)requireThat(permitsRestaurant(identity.restaurantAccess,locationId,scope),'No access to this restaurant.',403);
}
export function cookieValue(request:Request,name:string):string|null {
  const values=(request.headers.get('Cookie')??'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(name+'='));
  if(!values.length)return null;
  requireThat(values.length===1,'Please sign in again.',401);
  return values[0].slice(name.length+1);
}
export function randomToken(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');}
export async function tokenHash(token:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');}
export function sessionCookie(token:string,seconds=sessionSeconds){return `${employeeCookie}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${seconds}`;}
export async function employeeIdentity(request:Request,db:Database):Promise<WorkspaceIdentity|null>{
  const token=cookieValue(request,employeeCookie);
  if(token===null)return null;
  requireThat(/^[a-f0-9]{64}$/.test(token),'Please sign in again.',401);
  const session=await db.prepare('SELECT s.auth_user_id,s.member_id,s.member_revision,m.location_id FROM employee_sessions s JOIN memberships m ON m.id=s.member_id AND m.auth_user_id=s.auth_user_id AND m.active=1 AND m.revision=s.member_revision WHERE s.token_hash=? AND s.expires_at>?').bind(await tokenHash(token),Date.now()).first<{auth_user_id:string;member_id:string;member_revision:number;location_id:string}>();
  // Never fall back to a different browser owner's ChatGPT login when an
  // employee cookie is present but invalid, expired, archived or revoked.
  if(!session)throw new AppError(401,'Your sign-in expired or your access changed. Please sign in again.');
  return {source:'setup-code',authUserId:session.auth_user_id,memberId:session.member_id,locationId:session.location_id,membershipRevision:session.member_revision};
}
