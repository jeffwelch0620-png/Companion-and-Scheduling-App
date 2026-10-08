import {followupReader} from './followup-desk';
import {ideaParticipant} from './staff-ideas';
import { has, type Member, type Workspace, type RecordOf } from './types';
import { visible } from './domain';
import { localDate } from './local-time';
import { operationsManager, previousShift } from './operations';
import {hireCoordinator,hireScheduler} from './hire-handoff';
import {maintenanceSchedule} from './maintenance';
import {foodManager} from './food';
import {foodPurchaser,foodWorkflowDestination} from './food-navigation';

// The dashboard consumes the same authorized records as the working screens.
// Keep this filtering even when a caller already received a scoped workspace.
export function operationsHome(w:Workspace, now:string) {
  const day=localDate(now,w.location.timezone);
  const records=w.records.filter(r=>r.locationId===w.location.id&&visible(r,w.me,w));
  const scoped={...w,records};
  const issues=records.filter((r):r is RecordOf<'managerlog'>=>r.kind==='managerlog'&&r.data.status!=='resolved')
    .sort((a,b)=>Number(b.data.priority==='urgent')-Number(a.data.priority==='urgent')||(a.data.due??'9999').localeCompare(b.data.due??'9999')||a.id.localeCompare(b.id));
  const summaries=records.filter((r):r is RecordOf<'shiftentry'>=>r.kind==='shiftentry'&&r.data.businessDate===day);
  const areas=has(w.me,'location.manage')
    ? [...new Set([...w.members.filter(m=>!has(m,'location.manage')&&!has(m,'operations.store')).map(m=>m.area),...records.filter(r=>r.kind==='shiftentry').map(r=>r.area)])].filter(a=>['FOH','BOH','combined','production'].includes(a))
    : [...new Set([w.me.area,'FOH','BOH'])].filter(area=>['FOH','BOH','combined','production'].includes(area)&&operationsManager(w.me,area));
  const meetings=records.filter((r):r is RecordOf<'meeting'>=>r.kind==='meeting'&&r.data.status==='active');
  return {day,issues,summaries,meetings,
    maintenance:records.filter((r):r is RecordOf<'maintenance'>=>r.kind==='maintenance'&&r.data.status==='active').map(r=>({record:r,...maintenanceSchedule(r.data,day)})).filter(s=>s.state!=='upcoming').sort((a,b)=>a.due.localeCompare(b.due)||a.record.id.localeCompare(b.record.id)),
    urgent:issues.filter(r=>r.data.priority==='urgent'),
    overdue:issues.filter(r=>r.data.due&&Date.parse(r.data.due)<Date.parse(now)),
    unaccepted:issues.filter(r=>!r.data.acceptedBy),
    repairs:issues.filter(r=>r.data.category==='Maintenance'),
    drafts:summaries.filter(r=>r.data.status==='draft'),
    handoffs:areas.map(area=>({area,record:previousShift(scoped,day,area)})),
    shifts:records.filter((r):r is RecordOf<'shift'>=>r.kind==='shift'&&r.data.published&&!r.data.cancelled&&localDate(r.data.start,w.location.timezone)===day),
    followups:meetings.flatMap(r=>r.data.actions.filter(a=>!a.doneAt).map(a=>({...a,meetingId:r.id}))),
  };
}

