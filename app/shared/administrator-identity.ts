import type {AdministratorRequest} from './access-types';

type Database=Pick<D1Database,'prepare'|'batch'>;
export type AdministratorRequestRow={member_id:string;request_id:string;kind:AdministratorRequest['kind'];status:AdministratorRequest['status'];member_revision:number;requested_auth_user_id:string|null;browser_subject:string|null;verified_email:string|null;created_at:string;verified_at:string|null;expires_at:string};
export function administratorRequestView(r:AdministratorRequestRow):AdministratorRequest{
  return {requestId:r.request_id,kind:r.kind,status:r.status,verifiedEmail:r.verified_email,verifiedAt:r.verified_at,expiresAt:r.expires_at};
}

// A provider sign-in proves who is requesting access, not authorization to a
// restaurant. Save only the request; never activate or rebind the membership here.
export async function recordAdministratorIdentity(db:Database,authUserId:string,browserSubject:string,email:string){
  const now=new Date().toISOString(),expiry=new Date(Date.now()+24*60*60*1000).toISOString();
  const candidates=await db.prepare(`SELECT m.id,m.auth_user_id,m.revision,m.active,r.request_id,r.kind,r.status,r.requested_auth_user_id,r.expires_at FROM memberships m LEFT JOIN administrator_requests r ON r.member_id=m.id WHERE m.email=? AND m.location_id<>'owner-review' AND json_extract(m.employment,'$.status')='active' AND EXISTS(SELECT 1 FROM json_each(m.capabilities) WHERE value='location.manage') AND ((m.active=1 AND m.auth_user_id IS NOT NULL AND m.auth_user_id<>?) OR (m.active=0 AND r.kind='invitation' AND r.status IN ('invited','requested')))`)
    .bind(email,authUserId).all<{id:string;auth_user_id:string|null;revision:number;active:number;request_id:string|null;kind:string|null;status:string|null;requested_auth_user_id:string|null;expires_at:string|null}>();
  let waiting=false;
  for(const m of candidates.results){
    // One identity cannot claim a second person at the same restaurant.
    const collision=await db.prepare('SELECT id FROM memberships WHERE auth_user_id=? AND location_id=(SELECT location_id FROM memberships WHERE id=?) AND id<>?').bind(authUserId,m.id,m.id).first();
    if(collision)continue;
    if(m.active===0){
      if(!m.expires_at||m.expires_at<=now)continue;
      const result=await db.prepare(`UPDATE administrator_requests SET status='requested',requested_auth_user_id=?,browser_subject=?,verified_email=?,verified_at=? WHERE member_id=? AND request_id=? AND kind='invitation' AND status='invited' AND expires_at>? AND EXISTS(SELECT 1 FROM memberships WHERE id=? AND active=0 AND revision=administrator_requests.member_revision AND email=?)`)
        .bind(authUserId,browserSubject,email,now,m.id,m.request_id,now,m.id,email).run();
      waiting=waiting||!!result.meta.changes||m.status==='requested';
    }else{
      // An unresolved request cannot be replaced by another browser sign-in.
      // Expired/cancelled requests can be restarted, while the old login stays active.
      const result=await db.prepare(`INSERT INTO administrator_requests(member_id,request_id,kind,status,member_revision,requested_auth_user_id,browser_subject,verified_email,created_at,verified_at,expires_at) SELECT ?,?,'recovery','requested',?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM memberships WHERE id=? AND active=1 AND revision=? AND email=? AND auth_user_id<>?) ON CONFLICT(member_id) DO UPDATE SET request_id=excluded.request_id,kind=excluded.kind,status=excluded.status,member_revision=excluded.member_revision,requested_auth_user_id=excluded.requested_auth_user_id,browser_subject=excluded.browser_subject,verified_email=excluded.verified_email,created_at=excluded.created_at,verified_at=excluded.verified_at,expires_at=excluded.expires_at WHERE administrator_requests.status IN ('approved','cancelled') OR administrator_requests.expires_at<=?`)
        .bind(m.id,crypto.randomUUID(),m.revision,authUserId,browserSubject,email,now,now,expiry,m.id,m.revision,email,authUserId,now).run();
      waiting=waiting||!!result.meta.changes||m.status==='requested';
    }
  }
  return waiting;
}
