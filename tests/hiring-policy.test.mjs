import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedHiringReview} from '../.sites-runtime/shared/hiring-policy.mjs';
import {applyOpeningApplicant} from '../.sites-runtime/shared/opening-applicants.mjs';
const person=(id,position,capabilities,locationId='a')=>({id,position,capabilities,locationId,name:id,area:'BOH',qualifications:[]});
const members=[person('gm','General Manager',['people.approve','tasks.manage']),person('manager','Kitchen Manager',['tasks.manage']),person('owner','Owner',['location.manage']),person('peer','Cook',[]),person('title-only','General Manager',[])];
const interview=personId=>({personId,date:'2026-09-15',evidence:'Fictional completed interview source'});
const input={candidateType:'frontline',interviews:[interview('gm'),interview('manager')],approverId:'gm',offerApproved:true,approvalEvidence:'Fictional approval source'};
const check=(patch={},people=members)=>checkedHiringReview({...input,...patch},people,'a','2026-09-01','2026-10-02','owner','2026-10-02T12:00:00Z');
test('frontline allows GM as one of two distinct managers',()=>{assert.equal(check().interviews.length,2);});
test('duplicate manager interviews and peers cannot replace a second manager',()=>{for(const id of ['gm','peer'])assert.throws(()=>check({interviews:[interview('gm'),interview(id)]}));});
test('GM title alone does not grant final hiring authority',()=>{assert.throws(()=>check({approverId:'title-only'}));assert.throws(()=>check({approverId:'manager'}));});
test('every position needs two managers; administrator or Owner title cannot substitute for explicit owner authority',()=>{for(const candidateType of ['management','gm']){assert.throws(()=>check({candidateType,interviews:[interview('owner')],approverId:'owner'}),/two distinct authorized managers/);assert.throws(()=>check({candidateType,interviews:[interview('gm'),interview('manager'),interview('owner')],approverId:'owner'}),/Explicit owner identity is not configured/);assert.throws(()=>check({candidateType,approverId:'gm'}),/administrator access cannot substitute/);}});
test('wrong location, removed membership and schedule-only authority cannot approve',()=>{assert.throws(()=>check({},members.filter(m=>m.id!=='gm')));assert.throws(()=>check({},members.map(m=>m.id==='gm'?{...m,locationId:'b'}:m)));assert.throws(()=>check({},members.map(m=>m.id==='gm'?{...m,scheduleOnly:true}:m)));});
test('approval and completed source/date evidence are mandatory',()=>{for(const patch of [{offerApproved:false},{approvalEvidence:''},{candidateType:'unknown'},{interviews:[]},{interviews:[interview('gm'),{...interview('manager'),date:'2999-01-01'}]},{interviews:[interview('gm'),{...interview('manager'),evidence:''}]}])assert.throws(()=>check(patch));});
test('policy review saves in retained applicant history and correction invalidates it',()=>{
 let saved;const applicant={id:'app',name:'Fictional candidate',reference:'REF',receivedOn:'2026-09-01',sourceRef:'Fictional source',stage:'received',followupOn:'2026-10-03',interview:null,approvalRevision:2,events:[]};
 const r={id:'opening',locationId:'a',kind:'opening',revision:3,area:'BOH',ownerId:'manager',data:{status:'open',approval:{revision:2},managerId:'manager',applicants:[applicant]}};
 const c={w:{location:{id:'a',timezone:'America/New_York'},members},me:members.find(m=>m.id==='owner'),input:{...input,applicantId:'app',checked:true,note:'Fictional checked evidence'},command:{action:'opening.applicant-hiring-review'},at:'2026-10-02T12:00:00Z',save:v=>saved=v};
 applyOpeningApplicant(c,r);assert.equal(saved.data.applicants[0].hiringReview.approverId,'gm');assert.equal(saved.data.applicants[0].events[0].state.hiringReview.approverId,'gm');
 const approved=saved;c.command.action='opening.applicant-correct';c.input={...applicant,applicantId:'app',name:'Corrected candidate',checked:true,note:'Fictional correction'};applyOpeningApplicant(c,approved);assert.equal(saved.data.applicants[0].hiringReview,null);assert.equal(saved.data.applicants[0].events[0].state.hiringReview.approverId,'gm');
});

