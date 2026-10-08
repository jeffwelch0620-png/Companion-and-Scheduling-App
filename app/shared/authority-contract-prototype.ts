// ISOLATED PROTOTYPE. No existing authentication or command path calls this.
// Inputs must come from a verified server-side identity/grant snapshot, never
// from request JSON, UI selections, Toast titles or administrator capabilities.
export type ExplicitRole='owner'|'gm'|'foh-manager'|'boh-manager'|'covering-foh'|'covering-boh';
export type AuthorityIdentity={authUserId:string;personId:string;organizationId:string;membershipId:string;storeId:string;membershipRevision:number;active:boolean;scheduleOnly:boolean};
export type AuthorityGrant={id:string;organizationId:string;personId:string;membershipId:string|null;membershipRevision:number|null;storeId:string|null;role:ExplicitRole;revision:number;active:boolean;startsAt:string;endsAt:string|null;verifiedAt:string;verifiedByPersonId:string;sourceRef:string};
export type AuthorityAction='incident.read'|'management.offer.approve'|'crossstore.sop.approve'|'manager.pay.read'|'frontline.hire.approve'|'lead.appoint'|'store.sop.approve'|'foh.service'|'boh.service'|'frontline.rate.read'|'applicant.read'|'performance.read';
export type AuthorityResource={organizationId:string;storeId:string;subjectPersonId?:string;involvedHiringPersonIds?:readonly string[];designatedReviewPersonIds?:readonly string[];scheduleWriting?:boolean};
export type AuthorityProof={allowed:boolean;grantRevisions:readonly {id:string;revision:number}[];membershipRevision:number};
const validId=(v:string)=>typeof v==='string'&&v.trim().length>0;
const validRevision=(v:number)=>Number.isSafeInteger(v)&&v>0;
const stamp=(v:string)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v)&&Number.isFinite(Date.parse(v));

export function explicitAuthority(identity:AuthorityIdentity,grants:readonly AuthorityGrant[],action:AuthorityAction,resource:AuthorityResource,at:string):AuthorityProof{
 const deny:AuthorityProof={allowed:false,grantRevisions:[],membershipRevision:identity.membershipRevision};
 if(!stamp(at)||!identity.active||identity.scheduleOnly||!validRevision(identity.membershipRevision)||![identity.authUserId,identity.personId,identity.organizationId,identity.membershipId,identity.storeId].every(validId)||resource.organizationId!==identity.organizationId)return deny;
 // Conflicting or duplicate grant identities indicate an invalid snapshot.
 if(new Set(grants.map(g=>g.id)).size!==grants.length)return deny;
 const current=grants.filter(g=>g.active&&validId(g.id)&&validRevision(g.revision)&&g.organizationId===identity.organizationId&&g.personId===identity.personId&&validId(g.sourceRef)&&validId(g.verifiedByPersonId)&&stamp(g.verifiedAt)&&Date.parse(g.verifiedAt)<=Date.parse(at)&&stamp(g.startsAt)&&Date.parse(g.startsAt)<=Date.parse(at)&&(!g.endsAt||stamp(g.endsAt)&&Date.parse(at)<Date.parse(g.endsAt))&&(
  g.role==='owner'?g.storeId===null&&g.membershipId===null&&g.membershipRevision===null:
  g.storeId===identity.storeId&&g.storeId===resource.storeId&&g.membershipId===identity.membershipId&&g.membershipRevision===identity.membershipRevision&&(['covering-foh','covering-boh'].includes(g.role)?g.endsAt!==null:true)
  ));
 const owners=current.filter(g=>g.role==='owner');
 const roles=(...names:ExplicitRole[])=>current.filter(g=>names.includes(g.role));
 let evidence:AuthorityGrant[]=[];
 switch(action){
  case 'incident.read':case 'management.offer.approve':case 'crossstore.sop.approve':case 'manager.pay.read':evidence=owners;break;
  case 'frontline.hire.approve':case 'lead.appoint':case 'store.sop.approve':evidence=[...owners,...roles('gm')];break;
  case 'foh.service':evidence=[...owners,...roles('gm','foh-manager','covering-foh')];break;
  case 'boh.service':evidence=[...owners,...roles('gm','boh-manager','covering-boh')];break;
  case 'frontline.rate.read':if(resource.scheduleWriting===true)evidence=[...owners,...roles('gm','foh-manager','boh-manager')];break;
  case 'applicant.read':evidence=owners.length?owners:resource.involvedHiringPersonIds?.includes(identity.personId)?roles('gm','foh-manager','boh-manager'):[];break;
  case 'performance.read':
   if(resource.storeId===identity.storeId&&resource.subjectPersonId===identity.personId)return {allowed:true,grantRevisions:[],membershipRevision:identity.membershipRevision};
   evidence=owners.length?owners:resource.designatedReviewPersonIds?.includes(identity.personId)?roles('gm','foh-manager','boh-manager'):[];break;
 }
 return evidence.length?{allowed:true,grantRevisions:evidence.map(g=>({id:g.id,revision:g.revision})),membershipRevision:identity.membershipRevision}:deny;
}
