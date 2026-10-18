import test from 'node:test';
import assert from 'node:assert/strict';
import {rehearseSourceReviewer,rehearseSourceReviewerFinalAccess,rehearseSourceReviewerAdvisories} from './source-reviewer-policy-rehearsal.mjs';
const id=n=>'4abcde00-0000-0000-0000-'+String(n).padStart(12,'0');
const clone=x=>structuredClone(x);
function fixture(){
 return {version:1,organization:{id:id(1),active:true,eligibilityRevision:1,policyRevision:1,lifecycleVerified:true},store:{id:id(2),organizationId:id(1),active:true,eligibilityRevision:1,lifecycleVerified:true},person:{id:id(3),active:true,eligibilityRevision:1,lifecycleVerified:true},accountLink:{id:id(4),personId:id(3),active:true,revision:1,eligibilityRevision:1,lifecycleVerified:true},session:{id:id(5),personId:id(3),verified:true,active:true,revision:1},authority:{personId:id(3),organizationId:id(1),owner:false,enabledAdmin:false,revision:1},designations:[{id:id(6),organizationId:id(1),storeId:id(2),personId:id(3),family:'roster',level:'review',active:true,revision:1,eligibilityRevision:{person:1,accountLink:1,organization:1,store:1}}],activeMembershipCount:0,workspaceRevision:10};
}
const request=(overrides={})=>({action:'read',organizationId:id(1),storeId:id(2),family:'roster',designationId:null,authorPersonIds:[],...overrides});
const decide=(s,r=request())=>rehearseSourceReviewer(s,r);
function flags(out){assert.equal(out.authoritative,false);assert.equal(out.canApply,false);assert.equal(out.completenessCertified,false);assert.equal(out.accessProvisioned,false);assert.equal(out.purpose,'fictional_source_reviewer_policy_rehearsal');}
function invalid(s,r=request()){assert.throws(()=>decide(s,r),e=>e instanceof TypeError&&e.message==='invalid_source_reviewer_rehearsal');}
function deepFreeze(x){if(x&&typeof x==='object'){for(const v of Object.values(x))deepFreeze(v);Object.freeze(x);}return x;}

