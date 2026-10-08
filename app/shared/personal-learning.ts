import {canDraftStandard, manages, type Member, type RecordOf, type Workspace} from './types';
import {eligibleForStation} from './station-assignment';
import {myWork} from './my-work';
import {guideMatchesStation} from './shift-learning';

// Learning eligibility is not a shift assignment or clearance. This projection
// requires no manager-created goal and never promotes draft restaurant material.
export function learningGuides(w:Workspace,person:Member) {
 if(person.locationId!==w.location.id||person.position==='Dishwasher')return [];
 const stations=w.records.filter((r):r is RecordOf<'station'>=>r.kind==='station'&&r.locationId===w.location.id&&eligibleForStation(w,person,r));
 const jobs=new Set([person.position,...(person.scheduleJobs??[])]);
 return w.records.filter((r):r is RecordOf<'standard'>=>r.kind==='standard'&&r.locationId===w.location.id&&r.area===person.area&&r.data.status==='approved'&&r.data.criteria.length>0&&(stations.some(s=>guideMatchesStation(r,s))||jobs.has(r.data.position))).sort((a,b)=>a.data.title.localeCompare(b.data.title)||a.id.localeCompare(b.id));
}
export function learningReviewer(w:Workspace,person:Member,guide:RecordOf<'standard'>) {
 const eligible=w.members.filter(m=>m.id!==person.id&&!m.scheduleOnly&&m.position!=='Dishwasher'&&manages(m,person.area,'people.manage'));
 const station=w.records.find((r):r is RecordOf<'station'>=>r.kind==='station'&&eligibleForStation(w,person,r)&&guideMatchesStation(guide,r));
 return eligible.find(m=>m.id===station?.data.setup?.managerId)??eligible.sort((a,b)=>Number(b.area===person.area)-Number(a.area===person.area)||a.id.localeCompare(b.id))[0];
}
export function personalLearning(w:Workspace,at:string) {
 const guides=learningGuides(w,w.me),work=myWork(w,at),currentIds=new Set(work.guides.map(g=>g.id));
 const goals=w.records.filter((r):r is RecordOf<'goal'>=>r.kind==='goal'&&r.ownerId===w.me.id&&r.locationId===w.location.id);
 const items=guides.map(guide=>{
  const matches=goals.filter(g=>g.data.standardId===guide.id&&g.data.standardRevision===guide.revision&&g.data.type==='development'&&g.data.automaticLearning===true);
  const goal=matches.find(g=>g.data.phase==='closed')??matches.find(g=>!['cancelled','declined'].includes(g.data.phase));
  const completed=goal?.data.phase==='closed'||w.learningHistory?.some(h=>h.personId===w.me.id&&h.standardId===guide.id&&h.standardRevision===guide.revision)===true;
  return {guide,goal,completed,reviewer:learningReviewer(w,w.me,guide),current:currentIds.has(guide.id),updated:!goal&&goals.some(g=>g.data.standardId===guide.id||g.data.standardId===guide.data.supersedes?.id)};
 });
 items.sort((a,b)=>Number(a.completed)-Number(b.completed)||Number(b.current)-Number(a.current)||Number(!!b.goal)-Number(!!a.goal)||a.guide.data.title.localeCompare(b.guide.data.title));
 return {items,completed:items.filter(i=>i.completed).length,next:items.find(i=>!i.completed&&i.goal?.data.phase!=='verification')??items.find(i=>!i.completed)};
}
export function reviewGuideOptions(w:Workspace,person:Member) {
 return learningGuides(w,person).map(g=>({id:g.id,revision:g.revision,name:g.data.position+' · '+g.data.title,definition:g.data.criteria.join('\n'),source:g.data.source}));
}
export function draftGuides(w:Workspace) {
 return w.records.filter((r):r is RecordOf<'standard'>=>r.kind==='standard'&&r.locationId===w.location.id&&r.data.status==='draft'&&canDraftStandard(w.me,r.area));
}
export const reviewRatings=[
 {value:0,label:'Not tried yet',description:'I have not had an opportunity to practice this work.'},
 {value:1,label:'Needs step-by-step help',description:'Needs someone beside them through the work.'},
 {value:5,label:'Independent with support',description:'Can meet the saved criteria; help is available when needed.'},
 {value:10,label:'Consistent mastery',description:'Consistently meets the criteria, including difficult situations.'},
] as const;
export const ratingLabel=(score:number|null,scale?:string)=>score===null?'Not assessed':scale!=='readiness-v1'?`Previous rating: ${score}/10`:reviewRatings.find(r=>r.value===score)?.label??`Previous rating: ${score}/10`;
