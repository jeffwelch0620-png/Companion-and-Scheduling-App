import {publicWorkspace} from './domain';
import {operationsHome} from './operations-home';
import {operationsManager} from './operations';
import {followupDesk} from './followup-desk';
import {buildShiftBrief} from './shift-brief';
import {myWork} from './my-work';
import {localDate} from './local-time';
import {has,type Kind,type Workspace,type WorkRecord} from './types';

export type RoleHomeKind='frontline'|'department-manager'|'general-manager'|'owner';
export type RoleHomeFreshness={state:'current'|'historical'|'changed'|'missing'|'unavailable'|'stale'|'recorded';label:string;sourceAt:string|null};
export type RoleHomeSource={locationId:string;locationName:string;state:'available'|'missing'|'unavailable'|'stale';label:string;asOf?:string|null};
export type ExpectedRoleHomeSource={locationId:string;locationName:string;state?:'missing'|'unavailable'|'stale';reason?:string;asOf?:string|null};
// Explicit source failure metadata may reduce the supplied scope, never enlarge it.
export type RoleHomeWorkspace=Workspace&{roleHomeSource?:{state:RoleHomeSource['state'];label?:string;asOf?:string|null;operatingAreas?:('FOH'|'BOH'|'combined'|'production')[]}};
export type RoleHomeAttention={
 id:string;what:string;why:string;person:string;personId:string|null;nextAction:string;
 recordId:string|null;recordKind:Kind|null;tab:string|null;locationId:string;locationName:string;area:string;
 priority:'urgent'|'attention'|'routine';freshness:RoleHomeFreshness;
 source:{label:string;recordId:string|null;revision:number|null;businessDate:string|null};
 // True means the original authorized target can be opened, not permission to mutate it.
 actionable:boolean;
};
export type RoleHomeModel={role:RoleHomeKind;title:string;purpose:string;scopeLabel:string;priorities:RoleHomeAttention[];attention:RoleHomeAttention[];sources:RoleHomeSource[];assumptions:string[];missing:string[]};

