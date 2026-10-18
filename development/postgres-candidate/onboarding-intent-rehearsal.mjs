// FICTIONAL REHEARSAL ONLY: supplied flags are not verified provider or authorization evidence.
// Never import this oracle into an application, adapter, CLI or permission service.
import {exactShape,sourceUuid,trimmedText} from './source-fingerprint.mjs';
const error='invalid_onboarding_intent_rehearsal';
const fail=()=>{throw new TypeError(error);};
const shape=(v,keys)=>exactShape(v,keys,error);
const same=(a,b)=>a.toLowerCase()===b.toLowerCase();
const counter=v=>Number.isSafeInteger(v)&&v>=0;
const revision=v=>Number.isSafeInteger(v)&&v>0;
const ids=values=>values.every(sourceUuid);
const bools=values=>values.every(v=>typeof v==='boolean');
const result=(eligible,code,extra={})=>Object.freeze({
 purpose:'fictional_onboarding_intent_rehearsal',eligible,code,
 authoritative:false,canApply:false,accessProvisioned:false,completenessCertified:false,...extra
});
function namespace(v){
 shape(v,['provider','issuer','tenant']);
 if(![v.provider,v.issuer,v.tenant].every(s=>trimmedText(s,300)))fail();
}
function identity(v){
 shape(v,['provider','issuer','tenant','subject']);
 namespace({provider:v.provider,issuer:v.issuer,tenant:v.tenant});
 if(!trimmedText(v.subject,300))fail();
}
const namespaceMatches=(a,b)=>['provider','issuer','tenant'].every(k=>a[k]===b[k]);
const identityMatches=(a,b)=>namespaceMatches(a,b)&&a.subject===b.subject;
function context(c){
 shape(c,['version','organizationId','intentId','personId','issuerPersonId','revision','issuedAt','now','audience','challengeId','approval','providerState','reconciliation','operationId','binding','bindingRevision','providerNamespace','issuerEligible']);
 if(c.version!==1||!ids([c.organizationId,c.intentId,c.personId,c.issuerPersonId,c.challengeId])||
 !revision(c.revision)||![c.issuedAt,c.now,c.bindingRevision].every(counter)||c.now<c.issuedAt||
 !trimmedText(c.audience,200)||typeof c.issuerEligible!=='boolean'||
 !['approved','expired','revoked','consumed'].includes(c.approval)||
 !['not_started','pending','unknown','confirmed','refused'].includes(c.providerState)||
 !['none','required','resolved'].includes(c.reconciliation))fail();
 namespace(c.providerNamespace);
 if(c.binding===null){if(c.bindingRevision!==0)fail();}
 else{identity(c.binding);if(!revision(c.bindingRevision)||!namespaceMatches(c.binding,c.providerNamespace))fail();}
 if(c.operationId!==null&&!sourceUuid(c.operationId))fail();
 if((c.providerState==='not_started')!==(c.operationId===null))fail();
 if(c.providerState==='unknown'&&c.reconciliation!=='required')fail();
}
function proof(p){
 shape(p,['organizationId','intentId','intentRevision','personId','audience','challengeId','identity','verified','current','usablePersonalContact','contact']);
 if(!ids([p.organizationId,p.intentId,p.personId,p.challengeId])||!revision(p.intentRevision)||
 !trimmedText(p.audience,200)||!bools([p.verified,p.current,p.usablePersonalContact]))fail();
 identity(p.identity);
 if(p.contact!==null){shape(p.contact,['kind','value','verified']);
  if(!['email','phone'].includes(p.contact.kind)||!trimmedText(p.contact.value,300)||typeof p.contact.verified!=='boolean')fail();
 }
}
function proofIssue(c,p){
 if(c.approval!=='approved')return 'setup_not_approved';
 if(!c.issuerEligible)return 'issuer_ineligible';
 if(!p.verified||!p.current)return 'provider_proof_unverified';
 if(!same(c.organizationId,p.organizationId)||!same(c.intentId,p.intentId)||
 !same(c.personId,p.personId)||p.intentRevision!==c.revision||
 c.audience!==p.audience||!same(c.challengeId,p.challengeId))return 'proof_context_changed';
 if(!namespaceMatches(c.providerNamespace,p.identity)||c.binding&&!identityMatches(c.binding,p.identity))return 'provider_identity_conflict';
 return null;
}
export function rehearseOnboardingProofBinding(c,p){
 context(c);proof(p);const issue=proofIssue(c,p);
 if(issue)return result(false,issue);
 // An actual first binding requires a coordinated write/revision check, absent from this model.
 return result(true,c.binding?'provider_binding_matches':'provider_binding_required');
}
function contact(v){
 shape(v,['id','personId','revision','kind','value','recordedByPersonId','recordedAt','authorized']);
 if(!ids([v.id,v.personId,v.recordedByPersonId])||!revision(v.revision)||!counter(v.recordedAt)||
 !['email','phone'].includes(v.kind)||!trimmedText(v.value,300)||typeof v.authorized!=='boolean')fail();
}
const contactMatches=(a,b)=>['id','personId','recordedByPersonId'].every(k=>same(a[k],b[k]))&&
 ['revision','kind','value','recordedAt','authorized'].every(k=>a[k]===b[k]);
