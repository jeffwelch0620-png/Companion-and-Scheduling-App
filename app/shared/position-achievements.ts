import {manages,type History,type Kind,type Member,type RecordOf,type Workspace,type WorkRecord} from './types';
import type {CommandContext} from './followthrough';
import {requireThat} from './validation';
import {operationalLearningSourceState} from './operational-learning';
import {operationsManager} from './operations';
import {canManageClosing} from './closing-access';
import {ideaReviewer} from './staff-ideas';

// Personal evidence milestones, not a performance rating or a competition.
// No click, conversation, quantity or shortage-free streak is an earning event.
export type AchievementSource={id:string;revision:number;kind:Kind;event:string;at:string;by:string};
export type Achievement={milestoneId:string;ruleVersion:number;title:string;definition:string;earnedAt:string;sourceRefs:AchievementSource[];status:'earned'|'review-needed';versions:{sourceRefs:AchievementSource[];status:'earned'|'review-needed';at:string;by:string}[];history:History;readEvidenceCurrent?:boolean};
export type AchievementCard={id:string;title:string;description:string;nextAction:string;progress:number;target:number;state:'opportunity'|'ready'|'earned'|'review-needed';earnedAt?:string;recordId?:string;sourceRefs:AchievementSource[]};
const ruleVersion=1;
type Opportunity={id:string;title:string;description:string;nextAction:string};
const opportunities:Opportunity[]=[
 {id:'checked-work',title:'Checked & Ready',description:'Your assigned work was submitted and checked by a different authorized person. The app records the check; it does not independently observe physical work or POS accuracy.',nextAction:'Complete assigned work, explain what you did, and request the independent check.'},
 {id:'clean-handoff',title:'Clean Handoff',description:'Your checked work has an explicit acceptance from the person receiving it. Acceptance transfers responsibility; it does not prove the receiving work is finished.',nextAction:'Describe the remaining work clearly, request the check, and let the named recipient accept it.'},
 {id:'problem-solver',title:'Problem Solver',description:'An assigned issue went through a correction and an independent check. Reporting a problem is responsible work; having fewer problems is not a score.',nextAction:'Record the correction and its result, then ask the authorized checker to review it.'},
 {id:'ready-for-tomorrow',title:'Ready for Tomorrow',description:'Your closing assignment against the current approved guide received independent final confirmation.',nextAction:'Use your approved closing guide, finish the assigned conditions, and request the required checks.'},
 {id:'learning-step',title:'Learning Step',description:'A voluntary development goal linked to current approved instructions was closed by its assigned independent manager.',nextAction:'Practice your agreed goal and show the evidence to its assigned reviewer. Marking yourself ready is not a completed review.'},
 {id:'station-builder',title:'Station Builder',description:'A different authorized reviewer recorded a current station assessment. This does not grant access, clearance, trainer authority or higher pay.',nextAction:'Practice the approved station skills and arrange an assessment with an authorized reviewer.'},
 {id:'idea-to-action',title:'Idea Into Action',description:'Your assigned independent reviewer reported implementing your idea and saved the implementation evidence. This is a reported result, not an automatic physical observation.',nextAction:'Share a useful idea and its benefit. Progress follows reviewed implementation, not the number of submissions.'},
 {id:'shared-learning',title:'Helpful Lesson',description:'A shared operational report has an independently supported review tied to current checked work. It remains a reported lesson, not a new approved method.',nextAction:'Share the observed symptom, actions, result and uncertainty, then request an independent evidence review.'},
];
function participant(m:Member){return !m.scheduleOnly;}
export function achievementReader(r:RecordOf<'achievement'>,m:Member){return participant(m)&&r.locationId===m.locationId&&r.ownerId===m.id;}
function sameStore(w:Workspace,r:WorkRecord){return r.locationId===w.location.id&&w.me.locationId===w.location.id;}
function ownSources(w:Workspace){return w.records.filter(r=>sameStore(w,r)&&r.ownerId===w.me.id&&r.area===w.me.area);}
function event(r:WorkRecord,action:string,actor?:string){
 const h='history' in r.data&&Array.isArray(r.data.history)?r.data.history:[];
 return [...h].reverse().find(x=>x.action===action&&x.actorId!==r.ownerId&&(!actor||x.actorId===actor)&&!!x.note.trim()&&Number.isFinite(Date.parse(x.at)));
}
function authorized(w:Workspace,r:WorkRecord,by:string,cap:'tasks.manage'|'people.manage'|'close.confirm'|'close.verify'){
 const m=w.members.find(m=>m.id===by&&m.locationId===r.locationId);
 if(!m||m.id===r.ownerId||m.position==='Dishwasher')return false;
 if(r.kind==='task'&&cap==='tasks.manage')return r.data.dishCheckout||r.data.dishHandoff?operationsManager(m,r.area):r.data.shiftId?canManageClosing(m,r.area,cap):manages(m,r.area,cap);
 if(r.kind==='close'&&(cap==='close.confirm'||cap==='close.verify'))return canManageClosing(m,r.area,cap);
 if(r.kind==='staffidea')return ideaReviewer(m,r.area);
 return manages(m,r.area,cap);
}
function ref(r:WorkRecord,action:string,by:string,at:string):AchievementSource{return {id:r.id,revision:r.revision,kind:r.kind,event:action,by,at};}
function dependency(w:Workspace,id:string|undefined,kind:'standard'|'station',revision:number|undefined){
 const r=w.records.find(r=>r.id===id&&sameStore(w,r)&&r.kind===kind&&r.area===w.me.area);
 if(!r||revision===undefined)return null;
 if(r.kind==='standard')return r.revision===revision&&r.data.status==='approved'?r:null;
 if(r.kind==='station')return (r.data.definitionRevision??r.revision)===revision&&r.data.status==='active'?r:null;
 return null;
}
function currentDishAcceptance(w:Workspace,r:RecordOf<'task'>,id:string){
 const a=r.data.dishHandoffAcceptances?.find(a=>a.handoffId===id);
 if(!a||a.acceptedBy===r.ownerId||!r.data.dishCheckout?.participantIds.slice(1).includes(a.acceptedBy)||!Number.isFinite(Date.parse(a.acceptedAt)))return null;
 if(r.data.dishHandoffReceiptView===true){
  // publicWorkspace creates this narrow projection after checking the raw
  // cycle. PM detail is not visible to AM, and is never copied into a badge.
  return Array.isArray(r.data.dishHandoffPendingIds)&&r.data.dishHandoffPendingIds.length===0?a:null;
 }
 const child=w.records.find((c):c is RecordOf<'task'>=>c.id===id&&c.kind==='task'&&sameStore(w,c));
 const link=child?.data.dishHandoff;
 return child&&link&&child.area===r.area&&child.ownerId===a.acceptedBy&&child.data.kind==='task'&&link.sourceId===r.id&&link.cycleId===r.data.dishCheckout?.cycleId&&link.businessDate===r.data.dishCheckout?.businessDate&&link.acceptedBy===a.acceptedBy&&link.acceptedAt===a.acceptedAt?a:null;
}
function proofs(w:Workspace,id:string):AchievementSource[][]{
 const matches:AchievementSource[][]=[];
 for(const r of ownSources(w)){
  if(r.kind==='task'){
   const checked=event(r,'verify');
   if(r.data.phase!=='closed'||!checked||!authorized(w,r,checked.actorId,'tasks.manage'))continue;
   const base=[ref(r,'verify',checked.actorId,checked.at)];
   // A new owner cannot inherit another person's earlier completed work.
   const lastReassignment=[...r.data.history].reverse().find(h=>h.action==='reassigned');
   if(lastReassignment&&lastReassignment.at>=checked.at)continue;
   const ready=[...r.data.history].reverse().find(h=>h.action==='ready'&&h.actorId===r.ownerId&&h.at<=checked.at);
   if(!ready||lastReassignment&&lastReassignment.at>=ready.at)continue;
   if(id==='checked-work'&&r.data.kind==='task')matches.push(base);
   if(id==='problem-solver'&&r.data.kind==='issue'&&r.data.history.some(h=>h.action==='fix'&&h.actorId!==r.ownerId&&h.at<checked.at))matches.push(base);
   if(id==='clean-handoff'){
    const accepted=event(r,'accept',r.data.incomingId);
    if(r.data.kind==='handoff'&&r.data.incomingId&&accepted&&accepted.at>=checked.at)matches.push([...base,ref(r,'accept',accepted.actorId,accepted.at)]);
    // AM's own public receipt is enough. Never expose a PM task body here.
    if(r.data.dishCheckout?.shift==='AM'&&r.data.dishHandoffs?.length){
     if(!r.data.dishHandoffPendingIds?.length&&r.data.dishHandoffs.every(id=>currentDishAcceptance(w,r,id)))
      matches.push([...base,...r.data.dishHandoffs.map(id=>{const a=currentDishAcceptance(w,r,id)!;return ref(r,'incoming-accepted',a.acceptedBy,a.acceptedAt);})]);
    }
   }
  }
  if(id==='ready-for-tomorrow'&&r.kind==='close'&&r.data.phase==='closed'){
   const confirmed=event(r,'confirm',r.data.managerId),guide=dependency(w,r.data.standardId,'standard',r.data.standardRevision);
   const shift=w.records.find(s=>s.kind==='shift'&&s.id===r.data.shiftId&&sameStore(w,s)&&s.ownerId===r.ownerId&&s.data.published&&!s.data.cancelled);
   if(!confirmed||!authorized(w,r,confirmed.actorId,'close.confirm')||!guide||!shift)continue;
   const ready=r.data.history.find(h=>h.action==='ready'&&h.actorId===r.ownerId&&h.at<=confirmed.at);
   if(!ready||r.data.correction?.personId&&r.data.correction.personId!==r.ownerId)continue;
   if(r.data.verifierId&&(!event(r,'verify',r.data.verifierId)||!authorized(w,r,r.data.verifierId,'close.verify')))continue;
   matches.push([ref(r,'confirm',confirmed.actorId,confirmed.at),ref(guide,'approved-guide',confirmed.actorId,confirmed.at),ref(shift,'published-shift',confirmed.actorId,confirmed.at)]);
  }
  if(id==='learning-step'&&r.kind==='goal'&&w.me.position!=='Dishwasher'&&r.data.type==='development'&&r.data.phase==='closed'){
   const checked=event(r,'verify',r.data.managerId),guide=dependency(w,r.data.standardId,'standard',r.data.standardRevision);
   if(checked&&authorized(w,r,checked.actorId,'people.manage')&&guide)matches.push([ref(r,'verify',checked.actorId,checked.at),ref(guide,'approved-guide',checked.actorId,checked.at)]);
  }
  if(id==='station-builder'&&r.kind==='proficiency'&&w.me.position!=='Dishwasher'&&r.data.level!==null){
   const checked=event(r,'manager-assessed'),station=dependency(w,r.data.stationId,'station',r.data.stationRevision);
   if(checked&&authorized(w,r,checked.actorId,'people.manage')&&station?.kind==='station'&&station.data.levels.some(l=>l.value===r.data.level)&&!!r.data.evidence.trim())matches.push([ref(r,'manager-assessed',checked.actorId,checked.at),ref(station,'current-station',checked.actorId,checked.at)]);
  }
  if(id==='idea-to-action'&&r.kind==='staffidea'&&w.me.position!=='Dishwasher'&&r.data.status==='closed'){
   const response=r.data.responses.at(-1);
   if(response?.outcome==='implemented'&&response.by===r.data.managerId&&authorized(w,r,response.by,'tasks.manage')&&response.evidence.trim())matches.push([ref(r,'implementation-reported',response.by,response.at)]);
  }
  if(id==='shared-learning'&&r.kind==='learningcase'&&r.data.status==='reviewed'&&r.data.review?.verdict==='supported'&&r.data.review.evidence.trim()&&authorized(w,r,r.data.review.by,'tasks.manage')&&operationalLearningSourceState(w,r)==='current'){
   const source=w.records.find(x=>x.id===r.data.source.id&&sameStore(w,x));
   const asset=r.data.asset?w.records.find(x=>x.id===r.data.asset!.id&&sameStore(w,x)):undefined;
   if(source)matches.push([ref(r,'supported-review',r.data.review.by,r.data.review.at),ref(source,'reviewed-source',r.data.review.by,r.data.review.at),...(asset?[ref(asset,'reviewed-asset',r.data.review.by,r.data.review.at)]:[])]);
  }
 }
 return matches.sort((a,b)=>a[0].at.localeCompare(b[0].at)||a[0].id.localeCompare(b[0].id));
}
function sameProof(a:AchievementSource[],b:AchievementSource[]){return JSON.stringify(a)===JSON.stringify(b);}
function currentProof(w:Workspace,r:RecordOf<'achievement'>){return r.data.ruleVersion===ruleVersion&&proofs(w,r.data.milestoneId).some(p=>sameProof(p,r.data.sourceRefs));}
export function achievementView(r:RecordOf<'achievement'>,w:Workspace):RecordOf<'achievement'> {
 const current=achievementReader(r,w.me)&&currentProof(w,r);
 return {...r,data:{...r.data,status:current?'earned':'review-needed',readEvidenceCurrent:current}};
}
export function positionAchievements(w:Workspace):AchievementCard[]{
 if(!participant(w.me)||w.me.locationId!==w.location.id)return [];
 return opportunities.filter(o=>w.me.position!=='Dishwasher'||['checked-work','clean-handoff','shared-learning'].includes(o.id)).map(o=>{
  const saved=w.records.find((r):r is RecordOf<'achievement'>=>r.kind==='achievement'&&achievementReader(r,w.me)&&r.data.milestoneId===o.id&&r.data.ruleVersion===ruleVersion);
  // The server computes this narrow marker from the raw authorized workspace
  // before removing hidden equipment/source bodies. It is rendering only:
  // currentProof and updates never trust it, and recordFromRow strips storage.
  const eligible=proofs(w,o.id)[0],valid=saved?typeof saved.data.readEvidenceCurrent==='boolean'?saved.data.readEvidenceCurrent:currentProof(w,saved):false;
  return {...o,progress:valid||!saved&&eligible?1:0,target:1,state:saved?valid?'earned':'review-needed':eligible?'ready':'opportunity',...(saved?{recordId:saved.id,earnedAt:saved.data.earnedAt}:eligible?{recordId:eligible[0].id}:{}),sourceRefs:saved?.data.sourceRefs??eligible??[],nextAction:saved&&!valid?'The saved evidence changed or is unavailable. Review the linked work before treating this milestone as current.':valid?'Keep building this skill. This milestone records one verified example, not a rating.':o.nextAction};
 });
}
function updates(w:Workspace,at:string,makeId:()=>string,actorId:string):WorkRecord[]{
 const result:WorkRecord[]=[];
 for(const o of opportunities){
  if(w.me.position==='Dishwasher'&&!['checked-work','clean-handoff','shared-learning'].includes(o.id))continue;
  const old=w.records.find((r):r is RecordOf<'achievement'>=>r.kind==='achievement'&&achievementReader(r,w.me)&&r.data.milestoneId===o.id&&r.data.ruleVersion===ruleVersion);
  const candidates=proofs(w,o.id);
  if(!old){const sourceRefs=candidates[0];if(!sourceRefs)continue;
   result.push({id:makeId(),kind:'achievement',locationId:w.location.id,ownerId:w.me.id,area:w.me.area,revision:1,updatedAt:at,data:{milestoneId:o.id,ruleVersion,title:o.title,definition:o.description,earnedAt:at,sourceRefs,status:'earned',versions:[],history:[{actorId,action:'evidence-recorded',at,note:'One qualifying saved outcome; no points, pay or permission change.'}]}});continue;
  }
  const exact=candidates.find(p=>sameProof(p,old.data.sourceRefs));
  // Revalidation may update the SAME underlying work after its authorized
  // recheck. Another event never silently replaces the original achievement.
  const updated=exact??candidates.find(p=>p[0].id===old.data.sourceRefs[0]?.id);
  const status=updated?'earned':'review-needed',sourceRefs=updated??old.data.sourceRefs;
  if(status===old.data.status&&sameProof(sourceRefs,old.data.sourceRefs))continue;
  result.push({...old,revision:old.revision+1,updatedAt:at,data:{...old.data,status,sourceRefs,versions:[...(old.data.versions??[]),{sourceRefs:old.data.sourceRefs,status:old.data.status,at,by:actorId}],history:[...old.data.history,{actorId,action:status==='earned'?'evidence-revalidated':'evidence-needs-review',at,note:'Original earned date and previous source versions retained; current source status checked.'}]}});
 }
 return result;
}
export function applyPositionAchievements(c:CommandContext){
 requireThat(c.command.action==='achievement.refresh','Unknown position progress action.');
 requireThat(participant(c.me)&&c.me.locationId===c.w.location.id,'Enable your own restaurant account before recording progress.',403);
 requireThat(!c.command.recordId&&Object.keys(c.input).length===0,'Progress is derived from your saved work; do not submit an owner, score or proof.');
 const changed=updates(c.w,c.at,()=>crypto.randomUUID(),c.me.id);
 requireThat(changed.length,'Your saved progress is already current. No new qualifying evidence needs recording.');
 for(const r of changed){
  const old=c.w.records.find(x=>x.id===r.id);
  if(old)c.save({...r,revision:old.revision});else c.create({kind:'achievement',data:r.data as Achievement});
 }
}
export function synchronizePositionAchievements(w:Workspace,changed:WorkRecord[],at:string,makeId:()=>string=()=>crypto.randomUUID()):WorkRecord[]{
 const eligibleKinds:Kind[]=['task','close','goal','proficiency','staffidea','learningcase','standard','station','shift','equipment','maintenance'];
 const relevant=changed.filter(r=>r.locationId===w.location.id&&eligibleKinds.includes(r.kind));
 if(!relevant.length)return [];
 const changedIds=new Set(relevant.map(r=>r.id)),owners=new Set(relevant.filter(r=>!['standard','station','shift'].includes(r.kind)).map(r=>r.ownerId));
 for(const r of w.records)if(r.kind==='achievement'&&r.locationId===w.location.id&&r.data.sourceRefs.some(s=>changedIds.has(s.id)))owners.add(r.ownerId);
 for(const r of w.records)if(r.kind==='task'&&sameStore(w,r)&&r.data.dishHandoffs?.some(id=>changedIds.has(id)))owners.add(r.ownerId);
 for(const r of w.records){
  if(!sameStore(w,r))continue;
  if(r.kind==='learningcase'&&(changedIds.has(r.data.source.id)||r.data.asset&&changedIds.has(r.data.asset.id)))owners.add(r.ownerId);
  if(r.kind==='goal'&&r.data.standardId&&changedIds.has(r.data.standardId))owners.add(r.ownerId);
  if(r.kind==='proficiency'&&changedIds.has(r.data.stationId))owners.add(r.ownerId);
  if(r.kind==='close'&&(changedIds.has(r.data.standardId)||changedIds.has(r.data.shiftId)))owners.add(r.ownerId);
 }
 const projected={...w,records:[...w.records.filter(r=>!changedIds.has(r.id)),...relevant]};
 return [...owners].flatMap(id=>{const me=w.members.find(m=>m.id===id&&m.locationId===w.location.id);return me&&participant(me)?updates({...projected,me},at,makeId,w.me.id):[];});
}
