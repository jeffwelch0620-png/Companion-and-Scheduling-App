import { applyCommand } from './domain';
import { handleRecordHistory } from './history-service';
import { handleWorkspace, boundedJson } from './service';
import {handleFood} from './food-service';
import { handleAccess } from './access-service';
import { handleToast } from './toast-service';
import { handleReminders } from './reminder-service';
import { handleCompanionChat } from './companion-chat';
import { normalizeToastRoster } from './toast-roster';
import { localDate, localInstant, nextDate } from './local-time';
import { AppError, object, requireThat } from './validation';
import type { Member, Workspace, WorkRecord, Capability } from './types';

const locationId='owner-review',prefix='owner-review-';
export const reviewRoles=['employee','senior','manager','replacement','dish','gm','opener','admin'] as const;
export type ReviewRole=typeof reviewRoles[number];
const profiles:[ReviewRole,string,string,Capability[]][]=[
  ['employee','Sample employee','Server',[]],['senior','Sample senior','Senior server',['close.verify','schedule.change']],
  ['manager','Sample manager','Manager',['schedule.manage','schedule.publish','schedule.change','close.confirm','standards.approve','tasks.manage','people.manage','orders.request','orders.review']],
  ['replacement','Sample replacement','Server',[]],['dish','Sample dishwasher','Dishwasher',[]],
  ['gm','Sample GM','General manager',['people.manage','people.approve','operations.escalation']],
  ['opener','Sample opening manager','Opening manager',['tasks.manage','people.manage','schedule.change']],['admin','Sample administrator','Administrator',['location.manage']],
];
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff'}});

export async function seedOwnerReview(binding:D1Database,at=new Date().toISOString()) {
  const db=binding.withSession('first-primary');
  if(await db.prepare('SELECT id FROM locations WHERE id=?').bind(locationId).first())return;
  const timezone='America/New_York',today=localDate(at,timezone);
  const members:Member[]=profiles.map(([role,name,position,capabilities])=>({id:prefix+role,locationId,name,position,area:role==='dish'?'BOH':'FOH',capabilities,qualifications:[position]}));
  let w:Workspace={location:{id:locationId,name:'Owner review · fictional team',timezone,revision:0},me:members.find(m=>m.id===prefix+'manager')!,members,records:[]};
  const command=(action:string,input:Record<string,unknown>,record?:WorkRecord)=>{
    const changes=applyCommand(w,{requestId:crypto.randomUUID(),locationId,action,input,...(record?{recordId:record.id,expectedRevision:record.revision}:{})},at);
    const ids=new Set(changes.map(r=>r.id));w={...w,records:[...w.records.filter(r=>!ids.has(r.id)),...changes]};return changes.find(r=>r.kind===action.split('.')[0])!;
  };
  const period={start:localInstant(today,'16:00',timezone),end:localInstant(today,'23:00',timezone)};
  command('leadership.assign',{personId:prefix+'manager',area:'FOH',...period,note:'Fictional closing leadership for owner review.'});
  command('leadership.assign',{personId:prefix+'opener',area:'FOH',start:localInstant(nextDate(today),'08:00',timezone),end:localInstant(nextDate(today),'16:00',timezone),note:'Fictional opening leadership for owner review.'});
  let standard=command('standard.save',{title:'Sample Server Station close',zone:'Sample Server Station',position:'Server',version:1,criteria:['Sample counter is ready','Sample stock is counted'],verification:'senior-then-manager',source:'Fictional software review criteria. Not an approved restaurant standard.'});
  standard=command('standard.approve',{validated:true,note:'Fictional review fixture only.'},standard);
  let shift=command('shift.save',{personId:prefix+'employee',position:'Server',...period});
  command('close.assign',{shiftId:shift.id,standardId:standard.id,managerId:prefix+'manager',verifierId:prefix+'senior',due:period.end});
  shift=command('shift.publish',{},shift);
  for(const offset of [1,2])command('shift.save',{personId:prefix+'employee',position:'Server',start:localInstant(nextDate(today,offset),'16:00',timezone),end:localInstant(nextDate(today,offset),'22:00',timezone),note:'Sample weekly draft for owner review.'});
  command('development.create',{ownerId:prefix+'employee',managerId:prefix+'manager',approverId:prefix+'gm',hireDate:nextDate(today,-60),dueDate:nextDate(today,-8),validated:true,stations:[{name:'Sample service station',definition:'Fictional criteria for trying the review workflow.',source:'Owner review fixture; no real employee evaluation.'}]});
  command('order.save',{lines:[{name:'Black 9 × 9 takeout containers',productId:'SAMPLE-ONLY',quantity:2,unit:'cases',note:'Review example: preserve black color preference. No supplier is connected.'}],note:'Fictional internal request; not a supplier order.'});
  const roster=normalizeToastRoster([{guid:'sample-toast-cook',firstName:'Sample',lastName:'Cook',email:'sample-cook@example.test',jobReferences:[{guid:'sample-job-cook'},{guid:'sample-job-dish'}]},{guid:'sample-toast-review',firstName:'Sample',lastName:'Needs Review',jobReferences:[]}],[{guid:'sample-job-cook',title:'Cook'},{guid:'sample-job-dish',title:'Dishwasher'}],'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',at);
  // Initialization is all-or-nothing and idempotent across simultaneous visitors.
  const token=crypto.randomUUID(),gate='EXISTS (SELECT 1 FROM locations WHERE id=? AND last_command=?)';
  const statements=[db.prepare('INSERT INTO locations(id,name,timezone,revision,last_command) VALUES(?,?,?,0,?) ON CONFLICT(id) DO NOTHING').bind(locationId,w.location.name,timezone,token)];
  for(const m of members)statements.push(db.prepare(`INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) SELECT ?,?,?,?,?,?,?,?,? WHERE ${gate}`).bind(m.id,m.id+'@example.test','review-identity-'+m.id,locationId,m.name,m.area,m.position,JSON.stringify(m.capabilities),JSON.stringify(m.qualifications),locationId,token));
  for(const r of w.records)statements.push(db.prepare(`INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE ${gate}`).bind(r.id,locationId,r.kind,r.ownerId,r.area,r.revision,JSON.stringify(r.data),at,locationId,token));
  statements.push(db.prepare(`INSERT INTO toast_rosters(location_id,restaurant_guid,data,retrieved_at,requested_by) SELECT ?,?,?,?,? WHERE ${gate}`).bind(locationId,roster.restaurantGuid,JSON.stringify(roster),at,prefix+'admin',locationId,token));
  await db.batch(statements);
}

