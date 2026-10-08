import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {handleRecordHistory} from '../.sites-runtime/shared/history-service.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
export const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data};
export const assetFacts={title:'Fictional meter unit',assetTag:'FIX-METER-1',placement:'Test room',manufacturer:'',model:'Fixture model',serial:'Fixture serial',sourceRef:'Fictional label',note:'Fixture physical check',checked:true};
export const planFacts={title:'Fictional date-and-hour service',equipment:'FIX-METER-1',task:'Fictional entire task; not an operating procedure',sourceRef:'Fictional manual §2 with both limits',initialDue:'2026-12-01',intervalDays:30,warningDays:5,managerId:'manager',note:'Fixture rule checked',checked:true,meterEnabled:true,meterRef:'Fictional run-hour meter §2',initialDueHours:100,intervalHours:50,warningHours:10};
export const reading={date:'2026-09-28',hours:90,evidence:'Fictional dated meter observation',note:'Fixture observation',checked:true};
export const service={date:'2026-09-28',performedBy:'Fixture technician',evidence:'Fictional completion report',note:'Fixture task complete',completed:true};
export async function fixture(t){
 const compiled=process.env.JMAX_METER_COMPILED==='1';let outbound=0;
 const mf=new Miniflare({modules:true,...(compiled?{scriptPath:path.resolve(process.env.JMAX_TEST_DIST??'dist','server/index.js'),modulesRoot:path.resolve(process.env.JMAX_TEST_DIST??'dist','server'),modulesRules:[{type:'ESModule',include:['**/*.js']}],compatibilityFlags:['nodejs_compat'],serviceBindings:{ASSETS:()=>new Response('Missing',{status:404})}}:{script:'export default {fetch(){return new Response("test")}}'}),compatibilityDate:'2026-05-22',d1Databases:['DB'],outboundService:()=>{outbound++;throw Error('No outbound expected')}});t.after(async()=>{assert.equal(outbound,0);await mf.dispose()});const db=await mf.getD1Database('DB');
 for(const file of fs.readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const loc of ['a','b','c'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(loc,'Fictional '+loc,'America/New_York').run();
 for(const [id,loc,caps,position='Manager',scheduleOnly=0] of [['owner','a',['location.manage'],'Owner'],['manager','a',['tasks.manage']],['othermanager','a',['tasks.manage']],['worker','a',[]],['dish','a',['location.manage'],'Dishwasher'],['schedule','a',['location.manage'],'Owner',1],['foreign','b',['location.manage'],'Owner'],['third','c',['location.manage'],'Owner']])await db.prepare("INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,active,schedule_only) VALUES(?,?,?,?,?,'BOH',?,?,'[]',1,?)").bind(id,id+'@example.test',id+'-identity',loc,id,position,JSON.stringify(caps),scheduleOnly).run();
 const headers=actor=>({'oai-authenticated-user-id':actor+'-identity','oai-authenticated-user-email':actor+'@example.test',Origin:'http://localhost','Content-Type':'application/json'});
 async function request(actor,url,body,binding=db){const init={headers:headers(actor),...(body?{method:'POST',body:JSON.stringify(body)}:{})};const res=compiled?await mf.dispatchFetch('http://localhost'+url,init):await (url.startsWith('/api/history')?handleRecordHistory:handleWorkspace)(new Request('http://localhost'+url,init),binding);return {status:res.status,data:await res.json()};}
 const call=(actor,action,input={},record,extra={},binding=db)=>request(actor,'/api/workspace',{locationId:'a',requestId:crypto.randomUUID(),action,input,...(record?{recordId:record.recordId??record.id,expectedRevision:record.revision}:{}),...extra},binding);
 const view=async(actor='owner',loc='a')=>ok(await request(actor,'/api/workspace?locationId='+loc));
 const saved=async r=>(await view()).records.find(x=>x.id===(r.recordId??r.id));
 const setup=async()=>{const asset=ok(await call('owner','equipment.create',assetFacts));const facts={...planFacts,assetId:asset.recordId,assetRevision:asset.revision};const record=ok(await call('owner','maintenance.create',facts));return {asset,facts,record};};
 return {db,compiled,request,call,view,saved,setup,dispatch:(url,init)=>mf.dispatchFetch(url,init)};
}