const roleText:Record<RoleHomeKind,{title:string;purpose:string}>={
 frontline:{title:'My position today',purpose:'Know what your position needs, what to do next, and who can help you finish and hand off well.'},
 'department-manager':{title:'My department today',purpose:'Keep your department ready, remove blockers, and make the next responsibility clear.'},
 'general-manager':{title:'My restaurant today',purpose:'Keep front and back of house working together, with clear responsibility and follow-through.'},
 owner:{title:'Our restaurants and commissary',purpose:'See which authorized location needs a decision or support, why it matters, and who is following through.'},
};
const assumptions=['Role purpose and priority order are working design assumptions for review.','The selected home changes presentation only; existing account, restaurant and record permissions still apply.','Saved records are evidence of recorded work. Missing records do not establish readiness or completion.','This report uses supplied workspace records. Separately loaded Food/prep and other sources require their own authorized adapters; this is not an all-systems check.'];
const sourceLabels:Partial<Record<Kind,string>>={managerlog:'Manager Log',shiftentry:'Shift summary',shift:'Published schedule',task:'Assigned work',close:'Closing check',handoff:'Handoff',standard:'Approved position guide',order:'Internal purchasing request',message:'Inbox',maintenance:'Maintenance plan'};
function source(w:RoleHomeWorkspace):RoleHomeSource{
 if(w.me.locationId!==w.location.id)return {locationId:w.location.id,locationName:w.location.name,state:'unavailable',label:'The account and restaurant scope do not match.'};
 const state=w.roleHomeSource?.state??'available';
 return {locationId:w.location.id,locationName:w.location.name,state,asOf:w.roleHomeSource?.asOf??null,label:w.roleHomeSource?.label??(state==='available'?'Authorized workspace supplied; no live connection is implied.':state==='missing'?'No workspace evidence was supplied.':state==='stale'?'The source reports that its evidence is outdated.':'Workspace evidence is unavailable.')};
}
function person(w:Workspace,id:string|null|undefined){const member=w.members.find(m=>m.id===id&&m.locationId===w.location.id);return {person:member?.name??'Unassigned',personId:member?.id??null};}
function item(w:Workspace,r:WorkRecord,what:string,why:string,nextAction:string,tab:string|null,options:Partial<Pick<RoleHomeAttention,'priority'|'freshness'|'area'>> & {responsibleId?:string|null;businessDate?:string|null}={}):RoleHomeAttention{
 return {id:w.location.id+':'+r.kind+':'+r.id,what,why,...person(w,options.responsibleId===undefined?r.ownerId:options.responsibleId),nextAction,recordId:r.id,recordKind:r.kind,tab,locationId:w.location.id,locationName:w.location.name,area:options.area??r.area,priority:options.priority??'routine',freshness:options.freshness??{state:'recorded',label:'Saved record; current conditions still need confirmation.',sourceAt:r.updatedAt||null},source:{label:sourceLabels[r.kind]??'Saved '+r.kind,recordId:r.id,revision:r.revision,businessDate:options.businessDate??null},actionable:!!tab};
}
function gap(site:Pick<RoleHomeSource,'locationId'|'locationName'|'asOf'>,id:string,what:string,why:string,nextAction:string,state:'missing'|'unavailable'|'changed'|'stale'='missing',area=''):RoleHomeAttention{
 return {id:site.locationId+':gap:'+id,what,why,person:'Unassigned',personId:null,nextAction,recordId:null,recordKind:null,tab:null,locationId:site.locationId,locationName:site.locationName,area,priority:'attention',freshness:{state,label:why,sourceAt:site.asOf??null},source:{label:'Source coverage',recordId:null,revision:null,businessDate:null},actionable:false};
}
const targets:Partial<Record<Kind,string>>={shift:'Schedule week',request:'Schedule requests',availability:'Schedule requests',task:'Legacy duties',close:'Legacy duties',handoff:'Legacy duties',goal:'Training',development:'Training',feedback:'Feedback',order:'Orders',message:'Inbox'};
function sorted(rows:RoleHomeAttention[]){const rank={urgent:0,attention:1,routine:2};return [...new Map(rows.map(r=>[r.id,r])).values()].sort((a,b)=>rank[a.priority]-rank[b.priority]||a.locationName.localeCompare(b.locationName)||a.what.localeCompare(b.what)||a.id.localeCompare(b.id));}
function model(role:RoleHomeKind,scopeLabel:string,rows:RoleHomeAttention[],sources:RoleHomeSource[],notes:string[]=[]):RoleHomeModel{
 const attention=sorted(rows);return {role,...roleText[role],scopeLabel,priorities:attention.slice(0,3),attention,sources,assumptions:[...assumptions,...notes],missing:attention.filter(i=>['missing','unavailable','changed','stale'].includes(i.freshness.state)).map(i=>i.locationName+': '+i.what)};
}
function briefItems(w:Workspace,at:string,frontline:boolean):RoleHomeAttention[]{
 return buildShiftBrief(w,at).items.filter(b=>!frontline||b.record.ownerId===w.me.id||b.lane==='action').map(b=>{
  const r=b.record;
  let freshness:RoleHomeFreshness={state:'recorded',label:'Saved work and its current workflow state.',sourceAt:r.updatedAt||null};
  if(r.kind==='close'){
   const current=w.records.some(s=>s.kind==='standard'&&s.id===r.data.standardId&&s.revision===r.data.standardRevision&&s.data.status==='approved');
   if(!current)freshness={state:'changed',label:'The linked approved instruction cannot be confirmed at this version.',sourceAt:r.updatedAt||null};
  }
  if(r.kind==='order'&&r.data.food&&r.data.food.countDate!==localDate(at,w.location.timezone))freshness={state:'historical',label:'The purchasing count is from another restaurant business date. Saving, submission and approval require a current-day count.',sourceAt:r.data.food.capturedAt};
  return item(w,r,b.title,r.kind==='order'?'The internal request needs its next recorded review step. Supplier placement is separate.':b.reason,b.next,r.kind==='order'&&r.data.food?'Purchasing review':targets[r.kind]??null,{priority:r.kind==='handoff'&&r.data.priority==='urgent'?'urgent':b.rank<=10||b.overdue||b.lane==='action'?'attention':'routine',freshness,responsibleId:r.kind==='order'&&r.data.status==='review'?r.data.reviewerId??null:r.ownerId,businessDate:r.kind==='order'?r.data.food?.countDate??null:null});
 });
}