function review(r){
 shape(r,['expectedIntentRevision','expectedBindingRevision','reviewer','contactAtIssuance','currentContact','contactConfirmation','attestation']);
 if(![r.expectedIntentRevision,r.expectedBindingRevision].every(revision))fail();
 const a=r.reviewer;shape(a,['personId','organizationId','verified','eligible','owner','enabledAdmin']);
 if(!ids([a.personId,a.organizationId])||!bools([a.verified,a.eligible,a.owner,a.enabledAdmin]))fail();
 for(const v of [r.contactAtIssuance,r.currentContact])if(v!==null)contact(v);
 const f=r.contactConfirmation;
 if(f!==null){shape(f,['personId','contactId','contactRevision','verified','at']);
  if(!ids([f.personId,f.contactId])||!revision(f.contactRevision)||!counter(f.at)||typeof f.verified!=='boolean')fail();
 }
 const t=r.attestation;
 if(t!==null){shape(t,['intentId','intentRevision','personId','bindingRevision','identity','attesterPersonId','verified','controlsAccount','at']);
  if(!ids([t.intentId,t.personId,t.attesterPersonId])||![t.intentRevision,t.bindingRevision].every(revision)||
  !bools([t.verified,t.controlsAccount])||!counter(t.at))fail();
  identity(t.identity);
 }
}
export function rehearseOnboardingLinkEvidence(c,p,r){
 context(c);proof(p);review(r);
 const issue=proofIssue(c,p);if(issue)return result(false,issue);
 if(!c.binding)return result(false,'provider_binding_required');
 if(r.expectedIntentRevision!==c.revision||r.expectedBindingRevision!==c.bindingRevision)return result(false,'review_context_changed');
 const a=r.reviewer;
 if(!a.verified||!a.eligible||!same(a.organizationId,c.organizationId))return result(false,'reviewer_ineligible');
 if(!a.owner&&!a.enabledAdmin)return result(false,'link_owner_admin_required');
 if(same(a.personId,c.issuerPersonId))return result(false,'distinct_link_reviewer_required');
 if(!p.usablePersonalContact)return result(false,'personal_signin_pending');
 const old=r.contactAtIssuance,current=r.currentContact,t=r.attestation,f=r.contactConfirmation;
 // Supplied evidence is bound explicitly; a stale optional evidence item is never silently ignored.
 if(old!==null||current!==null){
  if(!old||!current||!contactMatches(old,current)||!same(old.personId,c.personId)||
  !old.authorized||old.recordedAt>=c.issuedAt)return result(false,'contact_context_changed');
 }
 if(f&&(!old||!f.verified||!same(f.personId,a.personId)||!same(f.contactId,old.id)||
 f.contactRevision!==old.revision||f.at<c.issuedAt||f.at>c.now))return result(false,'contact_confirmation_invalid');
 if(t&&(!t.verified||!t.controlsAccount||!same(t.intentId,c.intentId)||t.intentRevision!==c.revision||
 !same(t.personId,c.personId)||t.bindingRevision!==c.bindingRevision||
 !identityMatches(t.identity,c.binding)||!same(t.attesterPersonId,a.personId)||
 t.at<c.issuedAt||t.at>c.now))return result(false,'attestation_context_changed');
 const matched=!!(old&&p.contact?.verified&&p.contact.kind===old.kind&&p.contact.value===old.value);
 if(matched&&same(old.recordedByPersonId,c.issuerPersonId)&&!f&&!t)return result(false,'independent_contact_confirmation_required');
 if(!matched&&!t)return result(false,'link_evidence_required');
 return result(true,matched?(t?'link_evidence_both':'link_evidence_contact'):'link_evidence_in_person');
}
export function rehearseOnboardingTransition(c,e){
 context(c);
 shape(e,['kind','intentId','intentRevision','operationId','verifiedOriginalOperation']);
 if(!['provider_started','provider_unknown','provider_confirmed','approval_expired','approval_revoked'].includes(e.kind)||
 !sourceUuid(e.intentId)||!revision(e.intentRevision)||(e.operationId!==null&&!sourceUuid(e.operationId))||
 typeof e.verifiedOriginalOperation!=='boolean')fail();
 if(!same(e.intentId,c.intentId)||e.intentRevision!==c.revision)return result(false,'transition_context_changed');
 let approval=c.approval,providerState=c.providerState,reconciliation=c.reconciliation;
 if(e.kind.startsWith('approval_')){
  if(e.operationId!==null||e.verifiedOriginalOperation)fail();
  if(approval==='consumed')return result(false,'setup_already_consumed');
  if(e.kind==='approval_expired'&&approval==='revoked')return result(false,'setup_already_revoked');
  approval=e.kind==='approval_expired'?'expired':'revoked';
  if(['pending','unknown'].includes(providerState))reconciliation='required';
 }else{
  if(!e.operationId||!e.verifiedOriginalOperation)return result(false,'original_operation_evidence_required');
  if(e.kind==='provider_started'){
   if(approval!=='approved'||!c.issuerEligible)return result(false,'setup_not_eligible');
   if(providerState!=='not_started')return result(false,'provider_operation_already_started');
   providerState='pending';
  }else{
   if(!c.operationId||!same(e.operationId,c.operationId))return result(false,'provider_operation_mismatch');
   if(!['pending','unknown'].includes(providerState))return result(false,'provider_state_not_pending');
   if(e.kind==='provider_unknown'){providerState='unknown';reconciliation='required';}
   else providerState='confirmed';
  }
 }
 // Only a proposed axis result: no approval/link/grant write or reconciliation resolution.
 return result(true,'onboarding_axes_rehearsed',{next:Object.freeze({approval,providerState,reconciliation})});
}
