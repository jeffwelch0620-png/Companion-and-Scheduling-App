import {authenticateWorkspace,boundedJson,recordFromRow,workspace} from './service';
import {context as foodContext} from './food-service';
import {restaurantAccessWriteGuard,requireRestaurantAccess} from './restaurant-access';
// Commissary shares prep counts and plans, not the personnel workspace.
const context=(db:Parameters<typeof foodContext>[0],identity:Parameters<typeof foodContext>[1],locationId:string)=>foodContext(db,identity,locationId,true);
import type {WorkspaceIdentity} from './employee-session';
import {visible} from './domain';
import {calendarDate} from './schedule-policy';
import {localDate,nextDate} from './local-time';
import {AppError,id,object,requireThat,text} from './validation';
import {foodWorkflowPermissions,prepQuantity,prepQuantityMode,completedPrepQuantity,planLines,missingCountBlockers,type FoodDataset,type PrepTrack,type PrepBase,type PrepDefinition,type PrepCount,type PrepPlan,type PrepWorkflow,type PrepCountLine,type PrepEvent,type FoodWorkflowPage,type FoodWorkflowDetail} from './food-workflow-model';
import type {FoodItem,FoodRecipe} from './food-model';
import type {Command} from './types';
type DB=Pick<D1Database,'prepare'|'batch'>;
type Row={id:string;location_id:string;dataset:FoodDataset;kind:PrepWorkflow['kind'];natural_key:string;revision:number;status:string;data:string;updated_at:string};
type SourceRow={id:string;revision:number;kind:'fooditem'|'foodrecipe';data:string};
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff'}});
const dataset=(v:unknown):FoodDataset=>{requireThat(v==='demo'||v==='operating','Choose a food dataset.');return v;};
const track=(v:unknown):PrepTrack=>{requireThat(v==='daily'||v==='bulk','Choose daily or bulk prep.');return v;};
const unpack=(r:Row):PrepWorkflow=>JSON.parse(r.data) as PrepWorkflow;
const note=(v:unknown)=>text(v??'','Note',1500,true);
async function row(db:DB,loc:string,ds:FoodDataset,rid:string){const result=await db.prepare('SELECT * FROM food_workflows WHERE id=? AND location_id=? AND dataset=?').bind(rid,loc,ds).first<Row>();requireThat(result,'Workflow not found in this restaurant and dataset.',404);return result;}
async function source(db:DB,loc:string,ds:FoodDataset,rid:string){const result=await db.prepare('SELECT id,revision,kind,data FROM food_records WHERE id=? AND location_id=? AND dataset=?').bind(rid,loc,ds).first<SourceRow>();requireThat(result,'Food source not found in this restaurant and dataset.',404);return result;}
async function definitions(db:DB,loc:string,ds:FoodDataset):Promise<PrepDefinition[]>{const rows=await db.prepare("SELECT * FROM food_workflows WHERE location_id=? AND dataset=? AND kind='definition' AND status='active' ORDER BY natural_key LIMIT 101").bind(loc,ds).all<Row>();requireThat(rows.results.length<=100,'Retire unused prep definitions before adding more than 100.',503);return rows.results.map(unpack) as PrepDefinition[];}
function snapshot(d:PrepDefinition):PrepCountLine{return {definitionId:d.id,definitionRevision:d.revision,foodRecordId:d.foodRecordId,foodRevision:d.foodRevision,title:d.title,countUnit:d.countUnit,quantityMode:d.quantityMode??'continuous',par:d.par,quantity:null,note:''};}
async function refBlockers(db:DB,loc:string,ds:FoodDataset,lines:PrepCountLine[],chosenTrack:PrepTrack){
 const issues:string[]=[];
 const active=(await definitions(db,loc,ds)).filter(d=>d.track===chosenTrack);
 if(active.length!==lines.length||active.some(d=>!lines.some(l=>l.definitionId===d.id)))issues.push('The active prep definition list changed; refresh and resubmit the count.');
 for(const line of lines){
  const def=await db.prepare('SELECT revision,status FROM food_workflows WHERE id=? AND location_id=? AND dataset=?').bind(line.definitionId,loc,ds).first<{revision:number;status:string}>();
  const item=await db.prepare('SELECT revision FROM food_records WHERE id=? AND location_id=? AND dataset=?').bind(line.foodRecordId,loc,ds).first<{revision:number}>();
  if(def?.revision!==line.definitionRevision||def.status!=='active'||item?.revision!==line.foodRevision)issues.push(`${line.title}: definition or Food source changed; refresh and resubmit the count.`);
 }
 return issues;
}
async function prior(db:DB,loc:string,actor:string,requestId:string,fingerprint:string){const r=await db.prepare('SELECT fingerprint,result FROM food_receipts WHERE location_id=? AND actor_id=? AND request_id=?').bind(loc,actor,requestId).first<{fingerprint:string;result:string}>();if(!r)return null;requireThat(r.fingerprint===fingerprint,'This request identifier was used for a different change.',409);return JSON.parse(r.result) as {recordId:string;revision:number;foodRevision:number};}
async function read(db:DB,identity:WorkspaceIdentity,url:URL){
 const loc=id(url.searchParams.get('locationId')),ds=dataset(url.searchParams.get('dataset')??'operating'),ctx=await context(db,identity,loc);
 requireThat(!ctx.w.me.scheduleOnly,'Schedule-only access does not include food workflows.',403);
 if(url.searchParams.get('view')==='context')return {location:ctx.w.location,me:ctx.w.me,commissaryOnly:ctx.restaurantAccess.kind==='commissary'};
 let result:FoodWorkflowPage|FoodWorkflowDetail;
 if(url.searchParams.has('recordId')){
  const r=unpack(await row(db,loc,ds,id(url.searchParams.get('recordId')))),after=Number(url.searchParams.get('after')??0);
  requireThat(Number.isSafeInteger(after)&&after>=0,'Invalid history cursor.');
  const events=await db.prepare('SELECT event FROM food_workflow_events WHERE workflow_id=? AND revision>? ORDER BY revision LIMIT 21').bind(r.id,after).all<{event:string}>();
  const history=events.results.slice(0,20).map(e=>JSON.parse(e.event) as PrepEvent);result={record:r,history,next:events.results.length>20?history.at(-1)!.revision:null};
 }else{
  const defs=await definitions(db,loc,ds);
  const rows=await db.batch([
   db.prepare("SELECT * FROM food_workflows WHERE location_id=? AND dataset=? AND kind='count' ORDER BY updated_at DESC,id LIMIT 31").bind(loc,ds),
   db.prepare("SELECT * FROM food_workflows WHERE location_id=? AND dataset=? AND kind='plan' ORDER BY updated_at DESC,id LIMIT 31").bind(loc,ds),
   db.prepare("SELECT * FROM records WHERE location_id=? AND kind='order' AND archived_at IS NULL AND json_extract(data,'$.food.dataset')=? AND (owner_id=? OR (?=1 AND json_extract(data,'$.status')<>'draft')) ORDER BY updated_at DESC,id LIMIT 31").bind(loc,ds,ctx.w.me.id,Number(foodWorkflowPermissions(ctx.w.me).reviewPurchase))
  ]);
  const purchases=ctx.restaurantAccess.kind==='commissary'?[]:(rows[2].results as Parameters<typeof recordFromRow>[0][]).map(recordFromRow).filter((r):r is Extract<typeof r,{kind:'order'}>=>r.kind==='order'&&visible(r,ctx.w.me,ctx.w));
  result={foodRevision:ctx.revision,definitions:defs,counts:(rows[0].results as Row[]).slice(0,30).map(unpack) as PrepCount[],plans:(rows[1].results as Row[]).slice(0,30).map(unpack) as PrepPlan[],purchases:purchases.slice(0,30),permissions:foodWorkflowPermissions(ctx.w.me),more:{counts:rows[0].results.length>30,plans:rows[1].results.length>30,purchases:rows[2].results.length>30}};
 }
 const check=await context(db,identity,loc);requireThat(check.revision===ctx.revision&&check.membershipRevision===ctx.membershipRevision&&check.w.location.revision===ctx.w.location.revision,'Food records or access changed while loading. Refresh.',409);return result;
}
async function write(db:DB,identity:WorkspaceIdentity,c:Command){
 const ds=dataset(c.input.dataset),employeeCompletion=c.action==='plan.employee-complete';
 const employeeContext=async()=>{const current=await workspace(db,identity,c.locationId);requireThat(!current.value.me.scheduleOnly,'Schedule-only access does not include prep.',403);const state=await db.prepare('SELECT revision FROM food_state WHERE location_id=?').bind(c.locationId).first<{revision:number}>();return {w:current.value,membershipRevision:current.membershipRevision,revision:state?.revision??0};};
 const ctx=employeeCompletion?await employeeContext():await context(db,identity,c.locationId),w=ctx.w,at=new Date().toISOString(),permissions=foodWorkflowPermissions(w.me);
 if('restaurantAccess' in ctx&&ctx.restaurantAccess.kind==='commissary'&&c.locationId!==ctx.restaurantAccess.home_location_id)requireThat(!['definition.save','definition.retire','plan.assign'].includes(c.action),'Commissary destination access covers prep and counts; restaurant setup and employee assignment stay with that restaurant.',403);
 const policy=await restaurantAccessWriteGuard(db,identity,c.locationId,employeeCompletion?'restaurant':'commissary-food');
 requireThat(employeeCompletion||permissions.managePrep,'Prep changes require this restaurant’s prep-management access.',403);
 const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(c)))),n=>n.toString(16).padStart(2,'0')).join('');
 const repeated=await prior(db,w.location.id,w.me.id,c.requestId,fingerprint);if(repeated)return repeated;
 if(c.input.advisorFingerprint!==undefined)requireThat(c.action==='definition.save'&&typeof c.input.advisorFingerprint==='string'&&c.input.advisorExpectedFoodRevision===ctx.revision,'The reviewed Food advice or local records changed. Refresh before applying.',409);
 const existing=c.recordId?await row(db,w.location.id,ds,c.recordId):null;
 requireThat(!existing||existing.revision===c.expectedRevision,'This workflow changed. Refresh before saving.',409);
 const old=existing?unpack(existing):null,base:PrepBase={id:old?.id??crypto.randomUUID(),locationId:w.location.id,dataset:ds,revision:old?old.revision+1:1,createdAt:old?.createdAt??at,createdBy:old?.createdBy??w.me.id,updatedAt:at};
 let record:PrepWorkflow,natural=existing?.natural_key??'',eventNote=note(c.input.note);
 if(c.action==='definition.save'){
  requireThat(!old||old.kind==='definition','Open a prep definition.');requireThat(c.input.confirmed===true,'Confirm the count unit, par and Food source were reviewed.');
  const food=await source(db,w.location.id,ds,id(c.input.foodRecordId)),data=JSON.parse(food.data) as FoodItem|FoodRecipe;
  requireThat(food.revision===c.input.foodRevision,'The Food source changed. Review it again.',409);
  if(food.kind==='fooditem')requireThat('active'in data&&data.active&&!data.needsReview,'Review and activate this Food item first.');
  else requireThat('recipeType'in data&&data.recipeType==='prep','Use a prep recipe, not a menu recipe.');
  const chosenTrack=track(c.input.track);natural=`${chosenTrack}:${food.id}`;
  requireThat(!old||old.kind==='definition'&&old.foodRecordId===food.id&&old.track===chosenTrack,'Keep the existing source and track; retire this definition to replace them.');
  const current=await definitions(db,w.location.id,ds);requireThat(old||current.length<100,'Limit active prep definitions to 100.');
  const quantityMode=prepQuantityMode(c.input.quantityMode===undefined?(old?.kind==='definition'?old.quantityMode:undefined):c.input.quantityMode),par=prepQuantity(c.input.par,'Par')!;
  requireThat(quantityMode!=='whole-portions'||Number.isInteger(par),'The par for whole portion units must be a whole number.');
  record={...base,kind:'definition',status:'active',track:chosenTrack,foodRecordId:food.id,foodRevision:food.revision,foodKind:food.kind,title:data.title,countUnit:text(c.input.countUnit,'Count unit',40),quantityMode,par,reviewNote:text(c.input.reviewNote,'Definition review evidence',1500),reviewedBy:w.me.id,reviewedAt:at};eventNote=record.reviewNote;
 }else if(c.action==='definition.retire'){
  requireThat(old?.kind==='definition'&&old.status==='active','Open an active prep definition.');record={...old,...base,status:'retired'};eventNote=text(c.input.reason,'Retirement reason',1500);
 }else if(c.action==='count.create'){
  requireThat(!old,'Create a new count session.');const chosenTrack=track(c.input.track),businessDate=calendarDate(c.input.businessDate,'Evening count date');
  requireThat(businessDate<=localDate(at,w.location.timezone),'An evening count cannot be future dated.');
  const defs=(await definitions(db,w.location.id,ds)).filter(d=>d.track===chosenTrack);requireThat(defs.length,'Review at least one prep definition for this track.');
  record={...base,kind:'count',status:'draft',track:chosenTrack,businessDate,lines:defs.map(snapshot),submittedAt:null,submittedBy:null};natural=`${businessDate}:${chosenTrack}`;
 }else if(c.action==='count.save'||c.action==='count.submit'||c.action==='count.reopen'){
  requireThat(old?.kind==='count','Open a count session.');record={...old,...base,kind:'count'};
  if(c.action==='count.reopen'){
   eventNote=text(c.input.reason,'Reason for reopening or refreshing',1500);const defs=(await definitions(db,w.location.id,ds)).filter(d=>d.track===old.track);requireThat(defs.length,'No active definitions remain for this track.');
   record.lines=defs.map(d=>{const prior=old.lines.find(l=>l.definitionId===d.id);return {...snapshot(d),...(prior&&prior.foodRevision===d.foodRevision&&prior.countUnit===d.countUnit?{quantity:prior.quantity,note:prior.note}:{})}});record.status='draft';record.submittedAt=null;record.submittedBy=null;
  }else{
   requireThat(old.status==='draft','Reopen the submitted count before changing it.');
   if(c.action==='count.save'){
    requireThat(Array.isArray(c.input.lines)&&c.input.lines.length>0&&c.input.lines.length<=100,'Save 1–100 count entries.');const seen=new Set<string>();
    for(const v of c.input.lines){const line=object(v),did=id(line.definitionId);requireThat(!seen.has(did),'A count entry is duplicated.');seen.add(did);const target=record.lines.find(l=>l.definitionId===did);requireThat(target,'This definition is not in the count session.');target.quantity=prepQuantity(line.quantity,'Count',true);target.note=note(line.note);}
   }else{requireThat(c.input.confirmed===true,'Confirm this evening count submission.');const blockers=await refBlockers(db,w.location.id,ds,record.lines,record.track);requireThat(!blockers.length,blockers.join(' '),409);record.status='submitted';record.submittedAt=at;record.submittedBy=w.me.id;}
  }
 }else if(c.action==='plan.generate'){
  requireThat(!old||old.kind==='plan'&&old.status==='draft','Only a draft prep plan can be regenerated.');
  const count=unpack(await row(db,w.location.id,ds,id(c.input.countId)));requireThat(count.kind==='count'&&count.status==='submitted','Choose a submitted evening count.');requireThat(count.revision===c.input.countRevision,'The selected evening count changed. Refresh it.',409);
  const targetDate=calendarDate(c.input.targetDate,'Prep target date');requireThat(targetDate>count.businessDate&&targetDate<=nextDate(count.businessDate,31),'Choose a prep date after the count, within 31 days.');natural=`${targetDate}:${count.track}`;
  requireThat(!old||old.kind==='plan'&&old.targetDate===targetDate&&old.track===count.track,'Regeneration must keep this plan’s target date and track.');
  record={...base,kind:'plan',status:'draft',targetDate,track:count.track,countId:count.id,countRevision:count.revision,lines:planLines(count),blockers:[...(count.businessDate===localDate(at,w.location.timezone)?[]:['A current-day restaurant-local evening count is required for release.']),...missingCountBlockers(count.lines),...await refBlockers(db,w.location.id,ds,count.lines,count.track)],releasedAt:null,releasedBy:null};
 }else if(c.action==='plan.release'){
  requireThat(old?.kind==='plan'&&old.status==='draft','Open a draft prep plan.');requireThat(c.input.confirmed===true,'Confirm release to the prep team.');
  const count=unpack(await row(db,w.location.id,ds,old.countId));requireThat(count.kind==='count'&&count.status==='submitted'&&count.revision===old.countRevision,'The source count changed; regenerate the draft before release.',409);
  requireThat(count.businessDate===localDate(at,w.location.timezone),'A current-day restaurant-local evening count is required for release. The production target date does not refresh an old count.',409);
  const blockers=[...missingCountBlockers(old.lines),...await refBlockers(db,w.location.id,ds,old.lines,old.track)];requireThat(!blockers.length,blockers.join(' '),409);
  record={...old,...base,kind:'plan',status:old.lines.some(l=>(l.plannedQty??0)>0)?'released':'completed',blockers:[],releasedAt:at,releasedBy:w.me.id};
 }else if(c.action==='plan.assign'){
  requireThat(old?.kind==='plan'&&old.status==='released','Assign work from a released prep plan.');
  const definitionId=id(c.input.definitionId),assignedTo=id(c.input.assignedTo);
  const target=old.lines.find(l=>l.definitionId===definitionId);
  requireThat(target&&!target.completedAt&&(target.plannedQty??0)>0,'Choose unfinished prep work.');
  const employee=await db.prepare('SELECT id FROM memberships WHERE id=? AND location_id=? AND active=1 AND COALESCE(schedule_only,0)=0').bind(assignedTo,w.location.id).first();
  requireThat(employee,'Choose an active employee at this restaurant.');
  record={...old,...base,lines:old.lines.map(l=>l.definitionId===definitionId?{...l,assignedTo}:l)};
  eventNote='Prep responsibility assigned to '+assignedTo;
 }else if(c.action==='plan.complete'||employeeCompletion){
  requireThat(old?.kind==='plan'&&old.status==='released','Only a released prep plan can record task completion.');requireThat(c.input.confirmed===true,'Confirm the actual prep quantity completed.');
  record={...old,...base,kind:'plan'};const target=record.lines.find(l=>l.definitionId===c.input.definitionId);requireThat(target&&target.plannedQty!==null&&target.plannedQty>0&&!target.completedAt,'Choose an unfinished prep task.');
  if(employeeCompletion){
   requireThat(target.assignedTo===w.me.id,'Only the assigned employee can report this prep.',403);
   const currentSource=await source(db,w.location.id,ds,target.foodRecordId);
   requireThat(currentSource.revision===target.foodRevision,'The recipe or item changed. Ask your manager to review this prep before reporting completion.',409);
  }
  target.completedQty=completedPrepQuantity(c.input.quantity,target.quantityMode);target.completedAt=at;target.completedBy=w.me.id;target.completionNote=note(c.input.note);
  if(target.completedQty!==target.plannedQty)requireThat(target.completionNote,'Explain the difference from the released prep quantity.');
  if(record.lines.every(l=>(l.plannedQty??0)===0||l.completedAt))record.status='completed';
 }else throw new AppError(400,'Unsupported prep workflow action.');
 if(!existing){const dup=await db.prepare('SELECT id FROM food_workflows WHERE location_id=? AND dataset=? AND kind=? AND natural_key=?').bind(w.location.id,ds,record.kind,natural).first();requireThat(!dup,'This definition, dated count or target plan already exists. Open its saved record.',409);}
 const encoded=JSON.stringify(record);requireThat(new TextEncoder().encode(encoded).byteLength<=256000,'This workflow is too large. Reduce the supporting notes.');
 const token=crypto.randomUUID(),gate='EXISTS(SELECT 1 FROM food_state WHERE location_id=? AND last_command=?)',result={recordId:record.id,revision:record.revision,foodRevision:ctx.revision+1,...(c.input.advisorFingerprint!==undefined?{advisorFingerprint:c.input.advisorFingerprint}:{})};
 const event:PrepEvent={revision:record.revision,action:c.action,at,by:w.me.id,byName:w.me.name,note:eventNote,snapshot:record};
 const statements=[db.prepare(`INSERT INTO food_state(location_id) SELECT ? WHERE ${policy.sql} ON CONFLICT(location_id) DO NOTHING`).bind(w.location.id,...policy.values),db.prepare(`UPDATE food_state SET revision=revision+1,last_command=? WHERE location_id=? AND revision=? AND EXISTS(SELECT 1 FROM memberships WHERE id=? AND location_id=? AND auth_user_id=? AND active=1 AND revision=?) AND EXISTS(SELECT 1 FROM locations WHERE id=? AND revision=?) AND ${policy.sql}`).bind(token,w.location.id,ctx.revision,w.me.id,w.location.id,identity.authUserId,ctx.membershipRevision,w.location.id,w.location.revision,...policy.values),
  db.prepare(`INSERT INTO food_workflows(id,location_id,dataset,kind,natural_key,revision,status,data,updated_at) SELECT ?,?,?,?,?,?,?,?,? WHERE ${gate} ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,status=excluded.status,data=excluded.data,updated_at=excluded.updated_at`).bind(record.id,w.location.id,ds,record.kind,natural,record.revision,record.status,encoded,at,w.location.id,token),
  db.prepare(`INSERT INTO food_workflow_events(workflow_id,revision,event) SELECT ?,?,? WHERE ${gate}`).bind(record.id,record.revision,JSON.stringify(event),w.location.id,token),
  db.prepare(`INSERT INTO food_receipts(location_id,actor_id,request_id,fingerprint,result) SELECT ?,?,?,?,? WHERE ${gate}`).bind(w.location.id,w.me.id,c.requestId,fingerprint,JSON.stringify(result),w.location.id,token),
  db.prepare(`INSERT INTO audit_events(id,location_id,actor_id,action,record_id,at,revision) SELECT ?,?,?,?,?,?,? WHERE ${gate}`).bind(token,w.location.id,w.me.id,'prep.'+c.action,record.id,at,result.foodRevision,w.location.id,token)];
 const saved=await db.batch(statements);if(!saved[1].meta.changes){await requireRestaurantAccess(db,identity,w.location.id,employeeCompletion?'restaurant':'commissary-food');const repeated=await prior(db,w.location.id,w.me.id,c.requestId,fingerprint);if(repeated)return repeated;throw new AppError(409,'Food records or access changed. Refresh before saving.');}return result;
}
export async function handleFoodWorkflows(request:Request,binding?:D1Database):Promise<Response>{
 try{
  requireThat(request.method==='GET'||request.method==='POST','Method not allowed.',405);const {db,identity}=await authenticateWorkspace(request,binding),url=new URL(request.url);
  if(request.method==='GET')return json(await read(db,identity,url));
  requireThat(request.headers.get('Origin')===url.origin&&request.headers.get('Sec-Fetch-Site')!=='cross-site','Open this action from your JMAX workspace.',403);requireThat(request.headers.get('Content-Type')?.split(';')[0]==='application/json','Use JSON for this request.',415);
  const body=object(await boundedJson(request.body,128000)),c:Command={requestId:id(body.requestId),locationId:id(body.locationId),action:text(body.action,'Action',60),input:object(body.input)};
  if(body.recordId!==undefined){c.recordId=id(body.recordId);requireThat(Number.isInteger(body.expectedRevision)&&Number(body.expectedRevision)>0,'An exact record revision is required.');c.expectedRevision=Number(body.expectedRevision);}
  return json(await write(db,identity,c));
 }catch(error){if(error instanceof AppError)return json({error:error.message},error.status);console.error(JSON.stringify({event:'food_workflow_failed',errorType:error instanceof Error?error.name:'unknown'}));return json({error:'Food workflow storage could not confirm this change. Retrying the same request is safe.'},503);}
}
