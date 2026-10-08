import {publicWorkspace} from './domain';
import {operationsManager} from './operations';
import {followupTarget} from './followup-desk';
import {foodWorkflowDestination} from './food-navigation';
import type {RoleHomeAttention,RoleHomeKind,RoleHomeWorkspace} from './role-home';
import {has,type Kind,type RecordOf,type Workspace,type WorkRecord} from './types';

export type RoleHomeDestination={tab:string;mode:'detail'|'issue'|'summary'|'followup'|'food-order';record:WorkRecord};
export class RoleHomeTargetError extends Error{constructor(message:string,public code:'unavailable'|'changed'){super(message)}}
export function parseRoleHomeKind(value:unknown):RoleHomeKind{return ['owner','general-manager','department-manager','frontline'].includes(String(value))?value as RoleHomeKind:'frontline';}
export function authorizedRoleHomeKind(w:Workspace,requested:RoleHomeKind):RoleHomeKind{
 if(has(w.me,'location.manage'))return requested;
 if(requested==='frontline')return 'frontline';
 if(w.me.capabilities.includes('operations.store')&&has(w.me,'tasks.manage'))return 'general-manager';
 return operationsManager(w.me)?'department-manager':'frontline';
}
const detailTabs:Partial<Record<Kind,string>>={shift:'Schedule week',request:'Schedule requests',availability:'Schedule requests',task:'Legacy duties',close:'Legacy duties',handoff:'Legacy duties',standard:'Training',goal:'Training',development:'Training',feedback:'Feedback',order:'Orders',message:'Inbox'};
const followups:Kind[]=['staffidea','guestreview','hirechecklist','hirehandoff','compliance','promotion'];
// Completed assignments stay in the current authorized workspace until archived.
// Keep them separate from outstanding attention, but use the same fresh target gate.
export function completedOwnRoleHomeTasks(workspace:Workspace,now=new Date()):RoleHomeAttention[]{
 const state=(workspace as RoleHomeWorkspace).roleHomeSource?.state;
 if(workspace.me.locationId!==workspace.location.id||state&&state!=='available')return [];
 const w=publicWorkspace({...workspace,records:workspace.records.filter(r=>r.locationId===workspace.location.id)},now.toISOString());
 return w.records.filter((r):r is RecordOf<'task'>=>r.kind==='task'&&r.ownerId===w.me.id&&r.data.kind==='task'&&r.data.phase==='closed').sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id)).map(r=>({
  id:w.location.id+':completed:'+r.id,what:r.data.title,why:'Your assignment was verified. Its original saved history remains available.',person:w.me.name,personId:w.me.id,nextAction:'Review the completed assignment and its saved history.',recordId:r.id,recordKind:r.kind,tab:'Legacy duties',locationId:w.location.id,locationName:w.location.name,area:r.area,priority:'routine',freshness:{state:'recorded',label:'Saved completed assignment.',sourceAt:r.updatedAt},source:{label:'Completed assignment',recordId:r.id,revision:r.revision,businessDate:null},actionable:true,
 }));
}
// Resolve only a fresh authorized projection. A role name is intentionally not
// accepted here: presentation cannot create a target or an action permission.
export function resolveRoleHomeTarget(workspace:Workspace,item:RoleHomeAttention,now=new Date()):RoleHomeDestination{
 const unavailable=()=>{throw new RoleHomeTargetError('This workflow is no longer available in this restaurant and account. Return home and refresh.','unavailable')};
 if(workspace.me.locationId!==workspace.location.id||item.locationId!==workspace.location.id||!item.actionable||!item.recordId||!item.recordKind||item.source.recordId!==item.recordId)return unavailable();
 const metadata=(workspace as RoleHomeWorkspace).roleHomeSource;if(metadata&&metadata.state!=='available')return unavailable();
 const w=publicWorkspace({...workspace,records:workspace.records.filter(r=>r.locationId===workspace.location.id)},now.toISOString());
 const record=w.records.find(r=>r.id===item.recordId&&r.kind===item.recordKind&&r.locationId===workspace.location.id);if(!record)return unavailable();
 if(record.revision!==item.source.revision)throw new RoleHomeTargetError('This record changed after the home was loaded. Return home, refresh, and open its latest card.','changed');
 let tab=detailTabs[record.kind],mode:RoleHomeDestination['mode']='detail';
 if(record.kind==='managerlog'||record.kind==='shiftentry'){
  if(!operationsManager(w.me,record.area))return unavailable();tab='Manager Log';mode=record.kind==='managerlog'?'issue':'summary';
 }else if(followups.includes(record.kind)){
  const target=followupTarget(w,now.toISOString(),record.id);if(!target||target.kind!==record.kind)return unavailable();tab=target.tab;mode='followup';
 }else if(record.kind==='order'&&record.data.food){
  if(foodWorkflowDestination('Purchasing review',w.me)!=='purchasing')return unavailable();tab='Purchasing review';mode='food-order';
 }
 const dishTarget=record.kind==='task'&&record.ownerId===w.me.id||record.kind==='standard'&&record.data.status==='approved'&&record.data.position==='Dishwasher';
 if(!tab||item.tab!==tab||w.me.position==='Dishwasher'&&!dishTarget&&!['Schedule week','Schedule requests','Inbox'].includes(tab))return unavailable();
 return {tab,mode,record};
}