test('an ordinary manager without a designation has no source-review eligibility',()=>{
 const s=fixture();s.designations=[];const out=decide(s);assert.equal(out.eligible,false);assert.equal(out.code,'designation_required');flags(out);
});
test('an owner without employment or designation has organization-policy read and certification eligibility',()=>{
 const s=fixture();s.designations=[];s.authority.owner=true;
 for(const action of ['read','certify']){const out=decide(s,request({action}));assert.equal(out.eligible,true);assert.equal(out.via,'organization_owner');flags(out);}
});
test('only the currently enabled admin has the organization-policy path',()=>{
 const s=fixture();s.designations=[];s.authority.enabledAdmin=true;assert.equal(decide(s).via,'enabled_admin');
 s.authority.enabledAdmin=false;assert.equal(decide(s).eligible,false);
});
test('review-only designation never implies certification',()=>{
 const s=fixture();assert.equal(decide(s).eligible,true);const out=decide(s,request({action:'certify'}));assert.equal(out.eligible,false);assert.equal(out.code,'certification_level_required');
});
test('explicit certification level permits author self-certification eligibility',()=>{
 const s=fixture();s.designations[0].level='review_and_certify';
 const out=decide(s,request({action:'certify',authorPersonIds:[s.person.id]}));assert.equal(out.eligible,true);assert.equal(out.via,'designation');flags(out);
});
test('authorship alone creates no review or certification authority',()=>{
 const s=fixture();s.designations=[];
 for(const action of ['read','certify'])assert.equal(decide(s,request({action,authorPersonIds:[s.person.id]})).eligible,false);
});
test('non-employed explicit reviewers remain eligible without a membership',()=>{
 const s=fixture();assert.equal(s.activeMembershipCount,0);assert.equal(decide(s).eligible,true);assert.equal(decide(s).via,'designation');
});
test('organization store and family scope cannot be widened by the requested resource',()=>{
 for(const change of [r=>r.organizationId=id(10),r=>r.storeId=id(10),r=>r.family='timeOff']){const r=request();change(r);assert.equal(decide(fixture(),r).eligible,false);}
});
test('a designation for another person or scope cannot authorize the viewer',()=>{
 for(const change of [d=>d.personId=id(10),d=>d.storeId=id(10),d=>d.organizationId=id(10),d=>d.family='timeOff']){const s=fixture();change(s.designations[0]);assert.equal(decide(s).eligible,false);}
});
test('person account session and authority bindings must identify the same actor and organization',()=>{
 for(const change of [s=>s.accountLink.personId=id(10),s=>s.session.personId=id(10),s=>s.authority.personId=id(10),s=>s.authority.organizationId=id(10)]){const s=fixture();change(s);assert.equal(decide(s).code,'identity_mismatch');}
});
test('inactive people accounts sessions and unverified sessions deny even an owner',()=>{
 for(const change of [s=>s.person.active=false,s=>s.accountLink.active=false,s=>s.session.active=false,s=>s.session.verified=false]){const s=fixture();s.authority.owner=true;change(s);assert.equal(decide(s).code,'identity_ineligible');}
});
test('unverified provider lifecycle continuity refuses all source reads with no private output',()=>{
 const s=fixture();s.accountLink.lifecycleVerified=false;const out=decide(s);assert.equal(out.code,'lifecycle_unverified');assert.equal(out.eligible,false);assert.ok(!JSON.stringify(out).includes(s.person.id));flags(out);
});
test('inactive organization or store denies review and certification regardless of role',()=>{
 for(const key of ['organization','store'])for(const action of ['read','certify']){const s=fixture();s.authority.owner=true;s[key].active=false;assert.equal(decide(s,request({action})).code,'scope_ineligible');}
});
test('each durable eligibility counter prevents lapse then re-enable on a fresh request',()=>{
 for(const key of ['person','accountLink','organization','store']){const s=fixture();s[key].eligibilityRevision++;assert.equal(decide(s).code,'eligibility_review_required');assert.equal(s[key].active,true);}
});
test('an explicitly reviewed restore can capture current counters for the designee',()=>{
 const s=fixture();s.accountLink.eligibilityRevision++;s.designations[0].eligibilityRevision.accountLink++;s.designations[0].revision++;assert.equal(decide(s).eligible,true);
});
test('organization-policy authority does not require a fabricated designation vector',()=>{
 const s=fixture();s.authority.owner=true;s.designations[0].eligibilityRevision.person=0;assert.equal(decide(s).via,'organization_owner');
});
test('last active membership ending proposes an advisory only and preserves read eligibility',()=>{
 const before=fixture();before.activeMembershipCount=1;const after=clone(before);after.activeMembershipCount=0;
 assert.deepEqual(rehearseSourceReviewerAdvisories(before,after).advisoryKinds,['last_active_membership_ended']);assert.equal(rehearseSourceReviewerFinalAccess(before,after,request()).eligible,true);assert.deepEqual(before.designations,after.designations);
});
test('person inactivity proposes an advisory while current identity denies access',()=>{
 const before=fixture(),after=clone(before);after.person.active=false;after.person.eligibilityRevision++;
 const out=rehearseSourceReviewerAdvisories(before,after);assert.deepEqual(out.advisoryKinds,['reviewer_person_inactive']);assert.equal(decide(after).eligible,false);flags(out);
});
test('unchanged lifecycle and a person without a current designation produce no advisory proposal',()=>{
 const s=fixture();assert.deepEqual(rehearseSourceReviewerAdvisories(s,clone(s)).advisoryKinds,[]);
 const after=clone(s);s.designations=[];after.designations=[];s.activeMembershipCount=1;assert.deepEqual(rehearseSourceReviewerAdvisories(s,after).advisoryKinds,[]);
});
test('final access refuses a designation revoked after the initial authorized read',()=>{
 const before=fixture(),after=clone(before);after.designations[0].active=false;after.designations[0].revision++;assert.equal(rehearseSourceReviewerFinalAccess(before,after,request()).eligible,false);
});
test('final access detects revoke and reviewed restore even if both snapshots are eligible',()=>{
 const before=fixture(),after=clone(before);after.designations[0].revision+=2;assert.equal(decide(after).eligible,true);assert.equal(rehearseSourceReviewerFinalAccess(before,after,request()).code,'access_fence_changed');
});
test('final access catches person session link and organization-policy revision changes',()=>{
 for(const change of [s=>s.session.id=id(20),s=>s.session.revision++,s=>s.accountLink.revision++,s=>s.organization.policyRevision++,s=>s.authority.revision++]){const before=fixture(),after=clone(before);change(after);assert.equal(rehearseSourceReviewerFinalAccess(before,after,request()).code,'access_fence_changed');}
});
test('routine global workspace writes do not invalidate the access fence',()=>{
 const before=fixture(),after=clone(before);after.workspaceRevision+=100;assert.equal(rehearseSourceReviewerFinalAccess(before,after,request()).eligible,true);
});
test('an unrelated family designation revision does not invalidate the selected family access fence',()=>{
 const before=fixture();before.designations.push({...clone(before.designations[0]),id:id(7),family:'timeOff'});const after=clone(before);after.designations[1].revision++;assert.equal(rehearseSourceReviewerFinalAccess(before,after,request()).eligible,true);
});
test('self-revocation eligibility requires personal identity but not source certification or current captured epochs',()=>{
 const s=fixture();s.designations[0].eligibilityRevision.person=0;s.store.active=false;const out=decide(s,request({action:'self_revoke',designationId:id(6)}));assert.equal(out.eligible,true);assert.equal(out.via,'self_revocation');assert.equal(out.noop,false);flags(out);
});
test('self-revocation cannot target another person even when the actor is an owner',()=>{
 const s=fixture();s.authority.owner=true;s.designations[0].personId=id(20);assert.equal(decide(s,request({action:'self_revoke',designationId:id(6)})).code,'self_revocation_denied');
});
test('already revoked designation is a relinquishment no-op proposal without restoring anything',()=>{
 const s=fixture();s.designations[0].active=false;const out=decide(s,request({action:'self_revoke',designationId:id(6)}));assert.equal(out.code,'already_revoked');assert.equal(out.noop,true);assert.equal(s.designations[0].active,false);
});
test('canonical UUID comparisons remain case-insensitive for scope and actor links',()=>{
 const s=fixture();s.session.personId=s.person.id.toUpperCase();s.designations[0].organizationId=s.organization.id.toUpperCase();assert.equal(decide(s,request({storeId:s.store.id.toUpperCase()})).eligible,true);
});
test('unknown shapes levels actions booleans and malformed counters refuse with a fixed error',()=>{
 for(const change of [s=>s.extra=true,s=>s.designations[0].level='owner',s=>s.person.active='true',s=>s.session.revision=0,s=>s.organization.eligibilityRevision=-1]){const s=fixture();change(s);invalid(s);}
 for(const change of [r=>r.action='grant',r=>r.authorPersonIds=['fictional-secret'],r=>r.designationId=id(6),r=>r.extra='fictional-secret']){const r=request();change(r);invalid(fixture(),r);}
});
test('duplicate designation identities and duplicate person-store-family records refuse',()=>{
 for(const changed of [{id:id(6).toUpperCase(),family:'timeOff'},{id:id(7)}]){const s=fixture();s.designations.push({...clone(s.designations[0]),...changed});invalid(s);}
});
test('technical row bounds refuse rather than truncating or evaluating partial snapshots',()=>{
 const s=fixture();s.designations=Array.from({length:101},()=>clone(s.designations[0]));invalid(s);
 invalid(fixture(),request({authorPersonIds:Array.from({length:101},(_,i)=>id(i+100))}));
});
test('advisories cannot mix people or organizations from unrelated snapshots',()=>{
 for(const key of ['person','organization']){const before=fixture(),after=clone(before);after[key].id=id(20);assert.throws(()=>rehearseSourceReviewerAdvisories(before,after),/invalid_source_reviewer_rehearsal/);}
});
test('frozen input snapshots stay unchanged and every decision keeps all authority flags false',()=>{
 const before=deepFreeze(fixture()),after=deepFreeze(clone(before)),r=deepFreeze(request()),original=JSON.stringify(before);
 for(const out of [decide(before,r),rehearseSourceReviewerFinalAccess(before,after,r),rehearseSourceReviewerAdvisories(before,after)]){flags(out);assert.equal(Object.isFrozen(out),true);}
 assert.equal(JSON.stringify(before),original);assert.equal(JSON.stringify(after),original);
});

