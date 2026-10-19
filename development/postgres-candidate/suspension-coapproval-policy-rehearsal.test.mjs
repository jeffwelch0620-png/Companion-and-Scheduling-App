import test from 'node:test';
import assert from 'node:assert/strict';
import {rehearseSuspensionCoapproval as decide} from './suspension-coapproval-policy-rehearsal.mjs';
const id=n=>'abcdefab-cdef-4000-8000-'+String(n).padStart(12,'0');
function fixture(count=2){
 const c={version:1,organizationId:id(1),organizationActive:true,lifecycleVerified:true,ownersComplete:true,
  ownerSetRevision:8,suspensionRevision:2,caseId:id(2),caseRevision:4,
  owners:Array.from({length:count},(_,i)=>({personId:id(i+3),eligible:true,suspended:false})),
  actor:{personId:id(3),verified:true,eligible:true,suspended:false},targetPersonId:id(4),request:null,coapproval:null};
 c.request={caseId:c.caseId,organizationId:c.organizationId,actorPersonId:c.actor.personId,targetPersonId:c.targetPersonId,
  caseRevision:c.caseRevision,ownerSetRevision:c.ownerSetRevision,suspensionRevision:c.suspensionRevision,
  scope:'organization_access',reasonRecorded:true,auditRecorded:true};return c;
}
function approve(c){
 const {reasonRecorded,auditRecorded,...binding}=c.request;
 c.coapproval={...binding,reviewer:{personId:id(90),organizationId:c.organizationId,verified:true,eligible:true,
  suspended:false,governanceAuthorized:true},approved:true,current:true,evidenceVerified:true};return c;
}
function reciprocal(c){
 const r=structuredClone(c);r.actor.personId=c.targetPersonId;r.targetPersonId=c.actor.personId;r.caseId=id(20);
 Object.assign(r.request,{caseId:r.caseId,actorPersonId:r.actor.personId,targetPersonId:r.targetPersonId});r.coapproval=null;return r;
}
const expected=(c,code,satisfied=false,required=null)=>{
 const r=decide(c);assert.equal(r.code,code);assert.equal(r.m3Satisfied,satisfied);assert.equal(r.governanceRequired,required);return r;
};
const freeze=v=>{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;};