export function buildRoleHome(workspace:Workspace,role:RoleHomeKind,now:Date=new Date()):RoleHomeModel{
 const at=now.toISOString(),site=source(workspace),scopeLabel=role==='frontline'?`${site.locationName} · my assigned position`:role==='department-manager'?`${site.locationName} · ${workspace.me.area}`:`${site.locationName} · authorized restaurant scope`;
 if(site.state!=='available')return model(role,scopeLabel,[gap(site,'workspace',site.state==='stale'?'Location update is outdated':'Location update is unavailable',site.label,'Ask the location manager for a current update.',site.state)], [site]);
 // Never replace Member capabilities or derive them from role/job labels.
 const w=publicWorkspace({...workspace,members:workspace.members.filter(m=>m.locationId===workspace.location.id),records:workspace.records.filter(r=>r.locationId===workspace.location.id)},at);
 const rows:RoleHomeAttention[]=[],notes:string[]=[],day=localDate(at,w.location.timezone);
 if(role==='frontline'){
  const work=myWork(w,at);
  if(work.ambiguous)rows.push(gap(site,'ambiguous-shift','Confirm your position','More than one published shift overlaps. No position has been selected for you.','Ask your manager to confirm the assigned shift and station.','changed',w.me.area));
  else if(work.shift)rows.push(item(w,work.shift,work.station,work.checkoutPending?'Your scheduled shift has ended; assigned closing work and manager checkout remain separate.':work.current?'This is your current published assignment; it does not establish attendance.':'This is your next published assignment.','Open your shift','Schedule week',{freshness:{state:'current',label:work.checkoutPending?'Ended published assignment awaiting operational checkout.':'Published assignment matched to the requested time.',sourceAt:work.shift.updatedAt},businessDate:localDate(work.shift.data.start,w.location.timezone)}));
  else rows.push(gap(site,'shift','Published position not found','No current or upcoming published shift was found in your accessible coming week.','Check your schedule with your manager.','missing',w.me.area));
  for(const guide of work.guides.slice(0,3))rows.push(item(w,guide,guide.data.title,guide.data.guide?.purpose||'Approved instructions for your assigned position.','Open the approved guide','Training',{freshness:{state:'current',label:'Approved guide matched by the existing station selector.',sourceAt:guide.updatedAt}}));
  for(const entry of briefItems(w,at,true)){
   const assignment=rows.find(row=>row.recordKind==='shift'&&row.recordId===work.shift?.id&&row.recordId===entry.recordId);
   if(assignment){assignment.why+=' '+entry.why;assignment.nextAction=entry.nextAction;assignment.priority=entry.priority;}
   else rows.push(entry);
  }
  const unread=w.records.filter(r=>r.kind==='message'&&!r.data.readBy.includes(w.me.id));
  for(const r of unread)if(r.kind==='message')rows.push(item(w,r,r.data.title,'A saved message has not been marked read.','Read the message','Inbox',{priority:'attention'}));
  if(w.me.position==='Dishwasher'){
   notes.push('Dishwasher access includes its own assigned tasks and reporting ready for a manager’s check, plus approved Dishwasher instructions. It grants no closing, review or management powers.');
   if(!work.guides.length)rows.push(gap(site,'dish-work','Your position instructions are not available yet','Your approved Dishwasher instructions have not been supplied to this home.','Check your manager’s message or ask them to confirm your next task.','unavailable',w.me.area));
  }else if(!work.guides.length)rows.push(gap(site,'guide','Approved position instructions missing','No approved guide was matched to the selected position.','Ask your manager to review the position instructions.','missing',w.me.area));
  const home=model(role,scopeLabel,rows,[site],notes);
  // Orient the person to their published position before presenting source gaps.
  // This changes presentation order, not the assignment's urgency or authority.
  const assignment=home.attention.find(entry=>entry.recordKind==='shift');
  if(assignment)home.priorities=[assignment,...home.attention.filter(entry=>entry.id!==assignment.id)].slice(0,3);
  return home;
 }
 const home=operationsHome(w,at);
 const authorizedAreas=['FOH','BOH','combined','production'].filter(area=>operationsManager(w.me,area));
 // Administration scope is not an operating department. A configured source
 // can identify its departments, but those still require original authority.
 const operatingKinds:Kind[]=['managerlog','shiftentry','maintenance','equipment','close','task','handoff','station','shift'];
 const recordedAreas=[...new Set([...w.members.filter(m=>!has(m,'location.manage')&&!has(m,'operations.store')).map(m=>m.area),...w.records.filter(r=>operatingKinds.includes(r.kind)).map(r=>r.area)])].filter(area=>['FOH','BOH','combined','production'].includes(area));
 const configuredAreas=(workspace as RoleHomeWorkspace).roleHomeSource?.operatingAreas;
 const requestedAreas=role==='department-manager'?[w.me.area]:role==='general-manager'?['FOH','BOH']:configuredAreas??(recordedAreas.length?recordedAreas:['FOH','BOH']);
 const areas=requestedAreas.filter(area=>authorizedAreas.includes(area));
 const inArea=(area:string)=>role!=='department-manager'||area===w.me.area;
 for(const r of home.issues.filter(r=>inArea(r.area))){
  const responsible=w.members.find(m=>m.id===r.ownerId&&operationsManager(m,r.area)),overdue=!!r.data.due&&Date.parse(r.data.due)<now.getTime();
  rows.push(item(w,r,r.data.title,[r.data.priority==='urgent'?'Marked urgent by its author.':'Unresolved Manager Log item.',overdue?'Its recorded due time has passed.':'',!responsible?'The responsible manager is no longer available.':!r.data.acceptedBy?'Responsibility has not been accepted.':'Responsibility was accepted; resolution remains open.'].filter(Boolean).join(' '),!responsible?'Review the responsible manager':!r.data.acceptedBy?'Open the handoff and confirm responsibility':'Open the latest update and next step','Manager Log',{responsibleId:responsible?.id??null,priority:r.data.priority==='urgent'?'urgent':'attention'}));
 }
 for(const area of areas){
  const submitted=home.summaries.filter(r=>r.area===area&&r.data.status==='submitted').sort((a,b)=>b.data.submittedAt.localeCompare(a.data.submittedAt))[0];
  const previous=home.handoffs.find(h=>h.area===area)?.record;
  if(submitted)rows.push(item(w,submitted,`${area} submitted summary`,submitted.data.readiness==='not-assessed'?'Readiness was not assessed.':submitted.data.readiness==='action-needed'?'The submitted summary records action needed.':'The submitted summary records readiness at its recorded time; current conditions still need checking.','Read the submitted summary','Manager Log',{businessDate:day,priority:submitted.data.readiness==='ready'?'routine':'attention',freshness:{state:'current',label:`Submitted for restaurant date ${day}; not a live readiness check.`,sourceAt:submitted.data.submittedAt}}));
  else rows.push(gap(site,'summary-'+area,`${area} readiness evidence missing`,home.drafts.some(r=>r.area===area)?'Today’s summary remains in draft; no submitted readiness evidence is available.':'No submitted summary for the current restaurant date is recorded.','Open the Manager Log and review the current handoff.','missing',area));
  if(previous)rows.push(item(w,previous,`${area} previous handoff`,previous.data.tomorrowNote||'No next-shift note was entered.','Read the previous handoff','Manager Log',{businessDate:previous.data.businessDate,freshness:{state:'historical',label:`Previous submitted summary from ${previous.data.businessDate}; does not confirm today’s readiness.`,sourceAt:previous.data.submittedAt}}));
 }
 for(const entry of followupDesk(w,at).filter(e=>inArea(e.area))){
  const r=w.records.find(r=>r.id===entry.id);if(!r)continue;
  rows.push(item(w,r,entry.title,`${entry.mode==='review'?'Recorded evidence or responsibility needs review.':entry.mode==='your-step'?'The recorded workflow has a next step for you.':'The recorded workflow is waiting for follow-through.'} ${entry.date?entry.dateLabel+': '+entry.date+'.':entry.dateLabel+'.'}`,entry.nextStep,entry.tab,{responsibleId:entry.responsibleId,priority:entry.overdue||entry.mode!=='waiting'?'attention':'routine',freshness:{state:entry.mode==='review'?'changed':'recorded',label:entry.mode==='review'?entry.nextStep:'Current saved workflow state; not a live operating check.',sourceAt:r.updatedAt}}));
 }
 rows.push(...briefItems(w,at,false).filter(r=>inArea(r.area)));
 if(role==='general-manager'){
  for(const area of ['FOH','BOH'])if(!authorizedAreas.includes(area))rows.push(gap(site,'access-'+area,`${area} operating view unavailable`,'The supplied membership does not authorize this department. Choosing the GM home adds no access.','Review the GM operational scope before connecting this department.','unavailable',area));
  notes.push(has(w.me,'tasks.manage')&&has(w.me,'operations.store')?'GM operating logs cover front and back of house in this restaurant through explicit operations.store and tasks.manage permissions. Other workflows retain their own access checks.':'GM home: one store, both departments. Dedicated GM permission mapping remains to connect.');
 }
 if(!areas.length)rows.push(gap(site,'operations','Operational brief unavailable','The supplied membership has no matching department-wide operational scope.','Review assigned restaurant responsibilities.','unavailable',w.me.area));
 if(has(w.me,'location.manage'))notes.push('This supplied account has restaurant-administration authority. Its visibility is not evidence that a future GM should receive that authority.');
 notes.push('Supplied account permissions: '+(w.me.capabilities.join(', ')||'No management permissions.'));
 return model(role,scopeLabel,rows,[site],notes);
}

