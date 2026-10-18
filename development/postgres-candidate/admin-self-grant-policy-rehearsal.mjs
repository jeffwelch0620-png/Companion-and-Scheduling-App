// FICTIONAL POLICY REHEARSAL ONLY. Supplied flags/scopes/history are trusted fixtures,
// not authentication, a complete permission engine, a migration or a grant writer.
import {exactShape,sourceUuid,trimmedText} from './source-fingerprint.mjs';
import {rehearseMembershipGrantEpoch} from './access-lifecycle-policy-rehearsal.mjs';
const error='invalid_admin_self_grant_rehearsal';
const fail=()=>{throw new TypeError(error);};
const shape=(v,keys)=>exactShape(v,keys,error);
const same=(a,b)=>a.toLowerCase()===b.toLowerCase();
const counter=n=>Number.isSafeInteger(n)&&n>=0;
const revision=n=>Number.isSafeInteger(n)&&n>0;
const ids=values=>values.every(sourceUuid);
const bools=values=>values.every(v=>typeof v==='boolean');
const result=(eligible,code)=>Object.freeze({purpose:'fictional_admin_self_grant_rehearsal',
 eligible,code,authoritative:false,canApply:false,accessProvisioned:false,completenessCertified:false});
function list(v){
 if(!Array.isArray(v)||v.length>200||Object.getOwnPropertySymbols(v).length||
 Object.keys(v).length!==v.length||Array.from({length:v.length},(_,i)=>i).some(i=>!Object.hasOwn(v,i)))fail();
}
function actor(a){
 shape(a,['organizationId','personId','verified','eligible','owner']);
 if(!ids([a.organizationId,a.personId])||!bools([a.verified,a.eligible,a.owner]))fail();
}
function policy(p){
 shape(p,['organizationId','adminPersonId','enabled','epoch','revision']);
 if(!ids([p.organizationId,p.adminPersonId])||typeof p.enabled!=='boolean'||!counter(p.epoch)||!revision(p.revision))fail();
}
function scope(s){
 shape(s,['capability','storeId','department']);
 if(!trimmedText(s.capability,120)||!sourceUuid(s.storeId)||!trimmedText(s.department,80)||
 s.capability.includes('*')||s.department.includes('*'))fail();
}
const scopeKey=s=>JSON.stringify([s.capability,s.storeId.toLowerCase(),s.department]);
const componentScope=g=>({capability:g.capability,storeId:g.storeId,department:g.department});
function scopes(v){list(v);const seen=new Set();for(const s of v){scope(s);const key=scopeKey(s);if(seen.has(key))fail();seen.add(key);}}
function registry(v){
 list(v);const seen=new Set();
 for(const r of v){shape(r,['name','ordinary']);
  if(!trimmedText(r.name,120)||r.name.includes('*')||typeof r.ordinary!=='boolean'||seen.has(r.name))fail();seen.add(r.name);
 }
}
const scopeIssue=(s,r)=>!r.some(x=>x.name===s.capability&&x.ordinary)?'registered_ordinary_capability_required':null;
const grantKeys=['id','organizationId','actorPersonId','targetPersonId','capability','storeId','department',
 'active','revision','basis','basisVerified','adminEpoch','membershipId','capturedMembershipEpoch'];
