import test from 'node:test';
import assert from 'node:assert/strict';
import {explicitAuthority} from '../.sites-runtime/shared/authority-contract-prototype.mjs';
const at='2026-10-02T12:00:00Z';
const identity={authUserId:'fixture-auth',personId:'fixture-person',organizationId:'fixture-org',membershipId:'fixture-member',storeId:'a',membershipRevision:3,active:true,scheduleOnly:false};
const resource={organizationId:'fixture-org',storeId:'a'};
const grant=(role,patch={})=>({id:'fixture-'+role,organizationId:'fixture-org',personId:'fixture-person',membershipId:role==='owner'?null:'fixture-member',membershipRevision:role==='owner'?null:3,storeId:role==='owner'?null:'a',role,revision:2,active:true,startsAt:'2026-10-01T00:00:00Z',endsAt:role.startsWith('covering')?'2026-10-02T13:00:00Z':null,verifiedAt:'2026-10-01T00:00:00Z',verifiedByPersonId:'fixture-verifier',sourceRef:'Fictional verified designation',...patch});
const allowed=(role,action,r=resource,patch={})=>explicitAuthority(identity,[grant(role,patch)],action,r,at).allowed;
test('owner-only actions require explicit verified owner grant, not administrator capability or title',()=>{
 for(const action of ['incident.read','management.offer.approve','crossstore.sop.approve','manager.pay.read']){
  assert.equal(explicitAuthority({...identity,position:'Owner',capabilities:['location.manage']},[],action,resource,at).allowed,false);
  assert.equal(allowed('gm',action),false);assert.equal(allowed('owner',action),true);
 }
 assert.equal(allowed('owner','incident.read',{...resource,storeId:'b'}),true);
 assert.equal(allowed('owner','incident.read',{...resource,organizationId:'foreign'}),false);
});
test('designated managers and covering leads have separate store, department and reserved authority',()=>{
 assert.equal(allowed('gm','frontline.hire.approve'),true);assert.equal(allowed('foh-manager','frontline.hire.approve'),false);
 assert.equal(allowed('covering-foh','foh.service'),true);assert.equal(allowed('covering-foh','boh.service'),false);
 assert.equal(allowed('covering-boh','boh.service'),true);assert.equal(allowed('covering-boh','lead.appoint'),false);
 assert.equal(allowed('gm','store.sop.approve',{...resource,storeId:'b'}),false);
 assert.equal(allowed('covering-foh','foh.service',resource,{endsAt:null}),false);
 assert.equal(allowed('covering-foh','foh.service',resource,{endsAt:at}),false);
});
test('frontline rates are schedule-writing only for explicit designated managers; all manager pay owners-only',()=>{
 for(const role of ['owner','gm','foh-manager','boh-manager']){
  assert.equal(allowed(role,'frontline.rate.read'),false);
  assert.equal(allowed(role,'frontline.rate.read',{...resource,scheduleWriting:true}),true);
  assert.equal(allowed(role,'manager.pay.read'),role==='owner');
 }
 for(const role of ['covering-foh','covering-boh'])assert.equal(allowed(role,'frontline.rate.read',{...resource,scheduleWriting:true}),false);
 assert.equal(explicitAuthority(identity,[],'frontline.rate.read',{...resource,scheduleWriting:true},at).allowed,false);
});
test('applicant and performance audiences require record-specific involvement in addition to designation',()=>{
 assert.equal(allowed('gm','applicant.read'),false);assert.equal(allowed('gm','applicant.read',{...resource,involvedHiringPersonIds:['fixture-person']}),true);
 assert.equal(allowed('covering-foh','applicant.read',{...resource,involvedHiringPersonIds:['fixture-person']}),false);
 assert.equal(allowed('gm','performance.read'),false);assert.equal(allowed('gm','performance.read',{...resource,designatedReviewPersonIds:['fixture-person']}),true);
 assert.equal(explicitAuthority(identity,[],'performance.read',{...resource,subjectPersonId:'fixture-person'},at).allowed,true);
 assert.equal(explicitAuthority(identity,[],'performance.read',{...resource,storeId:'b',subjectPersonId:'fixture-person'},at).allowed,false);
});
test('missing evidence, stale bindings, revocation, future grants and invalid snapshots fail closed',()=>{
 for(const patch of [{active:false},{sourceRef:''},{verifiedByPersonId:''},{personId:'other'},{organizationId:'other'},{membershipId:'other'},{membershipRevision:2},{startsAt:'2027-01-01T00:00:00Z'},{verifiedAt:'2027-01-01T00:00:00Z'},{endsAt:at},{revision:0}])assert.equal(allowed('gm','foh.service',resource,patch),false);
 for(const patch of [{active:false},{scheduleOnly:true},{authUserId:''},{membershipRevision:0}])assert.equal(explicitAuthority({...identity,...patch},[grant('owner')],'incident.read',resource,at).allowed,false);
 assert.equal(explicitAuthority(identity,[grant('owner'),grant('owner')],'incident.read',resource,at).allowed,false);
 assert.equal(explicitAuthority(identity,[grant('owner')],'incident.read',resource,'invalid').allowed,false);
 const proof=explicitAuthority(identity,[grant('gm')],'foh.service',resource,at);assert.deepEqual(proof,{allowed:true,grantRevisions:[{id:'fixture-gm',revision:2}],membershipRevision:3});
});