export async function handleOwnerReview(request:Request,binding?:D1Database,bindings?:unknown):Promise<Response> {
  try {
    const config=bindings&&typeof bindings==='object'?bindings as Record<string,unknown>:{};
    const owner=typeof config.JMAX_REVIEW_OWNER_EMAIL==='string'?config.JMAX_REVIEW_OWNER_EMAIL.trim().toLowerCase():'';
    requireThat(owner,'Owner review has not been enabled.',404);
    // The Sites sign-in proxy supplies this verified identity. No role selected
    // in the browser is trusted until the real owner's identity has passed.
    const email=request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
    requireThat(email,'Sign in to open the owner review.',401);requireThat(email===owner,'This review area is restricted to its owner.',403);
    requireThat(binding,'Review storage has not been connected.',503);
    requireThat(request.method==='GET'||request.method==='POST','Method not allowed.',405);
    const url=new URL(request.url),parts=url.pathname.split('/'),role=parts[3] as ReviewRole,route=parts.slice(4).join('/');
    requireThat(reviewRoles.includes(role)&&['workspace','access','integrations/toast','reminders','companion','history','food'].includes(route),'Review route not found.',404);
    let body:Record<string,unknown>|undefined;
    if(request.method==='POST') {
      requireThat(request.headers.get('Origin')===url.origin&&request.headers.get('Sec-Fetch-Site')!=='cross-site','Open this action from the owner review.',403);
      requireThat(request.headers.get('Content-Type')?.split(';')[0]==='application/json','Use a JSON request.',415);
      body=object(await boundedJson(request.body,128000));
    }
    for(const requestedLocation of [body?.locationId,url.searchParams.get('locationId')])requireThat(requestedLocation==null||requestedLocation===locationId,'The owner review cannot access a real restaurant.',403);
    if(route==='access'&&body&&body.input&&typeof body.input==='object'){
      const profile=(body.input as Record<string,unknown>).profile;
      if(profile&&typeof profile==='object')requireThat(typeof (profile as Record<string,unknown>).email==='string'&&String((profile as Record<string,unknown>).email).endsWith('@example.test'),'Use a fictional @example.test email in this review.');
    }
    if(route==='integrations/toast'&&request.method==='POST')return json({error:'Owner review uses a sample roster. Live Toast refresh is available only in a configured team workspace.'},400);
    await seedOwnerReview(binding);
    const headers=new Headers(request.headers);headers.delete('cookie');headers.set('oai-authenticated-user-id','review-identity-'+prefix+role);headers.set('oai-authenticated-user-email',prefix+role+'@example.test');
    url.pathname='/api/'+route;
    const internal=new Request(url,{method:request.method,headers,...(body?{body:JSON.stringify(body)}:{})});
    if(route==='companion')return handleCompanionChat(internal,binding,bindings,fetch,undefined,'workforce');
    if(route==='history')return handleRecordHistory(internal,binding);
    if(route==='food')return handleFood(internal,binding);
    if(route==='workspace')return handleWorkspace(internal,binding);
    if(route==='access')return handleAccess(internal,binding,{});
    if(route==='reminders')return handleReminders(internal,binding);
    return handleToast(internal,binding,{});
  }catch(error){return json({error:error instanceof AppError?error.message:'Owner review could not be opened. Please try again.'},error instanceof AppError?error.status:503)}
}
