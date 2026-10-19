// FICTIONAL M3 PREDICATE ONLY. No suspension, authentication, authorization or writes.
// Complete/current owner, authority and approval evidence is supplied as trusted fixtures.
import {exactShape,sourceUuid} from './source-fingerprint.mjs';
const error='invalid_suspension_coapproval_rehearsal';
const fail=()=>{throw new TypeError(error);};
const shape=(v,keys)=>exactShape(v,keys,error);
const same=(a,b)=>a.toLowerCase()===b.toLowerCase();
const revision=n=>Number.isSafeInteger(n)&&n>0;
const ids=v=>v.every(sourceUuid);
const bools=v=>v.every(x=>typeof x==='boolean');
const scope='organization_access';
const bindingIds=['caseId','organizationId','actorPersonId','targetPersonId'];
const bindingRevisions=['caseRevision','ownerSetRevision','suspensionRevision'];
function binding(b){
 if(!ids(bindingIds.map(k=>b[k]))||!bindingRevisions.every(k=>revision(b[k]))||b.scope!==scope)fail();
}
function checked(c){
 shape(c,['version','organizationId','organizationActive','lifecycleVerified','ownersComplete',
  'ownerSetRevision','suspensionRevision','caseId','caseRevision','owners','actor','targetPersonId','request','coapproval']);
 if(c.version!==1||!ids([c.organizationId,c.caseId,c.targetPersonId])||
  !bools([c.organizationActive,c.lifecycleVerified,c.ownersComplete])||
  ![c.ownerSetRevision,c.suspensionRevision,c.caseRevision].every(revision))fail();
 shape(c.actor,['personId','verified','eligible','suspended']);
 if(!sourceUuid(c.actor.personId)||!bools([c.actor.verified,c.actor.eligible,c.actor.suspended]))fail();
 const owners=c.owners;
 if(!Array.isArray(owners)||owners.length>200||Object.getOwnPropertySymbols(owners).length||
  Object.keys(owners).length!==owners.length||Array.from({length:owners.length},(_,i)=>i).some(i=>!Object.hasOwn(owners,i)))fail();
 const seen=new Set();for(const o of owners){
  shape(o,['personId','eligible','suspended']);
  if(!sourceUuid(o.personId)||!bools([o.eligible,o.suspended])||seen.has(o.personId.toLowerCase()))fail();
  seen.add(o.personId.toLowerCase());
 }
 shape(c.request,[...bindingIds,...bindingRevisions,'scope','reasonRecorded','auditRecorded']);
 binding(c.request);if(!bools([c.request.reasonRecorded,c.request.auditRecorded]))fail();
 if(c.coapproval!==null){
  const a=c.coapproval;
  shape(a,[...bindingIds,...bindingRevisions,'scope','reviewer','approved','current','evidenceVerified']);binding(a);
  if(!bools([a.approved,a.current,a.evidenceVerified]))fail();
  shape(a.reviewer,['personId','organizationId','verified','eligible','suspended','governanceAuthorized']);
  if(!ids([a.reviewer.personId,a.reviewer.organizationId])||
   !bools([a.reviewer.verified,a.reviewer.eligible,a.reviewer.suspended,a.reviewer.governanceAuthorized]))fail();
 }
}
const result=(m3Satisfied,code,governanceRequired=null)=>Object.freeze({
 purpose:'fictional_suspension_coapproval_rehearsal',m3Satisfied,code,governanceRequired,
 authoritative:false,canApply:false,accessProvisioned:false,completenessCertified:false
});
// Owner-to-owner, one organization, exact fixed scope only. Positive is not permission.
export function rehearseSuspensionCoapproval(c){
 checked(c);const r=c.request;
 if(!c.organizationActive)return result(false,'organization_ineligible');
 if(!c.lifecycleVerified)return result(false,'lifecycle_unverified');
 if(!c.ownersComplete)return result(false,'owner_set_unverified');
 if(!same(r.organizationId,c.organizationId)||!same(r.caseId,c.caseId)||
  !same(r.actorPersonId,c.actor.personId)||!same(r.targetPersonId,c.targetPersonId))return result(false,'request_scope_changed');
 if(!c.actor.verified||!c.actor.eligible||c.actor.suspended)return result(false,'initiator_ineligible');
 const initiator=c.owners.find(o=>same(o.personId,c.actor.personId));
 if(!initiator||!initiator.eligible||initiator.suspended)return result(false,'current_owner_required');
 if(same(c.actor.personId,c.targetPersonId))return result(false,'distinct_target_required');
 const target=c.owners.find(o=>same(o.personId,c.targetPersonId));
 if(!target)return result(false,'target_owner_required');
 if(!target.eligible||target.suspended)return result(false,'target_owner_ineligible');
 if(bindingRevisions.some(k=>r[k]!==c[k]))return result(false,'review_context_changed');
 if(!r.reasonRecorded)return result(false,'reason_required');
 if(!r.auditRecorded)return result(false,'audit_required');
 const remaining=c.owners.filter(o=>o.eligible&&!o.suspended&&!same(o.personId,c.targetPersonId));
 const required=remaining.length===1&&same(remaining[0].personId,c.actor.personId);
 const a=c.coapproval;
 if(a!==null){
  if(bindingIds.some(k=>!same(a[k],r[k]))||bindingRevisions.some(k=>a[k]!==r[k])||a.scope!==r.scope)
   return result(false,'coapproval_context_changed',required);
  if(!a.approved)return result(false,'governance_coapproval_refused',required);
  if(!a.current)return result(false,'governance_coapproval_stale',required);
  if(!a.evidenceVerified)return result(false,'governance_evidence_unverified',required);
  const reviewer=a.reviewer;
  if(!same(reviewer.organizationId,c.organizationId)||!reviewer.verified||!reviewer.eligible||reviewer.suspended)
   return result(false,'governance_reviewer_ineligible',required);
  const reviewerOwner=c.owners.find(o=>same(o.personId,reviewer.personId));
  if(reviewerOwner&&(!reviewerOwner.eligible||reviewerOwner.suspended))
   return result(false,'governance_reviewer_ineligible',required);
  if(same(reviewer.personId,c.actor.personId)||same(reviewer.personId,c.targetPersonId))
   return result(false,'independent_governance_required',required);
  if(!reviewer.governanceAuthorized)return result(false,'governance_authority_required',required);
 }
 if(required&&a===null)return result(false,'governance_coapproval_required',true);
 return result(true,required?'m3_coapproval_satisfied':'m3_not_triggered',required);
}
