import test from 'node:test';
import assert from 'node:assert/strict';
import {rehearseAdminSuspensionTransition as suspension,rehearseOperationalGrantUse as use,
 rehearseOwnerSelfGrantReconfirmation as reconfirm,rehearseGrantProvenanceStability as provenance} from './admin-self-grant-policy-rehearsal.mjs';
const id=n=>'fedcbaab-cdef-4000-8000-'+String(n).padStart(12,'0');
const scope=(department='kitchen',storeId=id(3),capability='schedule.change')=>({capability,storeId,department});
const registry=()=>[{name:'schedule.change',ordinary:true},{name:'schedule.publish',ordinary:true},{name:'owner.change',ordinary:false}];
const owner=()=>({organizationId:id(1),personId:id(4),verified:true,eligible:true,owner:true});
function fixture(){
 const policy={organizationId:id(1),adminPersonId:id(2),enabled:true,epoch:3,revision:8};
 const membership={organizationId:id(1),storeId:id(3),personId:id(2),membershipId:id(5),approved:true,scheduleOnly:false,epoch:5};
 const c={version:1,policy,registeredCapabilities:registry(),outstandingScopes:[],membership,lifecycleVerified:true,scopeExpansionVerified:true};
 const g={id:id(6),organizationId:id(1),actorPersonId:id(2),targetPersonId:id(2),...scope(),
 active:true,revision:1,basis:'enabled_admin',basisVerified:true,adminEpoch:3,membershipId:id(5),capturedMembershipEpoch:5};
 return {c,g};
}
function disabled(){
 const f=fixture();f.c.policy.enabled=false;f.c.policy.epoch=4;f.c.policy.revision=9;f.c.outstandingScopes=[scope()];return f;
}
function disableContext(){
 const {c,g}=fixture();
 return {version:1,before:c.policy,after:{...c.policy,enabled:false,epoch:4,revision:9},owner:owner(),
 registeredCapabilities:c.registeredCapabilities,components:[g],beforeScopes:[],afterScopes:[scope()],
 lifecycleVerified:true,scopeExpansionVerified:true,componentsComplete:true,expectedPolicyRevision:8,auditRecorded:true};
}
function request(c){
 return {organizationId:id(1),personId:id(2),scope:scope(),membershipId:id(5),membershipEpoch:5,
 expectedPolicyRevision:c.policy.revision,owner:owner(),reasonRecorded:true,auditRecorded:true};
}
const expected=(out,code,eligible=false)=>{assert.equal(out.code,code);assert.equal(out.eligible,eligible);};
const freeze=v=>{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;};
test('a current ordinary self-grant can pass this narrow lifetime predicate',()=>{
 const {c,g}=fixture();expected(use(c,g),'operational_grant_lifetime_satisfied',true);
});
test('disable advances the epoch and requires the active admin self-granted extent',()=>{
 expected(suspension(disableContext()),'admin_suspension_transition_satisfied',true);
});
test('disable cannot omit one affected scope',()=>{
 const c=disableContext();c.components.push({...c.components[0],id:id(7),department:'service'});
 expected(suspension(c),'admin_suspension_extent_mismatch');
});
test('disable cannot add unrelated scopes as suspended',()=>{
 const c=disableContext();c.afterScopes.push(scope('service'));expected(suspension(c),'admin_suspension_extent_mismatch');
});
test('owner-approved baseline is not converted into an admin suspension',()=>{
 const c=disableContext();c.components.push({...c.components[0],id:id(7),actorPersonId:id(4),basis:'owner',adminEpoch:null,department:'service'});
 expected(suspension(c),'admin_suspension_transition_satisfied',true);
 c.afterScopes.push(scope('service'));expected(suspension(c),'admin_suspension_extent_mismatch');
});
test('a grant to another person is not suspended by its granting admin switch',()=>{
 const c=disableContext();c.components.push({...c.components[0],id:id(7),targetPersonId:id(8),department:'service'});
 expected(suspension(c),'admin_suspension_transition_satisfied',true);
});
test('an inactive component adds no current permission extent at disable',()=>{
 const c=disableContext();c.components[0].active=false;c.afterScopes=[];expected(suspension(c),'admin_suspension_transition_satisfied',true);
});
test('pre-existing unresolved extents must survive the next disable',()=>{
 const c=disableContext();c.beforeScopes=[scope('service')];c.afterScopes.push(scope('service'));
 expected(suspension(c),'admin_suspension_transition_satisfied',true);
 c.afterScopes=[scope()];expected(suspension(c),'admin_suspension_extent_mismatch');
});
test('scope and component ordering do not affect the required suspension set',()=>{
 const c=disableContext();c.components.push({...c.components[0],id:id(7),department:'service'});c.afterScopes.push(scope('service'));
 const permuted=structuredClone(c);permuted.components.reverse();permuted.afterScopes.reverse();
 assert.deepEqual(suspension(c),suspension(permuted));assert.equal(suspension(c).eligible,true);
});
test('re-enablement retains the advanced epoch and unresolved extents',()=>{
 const c=disableContext();c.before={...c.after};c.after={...c.before,enabled:true,revision:10};c.expectedPolicyRevision=9;c.beforeScopes=[scope()];
 expected(suspension(c),'admin_suspension_transition_satisfied',true);
 c.afterScopes=[];expected(suspension(c),'admin_suspension_extent_mismatch');
});
test('an unchanged switch does not advance either counter or clear an obligation',()=>{
 const c=disableContext();c.before={...c.after};c.after={...c.before};c.beforeScopes=[scope()];c.expectedPolicyRevision=9;c.auditRecorded=false;
 expected(suspension(c),'admin_suspension_transition_satisfied',true);
 c.after.epoch++;expected(suspension(c),'admin_epoch_transition_invalid');
});
for(const field of ['epoch','revision'])test('disable requires exact consecutive '+field,()=>{
 const c=disableContext();c.after[field]--;expected(suspension(c),'admin_epoch_transition_invalid');
});
test('overflow cannot advance an admin epoch',()=>{
 const c=disableContext();c.before.epoch=Number.MAX_SAFE_INTEGER;c.after.epoch=Number.MAX_SAFE_INTEGER;
 expected(suspension(c),'admin_counter_exhausted');
});
test('stale expected policy refuses disable',()=>{
 const c=disableContext();c.expectedPolicyRevision++;expected(suspension(c),'policy_changed');
});
for(const field of ['organizationId','adminPersonId'])test('switch transition binds '+field,()=>{
 const c=disableContext();c.after[field]=id(99);expected(suspension(c),'admin_policy_scope_changed');
});
for(const field of ['verified','eligible','owner'])test('disable needs current owner '+field,()=>{
 const c=disableContext();c.owner[field]=false;expected(suspension(c),field==='owner'?'current_owner_required':'owner_identity_ineligible');
});
test('disable cannot use a different organization owner',()=>{
 const c=disableContext();c.owner.organizationId=id(99);expected(suspension(c),'owner_identity_ineligible');
});
for(const [field,code] of [['lifecycleVerified','lifecycle_unverified'],['scopeExpansionVerified','scope_expansion_unverified'],['componentsComplete','grant_history_unverified'],['auditRecorded','audit_required']])test('disable refuses missing '+field,()=>{
 const c=disableContext();c[field]=false;expected(suspension(c),code);
});
test('unverified component provenance prevents a suspension calculation',()=>{
 const c=disableContext();c.components[0].basisVerified=false;expected(suspension(c),'grant_basis_unverified');
});
test('a future admin approval epoch is not accepted as reviewed history',()=>{
 const c=disableContext();c.components[0].adminEpoch=4;expected(suspension(c),'grant_basis_epoch_invalid');
});
test('history from a different organization refuses the transition',()=>{
 const c=disableContext();c.components[0].organizationId=id(99);expected(suspension(c),'grant_scope_changed');
});
test('protected capability cannot be treated as an ordinary suspended grant',()=>{
 const c=disableContext();c.components[0].capability='owner.change';expected(suspension(c),'registered_ordinary_capability_required');
});
test('disabled admin self-grant is unusable even before considering a stored obligation',()=>{
 const {c,g}=disabled();c.outstandingScopes=[];expected(use(c,g),'admin_self_grant_suspended');
});
test('re-enabling admin does not revive the suspended scope',()=>{
 const {c,g}=disabled();c.policy.enabled=true;expected(use(c,g),'owner_reconfirmation_required');
});
test('new grant IDs and a fresh epoch do not bypass a suspended permission extent',()=>{
 const {c,g}=disabled();c.policy.enabled=true;g.id=id(99);g.adminEpoch=4;g.revision=99;
 expected(use(c,g),'owner_reconfirmation_required');
});
test('template-expanded equivalent scope uses canonical UUIDs and remains suspended',()=>{
 const {c,g}=disabled();c.policy.enabled=true;g.adminEpoch=4;g.storeId=g.storeId.toUpperCase();g.targetPersonId=g.targetPersonId.toUpperCase();
 expected(use(c,g),'owner_reconfirmation_required');
});
test('future approval epoch is refused even for a grant to another person',()=>{
 const {c,g}=fixture();g.targetPersonId=id(8);c.membership.personId=id(8);g.adminEpoch=4;expected(use(c,g),'grant_basis_epoch_invalid');
});
test('old self-grant epoch cannot revive when no obligation is supplied',()=>{
 const {c,g}=disabled();c.policy.enabled=true;c.outstandingScopes=[];expected(use(c,g),'admin_epoch_stale');
});
test('an independently owner-approved component remains usable for the same suspended scope',()=>{
 const {c,g}=disabled();g.actorPersonId=id(4);g.basis='owner';g.adminEpoch=null;
 expected(use(c,g),'operational_grant_lifetime_satisfied',true);
});
test('owner baseline remains usable while an admin-added department is suspended',()=>{
 const {c,g}=disabled();g.actorPersonId=id(4);g.basis='owner';g.adminEpoch=null;g.department='service';
 expected(use(c,g),'operational_grant_lifetime_satisfied',true);
 const added={...g,id:id(9),actorPersonId:id(2),basis:'enabled_admin',adminEpoch:3,department:'kitchen'};
 expected(use(c,added),'admin_self_grant_suspended');
});
test('disable leaves another person ordinary grant under its own membership rules',()=>{
 const {c,g}=disabled();g.targetPersonId=id(8);c.membership.personId=id(8);
 expected(use(c,g),'operational_grant_lifetime_satisfied',true);
});
test('a different department outside the suspended exact extent can be freshly granted',()=>{
 const {c,g}=disabled();c.policy.enabled=true;g.department='service';g.adminEpoch=4;
 expected(use(c,g),'operational_grant_lifetime_satisfied',true);
});
test('an exact scope at a different store is distinct after trusted expansion',()=>{
 const {c,g}=disabled();c.policy.enabled=true;g.storeId=id(9);c.membership.storeId=id(9);g.adminEpoch=4;
 expected(use(c,g),'operational_grant_lifetime_satisfied',true);
});
test('choosing another admin policy does not make an admin-basis component usable',()=>{
 const {c,g}=fixture();c.policy.adminPersonId=id(9);expected(use(c,g),'admin_policy_scope_changed');
});
for(const [field,value,code] of [['approved',false,'employment_ineligible'],['scheduleOnly',true,'employment_ineligible'],['epoch',6,'grant_review_required']])test('owner baseline still obeys membership '+field,()=>{
 const {c,g}=disabled();g.actorPersonId=id(4);g.basis='owner';g.adminEpoch=null;c.membership[field]=value;expected(use(c,g),code);
});
test('inactive component stays inactive independent of admin authority',()=>{
 const {c,g}=fixture();g.active=false;expected(use(c,g),'grant_inactive');
});
test('unverified basis does not become owner-approved by changing the label',()=>{
 const {c,g}=fixture();g.basis='owner';g.adminEpoch=null;g.basisVerified=false;expected(use(c,g),'grant_basis_unverified');
});
for(const field of ['lifecycleVerified','scopeExpansionVerified'])test('use requires verified '+field,()=>{
 const {c,g}=fixture();c[field]=false;expected(use(c,g),field==='lifecycleVerified'?'lifecycle_unverified':'scope_expansion_unverified');
});
test('unknown and protected capability keys cannot be operational permissions',()=>{
 const {c,g}=fixture();for(const capability of ['unknown.permission','owner.change']){g.capability=capability;expected(use(c,g),'registered_ordinary_capability_required');}
});
test('a current owner can reconfirm an exact pending extent while admin is disabled',()=>{
 const {c}=disabled();expected(reconfirm(c,request(c)),'owner_reconfirmation_predicate_satisfied',true);
});
test('an admin without owner authority cannot reconfirm their own scope',()=>{
 const {c}=disabled(),r=request(c);r.owner.personId=c.policy.adminPersonId;r.owner.owner=false;
 expected(reconfirm(c,r),'current_owner_required');
});
test('a person who independently holds current owner authority may reconfirm under that basis',()=>{
 const {c}=disabled(),r=request(c);r.owner.personId=c.policy.adminPersonId;
 expected(reconfirm(c,r),'owner_reconfirmation_predicate_satisfied',true);
});
for(const field of ['verified','eligible'])test('reconfirmation requires current owner '+field,()=>{
 const {c}=disabled(),r=request(c);r.owner[field]=false;expected(reconfirm(c,r),'owner_identity_ineligible');
});
test('reconfirmation owner must belong to the same organization',()=>{
 const {c}=disabled(),r=request(c);r.owner.organizationId=id(99);expected(reconfirm(c,r),'owner_identity_ineligible');
});
for(const field of ['organizationId','personId'])test('reconfirmation binds '+field,()=>{
 const {c}=disabled(),r=request(c);r[field]=id(99);expected(reconfirm(c,r),'reconfirmation_scope_changed');
});
test('reconfirmation refuses a stale coordinated policy revision',()=>{
 const {c}=disabled(),r=request(c);r.expectedPolicyRevision--;expected(reconfirm(c,r),'policy_changed');
});
for(const [field,value,code] of [['approved',false,'employment_ineligible'],['scheduleOnly',true,'employment_ineligible'],['epoch',6,'grant_review_required']])test('reconfirmation requires current membership '+field,()=>{
 const {c}=disabled(),r=request(c);c.membership[field]=value;expected(reconfirm(c,r),code);
});
test('reconfirmation cannot select a different membership identity',()=>{
 const {c}=disabled(),r=request(c);r.membershipId=id(99);expected(reconfirm(c,r),'grant_scope_mismatch');
});
test('reconfirmation cannot silently broaden from the suspended department',()=>{
 const {c}=disabled(),r=request(c);r.scope.department='service';expected(reconfirm(c,r),'suspension_scope_not_pending');
});
test('reconfirmation requires an existing pending obligation',()=>{
 const {c}=disabled(),r=request(c);c.outstandingScopes=[];expected(reconfirm(c,r),'suspension_scope_not_pending');
});
for(const [field,code] of [['reasonRecorded','reason_required'],['auditRecorded','audit_required']])test('reconfirmation requires '+field,()=>{
 const {c}=disabled(),r=request(c);r[field]=false;expected(reconfirm(c,r),code);
});
test('successful reconfirmation predicate does not mutate or clear any obligation',()=>{
 const {c}=disabled(),r=request(c),before=JSON.stringify(c);expected(reconfirm(c,r),'owner_reconfirmation_predicate_satisfied',true);
 assert.equal(JSON.stringify(c),before);assert.equal(c.outstandingScopes.length,1);
});
test('a supplied post-reconfirmation owner component works; old admin provenance does not revive',()=>{
 const {c,g}=disabled();c.policy.enabled=true;const r=request(c);expected(reconfirm(c,r),'owner_reconfirmation_predicate_satisfied',true);
 const after=structuredClone(c);after.outstandingScopes=[];after.policy.revision++;
 const ownerComponent={...g,id:id(9),actorPersonId:r.owner.personId,basis:'owner',adminEpoch:null};
 expected(use(after,ownerComponent),'operational_grant_lifetime_satisfied',true);
 expected(use(after,g),'admin_epoch_stale');
});
test('same-record owner relabeling cannot replace admin provenance',()=>{
 const {g}=fixture(),after={...g,basis:'owner',adminEpoch:null};expected(provenance(g,after),'grant_provenance_changed');
});
for(const field of ['organizationId','actorPersonId','targetPersonId','storeId','membershipId'])test('immutable grant provenance binds '+field,()=>{
 const {g}=fixture(),after={...g,[field]:id(99)};expected(provenance(g,after),'grant_provenance_changed');
});
for(const [field,value] of [['capability','schedule.publish'],['department','service'],['basisVerified',false],['adminEpoch',4],['capturedMembershipEpoch',6]])test('immutable grant provenance binds '+field,()=>{
 const {g}=fixture(),after={...g,[field]:value};expected(provenance(g,after),'grant_provenance_changed');
});
test('provenance stability is not authority for active/revision changes',()=>{
 const {g}=fixture();expected(provenance(g,{...g,active:false,revision:2}),'grant_provenance_stable',true);
});
test('UUID case variants do not invent another grant owner or scope',()=>{
 const {g}=fixture(),after=structuredClone(g);for(const key of ['id','organizationId','actorPersonId','targetPersonId','storeId','membershipId'])after[key]=after[key].toUpperCase();
 expected(provenance(g,after),'grant_provenance_stable',true);
});
test('different grant record IDs cannot be presented as a same-record update',()=>{
 const {g}=fixture();expected(provenance(g,{...g,id:id(99)}),'grant_record_changed');
});
test('frozen fixtures are unchanged and all outputs contain only fixed non-authoritative codes',()=>{
 const f=freeze(disabled()),r=freeze(request(f.c)),d=freeze(disableContext()),before=JSON.stringify([f,r,d]);
 for(const out of [use(f.c,f.g),reconfirm(f.c,r),suspension(d),provenance(f.g,f.g)]){
  assert.ok(Object.isFrozen(out));for(const key of ['authoritative','canApply','accessProvisioned','completenessCertified'])assert.equal(out[key],false);
  assert.deepEqual(Object.keys(out).sort(),['purpose','eligible','code','authoritative','canApply','accessProvisioned','completenessCertified'].sort());
  const text=JSON.stringify(out);for(const secret of [f.g.id,f.g.actorPersonId,f.g.storeId,f.g.department,f.g.capability])assert.ok(!text.includes(secret));
 }
 assert.equal(JSON.stringify([f,r,d]),before);
});
test('malformed/oversized/duplicate/wildcard fixtures produce one fixed data-free TypeError',()=>{
 const runs=[
  ()=>{const {c,g}=fixture();c.extra='private';return use(c,g);},
  ()=>{const {c,g}=fixture();g.adminEpoch=null;return use(c,g);},
  ()=>{const {c,g}=fixture();g.department='*';return use(c,g);},
  ()=>{const {c,g}=fixture();g.capability='schedule.*';return use(c,g);},
  ()=>{const {c,g}=fixture();c.registeredCapabilities.push({...c.registeredCapabilities[0]});return use(c,g);},
  ()=>{const {c,g}=fixture();c.outstandingScopes=[scope(),scope('kitchen',id(3).toUpperCase())];return use(c,g);},
  ()=>{const c=disableContext();c.components.push({...c.components[0],id:c.components[0].id.toUpperCase()});return suspension(c);},
  ()=>{const c=disableContext();c.components=new Array(1);return suspension(c);},
  ()=>{const {c,g}=fixture();c.registeredCapabilities=Array.from({length:201},(_,i)=>({name:'permission.'+i,ordinary:true}));return use(c,g);},
  ()=>{const {c,g}=fixture();c.policy.epoch=-1;return use(c,g);},
  ()=>{const {c,g}=fixture();g.basis='title';return use(c,g);},
  ()=>{const {c}=disabled(),r=request(c);r.owner.owner='yes';return reconfirm(c,r);}
 ];
 for(const run of runs)assert.throws(run,{name:'TypeError',message:'invalid_admin_self_grant_rehearsal'});
});