function grant(g){
 shape(g,grantKeys);scope(componentScope(g));
 if(!ids([g.id,g.organizationId,g.actorPersonId,g.targetPersonId,g.membershipId])||
 !bools([g.active,g.basisVerified])||!revision(g.revision)||!counter(g.capturedMembershipEpoch)||
 !['owner','enabled_admin'].includes(g.basis))fail();
 if(g.basis==='owner'?g.adminEpoch!==null:!counter(g.adminEpoch))fail();
}
function membership(m){
 shape(m,['organizationId','storeId','personId','membershipId','approved','scheduleOnly','epoch']);
 if(!ids([m.organizationId,m.storeId,m.personId,m.membershipId])||
 !bools([m.approved,m.scheduleOnly])||!counter(m.epoch))fail();
}
function accessContext(c){
 shape(c,['version','policy','registeredCapabilities','outstandingScopes','membership','lifecycleVerified','scopeExpansionVerified']);
 if(c.version!==1||!bools([c.lifecycleVerified,c.scopeExpansionVerified]))fail();
 policy(c.policy);registry(c.registeredCapabilities);scopes(c.outstandingScopes);membership(c.membership);
}
function commonIssue(c){
 if(!c.lifecycleVerified)return 'lifecycle_unverified';
 if(!c.scopeExpansionVerified)return 'scope_expansion_unverified';
 if(!same(c.policy.organizationId,c.membership.organizationId))return 'organization_scope_changed';
 if(c.outstandingScopes.some(s=>scopeIssue(s,c.registeredCapabilities)))return 'registered_ordinary_capability_required';
 return null;
}
function ownerIssue(a,organizationId){
 if(!a.verified||!a.eligible||!same(a.organizationId,organizationId))return 'owner_identity_ineligible';
 return !a.owner?'current_owner_required':null;
}
const selfAdmin=(g,p)=>g.basis==='enabled_admin'&&same(g.actorPersonId,p.adminPersonId)&&same(g.targetPersonId,p.adminPersonId);
function membershipIssue(m,g){
 const r=rehearseMembershipGrantEpoch(m,{organizationId:g.organizationId,storeId:g.storeId,
 personId:g.targetPersonId,membershipId:g.membershipId,active:g.active,capturedEpoch:g.capturedMembershipEpoch});
 return r.eligible?null:r.code;
}
// One declared consecutive admin-switch event, with a supplied complete immutable history.
// Scopes are finite exact atoms already expanded by a trusted fictional scope normalizer.
export function rehearseAdminSuspensionTransition(c){
 shape(c,['version','before','after','owner','registeredCapabilities','components','beforeScopes','afterScopes',
 'lifecycleVerified','scopeExpansionVerified','componentsComplete','expectedPolicyRevision','auditRecorded']);
 if(c.version!==1||!bools([c.lifecycleVerified,c.scopeExpansionVerified,c.componentsComplete,c.auditRecorded])||
 !revision(c.expectedPolicyRevision))fail();
 policy(c.before);policy(c.after);actor(c.owner);registry(c.registeredCapabilities);
 scopes(c.beforeScopes);scopes(c.afterScopes);list(c.components);
 const seen=new Set();for(const g of c.components){grant(g);if(seen.has(g.id.toLowerCase()))fail();seen.add(g.id.toLowerCase());}
 const before=c.before,after=c.after;
 if(!same(before.organizationId,after.organizationId)||!same(before.adminPersonId,after.adminPersonId))return result(false,'admin_policy_scope_changed');
 if(!c.lifecycleVerified)return result(false,'lifecycle_unverified');
 if(!c.scopeExpansionVerified)return result(false,'scope_expansion_unverified');
 if(!c.componentsComplete)return result(false,'grant_history_unverified');
 const owner=ownerIssue(c.owner,before.organizationId);if(owner)return result(false,owner);
 if(c.expectedPolicyRevision!==before.revision)return result(false,'policy_changed');
 const changed=before.enabled!==after.enabled,disabled=before.enabled&&!after.enabled;
 const epoch=before.epoch+(disabled?1:0),nextRevision=before.revision+(changed?1:0);
 if(!Number.isSafeInteger(epoch)||!Number.isSafeInteger(nextRevision))return result(false,'admin_counter_exhausted');
 if(after.epoch!==epoch||after.revision!==nextRevision)return result(false,'admin_epoch_transition_invalid');
 if(changed&&!c.auditRecorded)return result(false,'audit_required');
 if([...c.beforeScopes,...c.afterScopes].some(s=>scopeIssue(s,c.registeredCapabilities)))return result(false,'registered_ordinary_capability_required');
 const required=new Set(c.beforeScopes.map(scopeKey));
 for(const g of c.components){
  if(!same(g.organizationId,before.organizationId))return result(false,'grant_scope_changed');
  if(!g.basisVerified)return result(false,'grant_basis_unverified');
  if(scopeIssue(componentScope(g),c.registeredCapabilities))return result(false,'registered_ordinary_capability_required');
  if(g.basis==='enabled_admin'&&same(g.actorPersonId,before.adminPersonId)&&g.adminEpoch>before.epoch)return result(false,'grant_basis_epoch_invalid');
  if(disabled&&g.active&&selfAdmin(g,before))required.add(scopeKey(g));
 }
 const actual=new Set(c.afterScopes.map(scopeKey));
 if(required.size!==actual.size||[...required].some(k=>!actual.has(k)))return result(false,'admin_suspension_extent_mismatch');
 return result(true,'admin_suspension_transition_satisfied');
}
// A lifetime/suspension predicate only, not a production capability/department/session check.
export function rehearseOperationalGrantUse(c,g){
 accessContext(c);grant(g);const issue=commonIssue(c);if(issue)return result(false,issue);
 if(!same(g.organizationId,c.policy.organizationId))return result(false,'grant_scope_changed');
 if(scopeIssue(componentScope(g),c.registeredCapabilities))return result(false,'registered_ordinary_capability_required');
 if(!g.basisVerified)return result(false,'grant_basis_unverified');
 const member=membershipIssue(c.membership,g);if(member)return result(false,member);
 if(g.basis==='enabled_admin'&&!same(g.actorPersonId,c.policy.adminPersonId))return result(false,'admin_policy_scope_changed');
 if(g.basis==='enabled_admin'&&g.adminEpoch>c.policy.epoch)return result(false,'grant_basis_epoch_invalid');
 if(selfAdmin(g,c.policy)){
  if(!c.policy.enabled)return result(false,'admin_self_grant_suspended');
  if(c.outstandingScopes.some(s=>scopeKey(s)===scopeKey(g)))return result(false,'owner_reconfirmation_required');
  if(g.adminEpoch!==c.policy.epoch)return result(false,'admin_epoch_stale');
 }
 return result(true,'operational_grant_lifetime_satisfied');
}
export function rehearseOwnerSelfGrantReconfirmation(c,r){
 accessContext(c);
 shape(r,['organizationId','personId','scope','membershipId','membershipEpoch','expectedPolicyRevision','owner','reasonRecorded','auditRecorded']);
 if(!ids([r.organizationId,r.personId,r.membershipId])||!counter(r.membershipEpoch)||
 !revision(r.expectedPolicyRevision)||!bools([r.reasonRecorded,r.auditRecorded]))fail();
 scope(r.scope);actor(r.owner);
 const issue=commonIssue(c);if(issue)return result(false,issue);
 if(!same(r.organizationId,c.policy.organizationId)||!same(r.personId,c.policy.adminPersonId))return result(false,'reconfirmation_scope_changed');
 const owner=ownerIssue(r.owner,c.policy.organizationId);if(owner)return result(false,owner);
 if(r.expectedPolicyRevision!==c.policy.revision)return result(false,'policy_changed');
 if(scopeIssue(r.scope,c.registeredCapabilities))return result(false,'registered_ordinary_capability_required');
 const member=membershipIssue(c.membership,{organizationId:r.organizationId,storeId:r.scope.storeId,
 targetPersonId:r.personId,membershipId:r.membershipId,active:true,capturedMembershipEpoch:r.membershipEpoch});
 if(member)return result(false,member);
 if(!c.outstandingScopes.some(s=>scopeKey(s)===scopeKey(r.scope)))return result(false,'suspension_scope_not_pending');
 if(!r.reasonRecorded)return result(false,'reason_required');
 if(!r.auditRecorded)return result(false,'audit_required');
 // Success neither clears a scope nor edits old provenance; the shared writer must commit
 // a new owner-based component, exact-scope obligation change, audit and receipt atomically.
 return result(true,'owner_reconfirmation_predicate_satisfied');
}
// Same-record immutable provenance: a new owner reconfirmation needs a new component,
// never relabeling an old admin component or refreshing its captured employment epoch.
export function rehearseGrantProvenanceStability(before,after){
 grant(before);grant(after);
 if(!same(before.id,after.id))return result(false,'grant_record_changed');
 const uuidKeys=['organizationId','actorPersonId','targetPersonId','storeId','membershipId'];
 const scalarKeys=['capability','department','basis','basisVerified','adminEpoch','capturedMembershipEpoch'];
 if(uuidKeys.some(k=>!same(before[k],after[k]))||scalarKeys.some(k=>before[k]!==after[k]))return result(false,'grant_provenance_changed');
 return result(true,'grant_provenance_stable');
}
