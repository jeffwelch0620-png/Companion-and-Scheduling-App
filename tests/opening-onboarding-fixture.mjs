import {fixture,ok} from './maintenance-meter-fixture.mjs';
export {ok};
export const openingFacts={title:'Fictional cook request',department:'BOH',positions:1,neededOn:'2026-10-15',shiftPlan:'Fictional evenings',reason:'Fictional gap',sourceRef:'Fictional staffing plan',managerId:'manager'};
export async function openingFixture(t){
 const f=await fixture(t);await f.db.prepare("UPDATE memberships SET capabilities='[\"tasks.manage\",\"schedule.manage\",\"schedule.publish\"]',revision=revision+1 WHERE id='manager'").run();
 async function hire(id='hire',area='BOH'){
  await f.db.prepare("INSERT INTO memberships(id,email,location_id,name,area,position,capabilities,qualifications,active,employment) VALUES(?,?,'a',?,?,'Line Cook','[]','[\"Line Cook\"]',0,?)").bind(id,id+'@example.test','Fictional '+id,area,JSON.stringify({status:'onboarding',hireDate:'2026-09-01',endedDate:null,departureReason:null,archivedAt:null})).run();
  const person=(await f.view()).hireCandidates.find(x=>x.id===id);const h=ok(await f.call('owner','hirehandoff.create',{employeeId:id,employeeRevision:person.revision,schedulerId:'manager',targetDate:'2026-10-01',handoffNote:'Fictional private handoff'}));return {person,h};
 }
 async function opening(patch={}){let o=ok(await f.call('owner','opening.create',{...openingFacts,...patch}));o=ok(await f.call('owner','opening.submit',{note:'Fictional check',checked:true},o));return ok(await f.call('owner','opening.approve',{note:'Fictional owner review',approved:true},o));}
 async function linkInput(h){const w=await f.view(),r=w.records.find(x=>x.id===(h.recordId??h.id)),p=w.hireCandidates.find(x=>x.id===r.ownerId);return {handoffId:r.id,handoffRevision:r.revision,employeeRevision:p.revision,note:'PRIVATE-LINK-REASON',checked:true};}
 const link=async(o,h,patch={})=>ok(await f.call('owner','opening.link-handoff',{...await linkInput(h),...patch},o));
 return {...f,hire,opening,linkInput,link};
}
