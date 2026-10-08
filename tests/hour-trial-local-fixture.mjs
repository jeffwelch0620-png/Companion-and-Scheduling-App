import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openPositionDatabase} from './all-position-week-fixture.mjs';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
export function localTrial(group, actors, locations=['papa','berts','rudds']) {
 const evidenceRoot=process.env.HOUR_TRIAL_EVIDENCE_ROOT??'hour-trial';assert.ok(['hour-trial','hour-trial-week3'].includes(evidenceRoot));
 const dir=path.resolve('evidence/'+evidenceRoot+'/'+group);fs.mkdirSync(dir,{recursive:true});
 const file=path.join(dir,'trial-'+crypto.randomUUID()+'.sqlite');let store=openPositionDatabase(file);
 for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())store.sqlite.exec(fs.readFileSync('drizzle/'+f,'utf8').replaceAll('--> statement-breakpoint',''));
 for(const loc of locations){store.sqlite.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').run(loc,'Fictional '+loc,'America/New_York');store.sqlite.prepare('INSERT INTO food_state(location_id) VALUES(?)').run(loc);}
 for(const a of actors)store.sqlite.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?,?)').run(a.id,a.id+'@example.test',a.id+'-identity',a.loc??'papa','Fictional '+a.id,a.area??'BOH',a.position,JSON.stringify(a.caps??[]),JSON.stringify(a.qualifications??[a.position]));
 const request=(actor,route,loc,body,query='')=>new Request(`https://hour-trial.example/api/${route}?locationId=${loc}${query}`,{headers:{'oai-authenticated-user-id':actor+'-identity','oai-authenticated-user-email':actor+'@example.test',Origin:'https://hour-trial.example','Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 const call=async(handler,actor,route,loc,body,query='')=>{const r=await handler(request(actor,route,loc,body,query),store.db);return {status:r.status,data:await r.json()};};
 const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
 const command=async(actor,action,input={},record,requestId=crypto.randomUUID(),loc='papa')=>ok(await raw(actor,action,input,record,requestId,loc));
 const raw=(actor,action,input={},record,requestId=crypto.randomUUID(),loc='papa')=>call(handleWorkspace,actor,'workspace',loc,{locationId:loc,requestId,action,input,...(record?{recordId:record.recordId??record.id,expectedRevision:record.revision}:{})});
 const find=id=>{const r=store.sqlite.prepare('SELECT * FROM records WHERE id=?').get(id);return r&&{...r,id:r.id,recordId:r.id,ownerId:r.owner_id,area:r.area,data:JSON.parse(r.data)};};
 const snapshot=()=>JSON.stringify(Object.fromEntries(['records','command_receipts','audit_events','food_state','food_records','food_workflows','food_workflow_events','food_transfers','food_transfer_events','food_receipts'].map(t=>[t,store.sqlite.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()])));
 const reopen=()=>{const before=snapshot();store.close();store=openPositionDatabase(file);assert.equal(snapshot(),before);};
 const modules=['service','domain','companion-chat','food-service','food-workflow-service','food-transfer-service'];const sourceHashes=()=>Object.fromEntries(modules.map(name=>[name,createHash('sha256').update(fs.readFileSync(`.sites-runtime/shared/${name}.mjs`)).digest('hex')]));const sourceRevision=sourceHashes();
 return {dir,file,sourceRevision,sourceHashes,actors,request,call,ok,raw,command,find,snapshot,reopen,get db(){return store.db},get sqlite(){return store.sqlite},close:()=>store.close()};
}
export const managerCaps=['location.manage','schedule.manage','schedule.publish','schedule.change','tasks.manage','people.manage','standards.approve','close.confirm','operations.escalation','orders.review'];
