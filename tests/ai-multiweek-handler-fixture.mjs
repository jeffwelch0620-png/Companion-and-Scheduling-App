import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {handleCompanionChat} from '../.sites-runtime/shared/companion-chat.mjs';

// One disposable database per role across all simulated days. Explicit fixture
// events replace operational snapshots; questions can change chat only.
export function createMultiweekSession(config,provider=fetch){
 const sqlite=new DatabaseSync(':memory:');
 const db={prepare(sql){let args=[];return {bind(...v){args=v;return this;},async all(){return {results:sqlite.prepare(sql).all(...args),meta:{changes:Number(sqlite.prepare('SELECT changes() AS n').get().n)}};},async first(){return sqlite.prepare(sql).get(...args)??null;},async run(){const result=sqlite.prepare(sql).run(...args);return {results:[],meta:{changes:Number(result.changes)}};}};},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.all());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 db.withSession=()=>db;
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync('drizzle/'+file,'utf8').replaceAll('--> statement-breakpoint',''));
 let w,now,view,capturedContext,rawAnswer,providerMeta={},providerHistoryCount=0,previousWeek,previousIdentity;
 const rotations=[],transitions=[];
 const snapshot=()=>JSON.stringify({records:sqlite.prepare('SELECT * FROM records ORDER BY id').all(),plans:sqlite.prepare('SELECT * FROM food_workflows ORDER BY id').all(),members:sqlite.prepare('SELECT * FROM memberships ORDER BY id').all(),audit:sqlite.prepare('SELECT * FROM audit_events ORDER BY id').all()});
 const hash=value=>createHash('sha256').update(value).digest('hex');
 const seed=(workspace,plans=[],revision=1,at)=>{
  const locs=new Set([workspace.location.id,...workspace.members.map(m=>m.locationId),...workspace.records.map(r=>r.locationId)]);
  for(const loc of locs)sqlite.prepare('INSERT INTO locations(id,name,timezone,revision) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision').run(loc,loc===workspace.location.id?workspace.location.name:'Fictional foreign location',workspace.location.timezone,workspace.location.revision??1);
  for(const m of workspace.members){
   const existing=sqlite.prepare('SELECT location_id FROM memberships WHERE id=?').get(m.id);
   if(existing&&existing.location_id!==m.locationId)throw Error('Fixture membership cannot move restaurants; use a distinct restaurant membership identity.');
   sqlite.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,schedule_jobs,schedule_only,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET capabilities=excluded.capabilities,area=excluded.area,position=excluded.position,name=excluded.name,qualifications=excluded.qualifications,schedule_jobs=excluded.schedule_jobs,schedule_only=excluded.schedule_only').run(m.id,m.id+'@example.test',m.id+'-identity',m.locationId,m.name,m.area,m.position,JSON.stringify(m.capabilities),JSON.stringify(m.qualifications??[]),JSON.stringify(m.scheduleJobs??[]),m.scheduleOnly?1:0);
  }
  // Snapshots are complete for the supplied location; foreign locations remain
  // stored so a restaurant switch does not erase earlier restaurants' work.
  sqlite.prepare('DELETE FROM records WHERE location_id=?').run(workspace.location.id);
  for(const r of workspace.records)sqlite.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data,owner_id=excluded.owner_id,updated_at=excluded.updated_at').run(r.id,r.locationId,r.kind,r.ownerId,r.area,r.revision,JSON.stringify(r.data),r.updatedAt??at);
  sqlite.prepare('INSERT INTO food_state(location_id,revision) VALUES(?,?) ON CONFLICT(location_id) DO UPDATE SET revision=excluded.revision').run(workspace.location.id,revision);
  sqlite.prepare('DELETE FROM food_workflows WHERE location_id=?').run(workspace.location.id);
  for(const plan of plans)sqlite.prepare('INSERT INTO food_workflows(id,location_id,dataset,kind,natural_key,revision,status,data,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(plan.id,plan.locationId,plan.dataset,plan.kind,plan.id,plan.revision,plan.status,JSON.stringify(plan),at);
 };
 const fetcher=async(url,init)=>{
  const input=JSON.parse(init.body).input;providerHistoryCount=input.filter(m=>m.role==='assistant').length;
  capturedContext=JSON.parse(input[1].content.split('\n').slice(1).join('\n'));
  const response=await provider(url,init);providerMeta.status=response.status;
  const body=await response.clone().json().catch(()=>null);
  if(response.ok){providerMeta.usage=body?.usage;const text=body?.output?.filter(o=>o.type==='message').flatMap(o=>o.content??[]).filter(p=>p.type==='output_text').map(p=>p.text).join('');try{rawAnswer=JSON.parse(text)?.answer;}catch{}}
  else if(typeof body?.error?.code==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(body.error.code))providerMeta.errorCode=body.error.code;
  return response;
 };
 const call=async(body)=>{
  const request=new Request('https://ai-multiweek.example/api/companion?locationId='+w.location.id,{headers:{'oai-authenticated-user-id':w.me.id+'-identity','oai-authenticated-user-email':w.me.id+'@example.test',Origin:'https://ai-multiweek.example','Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
  const response=await handleCompanionChat(request,db,{OPENAI_API_KEY:config.key,JMAX_OPENAI_MODEL:config.model},fetcher,()=>now,'workforce');
  return {status:response.status,data:await response.json()};
 };
 async function run(role,c){
  const beforeSeed=snapshot();w=c.workspace;now=Date.parse(c.at);
  if(!Number.isFinite(now))throw Error('A simulation case requires a valid date.');
  seed(w,c.prepPlans??[],c.prepRevision??1,c.at);
  transitions.push({day:c.day,week:c.week,phase:'arrival-fixture-event',events:c.events??[],previousWorkHash:hash(beforeSeed),currentWorkHash:hash(snapshot()),recordCount:w.records.length,planCount:(c.prepPlans??[]).length});
  const initial=await call();
  if(initial.status!==200)return {role,day:c.day,week:c.week,turns:[{status:'failed',stage:'fixture-authentication',appStatus:initial.status,error:initial.data.error}]};
  view=initial.data;
  const identity=w.location.id+':'+w.me.id;
  if(previousWeek!==undefined&&c.week!==previousWeek&&view.turns.length){
   const from=view.conversationId,count=view.turns.length,before=snapshot();
   const result=await call({action:'start-new',locationId:w.location.id,conversationId:view.conversationId,expectedRevision:view.revision});
   rotations.push({week:c.week,identity,previousIdentity,from,archivedTurns:count,appStatus:result.status,workUnchanged:before===snapshot()});
   if(result.status!==200)return {role,day:c.day,week:c.week,turns:[{status:'failed',stage:'week-chat-rotation',appStatus:result.status,error:result.data.error}]};
   view=result.data;
  }
  previousWeek=c.week;previousIdentity=identity;
  const turns=[],historyBefore=view.turns.length;
  for(const [index,question]of[c.question,c.followup].entries()){
   if(!question)continue;
   if(index){
    w=c.followupWorkspace??w;now=Date.parse(c.followupAt??c.at)+6000;
    if(c.followupWorkspace||c.followupPrepPlans){const before=snapshot();seed(w,c.followupPrepPlans??c.prepPlans??[],c.followupPrepRevision??c.prepRevision??1,c.followupAt??c.at);transitions.push({day:c.day,week:c.week,phase:'follow-up-fixture-event',events:c.followupEvents??[],previousWorkHash:hash(before),currentWorkHash:hash(snapshot())});}
   }
   capturedContext=undefined;rawAnswer=undefined;providerMeta={};providerHistoryCount=0;
   const before=snapshot(),started=Date.now(),selected=index?c.followupSelected:c.selected;
   const result=await call({action:'ask',locationId:w.location.id,conversationId:view.conversationId,expectedRevision:view.revision,question,requestId:crypto.randomUUID(),...(selected?{focus:selected}:{})});
   if(result.status===200){
    view=result.data;const returned=view.turns.at(-1);
    turns.push({question,answer:returned?.answer,rawAnswer,sources:returned?.sources,context:capturedContext,scopeMode:capturedContext?.scopeMode,elapsedMs:Date.now()-started,providerMeta,providerHistoryCount,conversationTurnCount:view.turns.length,workUnchanged:before===snapshot(),status:returned?.status==='complete'?'completed':'failed',appStatus:result.status});
   }else turns.push({question,status:'failed',stage:'companion-handler',appStatus:result.status,error:result.data.error,providerMeta,context:capturedContext,elapsedMs:Date.now()-started});
   if(turns.at(-1).status!=='completed')break;
  }
  if(c.afterWorkspace||c.afterPrepPlans){
   const before=snapshot();w=c.afterWorkspace??w;
   seed(w,c.afterPrepPlans??c.followupPrepPlans??c.prepPlans??[],c.afterPrepRevision??c.followupPrepRevision??c.prepRevision??1,c.afterAt??c.followupAt??c.at);
   transitions.push({day:c.day,week:c.week,phase:'after-conversation-human-fixture-event',events:c.afterEvents??c.afterFollowup??[],previousWorkHash:hash(before),currentWorkHash:hash(snapshot())});
  }
  return {role,day:c.day,week:c.week,dayInWeek:c.dayInWeek,scenario:c.scenario,at:c.at,events:c.events,followupEvents:c.followupEvents,afterEvents:c.afterEvents??c.afterFollowup,carryover:c.carryover,expectedFacts:c.expectedFacts,expectedActions:c.expectedActions,prohibitedClaims:c.prohibitedClaims,requiredSourceIds:c.requiredSourceIds,conversationId:view.conversationId,historyBefore,turns};
 }
 return {run,receipt:()=>({database:'One disposable SQLite database retained throughout this role run',rotations,transitions,archivedConversations:sqlite.prepare('SELECT id,title,turn_count,archived_at FROM companion_archives ORDER BY archived_at').all(),savedChatTurns:sqlite.prepare('SELECT count(*) AS n FROM companion_turns').get().n}),close:()=>sqlite.close()};
}
