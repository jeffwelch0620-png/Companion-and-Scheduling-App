// FICTIONAL POLICY REHEARSAL ONLY. No active app/CLI/server imports this module.
// Supplied snapshots are not authentication, provider verification or current database evidence.
// These functions model eligibility only; they grant no access and perform no reads/writes.
import {exactShape,sourceUuid,contentDigest} from './source-fingerprint.mjs';
const fail=()=>{throw new TypeError('invalid_source_reviewer_rehearsal');};
const shape=(value,keys)=>exactShape(value,keys,'invalid_source_reviewer_rehearsal');
const counter=x=>Number.isSafeInteger(x)&&x>=0;
const revision=x=>Number.isSafeInteger(x)&&x>0;
const same=(a,b)=>a.toLowerCase()===b.toLowerCase();
const idList=values=>values.every(sourceUuid);
const booleans=values=>values.every(v=>typeof v==='boolean');
const boundedList=(value,max)=>Array.isArray(value)&&value.length<=max&&Object.getOwnPropertySymbols(value).length===0&&Object.keys(value).length===value.length&&Array.from({length:value.length},(_,i)=>i).every(i=>Object.hasOwn(value,i));
const families=['roster','timeOff'];
const epochs=['person','accountLink','organization','store'];
function checkedEpochs(value){shape(value,epochs);if(!Object.values(value).every(counter))fail();}
function checkedSnapshot(s){
 shape(s,['version','organization','store','person','accountLink','session','authority','designations','activeMembershipCount','workspaceRevision']);
 if(s.version!==1||!counter(s.activeMembershipCount)||!counter(s.workspaceRevision))fail();
 shape(s.organization,['id','active','eligibilityRevision','policyRevision']);
 shape(s.store,['id','organizationId','active','eligibilityRevision']);
 shape(s.person,['id','active','eligibilityRevision']);
 shape(s.accountLink,['id','personId','active','revision','eligibilityRevision','lifecycleVerified']);
 shape(s.session,['id','personId','verified','active','revision']);
 shape(s.authority,['personId','organizationId','owner','enabledAdmin','revision']);
 if(!idList([s.organization.id,s.store.id,s.store.organizationId,s.person.id,s.accountLink.id,s.accountLink.personId,s.session.id,s.session.personId,s.authority.personId,s.authority.organizationId]))fail();
 if(!booleans([s.organization.active,s.store.active,s.person.active,s.accountLink.active,s.accountLink.lifecycleVerified,s.session.verified,s.session.active,s.authority.owner,s.authority.enabledAdmin]))fail();
 if(![s.organization.eligibilityRevision,s.store.eligibilityRevision,s.person.eligibilityRevision,s.accountLink.eligibilityRevision].every(counter)||![s.organization.policyRevision,s.accountLink.revision,s.session.revision,s.authority.revision].every(revision))fail();
 if(!boundedList(s.designations,100))fail();
 const ids=new Set(),scopes=new Set();
 for(const d of s.designations){
  shape(d,['id','organizationId','storeId','personId','family','level','active','revision','eligibilityRevision']);
  if(!idList([d.id,d.organizationId,d.storeId,d.personId])||!families.includes(d.family)||!['review','review_and_certify'].includes(d.level)||typeof d.active!=='boolean'||!revision(d.revision))fail();
  checkedEpochs(d.eligibilityRevision);
  const key=JSON.stringify([d.organizationId.toLowerCase(),d.storeId.toLowerCase(),d.personId.toLowerCase(),d.family]);
  if(ids.has(d.id.toLowerCase())||scopes.has(key))fail();ids.add(d.id.toLowerCase());scopes.add(key);
 }
}
function checkedRequest(r){
 shape(r,['action','organizationId','storeId','family','designationId','authorPersonIds']);
 if(!['read','certify','self_revoke'].includes(r.action)||!idList([r.organizationId,r.storeId])||!families.includes(r.family))fail();
 if(r.action==='self_revoke'?!sourceUuid(r.designationId):r.designationId!==null)fail();
 if(!boundedList(r.authorPersonIds,100)||!idList(r.authorPersonIds)||new Set(r.authorPersonIds.map(x=>x.toLowerCase())).size!==r.authorPersonIds.length)fail();
}
const result=(eligible,code,via=null)=>Object.freeze({purpose:'fictional_source_reviewer_policy_rehearsal',eligible,code,via,authoritative:false,canApply:false,completenessCertified:false,accessProvisioned:false});
function currentEpochs(s){return {person:s.person.eligibilityRevision,accountLink:s.accountLink.eligibilityRevision,organization:s.organization.eligibilityRevision,store:s.store.eligibilityRevision};}
function scopedDesignation(s,r){
 return s.designations.find(d=>same(d.personId,s.person.id)&&same(d.organizationId,r.organizationId)&&same(d.storeId,r.storeId)&&d.family===r.family);
}
function decide(s,r){
 if(!same(s.person.id,s.accountLink.personId)||!same(s.person.id,s.session.personId)||!same(s.person.id,s.authority.personId)||!same(s.organization.id,s.authority.organizationId))return result(false,'identity_mismatch');
 if(!s.session.verified||!s.session.active||!s.person.active||!s.accountLink.active)return result(false,'identity_ineligible');
 if(!s.accountLink.lifecycleVerified)return result(false,'lifecycle_unverified');
 if(!same(r.organizationId,s.organization.id)||!same(r.storeId,s.store.id)||!same(s.store.organizationId,s.organization.id))return result(false,'scope_denied');
 if(!s.organization.active)return result(false,'scope_ineligible');
 if(r.action==='self_revoke'){
  const d=s.designations.find(d=>same(d.id,r.designationId));
  if(!d||!same(d.personId,s.person.id)||!same(d.organizationId,r.organizationId)||!same(d.storeId,r.storeId)||d.family!==r.family)return result(false,'self_revocation_denied');
  // Relinquishment uses current personal identity, not source-review eligibility or employment.
  return result(true,d.active?'self_revocation_eligible':'already_revoked','self_revocation');
 }
 if(!s.store.active)return result(false,'scope_ineligible');
 if(s.authority.owner)return result(true,'eligible','organization_owner');
 if(s.authority.enabledAdmin)return result(true,'eligible','enabled_admin');
 const d=scopedDesignation(s,r);
 if(!d||!d.active)return result(false,'designation_required');
 if(epochs.some(k=>d.eligibilityRevision[k]!==currentEpochs(s)[k]))return result(false,'eligibility_review_required');
 if(r.action==='certify'&&d.level!=='review_and_certify')return result(false,'certification_level_required');
 // R07: authorship never grants authority and does not disqualify an otherwise eligible certifier.
 return result(true,'eligible','designation');
}
export function rehearseSourceReviewer(s,r){checkedSnapshot(s);checkedRequest(r);return decide(s,r);}
function fence(s,r){
 const selected=r.action==='self_revoke'?s.designations.find(d=>same(d.id,r.designationId)):scopedDesignation(s,r);
 const organizationPolicy=r.action!=='self_revoke'&&(s.authority.owner||s.authority.enabledAdmin);
 // Membership count and global workspaceRevision are deliberately outside the access fence.
 return contentDigest({organization:s.organization,store:{...s.store},person:s.person,accountLink:s.accountLink,session:s.session,authority:s.authority,designation:organizationPolicy?null:selected??null});
}
export function rehearseSourceReviewerFinalAccess(before,after,r){
 checkedSnapshot(before);checkedSnapshot(after);checkedRequest(r);
 const initial=decide(before,r);if(!initial.eligible)return initial;
 const final=decide(after,r);if(!final.eligible)return final;
 if(fence(before,r)!==fence(after,r))return result(false,'access_fence_changed');
 return final;
}
export function rehearseSourceReviewerAdvisories(before,after){
 checkedSnapshot(before);checkedSnapshot(after);
 if(!same(before.person.id,after.person.id)||!same(before.organization.id,after.organization.id))fail();
 const ownCurrent=s=>s.designations.some(d=>d.active&&same(d.personId,s.person.id)&&same(d.organizationId,s.organization.id));
 const codes=[];
 if(ownCurrent(before)||ownCurrent(after)){
  if(before.activeMembershipCount>0&&after.activeMembershipCount===0)codes.push('last_active_membership_ended');
  if(before.person.active&&!after.person.active)codes.push('reviewer_person_inactive');
 }
 // A pure transition proposal: no queued item, notification, mutation or deduplication receipt.
 return Object.freeze({purpose:'fictional_source_reviewer_policy_rehearsal',advisoryKinds:Object.freeze(codes),authoritative:false,canApply:false,completenessCertified:false,accessProvisioned:false});
}
