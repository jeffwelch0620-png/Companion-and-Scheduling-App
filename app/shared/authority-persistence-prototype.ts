// ISOLATED PROTOTYPE: only tests import this adapter. No grant provisioning API.
import {explicitAuthority,type AuthorityAction,type AuthorityGrant,type AuthorityIdentity,type AuthorityProof,type AuthorityResource} from './authority-contract-prototype';
type Database=Pick<D1Database,'prepare'|'batch'>;
type Principal={organization_id:string;person_id:string;auth_user_id:string;revision:number;active:number;verified_at:string;verified_by_person_id:string;source_ref:string};
type Membership={id:string;auth_user_id:string;location_id:string;revision:number;active:number;schedule_only:number};
type GrantRow={id:string;organization_id:string;person_id:string;membership_id:string|null;membership_revision:number|null;store_id:string|null;role:AuthorityGrant['role'];revision:number;active:number;starts_at:string;ends_at:string|null;verified_at:string;verified_by_person_id:string;source_ref:string};
export type PersistedAuthorityProof=AuthorityProof&{identity:AuthorityIdentity;principalRevision:number};
// authUserId is authenticated server identity, organization/store are verified
// server resource scope. They must never come from a client identity selector.
export async function loadExplicitAuthority(db:Database,authUserId:string,organizationId:string,storeId:string,action:AuthorityAction,resource:AuthorityResource,at:string):Promise<PersistedAuthorityProof|null>{
 const rows=await db.batch([
  db.prepare('SELECT * FROM prototype_authority_principals WHERE auth_user_id=? AND organization_id=?').bind(authUserId,organizationId),
  db.prepare('SELECT id,auth_user_id,location_id,revision,active,schedule_only FROM memberships WHERE auth_user_id=? AND location_id=?').bind(authUserId,storeId),
  db.prepare('SELECT g.* FROM prototype_authority_grants g JOIN prototype_authority_principals p ON p.organization_id=g.organization_id AND p.person_id=g.person_id WHERE p.auth_user_id=? AND p.organization_id=?').bind(authUserId,organizationId),
 ]);
 if(rows[0].results.length!==1||rows[1].results.length!==1)return null;
 const p=rows[0].results[0] as Principal,m=rows[1].results[0] as Membership;
 if(p.active!==1||!p.source_ref.trim()||!p.verified_by_person_id.trim()||!Number.isFinite(Date.parse(p.verified_at))||Date.parse(p.verified_at)>Date.parse(at)||!Number.isSafeInteger(p.revision)||p.revision<=0)return null;
 const identity:AuthorityIdentity={authUserId:p.auth_user_id,personId:p.person_id,organizationId:p.organization_id,membershipId:m.id,storeId:m.location_id,membershipRevision:m.revision,active:m.active===1,scheduleOnly:m.schedule_only===1};
 const grants=(rows[2].results as GrantRow[]).map(g=>({id:g.id,organizationId:g.organization_id,personId:g.person_id,membershipId:g.membership_id,membershipRevision:g.membership_revision,storeId:g.store_id,role:g.role,revision:g.revision,active:g.active===1,startsAt:g.starts_at,endsAt:g.ends_at,verifiedAt:g.verified_at,verifiedByPersonId:g.verified_by_person_id,sourceRef:g.source_ref}));
 return {...explicitAuthority(identity,grants,action,resource,at),identity,principalRevision:p.revision};
}
export function authorityTransactionGuard(proof:PersistedAuthorityProof|null,commitAt:string):{sql:string;values:(string|number)[]}{
 if(!proof?.allowed||!/^\d{4}-\d{2}-\d{2}T/.test(commitAt)||!Number.isFinite(Date.parse(commitAt)))return {sql:'0',values:[]};
 const i=proof.identity;
 const sql=[
  'EXISTS(SELECT 1 FROM prototype_authority_principals WHERE organization_id=? AND person_id=? AND auth_user_id=? AND active=1 AND revision=?)',
  'EXISTS(SELECT 1 FROM memberships WHERE id=? AND location_id=? AND auth_user_id=? AND active=1 AND schedule_only=0 AND revision=?)',
  ...proof.grantRevisions.map(()=>"EXISTS(SELECT 1 FROM prototype_authority_grants WHERE id=? AND organization_id=? AND person_id=? AND active=1 AND revision=? AND julianday(starts_at)<=julianday(?) AND (ends_at IS NULL OR julianday(?)<julianday(ends_at)))"),
 ].join(' AND ');
 const values:(string|number)[]=[i.organizationId,i.personId,i.authUserId,proof.principalRevision,i.membershipId,i.storeId,i.authUserId,proof.membershipRevision,...proof.grantRevisions.flatMap(g=>[g.id,i.organizationId,i.personId,g.revision,commitAt,commitAt])];
 return {sql,values};
}