test('two owners require governance before the M3 predicate is satisfied',()=>{
 const c=fixture(),before=JSON.stringify(c);expected(c,'governance_coapproval_required',false,true);assert.equal(JSON.stringify(c),before);
});
test('independent current governance satisfies only the selected M3 predicate',()=>{
 expected(approve(fixture()),'m3_coapproval_satisfied',true,true);
});
test('a third unsuspended eligible owner means the sole-owner condition is not triggered',()=>{
 expected(fixture(3),'m3_not_triggered',true,false);
});
for(const field of ['eligible','suspended'])test('third owner '+field+' changes the projected eligible set',()=>{
 const c=fixture(3);c.owners[2][field]=field==='suspended';expected(c,'governance_coapproval_required',false,true);
});
test('owner ordering and UUID case do not change M3 identity or outcome',()=>{
 const c=approve(fixture()),changed=structuredClone(c);changed.owners.reverse();
 for(const o of changed.owners)o.personId=o.personId.toUpperCase();
 changed.coapproval.reviewer.organizationId=changed.organizationId.toUpperCase();
 for(const key of ['caseId','organizationId','actorPersonId','targetPersonId'])changed.coapproval[key]=changed.coapproval[key].toUpperCase();
 assert.deepEqual(decide(changed),decide(c));
});
test('both unapproved mutual requests remain unsatisfied without any mutation',()=>{
 const a=fixture(),b=reciprocal(a),before=JSON.stringify([a,b]);
 expected(a,'governance_coapproval_required',false,true);expected(b,'governance_coapproval_required',false,true);
 assert.equal(JSON.stringify([a,b]),before);
});
test('supplied post-A-to-B state refuses B reciprocal request even with its earlier coapproval',()=>{
 const a=approve(fixture()),b=approve(reciprocal(a));expected(a,'m3_coapproval_satisfied',true,true);
 // Supplied consecutive snapshots, not execution of a suspension or proof of SQL serialization.
 const after=structuredClone(b);after.owners.find(o=>o.personId===id(4)).suspended=true;
 after.actor.suspended=true;after.suspensionRevision++;
 expected(after,'initiator_ineligible');
});
test('current owner state also refuses stale reciprocal authority claimed by an unchanged actor fixture',()=>{
 const c=approve(reciprocal(fixture()));c.owners.find(o=>o.personId===c.actor.personId).suspended=true;
 expected(c,'current_owner_required');
});
test('third owner lost after review stales the review; a refreshed case now needs governance',()=>{
 const c=fixture(3);expected(c,'m3_not_triggered',true,false);c.owners[2].eligible=false;c.ownerSetRevision++;
 expected(c,'review_context_changed');c.request.ownerSetRevision=c.ownerSetRevision;
 expected(c,'governance_coapproval_required',false,true);
});
for(const [field,code] of [['organizationActive','organization_ineligible'],['lifecycleVerified','lifecycle_unverified'],['ownersComplete','owner_set_unverified']])test('supplied '+field+' must be verified',()=>{
 const c=approve(fixture());c[field]=false;expected(c,code);
});
for(const key of ['caseId','organizationId','actorPersonId','targetPersonId'])test('request binds current '+key,()=>{
 const c=fixture();c.request[key]=id(99);expected(c,'request_scope_changed');
});
for(const key of ['caseRevision','ownerSetRevision','suspensionRevision'])test('request binds current '+key,()=>{
 const c=approve(fixture());c[key]++;expected(c,'review_context_changed');
});
for(const [field,value] of [['verified',false],['eligible',false],['suspended',true]])test('initiator '+field+' is rechecked',()=>{
 const c=approve(fixture());c.actor[field]=value;expected(c,'initiator_ineligible');
});
test('governance coapproval does not turn a non-owner initiator into an owner',()=>{
 const c=approve(fixture());c.owners.shift();expected(c,'current_owner_required');
});
test('self-targeting is outside this narrow owner-to-owner predicate',()=>{
 const c=fixture();c.targetPersonId=c.actor.personId;c.request.targetPersonId=c.actor.personId;
 expected(c,'distinct_target_required');
});
test('non-owner target is outside the M3-only rehearsal',()=>{
 const c=fixture();c.owners.pop();expected(c,'target_owner_required');
});
for(const field of ['eligible','suspended'])test('target owner '+field+' must be current',()=>{
 const c=approve(fixture());c.owners[1][field]=field==='suspended';expected(c,'target_owner_ineligible');
});
for(const [field,code] of [['reasonRecorded','reason_required'],['auditRecorded','audit_required']])test('request requires '+field,()=>{
 const c=approve(fixture());c.request[field]=false;expected(c,code);
});
for(const key of ['caseId','organizationId','actorPersonId','targetPersonId'])test('coapproval binds exact '+key,()=>{
 const c=approve(fixture());c.coapproval[key]=id(99);expected(c,'coapproval_context_changed',false,true);
});
for(const key of ['caseRevision','ownerSetRevision','suspensionRevision'])test('coapproval binds exact '+key,()=>{
 const c=approve(fixture());c.coapproval[key]++;expected(c,'coapproval_context_changed',false,true);
});
for(const [field,code] of [['approved','governance_coapproval_refused'],['current','governance_coapproval_stale'],['evidenceVerified','governance_evidence_unverified']])test('coapproval requires '+field,()=>{
 const c=approve(fixture());c.coapproval[field]=false;expected(c,code,false,true);
});
for(const [field,value] of [['organizationId',id(99)],['verified',false],['eligible',false],['suspended',true]])test('governance reviewer '+field+' is checked',()=>{
 const c=approve(fixture());c.coapproval.reviewer[field]=value;expected(c,'governance_reviewer_ineligible',false,true);
});
for(const personId of [id(3),id(4).toUpperCase()])test('governance reviewer must differ from initiator and target '+personId.slice(-1),()=>{
 const c=approve(fixture());c.coapproval.reviewer.personId=personId;expected(c,'independent_governance_required',false,true);
});
test('another owner is not a governance approver merely from ownership',()=>{
 const c=approve(fixture(3));c.coapproval.reviewer.personId=c.owners[2].personId;c.coapproval.reviewer.governanceAuthorized=false;
 expected(c,'governance_authority_required',false,false);
});
for(const field of ['eligible','suspended'])test('current owner projection also binds a governance reviewer '+field,()=>{
 const c=approve(fixture(3));c.coapproval.reviewer.personId=c.owners[2].personId;
 c.owners[2][field]=field==='suspended';
 expected(c,'governance_reviewer_ineligible',false,true);
});
test('an unrelated supplied approval is refused even when the sole-owner condition is not triggered',()=>{
 const c=approve(fixture(3));c.coapproval.caseId=id(99);expected(c,'coapproval_context_changed',false,false);
});
test('positive results are frozen, data-free, non-authoritative and mutate no input',()=>{
 for(const c of [freeze(approve(fixture())),freeze(fixture(3))]){
  const before=JSON.stringify(c),r=decide(c);assert.equal(r.m3Satisfied,true);assert.ok(Object.isFrozen(r));
  for(const key of ['authoritative','canApply','accessProvisioned','completenessCertified'])assert.equal(r[key],false);
  assert.deepEqual(Object.keys(r).sort(),['purpose','m3Satisfied','code','governanceRequired','authoritative','canApply','accessProvisioned','completenessCertified'].sort());
  for(const value of [c.organizationId,c.caseId,c.actor.personId,c.targetPersonId])assert.ok(!JSON.stringify(r).includes(value));
  assert.equal(JSON.stringify(c),before);
 }
});
test('malformed, ambiguous or oversized fixtures throw only a fixed data-free TypeError',()=>{
 const cases=[
  c=>{c.extra='private';},c=>{c.version=2;},c=>{c.ownerSetRevision=0;},c=>{c.actor.verified='yes';},
  c=>{c.owners=new Array(1);},c=>{c.owners.push({...c.owners[0],personId:c.owners[0].personId.toUpperCase()});},
  c=>{c.owners=Array.from({length:201},(_,i)=>({personId:id(i+100),eligible:true,suspended:false}));},
  c=>{c.request.scope='*';},c=>{c.request.actorPersonId='private';},c=>{c.coapproval.current='yes';},
  c=>{c.coapproval.reviewer.governanceAuthorized=null;},c=>{c.owners[0][Symbol('private')]=true;}
 ];
 for(const mutate of cases){const c=approve(fixture());mutate(c);assert.throws(()=>decide(c),{name:'TypeError',message:'invalid_suspension_coapproval_rehearsal'});}
});