export type OperationsModule={id:string;group:string;title:string;detail:string;tab?:string;access:'manager'|'owner'|'training'|'people'|'schedule'|'food'|'purchasing';pending?:string};
// Navigation adapted from Jay's Sep 28 Main.dc.html SECTIONS. A source's
// BUILT flag means prototype markup exists; only mounted modules get a tab.
export const operationsModules:OperationsModule[]=[
  {id:'overview',group:'Home',title:'Daily brief',detail:'Handoffs, unfinished work and today’s team.',tab:'Operations home',access:'manager'},
  {id:'followup',group:'Home',title:'Follow-up desk',detail:'Recorded next steps across People, guest, source and promotion work.',tab:'Follow-up desk',access:'manager'},
  {id:'log',group:'Home',title:'Manager Log / Red Book',detail:'Shift summaries, responsibility and resolution history.',tab:'Manager Log',access:'manager'},
  {id:'meetings',group:'Home',title:'Manager one-on-ones',detail:'Private conversations and carried-forward actions.',tab:'Manager one-on-ones',access:'manager'},
  {id:'schedule',group:'Labor',title:'Schedule',detail:'Build the week, review coverage and handle changes.',tab:'Schedule week',access:'schedule'},
  {id:'requests',group:'Labor',title:'Time off and availability',detail:'Review requests with the existing schedule.',tab:'Schedule requests',access:'schedule'},
  {id:'hiring',group:'Labor',title:'Hiring and open positions',detail:'Staffing needs, owner review and approved internal openings.',access:'manager',tab:'Hiring and open positions'},
  {id:'inventory',group:'Food',title:'Food inventory',detail:'Supplier packs, physical counts and reviewed food imports.',tab:'Food inventory',access:'food'},
  {id:'invoice-lines',group:'Food',title:'Invoice line review',detail:'Choose an item to record a checked supplier invoice line and normalize its units.',tab:'Food inventory',access:'purchasing'},
  {id:'invoice-matching',group:'Food',title:'Invoice CSV matching',detail:'Match checked rows or reopen saved invoice files.',tab:'Invoice CSV matching',access:'purchasing'},
  {id:'deliveries',group:'Food',title:'Delivery checks',detail:'Invoice checks, shortages, extra goods and actual pickups.',tab:'Delivery checks',access:'food'},
  {id:'supplier-returns',group:'Food',title:'Supplier returns',detail:'Recorded pickups and issued-credit quantity matching.',tab:'Supplier returns',access:'food'},
  {id:'supplier-issues',group:'Food',title:'Supplier issues',detail:'Internal follow-up and checked claim evidence.',tab:'Supplier issues',access:'food'},
  {id:'restaurant-transfers',group:'Food',title:'Restaurant transfers',detail:'Recorded parcels, destination checks and trip manifests.',tab:'Restaurant transfers',access:'food'},
  {id:'waste-report',group:'Food',title:'Waste and estimated costs',detail:'Dated waste history with recorded cost evidence.',tab:'Waste report',access:'food'},
  {id:'purchasing',group:'Food',title:'Purchasing review',detail:'Build requests from counted Food items, submit for a different reviewer, and keep the approval history. Supplier placement is separate.',access:'food',tab:'Purchasing review'},
  {id:'supplier-submission',group:'Food',title:'Supplier submission connection',detail:'External supplier placement after a separately authorized purchasing decision.',access:'food',pending:'Internal purchasing approval does not send or place a supplier order. Supplier submission is not connected here.'},
  {id:'prep',group:'Food',title:'Daily and bulk prep',detail:'Reviewed prep definitions, dated evening counts, next-day plans and completion records.',access:'food',tab:'Prep production'},
  {id:'waste',group:'Food',title:'Waste entries',detail:'Choose a food item to record discarded quantities, reasons and corrections.',tab:'Food inventory',access:'food'},
  {id:'transfers',group:'Food',title:'Cross-restaurant production connection',detail:'Combine restaurant prep needs into a shared commissary production request.',access:'manager',pending:'Daily and bulk prep are available within each restaurant. Automatic consolidation across restaurants remains separate; use Restaurant transfers for recorded movement.'},
  {id:'recipes',group:'Food',title:'Recipes and build cards',detail:'Imported menu and prep recipes, portions, yields and cost gaps.',tab:'Food recipes',access:'food'},
  {id:'sales',group:'Toast',title:'Sales and live labor summary',detail:'Toast remains the system for sales, clock-ins and live labor.',access:'manager',pending:'A live Toast summary is not connected here. Continue using Toast.'},
  {id:'temps',group:'Safety and compliance',title:'Temperature logs',detail:'Line checks, temperatures and corrective action.',access:'manager',pending:'Temperature capture and alert delivery are not available yet.'},
  {id:'permits',group:'Safety and compliance',title:'Inspections and permits',detail:'Inspection history and renewal dates.',access:'owner',tab:'Inspections and permits'},
  {id:'incidents',group:'Safety and compliance',title:'Incident reports',detail:'Record safety events with appropriate restricted access.',access:'manager',tab:'Incident reports'},
  {id:'duties',group:'Operations',title:'Existing shift duties',detail:'Follow through on previously assigned opening and closing work.',tab:'Legacy duties',access:'manager'},
  {id:'guides',group:'Operations',title:'Procedures and guides',detail:'Review restaurant instructions and prepare training content.',tab:'Standards',access:'training'},
  {id:'training',group:'Operations',title:'Station training',detail:'Learning, practice and manager review.',tab:'Training',access:'manager'},
  {id:'ideas',group:'Operations',title:'Staff ideas',detail:'Named suggestions, responsible review and response history.',access:'manager',tab:'Staff ideas'},
  {id:'repairs',group:'Maintenance',title:'Repair requests',detail:'The same repair issues and history as the Manager Log.',tab:'Repairs',access:'manager'},
  {id:'vendors',group:'Maintenance',title:'Who to call',detail:'Checked service contacts and repair call history.',access:'manager',tab:'Who to call'},
  {id:'maintenance',group:'Maintenance',title:'Scheduled maintenance',detail:'Recurring cleaning and equipment upkeep.',access:'manager',tab:'Scheduled maintenance'},
  {id:'catering',group:'Guests',title:'Catering and large orders',detail:'Owner-reviewed event briefs, preparation notes and staffing requirements.',access:'manager',tab:'Catering calendar'},
  {id:'reviews',group:'Guests',title:'Guest reviews',detail:'Checked source feedback, manager acknowledgment and owner follow-up.',tab:'Guest reviews',access:'manager'},
  {id:'marketing',group:'Marketing',title:'Social and Google',detail:'Store listings, updates and marketing activity.',access:'manager',pending:'Marketing publishing and account connections are not available here yet.'},
  {id:'promos',group:'Marketing',title:'Promotions',detail:'Dated offers, owner approval, staff briefings and source-backed outcomes.',tab:'Promotions',access:'manager'},
  {id:'checkins',group:'People',title:'Shift check-ins',detail:'Employee shift responses and private owner / GM review.',tab:'Shift check-ins',access:'people'},
  {id:'people',group:'People',title:'People and stations',detail:'Team profiles, station skills and development.',tab:'Team',access:'people'},
  {id:'access',group:'People',title:'Employee sign-in',detail:'Review access, enable an employee and give a setup code.',tab:'Employee access',access:'owner'},
  {id:'shout',group:'People',title:'Recognition',detail:'Named thank-yous, owner review and the restaurant board.',access:'manager',tab:'Recognition'},
  {id:'onboarding',group:'People',title:'First-shift handoff',detail:'Assign a scheduler, accept responsibility and confirm a published first shift.',tab:'First-shift handoff',access:'people'},
  {id:'hire-documents',group:'People',title:'Onboarding checklist',detail:'Entered requirements, checked status, completion evidence and correction history.',access:'people',tab:'Onboarding checklist'},
  {id:'hire-review',group:'People',title:'Onboarding review',detail:'Review one hire’s checklist, sign-in evidence, first shift and station assessments.',access:'people',tab:'Onboarding review'},
  {id:'gaps',group:'Owner tools',title:'Build progress and decisions',detail:'Source decisions and remaining connections.',tab:'Build progress',access:'owner'},
  {id:'setup',group:'Owner tools',title:'Restaurant setup',detail:'Access, responsibilities and existing connections.',tab:'Restaurant tools',access:'owner'},
];
export function canOpenModule(me:Member,module:OperationsModule){
  if(module.id==='prep'||module.id==='purchasing')return !!foodWorkflowDestination(module.tab??'',me);
  if(module.id==='hiring')return !me.scheduleOnly&&operationsManager(me);
  if(module.id==='followup')return followupReader(me);
  if(module.id==='ideas'||module.id==='shout')return ideaParticipant(me);
  if(me.position==='Dishwasher')return false;
  if(module.id==='hire-documents'||module.id==='hire-review')return hireCoordinator(me);
  if(module.id==='onboarding')return hireCoordinator(me)||hireScheduler(me);
  if(module.access==='food')return foodManager(me);
  if(module.access==='purchasing')return foodPurchaser(me);
  if(module.access==='owner')return has(me,'location.manage');
  if(module.access==='manager')return operationsManager(me);
  if(module.access==='training')return has(me,'tasks.manage')||has(me,'standards.approve');
  if(module.access==='people')return operationsManager(me)||has(me,'people.manage');
  return operationsManager(me)||has(me,'schedule.manage')||has(me,'schedule.publish')||has(me,'schedule.change');
}
export function availableModules(me:Member){return operationsModules.filter(m=>canOpenModule(me,m)&&(m.tab||has(me,'location.manage')));}
