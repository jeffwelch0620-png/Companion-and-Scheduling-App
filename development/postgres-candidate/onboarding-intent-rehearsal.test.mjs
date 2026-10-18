import test from 'node:test';
import assert from 'node:assert/strict';
import {rehearseOnboardingProofBinding as bind,rehearseOnboardingLinkEvidence as evidence,rehearseOnboardingTransition as transition} from './onboarding-intent-rehearsal.mjs';
const id=n=>'abcdefab-cdef-4000-8000-'+String(n).padStart(12,'0');
const identity=()=>({provider:'fictional-provider',issuer:'https://identity.invalid',tenant:'fictional-tenant',subject:'Subject-A'});
function fixture(){
 const c={version:1,organizationId:id(1),intentId:id(2),personId:id(3),issuerPersonId:id(4),revision:2,
 issuedAt:100,now:300,audience:'fictional-onboarding',challengeId:id(5),approval:'approved',
 providerState:'not_started',reconciliation:'none',operationId:null,binding:null,bindingRevision:0,
 providerNamespace:{provider:'fictional-provider',issuer:'https://identity.invalid',tenant:'fictional-tenant'},issuerEligible:true};
 const p={organizationId:c.organizationId,intentId:c.intentId,intentRevision:2,personId:c.personId,audience:c.audience,
 challengeId:c.challengeId,identity:identity(),verified:true,current:true,usablePersonalContact:true,
 contact:{kind:'email',value:'person@example.invalid',verified:true}};
 const old={id:id(6),personId:c.personId,revision:7,kind:'email',value:'person@example.invalid',recordedByPersonId:id(7),recordedAt:80,authorized:true};
 const r={expectedIntentRevision:2,expectedBindingRevision:1,
 reviewer:{personId:id(8),organizationId:c.organizationId,verified:true,eligible:true,owner:true,enabledAdmin:false},
 contactAtIssuance:old,currentContact:structuredClone(old),contactConfirmation:null,attestation:null};
 return {c,p,r};
}
function locked(){
 const f=fixture();f.c.binding=identity();f.c.bindingRevision=1;return f;
}
function attest(f){
 f.r.attestation={intentId:f.c.intentId,intentRevision:f.c.revision,personId:f.c.personId,
 bindingRevision:f.c.bindingRevision,identity:identity(),attesterPersonId:f.r.reviewer.personId,
 verified:true,controlsAccount:true,at:250};
}
function confirm(f){
 f.r.contactConfirmation={personId:f.r.reviewer.personId,contactId:f.r.contactAtIssuance.id,
 contactRevision:f.r.contactAtIssuance.revision,verified:true,at:240};
}
function issuerContact(f){f.r.contactAtIssuance.recordedByPersonId=f.c.issuerPersonId;f.r.currentContact=structuredClone(f.r.contactAtIssuance);}
const expect=(out,code,eligible=false)=>{assert.equal(out.code,code);assert.equal(out.eligible,eligible);};
const frozen=v=>{if(v&&typeof v==='object'){for(const x of Object.values(v))frozen(x);Object.freeze(v);}return v;};
test('a first verified proof requires a binding write, never grants access',()=>{
 const {c,p}=fixture();expect(bind(c,p),'provider_binding_required',true);
});
test('same exact locked provider tuple accepts a fresh same-subject proof',()=>{
 const {c,p}=locked();expect(bind(c,p),'provider_binding_matches',true);
});
for(const key of ['provider','issuer','tenant','subject'])test('a later different '+key+' cannot replace the lock',()=>{
 const {c,p}=locked();p.identity[key]+='-different';expect(bind(c,p),'provider_identity_conflict');
});
test('subject is exact and case sensitive',()=>{
 const {c,p}=locked();p.identity.subject='subject-a';expect(bind(c,p),'provider_identity_conflict');
});
for(const key of ['verified','current'])test(key+' proof flag is required before initializing a lock',()=>{
 const {c,p}=fixture();p[key]=false;expect(bind(c,p),'provider_proof_unverified');
});
for(const key of ['organizationId','intentId','personId','challengeId'])test('proof binds '+key,()=>{
 const {c,p}=fixture();p[key]=id(99);expect(bind(c,p),'proof_context_changed');
});
test('proof binds intent revision and audience',()=>{
 const {c,p}=fixture();p.intentRevision++;expect(bind(c,p),'proof_context_changed');p.intentRevision--;p.audience='other';expect(bind(c,p),'proof_context_changed');
});
for(const state of ['expired','revoked','consumed'])test(state+' setup cannot bind a new account',()=>{
 const {c,p}=fixture();c.approval=state;expect(bind(c,p),'setup_not_approved');
});
test('issuer must remain eligible in the supplied final snapshot',()=>{
 const {c,p}=fixture();c.issuerEligible=false;expect(bind(c,p),'issuer_ineligible');
});
test('UUID case does not invent a new person or context',()=>{
 const {c,p}=locked();p.personId=p.personId.toUpperCase();p.intentId=p.intentId.toUpperCase();expect(bind(c,p),'provider_binding_matches',true);
});
test('independently recorded pre-issuance contact can satisfy the evidence predicate',()=>{
 const {c,p,r}=locked();expect(evidence(c,p,r),'link_evidence_contact',true);
});
test('enabled admin can independently review evidence',()=>{
 const {c,p,r}=locked();r.reviewer.owner=false;r.reviewer.enabledAdmin=true;expect(evidence(c,p,r),'link_evidence_contact',true);
});
test('setup issuer using the same canonical person remains refused, including case variants',()=>{
 const {c,p,r}=locked();r.reviewer.personId=c.issuerPersonId.toUpperCase();expect(evidence(c,p,r),'distinct_link_reviewer_required');
});
for(const key of ['verified','eligible'])test('reviewer '+key+' is required',()=>{
 const {c,p,r}=locked();r.reviewer[key]=false;expect(evidence(c,p,r),'reviewer_ineligible');
});
test('reviewer cannot use another organization authority',()=>{
 const {c,p,r}=locked();r.reviewer.organizationId=id(99);expect(evidence(c,p,r),'reviewer_ineligible');
});
test('a designated setup issuer or source reviewer alone is not a link approver',()=>{
 const {c,p,r}=locked();r.reviewer.owner=false;expect(evidence(c,p,r),'link_owner_admin_required');
});
test('no usable personal contact stays pending even with in-person evidence',()=>{
 const f=locked();attest(f);f.p.usablePersonalContact=false;expect(evidence(f.c,f.p,f.r),'personal_signin_pending');
});
for(const key of ['expectedIntentRevision','expectedBindingRevision'])test('stale '+key+' refuses evidence',()=>{
 const {c,p,r}=locked();r[key]++;expect(evidence(c,p,r),'review_context_changed');
});
test('a valid proof without a recorded binding cannot pass link evidence',()=>{
 const {c,p,r}=fixture();expect(evidence(c,p,r),'provider_binding_required');
});
test('issuer-created contact cannot validate the issuer second-account attack',()=>{
 const f=locked();issuerContact(f);
 f.r.contactAtIssuance.value='issuer-second@example.invalid';f.r.currentContact.value=f.r.contactAtIssuance.value;f.p.contact.value=f.r.contactAtIssuance.value;
 expect(evidence(f.c,f.p,f.r),'independent_contact_confirmation_required');
});
test('independent reviewer ownership confirmation permits the contact predicate',()=>{
 const f=locked();issuerContact(f);confirm(f);expect(evidence(f.c,f.p,f.r),'link_evidence_contact',true);
});
test('independent reviewer actual account-control attestation permits issuer contact',()=>{
 const f=locked();issuerContact(f);attest(f);expect(evidence(f.c,f.p,f.r),'link_evidence_both',true);
});
test('in-person route works without a stored contact comparison',()=>{
 const f=locked();attest(f);f.r.contactAtIssuance=null;f.r.currentContact=null;f.p.contact=null;
 expect(evidence(f.c,f.p,f.r),'link_evidence_in_person',true);
});
test('in-person route does not bypass verified provider authentication',()=>{
 const f=locked();attest(f);f.p.verified=false;expect(evidence(f.c,f.p,f.r),'provider_proof_unverified');
});
for(const key of ['value','revision','recordedByPersonId','authorized'])test('current contact '+key+' change stales captured context',()=>{
 const {c,p,r}=locked();r.currentContact[key]=key==='revision'?8:key==='authorized'?false:key==='recordedByPersonId'?id(99):'changed@example.invalid';
 expect(evidence(c,p,r),'contact_context_changed');
});
test('contact created at issuance or afterwards cannot be retroactively captured',()=>{
 const {c,p,r}=locked();for(const n of [100,101]){r.contactAtIssuance.recordedAt=n;r.currentContact.recordedAt=n;expect(evidence(c,p,r),'contact_context_changed');}
});
test('contact must belong to the exact reviewed person and an authorized record',()=>{
 const {c,p,r}=locked();r.contactAtIssuance.personId=id(99);r.currentContact.personId=id(99);expect(evidence(c,p,r),'contact_context_changed');
 r.contactAtIssuance.personId=c.personId;r.currentContact.personId=c.personId;r.contactAtIssuance.authorized=false;r.currentContact.authorized=false;expect(evidence(c,p,r),'contact_context_changed');
});
test('contact equality uses supplied canonical exact values, never fuzzy matching',()=>{
 const {c,p,r}=locked();p.contact.value='PERSON@example.invalid';expect(evidence(c,p,r),'link_evidence_required');
});
test('unverified provider contact cannot satisfy the contact route',()=>{
 const {c,p,r}=locked();p.contact.verified=false;expect(evidence(c,p,r),'link_evidence_required');
});
for(const key of ['personId','contactId','contactRevision','verified','at'])test('independent confirmation binds '+key,()=>{
 const f=locked();issuerContact(f);confirm(f);
 f.r.contactConfirmation[key]=key==='verified'?false:key==='at'?301:key==='contactRevision'?8:id(99);
 expect(evidence(f.c,f.p,f.r),'contact_confirmation_invalid');
});
for(const key of ['intentId','intentRevision','personId','bindingRevision','attesterPersonId','verified','controlsAccount','at'])test('attestation binds '+key,()=>{
 const f=locked();attest(f);
 f.r.attestation[key]=['verified','controlsAccount'].includes(key)?false:key==='at'?301:['intentRevision','bindingRevision'].includes(key)?99:id(99);
 expect(evidence(f.c,f.p,f.r),'attestation_context_changed');
});
test('attestation binds the exact provider account, not only the intended person',()=>{
 const f=locked();attest(f);f.r.attestation.identity.subject='Second-account';expect(evidence(f.c,f.p,f.r),'attestation_context_changed');
});
test('issuer cannot provide their own independent confirmation',()=>{
 const f=locked();issuerContact(f);confirm(f);f.r.contactConfirmation.personId=f.c.issuerPersonId;expect(evidence(f.c,f.p,f.r),'contact_confirmation_invalid');
});
function operating(state='pending'){
 const f=locked();f.c.providerState=state;f.c.operationId=id(10);if(state==='unknown')f.c.reconciliation='required';return f;
}
function event(c,kind){return {kind,intentId:c.intentId,intentRevision:c.revision,operationId:kind.startsWith('approval_')?null:c.operationId??id(10),verifiedOriginalOperation:!kind.startsWith('approval_')};}
test('operation start returns pending axes only after recorded original operation evidence',()=>{
 const {c}=fixture();const out=transition(c,event(c,'provider_started'));expect(out,'onboarding_axes_rehearsed',true);
 assert.deepEqual(out.next,{approval:'approved',providerState:'pending',reconciliation:'none'});
});
test('an unverified operation reference cannot start a provider operation',()=>{
 const {c}=fixture(),e=event(c,'provider_started');e.verifiedOriginalOperation=false;expect(transition(c,e),'original_operation_evidence_required');
});
for(const approval of ['expired','revoked','consumed'])test('provider start cannot use '+approval+' setup',()=>{
 const {c}=fixture();c.approval=approval;expect(transition(c,event(c,'provider_started')),'setup_not_eligible');
});
test('timeout requires reconciliation, never proof that no account exists',()=>{
 const {c}=operating();const out=transition(c,event(c,'provider_unknown'));assert.deepEqual(out.next,{approval:'approved',providerState:'unknown',reconciliation:'required'});
});
for(const state of ['pending','unknown'])for(const kind of ['approval_expired','approval_revoked'])test(state+' survives '+kind,()=>{
 const {c}=operating(state);const out=transition(c,event(c,kind));expect(out,'onboarding_axes_rehearsed',true);
 assert.equal(out.next.providerState,state);assert.equal(out.next.reconciliation,'required');
});
test('confirmation of an unknown original operation does not automatically resolve or link',()=>{
 const {c}=operating('unknown');c.approval='revoked';const out=transition(c,event(c,'provider_confirmed'));
 assert.deepEqual(out.next,{approval:'revoked',providerState:'confirmed',reconciliation:'required'});assert.equal(out.accessProvisioned,false);
});
test('wrong original operation cannot settle a timeout',()=>{
 const {c}=operating('unknown'),e=event(c,'provider_confirmed');e.operationId=id(99);expect(transition(c,e),'provider_operation_mismatch');
});
test('confirmation requires verified evidence about the original operation',()=>{
 const {c}=operating('unknown'),e=event(c,'provider_confirmed');e.verifiedOriginalOperation=false;expect(transition(c,e),'original_operation_evidence_required');
});
test('repeated starts cannot issue a second operation for an uncertain intent',()=>{
 const {c}=operating('unknown');expect(transition(c,event(c,'provider_started')),'provider_operation_already_started');
});
test('stale intent revision refuses the proposed transition',()=>{
 const {c}=operating(),e=event(c,'provider_unknown');e.intentRevision++;expect(transition(c,e),'transition_context_changed');
});
test('expiry cannot restore a revoked setup state',()=>{
 const {c}=operating('unknown');c.approval='revoked';expect(transition(c,event(c,'approval_expired')),'setup_already_revoked');
});
test('expiry cannot erase an already consumed approval',()=>{
 const {c}=operating('confirmed');c.approval='consumed';expect(transition(c,event(c,'approval_expired')),'setup_already_consumed');
});
test('a sequential later proof sees the first proof lock; this is no concurrency test',()=>{
 const {c,p}=fixture();expect(bind(c,p),'provider_binding_required',true);
 c.binding=structuredClone(p.identity);c.bindingRevision=1;p.identity.subject='Subject-B';
 expect(bind(c,p),'provider_identity_conflict');
});
test('frozen inputs remain unchanged and all outputs contain only fixed non-authoritative data',()=>{
 const f=frozen(locked()),before=JSON.stringify(f);
 for(const out of [bind(f.c,f.p),evidence(f.c,f.p,f.r),transition(f.c,event(f.c,'provider_started'))]){
  assert.ok(Object.isFrozen(out));if(out.next)assert.ok(Object.isFrozen(out.next));
  for(const key of ['authoritative','canApply','accessProvisioned','completenessCertified'])assert.equal(out[key],false);
  const text=JSON.stringify(out);for(const secret of [f.c.personId,f.c.intentId,f.p.identity.subject,f.p.contact.value])assert.ok(!text.includes(secret));
 }
 assert.equal(JSON.stringify(f),before);
});
test('malformed fixtures expose only the fixed TypeError, without private input values',()=>{
 const cases=[
  ()=>{const {c,p}=fixture();c.extra='sensitive';return bind(c,p);},
  ()=>{const {c,p}=fixture();p.identity.subject=' padded ';return bind(c,p);},
  ()=>{const {c,p}=fixture();c.bindingRevision=1;return bind(c,p);},
  ()=>{const {c,p}=operating('unknown');c.reconciliation='none';return bind(c,p);},
  ()=>{const {c,p,r}=locked();r.reviewer.owner='yes';return evidence(c,p,r);},
  ()=>{const {c}=fixture(),e=event(c,'link_committed');return transition(c,e);},
  ()=>{const {c}=fixture();c.now=NaN;return transition(c,event(c,'provider_started'));},
  ()=>{const {c,p}=fixture();p.identity.subject='secret\n';return bind(c,p);}
 ];
 for(const run of cases)assert.throws(run,{name:'TypeError',message:'invalid_onboarding_intent_rehearsal'});
});
