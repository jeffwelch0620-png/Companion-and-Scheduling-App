// Loopback-only fictional accounts. This harness is never packaged into the app.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { Miniflare } from 'miniflare';
import { sourceLibrary } from '../.sites-runtime/shared/source-library-data.mjs';
import { localDate, localInstant, nextDate } from '../.sites-runtime/shared/local-time.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
const root=path.resolve('dist/client');
async function assets(request){let file;try{file=path.resolve(root,'.'+decodeURIComponent(new URL(request.url).pathname))}catch{return new Response('Not found',{status:404})}if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return new Response('Not found',{status:404});const type={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'}[path.extname(file)]??'application/octet-stream';return new Response(fs.readFileSync(file),{headers:{'Content-Type':type,'Cache-Control':'no-store'}})}
const chatRecovery=process.argv.includes('--chat-access-recovery'),personalFlow=process.argv.includes('--personal-flow');
const worker=new Miniflare({modules:true,scriptPath:path.resolve('dist/server/index.js'),modulesRoot:path.resolve('dist/server'),modulesRules:[{type:'ESModule',include:['**/*.js']}],compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],serviceBindings:{ASSETS:assets},...(chatRecovery||personalFlow?{bindings:{OPENAI_API_KEY:'sk-fictional-recovery-check'},outboundService:async request=>{if(personalFlow&&request.url==='https://api.openai.com/v1/responses'){const data=await request.json(),context=JSON.parse(data.input[1].content.split('\n').slice(1).join('\n')),shift=context.myShift;return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:'Fictional browser check: '+(shift?.station?'Your '+shift.status+' is '+shift.station+' ('+shift.job+').':'No assigned station is available.')+' This is a test reply, not operating instructions.',sourceIds:[]})}]}]})}return request.url==='https://api.openai.com/v1/responses'?Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:'Fictional provider: your conversation can continue with current access.',sourceIds:[]})}]}]}):new Response('Blocked in fictional review',{status:403})}}:{})});
const db=await worker.getD1Database('DB');
for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind('berts','Fictional training review — isolated copy','America/New_York').run();
const accounts=[['owner','Review owner','Executive','Owner',['location.manage','standards.approve','people.manage']],['employee','Review employee','FOH','Server',[]],['dish','Review dishwasher','BOH','Dishwasher',[]]];
if(process.argv.includes('--lifecycle')){accounts[0][4].push('schedule.manage','schedule.publish','schedule.change','tasks.manage');accounts.push(['coworker','Review coworker','FOH','Server',[]]);}
if(process.argv.includes('--stations')){accounts[0][4].push('schedule.manage','schedule.publish','schedule.change','tasks.manage');accounts[1][3]='Host';accounts.push(['cook','Review cook','BOH','Cook',[]]);}
const servers=[];
for(let i=0;i<accounts.length;i++){
 const [actor,name,area,position,caps]=accounts[i],port=5491+i;
 await db.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?,?)').bind(actor,actor+'@example.test',actor,'berts',name,area,position,JSON.stringify(caps),JSON.stringify([position])).run();
 const server=http.createServer(async(req,res)=>{try{const url=`http://127.0.0.1:${port}${req.url}`,headers=new Headers();if(req.method==='GET'&&new URL(url).pathname!=='/team'){const asset=await assets(new Request(url));if(asset.ok){res.writeHead(asset.status,Object.fromEntries(asset.headers));res.end(Buffer.from(await asset.arrayBuffer()));return}}for(const [key,value] of Object.entries(req.headers))if(value&&!['host','content-length','connection'].includes(key))headers.set(key,Array.isArray(value)?value.join(','):value);headers.set('oai-authenticated-user-id',actor);headers.set('oai-authenticated-user-email',actor+'@example.test');const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>128000){res.writeHead(413);res.end();return}chunks.push(chunk)}const response=await worker.dispatchFetch(url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()))}catch{res.writeHead(500);res.end('Local review failed.')}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});servers.push(server);console.log(`${name}: http://127.0.0.1:${port}/team`);
}
if(chatRecovery){
 await db.prepare("INSERT INTO companion_conversations(location_id,member_id,id,membership_revision,explanation_style) VALUES('berts','owner','old-access',1,'brief')").run();
 await db.prepare("INSERT INTO companion_turns(location_id,member_id,request_id,conversation_id,fingerprint,question,answer,status,at) VALUES('berts','owner','old-question','old-access','fixture','Private fictional old-access question','Private fictional old-access answer','complete',?)").bind(new Date().toISOString()).run();
 await db.prepare("UPDATE memberships SET revision=revision+1 WHERE id='owner'").run();
 console.log('Fictional account-change chat recovery fixture ready; replies are mocked.');
}
if(process.argv.includes('--attendance')){
 const now=new Date().toISOString(),day=localDate(now,'America/New_York');
 for(const [id,personId,area,position,start,end] of [['attendance-shift','employee','FOH','Server','12:00','18:00'],['dish-shift','dish','BOH','Dishwasher','13:00','19:00']]){
  const data={personId,position,start:localInstant(day,start,'America/New_York'),end:localInstant(day,end,'America/New_York'),published:true,cancelled:false};
  await db.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,'berts','shift',personId,area,1,JSON.stringify(data),now).run();
 }
 console.log('Fictional published shifts ready for attendance testing.');
}
if(process.argv.includes('--history')){
 const date='2026-01-12T17:00:00.000Z',end='2026-01-12T23:00:00.000Z';
 for(const [id,kind,data] of [
  ['history-shift','shift',{personId:'employee',position:'Server',start:date,end,published:true,cancelled:false}],
  ['history-attendance','attendance',{title:'Fictional attendance history',employeeName:'Review employee',shiftId:'history-shift',shiftRevision:1,shift:{start:date,end,position:'Server'},type:'call-in',reportedAt:date,note:'Fictional manager note for testing historical corrections.',status:'recorded',history:[]}],
  ['history-notice','message',{title:'Fictional old shift notice',body:'Your fictional shift was published.',recipients:['employee'],readBy:['employee'],replies:[],automated:true,recordId:'history-shift'}],
 ])await db.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,1,?,?)').bind(id,'berts',kind,'employee','FOH',JSON.stringify(data),date).run();
 console.log('Old fictional shift, attendance and read notice ready for history review.');
}
if(process.argv.includes('--lifecycle')){
 const date=new Date(Date.now()+7*86400000);date.setUTCHours(17,0,0,0);const start=date.toISOString(),end=new Date(date.getTime()+6*3600000).toISOString();
 await db.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,1,?,?)').bind('departure-shift','berts','shift','employee','FOH',JSON.stringify({personId:'employee',position:'Server',start,end,published:true,cancelled:false}),new Date().toISOString()).run();
 await db.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,1,?,?)').bind('departure-leader','berts','leadership','owner','FOH',JSON.stringify({personId:'owner',area:'FOH',start,end,active:true,note:'Fictional departure reassignment rehearsal'}),new Date().toISOString()).run();
 console.log('Future fictional employee shift and authorized leader ready for departure review.');
}
if(process.argv.includes('--resume-review')){
 if(personalFlow)await db.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,1,?,?)').bind('personal-flow-duty','berts','task','employee','FOH',JSON.stringify({title:'Prepare the fictional practice tray',detail:'Software walkthrough only: place the sample card in the test tray.',kind:'task',phase:'open',due:new Date().toISOString(),history:[]}),new Date().toISOString()).run();
 async function command(actor,action,input,record){const response=await worker.dispatchFetch('http://127.0.0.1:5491/api/workspace',{method:'POST',headers:{Origin:'http://127.0.0.1:5491','Content-Type':'application/json','oai-authenticated-user-id':actor,'oai-authenticated-user-email':actor+'@example.test'},body:JSON.stringify({requestId:crypto.randomUUID(),locationId:'berts',action,input,...(record?{recordId:record.recordId,expectedRevision:record.revision}:{})})});const result=await response.json();if(!response.ok)throw Error(JSON.stringify(result));return result}
 const source=sourceLibrary.documents.find(d=>d.title==='Host Training Checklist Berts');
 let draft=await command('owner','standard.from-source',{sourceId:source.id,sourceHash:source.sha256,area:'FOH',title:'Fictional training kit review',position:'Server',zone:'Fictional practice kit'});
 const row=await db.prepare('SELECT data FROM records WHERE id=?').bind(draft.recordId).first(),data=JSON.parse(row.data);
 await command('owner','standard.save',{title:data.title,zone:data.zone,position:data.position,version:1,source:'Fictional card demonstration only; historical source linked for software testing.',criteria:['The fictional blue card is in the practice tray.'],verification:'manager',guide:{purpose:'Practice arranging a fictional training card.',preparation:[],steps:['Put the fictional blue card in the empty practice tray.'],troubleshooting:[],escalation:'Ask the reviewing trainer if the practice card is missing.'},sourceAnswers:Object.fromEntries(data.provenance.questions.map(q=>[q.id,'Fictional software review only. No historical procedure is adopted or current restaurant policy decided.'])),sourceReview:{ownerId:'owner',reviewedOn:'',evidence:'Fictional software walkthrough only. Not restaurant operating approval.'}},draft);
 for(const [title,phase] of [['Practice the fictional kit','active'],['Demonstrate the fictional kit','verification'],['Choose a practice goal','proposed']]){let goal=await command('owner','goal.create',{ownerId:'employee',managerId:'owner',type:'development',title,definition:'Fictional practice only. The employee demonstrates a sample card arrangement to the reviewer.',due:new Date(Date.now()+(phase==='active'?-86400000:86400000)).toISOString()});if(phase!=='proposed')goal=await command('employee','goal.transition',{step:'accept',note:'Fictional acceptance'},goal);if(phase==='verification')await command('employee','goal.transition',{step:'ready',note:'Fictional readiness; outcome not yet confirmed'},goal);}
 console.log('Fictional draft and learning follow-up fixtures prepared.');
}
if(process.argv.includes('--stations')){
 async function command(action,input,record){const response=await worker.dispatchFetch('http://127.0.0.1:5491/api/workspace',{method:'POST',headers:{Origin:'http://127.0.0.1:5491','Content-Type':'application/json','oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'},body:JSON.stringify({requestId:crypto.randomUUID(),locationId:'berts',action,input,...(record?{recordId:record.recordId,expectedRevision:record.revision}:{})})});const result=await response.json();if(!response.ok)throw Error(JSON.stringify(result));return result}
 const now=new Date().toISOString(),date=new Date(Date.now()+86400000);date.setUTCHours(17,0,0,0);const start=date.toISOString(),end=new Date(date.getTime()+6*3600000).toISOString();
 for(const [title,job,area] of [['Fry','Cook','BOH'],['Grill','Cook','BOH'],['Seating','Host','FOH'],['Busser','Host','FOH'],['Back Window','Host','FOH'],['Food Runner','Host','FOH']]){
  const guideId='guide-'+title.replaceAll(' ','-');
  await db.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,1,?,?)').bind(guideId,'berts','standard','owner',area,JSON.stringify({title:title+' fictional practice',position:title,zone:title,version:1,status:'approved',source:'Fictional local rehearsal only',verification:'manager',criteria:['The fictional practice card is in the tray.'],guide:{purpose:'Fictional demonstration only',preparation:[],steps:['Put the fictional practice card into the tray.'],troubleshooting:[],escalation:'Ask the fictional reviewer.'},history:[]}),now).run();
  const station=await command('station.save',{title,area,levels:[],independentLevel:null,status:'active',note:'Fictional job-based station setup',setup:{jobs:[job],allJobMembers:true,memberIds:[],standardIds:[guideId],managerId:'owner',goals:[{id:'practice-'+guideId,title:'Practice '+title,definition:'Demonstrate the fictional card check to the reviewing owner.',dueDays:7,standardId:guideId}]}});
  if(title==='Seating'&&!process.argv.includes('--roster')){const shift=await command('shift.save',{personId:'employee',position:'Host',stationId:station.recordId,start,end});await command('shift.publish',{},shift);}
 }
 console.log('Fictional Cook/Host stations, approved practice guides and a published Host shift ready.');
}
if(process.argv.includes('--roster')){
 const now=new Date().toISOString(),today=localDate(now,'America/New_York'),start=nextDate(today,-((new Date(today+'T12:00:00Z').getUTCDay()+6)%7));
 const extras=[['roster-cook2','Morgan Reed','Cook','BOH'],['roster-cook3','Casey Brooks','Cook','BOH'],['roster-long','Alexandra Montgomery-Williams','Cook','BOH'],['roster-host2','Taylor Parker','Host','FOH'],['roster-server','Jordan Blake','Server','FOH']];
 for(const [id,name,job,area] of extras)await db.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,schedule_jobs) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,id+'@example.test',id,'berts',name,area,job,'[]','[]',JSON.stringify([job])).run();
 const roster=[['cook','Cook','BOH','08:00','15:00','Fry'],['roster-cook2','Cook','BOH','09:00','16:00','Grill'],['roster-cook3','Cook','BOH','12:00','20:00','Fry'],['dish','Dishwasher','BOH','11:00','15:00',''],['roster-long','Cook','BOH','22:00','02:00','Grill'],['employee','Host','FOH','10:00','16:00','Seating'],['roster-host2','Host','FOH','14:00','20:00','Food Runner'],['roster-server','Server','FOH','10:00','17:00',''],['owner','Owner','Executive','09:00','17:00','']];
 const stations=(await db.prepare("SELECT id,data FROM records WHERE kind='station'").all()).results.map(r=>({id:r.id,...JSON.parse(r.data)}));
 for(let d=0;d<7;d++)for(const [personId,position,area,from,to,title] of roster){const day=nextDate(start,d),station=stations.find(s=>s.title===title),published=personId!=='roster-host2'||day!==today;const data={personId,position,start:localInstant(day,from,'America/New_York'),end:localInstant(to<=from?nextDate(day,1):day,to,'America/New_York'),published,cancelled:false,...(station?{stationId:station.id,stationName:station.title}:{})};await db.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,1,?,?)').bind('roster-'+personId+'-'+day,'berts','shift',personId,area,JSON.stringify(data),now).run();}
 console.log('Fictional full week, draft and overnight shifts ready for phone roster review.');
}
async function stop(){for(const s of servers)s.close();await worker.dispose();process.exit(0)}process.on('SIGINT',stop);process.on('SIGTERM',stop);
