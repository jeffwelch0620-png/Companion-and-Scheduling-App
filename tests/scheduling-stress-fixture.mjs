import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {openPositionDatabase} from './all-position-week-fixture.mjs';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {localInstant,localClock,localDate,nextDate} from '../.sites-runtime/shared/local-time.mjs';
import {weekCopyPlan} from '../.sites-runtime/shared/week-copy.mjs';
import {closingSelection} from '../.sites-runtime/shared/publication.mjs';
import {planningStamp} from '../.sites-runtime/shared/schedule-review.mjs';

export {localInstant,localClock,localDate,nextDate};
const RealDate=Date;
export function schedulingRuntimeHashes(){return Object.fromEntries(fs.readdirSync('.sites-runtime/shared').filter(f=>f.endsWith('.mjs')).sort().map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync('.sites-runtime/shared/'+f)).digest('hex')]));}
export async function createSchedulingFixture(restaurant,outputDir){
 fs.mkdirSync(outputDir,{recursive:true});const file=path.join(outputDir,restaurant+'.sqlite');
 assert.ok(!fs.existsSync(file),'A new trial must not overwrite prior database evidence');
 let store=openPositionDatabase(file),now=RealDate.parse('2026-10-15T16:00:00Z');
 globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 const job=restaurant==='papa'?'Counter':'Server',ids={manager:restaurant+'-manager',worker:restaurant+'-worker',overnight:restaurant+'-overnight',early:restaurant+'-early',unqualified:restaurant+'-unqualified',lead:restaurant+'-lead',boh:restaurant+'-boh',foreign:(restaurant==='berts'?'rudds':'berts')+'-manager'};
 const receipt={restaurant,fixtureId:crypto.randomUUID(),initialSeeds:1,operationalReseeds:0,checks:[],failures:[],events:[],runtimeBefore:schedulingRuntimeHashes(),weeks:[],database:file,limits:['Fictional identities, approved QA closing criteria and schedule hours; actual authenticated local handlers and SQLite.','DST overnight/early-hours slots are synthetic boundary cases, not approved restaurant operating hours.','No Toast or provider network; no physical work is claimed.','Coverage/time-off/swap/replacement and Toast contracts are separate team suites.']};
 for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())store.sqlite.exec(fs.readFileSync('drizzle/'+f,'utf8').replaceAll('--> statement-breakpoint',''));
 for(const loc of ['berts','rudds','papa']){
  store.sqlite.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').run(loc,'Fictional '+loc,'America/New_York');
  for(const [suffix,area,position,caps,quals] of [['manager','FOH','General manager',['location.manage','schedule.manage','schedule.publish','schedule.change','tasks.manage','standards.approve','close.confirm'],[job]],['worker','FOH',job,[],[job]],['overnight','FOH',job,[],[job]],['early','FOH',job,[],[job]],['unqualified','FOH',job,[],[]],['lead','FOH','FOH Manager',['schedule.manage','schedule.publish','schedule.change'],[job]],['boh','BOH','Pizza Make',['schedule.manage','schedule.publish','schedule.change'],['Pizza Make']]]){
   const id=loc+'-'+suffix;store.sqlite.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?,?)').run(id,id+'@example.test',id+'-identity',loc,'Fictional '+id,area,position,JSON.stringify(caps),JSON.stringify(quals));
  }
 }
 const request=(actor,body,location=restaurant)=>new Request('https://schedule-stress.example/api/workspace?locationId='+location,{headers:{'oai-authenticated-user-id':actor+'-identity','oai-authenticated-user-email':actor+'@example.test',Origin:'https://schedule-stress.example','Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 const call=async(actor,action,input={},record,requestId=crypto.randomUUID(),location=restaurant)=>{const response=await handleWorkspace(request(actor,action?{locationId:location,requestId,action,input,...(record?{recordId:record.id??record.recordId,expectedRevision:record.revision}:{})}:undefined,location),store.db);const result={status:response.status,data:await response.json()};receipt.events.push({actor,action:action??'workspace.read',location,requestId,at:new Date().toISOString(),...(record?{recordId:record.id??record.recordId,expectedRevision:record.revision}:{}),status:result.status,...(result.status!==200?{error:result.data.error}:{})});return result;};
 const ok=result=>{assert.equal(result.status,200,JSON.stringify(result.data));return result.data;};
 const command=async(actor,action,input={},record,requestId)=>ok(await call(actor,action,input,record,requestId));
 const view=async(actor=ids.manager)=>ok(await call(actor));
 const find=id=>{const r=store.sqlite.prepare('SELECT * FROM records WHERE id=?').get(id);return r&&{...r,locationId:r.location_id,ownerId:r.owner_id,updatedAt:r.updated_at,data:JSON.parse(r.data)};};
 const snapshot=()=>JSON.stringify(Object.fromEntries(['records','command_receipts','audit_events','locations'].map(t=>[t,store.sqlite.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()])));
 const deny=async(actor,action,input,record,status=400,location=restaurant)=>{const before=snapshot(),result=await call(actor,action,input,record,undefined,location);assert.equal(result.status,status,JSON.stringify(result.data));assert.equal(snapshot(),before,'Rejected command must leave all operational rows and receipts unchanged');return result;};
 const check=async(name,fn)=>{try{await fn();receipt.checks.push({name,status:'passed'});}catch(e){receipt.checks.push({name,status:'failed',error:String(e.stack??e)});receipt.failures.push({name,error:String(e.stack??e)});throw e;}};
 const reopen=()=>{const before=snapshot();store.close();store=openPositionDatabase(file);assert.equal(snapshot(),before);receipt.reopens=(receipt.reopens??0)+1;};
 const copyInput=async(sourceWeek,targetWeek,shifts,repeated='earlier')=>{const w=await view(),o={sourceWeek,targetWeek,shiftIds:shifts.map(s=>s.id??s.recordId),staffingIds:[],repeated};return {...o,reviewStamp:weekCopyPlan(w,o).stamp,confirmed:true,note:'Review fictional destination draft; never inherit completed work'};};
 const publicationInput=async(week,shifts)=>{const w=await view(),selected=shifts.map(s=>find(s.id??s.recordId));return {weekStart:week,drafts:selected.map(s=>({id:s.id,revision:s.revision,closing:closingSelection(w,s.id)})),planningReview:planningStamp(w,week,selected.map(s=>s.id)),confirmed:true,note:'Actual simulated manager reviews selected current drafts'};};
 const publish=async(week,shifts,requestId)=>command(ids.manager,'shift.publish-batch',await publicationInput(week,shifts),undefined,requestId);
 return {ids,job,restaurant,receipt,command,call,view,find,deny,check,reopen,snapshot,copyInput,publish,publicationInput,instant:(date,clock,repeated='')=>localInstant(date,clock,'America/New_York',repeated),setNow:instant=>{now=RealDate.parse(instant);},sqlite:()=>store.sqlite,finish(){try{receipt.runtimeAfter=schedulingRuntimeHashes();assert.deepEqual(receipt.runtimeAfter,receipt.runtimeBefore,'Frozen runtime changed during trial');receipt.savedShifts=store.sqlite.prepare("SELECT * FROM records WHERE kind='shift' ORDER BY id").all().map(r=>{const d=JSON.parse(r.data);return {id:r.id,ownerId:r.owner_id,revision:r.revision,start:d.start,end:d.end,startDate:localDate(d.start,'America/New_York'),startClock:localClock(d.start,'America/New_York'),endDate:localDate(d.end,'America/New_York'),endClock:localClock(d.end,'America/New_York'),elapsedHours:(RealDate.parse(d.end)-RealDate.parse(d.start))/3600000,published:d.published,cancelled:d.cancelled,historyActions:d.history.map(h=>h.action),copiedFrom:d.copiedFrom};});receipt.savedCounts=Object.fromEntries(['records','command_receipts','audit_events'].map(t=>[t,store.sqlite.prepare(`SELECT count(*) AS n FROM ${t}`).get().n]));fs.writeFileSync(path.join(outputDir,restaurant+'.json'),JSON.stringify(receipt,null,2));}finally{store.close();globalThis.Date=RealDate;}}};
}
