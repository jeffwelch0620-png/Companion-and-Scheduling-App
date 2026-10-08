import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {handleCompanionChat} from '../.sites-runtime/shared/companion-chat.mjs';

// Disposable D1-compatible state. The actual authenticated Companion handler
// builds context, persists history, checks current access, and calls the provider.
export async function runHandlerCase(role,c,config,provider=fetch){
 const sqlite=new DatabaseSync(':memory:');
 const db={prepare(sql){let args=[];return {bind(...v){args=v;return this;},async all(){return {results:sqlite.prepare(sql).all(...args),meta:{changes:Number(sqlite.prepare('SELECT changes() AS n').get().n)}};},async first(){return sqlite.prepare(sql).get(...args)??null;},async run(){const r=sqlite.prepare(sql).run(...args);return {results:[],meta:{changes:Number(r.changes)}};}};},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.all());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};db.withSession=()=>db;
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync('drizzle/'+file,'utf8').replaceAll('--> statement-breakpoint',''));
 const seed=(w,plans=[])=>{
  const locs=new Set([w.location.id,...w.members.map(m=>m.locationId),...w.records.map(r=>r.locationId)]);
  for(const loc of locs)sqlite.prepare('INSERT INTO locations(id,name,timezone,revision) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision').run(loc,loc===w.location.id?w.location.name:'Fictional foreign location',w.location.timezone,w.location.revision??1);
  for(const m of w.members)sqlite.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,schedule_jobs,schedule_only,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET capabilities=excluded.capabilities,area=excluded.area,position=excluded.position,name=excluded.name,qualifications=excluded.qualifications,schedule_jobs=excluded.schedule_jobs,schedule_only=excluded.schedule_only').run(m.id,m.id+'@example.test',m.id+'-identity',m.locationId,m.name,m.area,m.position,JSON.stringify(m.capabilities),JSON.stringify(m.qualifications??[]),JSON.stringify(m.scheduleJobs??[]),m.scheduleOnly?1:0);
  sqlite.prepare('DELETE FROM records').run();
  for(const r of w.records)sqlite.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(r.id,r.locationId,r.kind,r.ownerId,r.area,r.revision,JSON.stringify(r.data),r.updatedAt??c.at);
  sqlite.prepare('INSERT INTO food_state(location_id,revision) VALUES(?,?) ON CONFLICT(location_id) DO UPDATE SET revision=excluded.revision').run(w.location.id,c.prepRevision??1);
  sqlite.prepare('DELETE FROM food_workflows').run();
  for(const p of plans)sqlite.prepare('INSERT INTO food_workflows(id,location_id,dataset,kind,natural_key,revision,status,data,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(p.id,p.locationId,p.dataset,p.kind,p.id,p.revision,p.status,JSON.stringify(p),c.at);
 };
 let w=c.workspace,now=Date.parse(c.at),capturedContext,rawAnswer,providerMeta={},view;
 const turns=[];
 const snapshot=()=>JSON.stringify({records:sqlite.prepare('SELECT * FROM records ORDER BY id').all(),plans:sqlite.prepare('SELECT * FROM food_workflows ORDER BY id').all(),members:sqlite.prepare('SELECT * FROM memberships ORDER BY id').all(),audit:sqlite.prepare('SELECT * FROM audit_events ORDER BY id').all()});
 const fetcher=async(url,init)=>{
  const input=JSON.parse(init.body).input;
  capturedContext=JSON.parse(input[1].content.split('\n').slice(1).join('\n'));
  const response=await provider(url,init);providerMeta.status=response.status;
  const body=await response.clone().json().catch(()=>null);
  if(response.ok){providerMeta.usage=body?.usage;const text=body?.output?.filter(o=>o.type==='message').flatMap(o=>o.content??[]).filter(p=>p.type==='output_text').map(p=>p.text).join('');try{rawAnswer=JSON.parse(text)?.answer;}catch{}}
  else if(typeof body?.error?.code==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(body.error.code))providerMeta.errorCode=body.error.code;
  return response;
 };
 const call=async(body)=>{
  const req=new Request('https://ai-week.example/api/companion?locationId='+w.location.id,{headers:{'oai-authenticated-user-id':w.me.id+'-identity','oai-authenticated-user-email':w.me.id+'@example.test',Origin:'https://ai-week.example','Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
  const response=await handleCompanionChat(req,db,{OPENAI_API_KEY:config.key,JMAX_OPENAI_MODEL:config.model},fetcher,()=>now,'workforce');return {status:response.status,data:await response.json()};
 };
 try{
  seed(w,c.prepPlans??[]);const initial=await call();
  if(initial.status!==200)return {role,day:c.day,scenario:c.scenario,turns:[{status:'failed',stage:'fixture-authentication',appStatus:initial.status,error:initial.data.error}]};
  view=initial.data;
  for(const [index,question] of [c.question,c.followup].entries()){
   if(!question)continue;
   if(index){w=c.followupWorkspace??w;if(c.followupWorkspace||c.followupPrepPlans)seed(w,c.followupPrepPlans??c.prepPlans??[]);now=Date.parse(c.followupAt??c.at)+6000;}
   capturedContext=undefined;rawAnswer=undefined;providerMeta={};const before=snapshot(),started=Date.now();
   const selected=index?c.followupSelected:c.selected;
   const result=await call({action:'ask',locationId:w.location.id,conversationId:view.conversationId,expectedRevision:view.revision,question,requestId:crypto.randomUUID(),...(selected?{focus:selected}:{})});
   if(result.status===200){view=result.data;const returned=view.turns.at(-1);turns.push({question,answer:returned?.answer,rawAnswer,sources:returned?.sources,context:capturedContext,scopeMode:capturedContext?.scopeMode,elapsedMs:Date.now()-started,providerMeta,workUnchanged:before===snapshot(),status:returned?.status==='complete'?'completed':'failed',appStatus:result.status});}
   else turns.push({question,status:'failed',stage:'companion-handler',appStatus:result.status,error:result.data.error,providerMeta,context:capturedContext,elapsedMs:Date.now()-started});
   console.log(JSON.stringify({role,day:c.day,turn:index+1,status:turns.at(-1).status,appStatus:result.status,providerStatus:providerMeta.status}));
   if(turns.at(-1).status!=='completed')break;
  }
 }finally{sqlite.close();}
 return {role,day:c.day,scenario:c.scenario,expectedFacts:c.expectedFacts,expectedActions:c.expectedActions,prohibitedClaims:c.prohibitedClaims,requiredSourceIds:c.requiredSourceIds,turns,review:'Actual authenticated Companion handler and real provider; independent role helpfulness grading required.'};
}
