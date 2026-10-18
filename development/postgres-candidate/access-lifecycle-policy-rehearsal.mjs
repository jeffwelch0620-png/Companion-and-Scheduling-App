// FICTIONAL POLICY REHEARSAL ONLY. Never an authorization service or a database command.
// Supplied people, sessions, responses, clocks and policy selections are fictional evidence.
import {exactShape,sourceUuid} from './source-fingerprint.mjs';
const error='invalid_access_lifecycle_rehearsal';
const fail=()=>{throw new TypeError(error);};
const shape=(value,keys)=>exactShape(value,keys,error);
const same=(a,b)=>a.toLowerCase()===b.toLowerCase();
const counter=n=>Number.isSafeInteger(n)&&n>=0;
const revision=n=>Number.isSafeInteger(n)&&n>0;
const ids=values=>values.every(sourceUuid);
const bools=values=>values.every(v=>typeof v==='boolean');
const result=(eligible,code)=>Object.freeze({purpose:'fictional_access_lifecycle_rehearsal',eligible,code,authoritative:false,canApply:false,accessProvisioned:false,completenessCertified:false});
function actor(a){shape(a,['personId','verified','active','lifecycleVerified']);if(!sourceUuid(a.personId)||!bools([a.verified,a.active,a.lifecycleVerified]))fail();}
function ownerContext(c){
 shape(c,['version','organizationId','organizationActive','lifecycleVerified','ownerSetRevision','owners','proposer','approver','targetEligible','proposal','expectedProposalRevision','targetResponse','policy','now']);
 if(c.version!==1||!sourceUuid(c.organizationId)||!bools([c.organizationActive,c.lifecycleVerified,c.targetEligible])||!revision(c.ownerSetRevision)||!revision(c.expectedProposalRevision)||!counter(c.now))fail();
 if(!Array.isArray(c.owners)||c.owners.length>100||Object.getOwnPropertySymbols(c.owners).length||Object.keys(c.owners).length!==c.owners.length||Array.from({length:c.owners.length},(_,i)=>i).some(i=>!Object.hasOwn(c.owners,i)))fail();
 const seen=new Set();for(const o of c.owners){shape(o,['personId','eligible']);if(!sourceUuid(o.personId)||typeof o.eligible!=='boolean'||seen.has(o.personId.toLowerCase()))fail();seen.add(o.personId.toLowerCase());}
 actor(c.proposer);actor(c.approver);
 const p=c.proposal;shape(p,['id','organizationId','revision','ownerSetRevision','proposerPersonId','action','targetPersonId','createdAt','expiresAt','reasonRecorded']);
 if(!ids([p.id,p.organizationId,p.proposerPersonId,p.targetPersonId])||![p.revision,p.ownerSetRevision].every(revision)||!['add','remove'].includes(p.action)||![p.createdAt,p.expiresAt].every(counter)||p.expiresAt<=p.createdAt||typeof p.reasonRecorded!=='boolean')fail();
 shape(c.policy,['proposalValidityMs','responsePolicySelected','responseRequirementsSatisfied']);
 if(c.policy.proposalValidityMs!==null&&!revision(c.policy.proposalValidityMs)||!bools([c.policy.responsePolicySelected,c.policy.responseRequirementsSatisfied]))fail();
 if(c.targetResponse!==null){const r=c.targetResponse;shape(r,['proposalId','proposalRevision','personId','kind','verified']);if(!ids([r.proposalId,r.personId])||!revision(r.proposalRevision)||!['consent','objection'].includes(r.kind)||typeof r.verified!=='boolean')fail();}
}
export function rehearseOwnerChange(c){
 ownerContext(c);const p=c.proposal;
 if(!c.organizationActive)return result(false,'organization_ineligible');
 if(!c.lifecycleVerified||!c.proposer.lifecycleVerified||!c.approver.lifecycleVerified)return result(false,'lifecycle_unverified');
 if(!c.proposer.verified||!c.proposer.active||!c.approver.verified||!c.approver.active)return result(false,'identity_ineligible');
 if(!same(c.organizationId,p.organizationId)||!same(c.proposer.personId,p.proposerPersonId))return result(false,'proposal_scope_mismatch');
 const current=c.owners.filter(o=>o.eligible);
 if(!current.some(o=>same(o.personId,c.proposer.personId)))return result(false,'existing_owner_required');
 if(current.length<2)return result(false,'single_owner_a05_required');
 if(same(c.proposer.personId,c.approver.personId))return result(false,'distinct_owner_required');
 if(!current.some(o=>same(o.personId,c.approver.personId)))return result(false,'existing_owner_required');
 if(p.ownerSetRevision!==c.ownerSetRevision||p.revision!==c.expectedProposalRevision)return result(false,'proposal_changed');
 const response=c.targetResponse;
 if(response&&(!same(response.proposalId,p.id)||response.proposalRevision!==p.revision||!same(response.personId,p.targetPersonId)))return result(false,'response_context_changed');
 if(response&&!response.verified)return result(false,'response_unverified');
 if(response&&p.action!=='remove')return result(false,'response_not_applicable');
 if(response?.kind==='objection')return result(false,'contested_removal_a05_required');
 const target=c.owners.find(o=>same(o.personId,p.targetPersonId));
 if(p.action==='remove'){
  if(!target)return result(false,'target_not_owner');
  if(current.filter(o=>!same(o.personId,p.targetPersonId)).length<1)return result(false,'last_owner_removal_denied');
  if(same(c.approver.personId,p.targetPersonId)&&response?.kind!=='consent')return result(false,'removal_consent_required');
 }else{
  if(target)return result(false,'target_already_owner');
  if(!c.targetEligible)return result(false,'target_ineligible');
 }
 if(!p.reasonRecorded)return result(false,'reason_required');
 if(c.policy.proposalValidityMs===null||p.action==='remove'&&!c.policy.responsePolicySelected)return result(false,'owner_policy_pending');
 if(c.now<p.createdAt||p.expiresAt-p.createdAt>c.policy.proposalValidityMs)return result(false,'proposal_time_invalid');
 if(c.now>=p.expiresAt)return result(false,'proposal_expired');
 if(p.action==='remove'&&!c.policy.responseRequirementsSatisfied)return result(false,'target_response_pending');
 // True means this fictional final-check predicate passed, not that anything was approved/applied.
 return result(true,'owner_change_predicate_satisfied');
}
const memberKeys=['organizationId','storeId','personId','membershipId','approved','scheduleOnly','epoch'];
const employmentEligible=m=>m.approved&&!m.scheduleOnly;
function membership(m){shape(m,memberKeys);if(!ids([m.organizationId,m.storeId,m.personId,m.membershipId])||!bools([m.approved,m.scheduleOnly])||!counter(m.epoch))fail();}
function sameMembership(a,b){return memberKeys.slice(0,4).every(k=>same(a[k],b[k]));}
export function rehearseMembershipEpochTransition(before,after){
 membership(before);membership(after);
 if(!sameMembership(before,after))return result(false,'membership_scope_changed');
 // Consecutive single-event fixtures only; this does not prove lifecycle continuity from two reads.
 const required=before.epoch+(employmentEligible(before)&&!employmentEligible(after)?1:0);
 if(!Number.isSafeInteger(required))return result(false,'membership_epoch_exhausted');
 if(after.epoch!==required)return result(false,'membership_epoch_transition_invalid');
 return result(true,'membership_epoch_transition_satisfied');
}
export function rehearseMembershipGrantEpoch(m,g){
 membership(m);shape(g,['organizationId','storeId','personId','membershipId','active','capturedEpoch']);
 if(!ids([g.organizationId,g.storeId,g.personId,g.membershipId])||typeof g.active!=='boolean'||!counter(g.capturedEpoch))fail();
 if(!sameMembership(m,g))return result(false,'grant_scope_mismatch');
 if(!employmentEligible(m))return result(false,'employment_ineligible');
 if(!g.active)return result(false,'grant_inactive');
 if(g.capturedEpoch!==m.epoch)return result(false,'grant_review_required');
 // Epoch eligibility alone is never capability/session/person/department authorization.
 return result(true,'membership_grant_epoch_satisfied');
}
// Evaluate at the creation/commit snapshot; no grant can be pre-staged while ineligible.
// This models the membership prerequisite only, not A01 authority, audit or a grant write.
export function rehearseMembershipGrantCreation(m,g){
 const eligibility=rehearseMembershipGrantEpoch(m,g);
 return eligibility.eligible?result(true,'membership_grant_creation_satisfied'):eligibility;
}