export function buildOwnerHome(workspaces:Workspace[],now:Date=new Date(),expectedSources:ExpectedRoleHomeSource[]=[]):RoleHomeModel{
 const byLocation=new Map<string,Workspace[]>();for(const w of workspaces){const group=byLocation.get(w.location.id)??[];group.push(w);byLocation.set(w.location.id,group);}
 const sources:RoleHomeSource[]=[],rows:RoleHomeAttention[]=[];
 for(const [locationId,group] of byLocation){
  if(new Set(group.map(w=>w.me.id)).size>1){const s:RoleHomeSource={locationId,locationName:group[0].location.name,state:'unavailable',label:'Conflicting account contexts were supplied for this restaurant.'};sources.push(s);rows.push(gap(s,'conflicting-context','Restaurant context needs review',s.label,'Reload this restaurant under one authorized account context.','unavailable'));continue;}
  const w=[...group].sort((a,b)=>b.location.revision-a.location.revision)[0],home=buildRoleHome(w,'owner',now);sources.push(...home.sources);rows.push(...home.attention);
 }
 for(const expected of expectedSources){
  if(sources.some(s=>s.locationId===expected.locationId))continue;
  const s:RoleHomeSource={locationId:expected.locationId,locationName:expected.locationName,state:expected.state??'missing',asOf:expected.asOf??null,label:expected.reason??'Expected restaurant evidence was not supplied.'};
  sources.push(s);rows.push(gap(s,'expected-source',s.state==='stale'?'Restaurant evidence outdated':'Restaurant evidence unavailable',s.label,'Refresh this authorized restaurant source or review its connection.',s.state==='available'?'missing':s.state));
 }
 if(!sources.length){const s:RoleHomeSource={locationId:'',locationName:'Authorized group',state:'missing',label:'No authorized restaurant workspaces were supplied.'};sources.push(s);rows.push(gap(s,'no-sources','Group evidence missing',s.label,'Connect the reviewed restaurant sources before assessing the group.'));}
 const available=sources.filter(s=>s.state==='available').length;
 return model('owner',`${available} of ${sources.length} supplied or expected locations available`,rows,sources,['The group contains only supplied authorized workspaces and explicitly expected source descriptors. Expected sources grant no access.']);
}
