// Local role-home review only. These generated examples never enter a database,
// change access, or represent a real restaurant's current operating condition.
import type {Capability,Member,RecordOf,Workspace,WorkRecord} from '../shared/types';
import {localDate,localInstant,nextDate} from '../shared/local-time';
import {gmOperatingSetup} from '../shared/gm-operating-setup';

export const roleReviewStores=[{id:'berts',name:"Bert's",short:'B',type:'Restaurant'},{id:'rudds',name:"Rudd's",short:'R',type:'Restaurant'},{id:'papa',name:"Papa Leone's",short:'P',type:'Restaurant'},{id:'comm',name:'Commissary',short:'C',type:'Production'}] as const;
export type RoleReviewStore=typeof roleReviewStores[number]['id'];
export type RoleReviewPosition='Dishwasher'|'Cook'|'Server';
export type RoleReviewWorkspace=Workspace&{roleHomeSource?:{state:'available'|'missing'|'unavailable'|'stale';label?:string;asOf?:string|null;operatingAreas?:('FOH'|'BOH'|'combined'|'production')[]}};
export function createRoleReviewFixtures(now:string):RoleReviewWorkspace[]{
 const timezone='America/New_York',day=localDate(now,timezone),recent=new Date(Date.parse(now)-30*60000).toISOString(),older=new Date(Date.parse(now)-3*86400000).toISOString();
 return roleReviewStores.map(store=>{
  const member=(key:string,name:string,area:string,position:string,capabilities:Capability[]):Member=>({id:`role-review-${store.id}-${key}`,locationId:store.id,name,area,position,capabilities,qualifications:[position]});
  const owner=member('owner','Sample owner','combined','Owner',['location.manage','tasks.manage','schedule.manage']);
  const gmSetup=gmOperatingSetup(),gm=member('gm','Sample general manager',gmSetup.area,gmSetup.position,gmSetup.capabilities);
  const boh=member('boh','Sample kitchen manager',store.id==='comm'?'production':'BOH','Kitchen manager',['tasks.manage','schedule.manage']);
  const foh=member('foh','Sample service manager','FOH','Service manager',['tasks.manage','schedule.manage']);
  const dish=member('dish','Sample Alex','BOH','Dishwasher',[]),cook=member('cook','Sample Casey','BOH','Cook',[]),server=member('server','Sample Jordan','FOH','Server',[]);
  const members=[owner,gm,boh,foh,dish,cook,server],records:WorkRecord[]=[];
  const issue=(key:string,title:string,area:string,assigned:Member,at:string,priority:'routine'|'urgent',detail:string):RecordOf<'managerlog'>=>({id:`role-review-${store.id}-${key}`,locationId:store.id,kind:'managerlog',ownerId:assigned.id,area,revision:1,updatedAt:at,data:{title,detail,category:key==='repair'?'Maintenance':'Shift handoff',priority,due:localInstant(day,'18:00',timezone),status:'open',acceptedBy:'',resolution:'',history:[{actorId:assigned.id,action:'created',at,note:'Fictional example for role-home review; not an operating report.'}]}});
  if(store.id==='berts'){
   records.push(issue('repair','Dish rack wheel needs repair','BOH',boh,recent,'urgent','Sample issue: the kitchen manager needs to confirm the repair plan and update the team.'));
   records.push(issue('handoff','Opening handoff needs confirmation','FOH',foh,recent,'routine','Sample issue: the service manager needs to acknowledge the previous shift’s note.'));
  }else if(store.id==='rudds')records.push(issue('repair','Oven service follow-up still open','BOH',boh,older,'routine','Historical sample: the last recorded update was three days ago. Current status has not been confirmed.'));
  else if(store.id==='papa')records.push(issue('handoff','Next shift coverage needs confirmation','FOH',foh,recent,'routine','Sample issue: confirm the responsible person and record the coverage decision.'));
  for(const area of store.id==='comm'?['production']:['FOH','BOH']){
   const assigned=area==='FOH'?foh:boh;
   // Bert's BOH summary is intentionally absent; a blank cannot mean ready.
   if(store.id==='comm'||store.id==='berts'&&area==='BOH')continue;
   const historicalDay=nextDate(day,store.id==='rudds'?-3:-1),at=localInstant(historicalDay,'22:00',timezone);
   records.push({id:`role-review-${store.id}-${area}-handoff`,locationId:store.id,kind:'shiftentry',ownerId:assigned.id,area,revision:1,updatedAt:at,data:{title:`${area} closing handoff`,businessDate:historicalDay,department:area,shift:'closing',status:'submitted',readiness:'not-assessed',summary:'Fictional closing summary for the role-home review.',tomorrowNote:area==='FOH'?'Check the opening handoff with the next manager.':'Confirm the next prep handoff with the kitchen manager.',issueIds:[],submittedAt:at,history:[{actorId:assigned.id,action:'submitted',at,note:'Fictional historical handoff.'}],versions:[]}});
  }
  for(const person of [dish,cook,server]){
   const manager=person.area==='FOH'?foh:boh,start=localInstant(day,'16:00',timezone),end=localInstant(day,'23:00',timezone);
   records.push({id:`role-review-${store.id}-${person.position}-shift`,locationId:store.id,kind:'shift',ownerId:person.id,area:person.area,revision:1,updatedAt:recent,data:{personId:person.id,position:person.position,start,end,published:true,cancelled:false}});
   records.push({id:`role-review-${store.id}-${person.position}-message`,locationId:store.id,kind:'message',ownerId:manager.id,area:person.area,revision:1,updatedAt:recent,data:{title:person.position==='Dishwasher'?'Your dish area handoff':person.position==='Cook'?'Your prep handoff':'Your service handoff',body:person.position==='Dishwasher'?'Fictional note: check in with the kitchen manager about the rack repair before starting your assigned work. Your update helps the next person.':'Fictional note: check your assigned work with the department manager and flag anything missing.',recipients:[person.id],readBy:[],replies:[]}});
   if(person.position!=='Dishwasher')records.push({id:`role-review-${store.id}-${person.position}-task`,locationId:store.id,kind:'task',ownerId:person.id,area:person.area,revision:1,updatedAt:recent,data:{title:person.position==='Cook'?'Confirm your prep handoff':'Review your section handoff',detail:'Fictional assigned task for this position only.',kind:'task',phase:'open',due:end,history:[{actorId:manager.id,action:'created',at:recent,note:'Fictional position assignment.'}]}});
  }
  return {location:{id:store.id,name:store.name,timezone,revision:1},me:owner,members,records,...(store.id==='comm'?{roleHomeSource:{state:'unavailable' as const,operatingAreas:['production'] as const,label:'Fictional example: the commissary handoff has not been supplied.'}}:store.id==='rudds'?{roleHomeSource:{state:'stale' as const,operatingAreas:['FOH','BOH'] as const,asOf:older,label:'Fictional example: the last supplied source is three days old. Current operating status is unverified.'}}:{roleHomeSource:{state:'available' as const,operatingAreas:['FOH','BOH'] as const,asOf:now,label:'Fictional saved records only; no live feed.'}})};
 });
}

