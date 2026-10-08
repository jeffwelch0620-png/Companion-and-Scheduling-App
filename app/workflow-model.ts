import { people, initialTeamMessages, type Person, type TeamMessage } from './demo-data';

export const DEMO_DAY='2026-09-11';
export const DAYS=['2026-09-07','2026-09-08','2026-09-09','2026-09-10',DEMO_DAY,'2026-09-12','2026-09-13'];
export type Phase='open'|'correction'|'verification'|'acceptance'|'closed';
export type Event={id:string; title:string; detail:string; area:Person['area']; station:string; ownerId:string; verifierId:string; incomingId?:string; phase:Phase; kind:'issue'|'handoff'|'close'; due:string; correction:string; history:{actor:string;action:string;at:string}[]; taskKey?:string};
export type TaskRecord={answers:string[];note:string;photo?:string;submitted:boolean};
export type Shift={id:string;personId:string;date:string;start:string;end:string;position:string};
export type ChangeRequest={id:string;personId:string;type:'Time off'|'Availability'|'Shift swap';date:string;note:string;replacementId:string;status:'pending'|'approved'|'declined';decision?:string};
export type OrderLine={id:string;name:string;qty:number;unit:string;note:string};
export type OrderRequest={id:string;personId:string;location:string;status:'draft'|'review'|'returned'|'approved';revision:number;lines:OrderLine[];note:string;reviewerId?:string;reviewNote?:string;approvedRevision?:number};
export type Feedback={id:string;personId:string;text:string;share:boolean;status:'private'|'submitted'|'follow-up'|'closed';response:string;due:string};
export type State={version:2;threads?:Record<string,{from:'ai'|'me';text:string}[]>;tasks:Record<string,TaskRecord>;events:Event[];shifts:Shift[];requests:ChangeRequest[];messages:TeamMessage[];orders:OrderRequest[];feedback:Feedback[];goals:Record<string,{text:string;level:number;trainer:boolean;note:string}>;mappings:Record<string,string>};
export function personName(id:string){return people.find(p=>p.id===id)?.name??id}
export function isLeader(p:Person){return p.tier!=='Team Member'}
export function isAdmin(p:Person){return p.tier==='GM'||p.tier==='Owner'}
export function inScope(viewer:Person,subject:Person){return isAdmin(viewer)||viewer.id===subject.id||viewer.tier==='Shift Leader'||(viewer.tier==='Department Manager'&&subject.area===viewer.area)}
export function eventVisible(e:Event,p:Person){return e.ownerId===p.id||e.incomingId===p.id||e.verifierId===p.id||isAdmin(p)||(p.tier==='Department Manager'&&e.area===p.area)}
export function canOrder(p:Person){return ['renee','walter','tim','owner-limited'].includes(p.id)}
export function canPurchase(p:Person){return ['tim','owner-limited'].includes(p.id)}
export function taskKey(p:Person,id:string){return `${p.id}:${DEMO_DAY}:${id}`}
export function canSeeMessage(m:TeamMessage,p:Person){
  if(m.from===p.name)return true;
  if(m.targetIds?.length)return m.targetIds.includes(p.id);
  if(m.leadershipOnly)return isLeader(p);
  if(m.targetArea)return m.targetArea===p.area||isAdmin(p)||(p.tier==='Shift Leader'&&p.area==='Bridge');
  if(m.targetPosition)return m.targetPosition===p.position||isAdmin(p)||(p.tier==='Department Manager'&&people.some(x=>x.position===m.targetPosition&&x.area===p.area));
  return m.kind==='Announcement'||m.kind==='Shift';
}
export function seedState():State {
  const event=(id:string,title:string,detail:string,station:string,ownerId:string,verifierId:string,kind:Event['kind']='issue'):Event=>({id,title,detail,station,ownerId,verifierId,kind,phase:kind==='handoff'?'verification':'open',area:'BOH',due:'Before handoff',correction:'',history:[],...(kind==='handoff'?{incomingId:'sam'}:{})});
  return {version:2,tasks:{},events:[event('prep','Abandoned prep ware','Completed sauce prep was left at Dish before Maya arrived.','Pizza/Oven','noah','renee'),event('fry','Handoff verification','One disclosed low-stock item needs a decision before the incoming shift accepts.','Fry','lena','jordan','handoff'),event('sandwich','Three close corrections','Repeated closing standard: coach, correct, and check the next handoff.','Sandwich','marcus','renee')],shifts:people.filter(p=>p.tier==='Team Member'||p.tier==='Shift Leader'||p.tier==='Department Manager').flatMap(p=>DAYS.filter((_,i)=>i!==1&&i!==5).map(date=>({id:`${p.id}:${date}`,personId:p.id,date,start:p.shift.startsWith('10')?'10:00':p.shift.startsWith('11')?'11:00':p.shift.startsWith('3')?'15:00':'16:00',end:p.shift.endsWith('4:00 PM')?'16:00':p.shift.includes('9:00')?'21:00':'23:00',position:p.position}))),requests:[],messages:initialTeamMessages,orders:[],feedback:[],goals:{},mappings:{}};
}
export function shiftLabel(s:Shift){const f=(v:string)=>{const [h,m]=v.split(':').map(Number);return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`};return `${f(s.start)}–${f(s.end)}`}
export function coverage(state:State,date=DEMO_DAY){return state.shifts.some(s=>s.date===date&&s.position==='Back Window'&&s.start<='16:00'&&s.end>='23:00')}
export function transition(e:Event,actor:Person,action:'assign'|'ready'|'pass'|'accept'|'dispute',input:{note:string;ownerId?:string;incomingId?:string;due?:string}):Event{
  const note=input.note.trim();if(!note)throw Error('Add the action or evidence before saving.');
  const history=[...e.history,{actor:actor.id,action:`${action}: ${note}`,at:new Date().toISOString()}];
  const manager=isLeader(actor)&&eventVisible(e,actor);
  if(action==='assign'&&input.ownerId){const owner=people.find(p=>p.id===input.ownerId);if(!owner||!inScope(actor,owner)||owner.tier==='Owner')throw Error('Choose an operational owner within your scope.');}
  if(action==='assign'&&manager&&e.phase!=='closed')return {...e,phase:'correction',ownerId:input.ownerId||e.ownerId,correction:note,due:input.due||e.due,history};
  if(action==='ready'&&e.ownerId===actor.id&&['open','correction'].includes(e.phase))return {...e,phase:'verification',history};
  if(action==='pass'&&manager&&actor.id!==e.ownerId&&e.phase==='verification'){
    const incomingId=input.incomingId||e.incomingId;
    if(e.kind==='handoff'&&(!incomingId||incomingId===e.ownerId))throw Error('Choose the incoming employee before passing the handoff.');
    return {...e,phase:e.kind==='handoff'?'acceptance':'closed',incomingId,history};
  }
  if(action==='accept'&&e.incomingId===actor.id&&e.phase==='acceptance')return {...e,phase:'closed',history};
  if(action==='dispute'&&e.incomingId===actor.id&&e.phase==='acceptance')return {...e,phase:'correction',correction:note,history};
  throw Error('This action is not available at the current step or for this person.');
}
export function reviewSchedule(state:State,request:ChangeRequest,actor:Person,approve:boolean,decision:string):State{
  const target=people.find(p=>p.id===request.personId);
  if(!target||!isLeader(actor)||!inScope(actor,target)||actor.id===request.personId||request.status!=='pending')throw Error('A different authorized manager must review this request.');
  if(!decision.trim())throw Error('Add a review note.');
  let shifts=state.shifts;
  if(approve&&request.type==='Time off')shifts=shifts.filter(s=>!(s.personId===request.personId&&s.date===request.date));
  if(approve&&request.type==='Shift swap'){
    const replacement=people.find(p=>p.id===request.replacementId);
    const original=shifts.find(s=>s.personId===request.personId&&s.date===request.date);
    if(!original||!replacement||!(replacement.position===original.position||replacement.position==='Float'))throw Error('Choose an employee qualified for this assignment.');
    if(shifts.some(s=>s.personId===replacement.id&&s.date===request.date&&s.start<original.end&&s.end>original.start))throw Error('The replacement already has an overlapping shift.');
    shifts=shifts.map(s=>s.id===original.id?{...s,personId:replacement.id}:s);
  }
  const messages:TeamMessage[]=[{id:crypto.randomUUID(),kind:'Direct',from:actor.name,fromRole:actor.tier,audience:target.name,targetIds:[target.id,actor.id],subject:`${request.type} ${approve?'approved':'declined'}`,body:`${request.date}: ${decision}`,time:'Now',acknowledgedBy:[],replies:[]},...state.messages];
  return {...state,shifts,messages,requests:state.requests.map(r=>r.id===request.id?{...r,status:approve?'approved':'declined',decision}:r)};
}
export function validateOrder(order:OrderRequest){if(!order.lines.length||order.lines.some(l=>!l.name.trim()||!Number.isFinite(l.qty)||l.qty<=0||!l.unit.trim()))throw Error('Every item needs a name, a positive quantity, and a unit.');}
export function reviewOrder(order:OrderRequest,actor:Person,approve:boolean,note:string):OrderRequest{if(!canPurchase(actor)||order.status!=='review')throw Error('Only Rudd or Tim can review a submitted request.');validateOrder(order);if(!approve&&!note.trim())throw Error('Explain the requested changes.');return {...order,status:approve?'approved':'returned',reviewerId:actor.id,reviewNote:note,approvedRevision:approve?order.revision:undefined};}
export function parseState(raw:string):State{const x=JSON.parse(raw);if(x?.version!==2||!Array.isArray(x.events)||!Array.isArray(x.shifts)||!Array.isArray(x.messages)||!Array.isArray(x.requests)||!Array.isArray(x.orders)||!Array.isArray(x.feedback)||!x.tasks||!x.goals||!x.mappings)throw Error('Saved review data cannot be read.');x.shifts=x.shifts.map((s:Shift)=>s.end<=s.start&&people.find(p=>p.id===s.personId)?.shift.endsWith('Close')?{...s,end:'23:00'}:s);return x as State;}