test('sparse arrays and extra array properties cannot bypass strict snapshot validation',()=>{
 const sparse=fixture();sparse.designations=Array(1);invalid(sparse);
 invalid(fixture(),request({authorPersonIds:Array(1)}));
 const extra=fixture();extra.designations.note='fictional-secret';invalid(extra);
 const authors=[id(3)];authors.note='fictional-secret';invalid(fixture(),request({authorPersonIds:authors}));
});

test('a revoked designation and membership ending in the same transition creates no advisory',()=>{
 const before=fixture();before.activeMembershipCount=1;const after=clone(before);after.activeMembershipCount=0;after.designations[0].active=false;after.designations[0].revision++;
 assert.deepEqual(rehearseSourceReviewerAdvisories(before,after).advisoryKinds,[]);
});
test('person inactivation after the final active designation is revoked creates no advisory',()=>{
 const before=fixture(),after=clone(before);after.person.active=false;after.person.eligibilityRevision++;after.designations[0].active=false;after.designations[0].revision++;
 assert.deepEqual(rehearseSourceReviewerAdvisories(before,after).advisoryKinds,[]);
});
for(const component of ['person','accountLink','organization','store'])test('unverified '+component+' lifecycle refuses reads and certification, including organization-policy viewers',()=>{
 for(const role of ['designee','owner','admin'])for(const action of ['read','certify']){
  const s=fixture();s.designations[0].level='review_and_certify';s.authority.owner=role==='owner';s.authority.enabledAdmin=role==='admin';s[component].lifecycleVerified=false;
  const out=decide(s,request({action}));assert.equal(out.eligible,false);assert.equal(out.code,'lifecycle_unverified');assert.equal(out.noop,false);flags(out);
 }
});
test('self-revocation remains eligible in an inactive organization with verified personal identity',()=>{
 const s=fixture();s.organization.active=false;const r=request({action:'self_revoke',designationId:id(6)});assert.equal(decide(s,r).eligible,true);assert.equal(decide(s).code,'scope_ineligible');
 s.accountLink.active=false;assert.equal(decide(s,r).code,'identity_ineligible');
});
test('self-revocation ignores organization and store lifecycle evidence but requires personal lifecycle evidence',()=>{
 const s=fixture();s.organization.active=false;s.store.active=false;s.organization.lifecycleVerified=false;s.store.lifecycleVerified=false;const r=request({action:'self_revoke',designationId:id(6)});
 assert.equal(decide(s,r).eligible,true);
 for(const key of ['person','accountLink']){const bad=clone(s);bad[key].lifecycleVerified=false;assert.equal(decide(bad,r).code,'lifecycle_unverified');}
});
test('self-revocation final fence tolerates organization/store eligibility lapses while retaining scope checks',()=>{
 const before=fixture(),after=clone(before),r=request({action:'self_revoke',designationId:id(6)});
 after.organization.active=false;after.organization.eligibilityRevision++;after.organization.lifecycleVerified=false;after.store.active=false;after.store.eligibilityRevision++;after.store.lifecycleVerified=false;
 assert.equal(rehearseSourceReviewerFinalAccess(before,after,r).eligible,true);
 after.store.organizationId=id(30);assert.equal(rehearseSourceReviewerFinalAccess(before,after,r).code,'scope_denied');
});
test('inactive organization does not allow self-revoking another person or mismatched scope',()=>{
 const s=fixture();s.organization.active=false;s.designations[0].personId=id(30);const r=request({action:'self_revoke',designationId:id(6)});assert.equal(decide(s,r).code,'self_revocation_denied');
 s.designations[0].personId=s.person.id;r.organizationId=id(30);assert.equal(decide(s,r).code,'scope_denied');
});
test('missing or non-boolean lifecycle evidence is refused rather than assumed verified',()=>{
 for(const key of ['person','accountLink','organization','store']){const missing=fixture();delete missing[key].lifecycleVerified;invalid(missing);const malformed=fixture();malformed[key].lifecycleVerified='true';invalid(malformed);}
});
test('newly unverified lifecycle evidence between snapshots refuses the final read',()=>{
 for(const key of ['person','accountLink','organization','store']){const before=fixture(),after=clone(before);after[key].lifecycleVerified=false;assert.equal(rehearseSourceReviewerFinalAccess(before,after,request()).code,'lifecycle_unverified');}
});
test('self-revocation final fence still detects personal session and owned record changes',()=>{
 const r=request({action:'self_revoke',designationId:id(6)});
 for(const change of [s=>s.session.revision++,s=>s.accountLink.revision++,s=>s.designations[0].revision++]){const before=fixture(),after=clone(before);change(after);assert.equal(rehearseSourceReviewerFinalAccess(before,after,r).code,'access_fence_changed');}
});
