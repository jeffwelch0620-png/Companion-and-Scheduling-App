// Local-only browser QA harness. Fictional identities are injected by a loopback
// proxy outside the application. No role picker or login bypass ships in app code.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { Miniflare } from 'miniflare';
import { normalizeToastRoster } from '../.sites-runtime/shared/toast-roster.mjs';
import { localDate, localInstant, nextDate } from '../.sites-runtime/shared/local-time.mjs';
import { seedMockWeek, weeklyAccounts } from './mock-week-fixture.mjs';

process.env.MINIFLARE_REGISTRY_PATH ??= path.resolve('.wrangler/registry');
const assetsRoot=path.resolve('dist/client');
async function assets(request){
  let file;try{file=path.resolve(assetsRoot,`.${decodeURIComponent(new URL(request.url).pathname)}`)}catch{return new Response('Not found',{status:404})}
  if(!file.startsWith(`${assetsRoot}${path.sep}`)||!fs.existsSync(file)||!fs.statSync(file).isFile())return new Response('Not found',{status:404});
  const mime={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'}[path.extname(file)]??'application/octet-stream';
  return new Response(fs.readFileSync(file),{headers:{'Content-Type':mime,'Cache-Control':'no-store'}});
}
const liveAI=process.argv.includes('--ai');
const recoveryQA=process.argv.includes('--chat-recovery');
if(recoveryQA&&liveAI)throw Error('Controlled recovery checks cannot use live AI.');
const recovery={mode:'none',providerCalls:0,askRequests:0,failedReads:0,slowReads:0};
const recoveryModes=['none','service-error','invalid-provider-json','slow','slow-poll','lost-response','lost-response-and-read','hung-response'];
if(liveAI)process.loadEnvFile('.env.local');
const aiBindings=liveAI?{OPENAI_API_KEY:process.env.OPENAI_API_KEY,JMAX_OPENAI_MODEL:'gpt-5.4-mini'}:recoveryQA?{OPENAI_API_KEY:'sk-fictional-recovery-only',JMAX_OPENAI_MODEL:'gpt-5.4-mini'}:{};
// The desktop network proxy supports Node's transport; workerd's direct TLS
// path returns 421 here. Forward only this exact provider URL for opt-in live
// QA. Requests and responses remain real; no provider answer is substituted.
const outboundService=recoveryQA?async request=>{
  if(request.url!=='https://api.openai.com/v1/responses'||request.method!=='POST')return new Response('Blocked by isolated recovery test',{status:403});
  recovery.providerCalls++;
  if(recovery.mode==='service-error'){recovery.mode='none';return Response.json({error:{code:'server_error',message:'Fictional upstream failure'}},{status:503});}
  if(recovery.mode==='invalid-provider-json'){recovery.mode='none';return new Response('<html>FICTIONAL_GATEWAY_CONTENT</html>');}
  if(['slow','slow-poll'].includes(recovery.mode)){recovery.mode='none';await new Promise(resolve=>setTimeout(resolve,10000));}
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:'Controlled recovery-test answer. This fictional response checks conversation saving and retry behavior; it is not restaurant operating guidance.',sourceIds:[]})}]}]});
}:liveAI?async request=>{
  if(request.url!=='https://api.openai.com/v1/responses'||request.method!=='POST'){console.log(JSON.stringify({qa:'provider-host-rejected'}));return new Response('Unavailable in local AI review',{status:403});}
  const response=await fetch(request.url,{method:'POST',headers:request.headers,body:await request.arrayBuffer(),redirect:'manual',signal:AbortSignal.timeout(45000)});
  const data=await response.clone().json().catch(()=>null);
  const code=data?.error?.code,param=data?.error?.param;
  console.log(JSON.stringify({qa:'live-provider-result',status:response.status,...(typeof code==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(code)?{code}:{}),...(typeof param==='string'&&/^[a-zA-Z0-9_.]{1,80}$/.test(param)?{param}:{}),...(Number.isSafeInteger(data?.usage?.input_tokens)?{inputTokens:data.usage.input_tokens,outputTokens:data.usage.output_tokens}:{})}));
  return response;
}:undefined;
const worker=new Miniflare({bindings:aiBindings,outboundService,modules:true,scriptPath:path.resolve('dist/server/index.js'),modulesRoot:path.resolve('dist/server'),modulesRules:[{type:'ESModule',include:['**/*.js']}],compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],serviceBindings:{ASSETS:assets}});
const db=await worker.getD1Database('DB');
for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync(`drizzle/${file}`,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
const weekly=process.argv.includes('--weekly');
const accounts=weekly?weeklyAccounts:[
  ['worker','Review employee','FOH','Server',[]],
  ['senior','Review senior','FOH','Senior server',['close.verify','schedule.change']],
  ['manager','Review manager','FOH','Manager',['schedule.manage','schedule.publish','schedule.change','close.confirm','standards.approve','tasks.manage','people.manage','orders.request','orders.review']],
  ['incoming','Review replacement','FOH','Server',[]],
  ['dish','Review dishwasher','BOH','Dishwasher',[]],
  ['gm','Review GM','FOH','General manager',['people.manage','people.approve','operations.escalation']],
  ['opener','Review opening manager','FOH','Opening manager',['tasks.manage','people.manage','schedule.change']],
  ['admin','Review administrator','FOH','Administrator',['location.manage']],
];
if(!weekly){
await db.prepare('INSERT INTO locations(id,name,timezone) VALUES (?,?,?)').bind('review','Private build review · fictional team','America/New_York').run();
for(const [id,name,area,position,caps] of accounts)await db.prepare('INSERT INTO memberships(id,email,location_id,name,area,position,capabilities,qualifications) VALUES (?,?,?,?,?,?,?,?)').bind(id,`${id}@example.test`,'review',name,area,position,JSON.stringify(caps),JSON.stringify([position])).run();
// Fictional saved-read fixture exercises the review UI without provider credentials.
const sampleRoster=normalizeToastRoster([
  {guid:'fictional-toast-1',firstName:'Sample',lastName:'Cook',email:'sample@example.test',jobReferences:[{guid:'fictional-job-1'},{guid:'fictional-job-2'}]},
  {guid:'fictional-toast-2',firstName:'Sample',lastName:'Needs Review',jobReferences:[]},
  {guid:'fictional-toast-3',firstName:'Sample',lastName:'Archived',deleted:true,jobReferences:[]},
],[{guid:'fictional-job-1',title:'Cook'},{guid:'fictional-job-2',title:'Dishwasher'}],'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
await db.prepare('INSERT INTO toast_rosters(location_id,restaurant_guid,data,retrieved_at,requested_by) VALUES (?,?,?,?,?)').bind('review',sampleRoster.restaurantGuid,JSON.stringify(sampleRoster),sampleRoster.retrievedAt,'admin').run();
async function command(action,input,record){const response=await worker.dispatchFetch('http://127.0.0.1:5293/api/workspace',{method:'POST',headers:{'oai-authenticated-user-id':'manager-fixture','oai-authenticated-user-email':'manager@example.test',Origin:'http://127.0.0.1:5293','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),locationId:'review',action,input,...(record?{recordId:record.recordId,expectedRevision:record.revision}:{})})});const result=await response.json();if(!response.ok)throw Error(JSON.stringify(result));return result}
const zone='America/New_York',qaDay=localDate(new Date().toISOString(),zone);
const period={start:localInstant(qaDay,'16:00',zone),end:localInstant(qaDay,'23:00',zone)};
await command('leadership.assign',{personId:'manager',area:'FOH',...period,note:'Fictional closing leadership for browser QA'});
await command('leadership.assign',{personId:'opener',area:'FOH',start:localInstant(nextDate(qaDay),'08:00',zone),end:localInstant(nextDate(qaDay),'16:00',zone),note:'Fictional opening leadership for browser QA'});
const learningGuide=process.argv.includes('--learning')?{title:'Fictional learning kit',guide:{purpose:'Rehearse a software learning workflow with a fictional practice kit.',preparation:['Use only the fictional blue practice card and empty practice tray.'],steps:['Read the practice label.','Place the blue practice card in the empty practice tray.'],troubleshooting:['If the blue practice card is missing, stop and ask the reviewing manager.'],escalation:'Ask the reviewing manager before using anything outside this fictional practice kit.'}}:{};
let standard=await command('standard.save',{title:'Server Station review',zone:'Server Station fixture',position:'Server',version:1,criteria:['Test counter cleared','Test stock counted'],verification:'senior-then-manager',source:'Fictional conditions for software checks; not a published restaurant SOP.',...learningGuide});
standard=await command('standard.approve',{validated:true,note:'Fictional test standard only'},standard);
let shift=await command('shift.save',{personId:'worker',position:'Server',...period});
await command('close.assign',{shiftId:shift.recordId,standardId:standard.recordId,managerId:'manager',verifierId:'senior',due:period.end});
shift=await command('shift.publish',{},shift);
for(const day of [nextDate(qaDay),nextDate(qaDay,2)])await command('shift.save',{personId:'worker',position:'Server',start:localInstant(day,'16:00',zone),end:localInstant(day,'22:00',zone),note:'Fictional weekly publication draft'});
if(process.argv.includes('--workforce')){
 const levels=Array.from({length:5},(_,i)=>({value:i+1,label:`Level ${i+1}`,definition:i===1?'Fictional practice with direct coaching.':i===3?'Fictional station practice performed independently.':''}));
 const station=await command('station.save',{title:'Server',area:'FOH',levels,independentLevel:4,status:'active',note:'Fictional software walkthrough only; not a restaurant policy.'});
 for(const [personId,level,certifiedTrainer] of [['worker',2,false],['incoming',4,true]])await command('proficiency.save',{personId,stationId:station.recordId,stationRevision:station.revision,level,certifiedTrainer,evidence:'Fictional learning kit practice. Confirm training time and workload with the manager.'});
 await command('shift.save',{personId:'incoming',position:'Server',...period,note:'Fictional training draft.'});
 const need=await command('staffing.save',{title:'Fictional paired Server practice',area:'FOH',position:'Server',minimum:2,...period,source:'Fictional two-person software practice window',note:'QA only.'});
 await command('staffing.approve',{note:'Fictional requirement reviewed',confirmed:true},need);
}
}else{
 const mock=await seedMockWeek(db,async(actor,action,input,record)=>{
  const response=await worker.dispatchFetch('http://127.0.0.1:5293/api/workspace',{method:'POST',headers:{'oai-authenticated-user-id':actor+'-fixture','oai-authenticated-user-email':actor+'@example.test',Origin:'http://127.0.0.1:5293','Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),locationId:'review',action,input,...(record?{recordId:record.id??record.recordId,expectedRevision:record.revision}:{})})});return {status:response.status,data:await response.json()};
 },{staffing:process.argv.includes('--staffing')});
 console.log('Mock week: '+mock.start+' through '+mock.days[6]+' · 28 unpublished shifts · 14 closing assignments');
}
const servers=[];
if(process.argv.includes('--chat-history')){
  await db.prepare("UPDATE memberships SET auth_user_id='worker-fixture' WHERE id='worker'").run();
  const member=await db.prepare("SELECT revision FROM memberships WHERE id='worker'").first();
  await db.prepare("INSERT INTO companion_conversations(location_id,member_id,id,membership_revision,explanation_style) VALUES('review','worker','qa-current',?,'brief')").bind(member.revision).run();
  await db.prepare("INSERT INTO companion_turns(location_id,member_id,request_id,conversation_id,fingerprint,question,answer,status,at) VALUES('review','worker','qa-question','qa-current','fixture','Fictional history walkthrough','This saved sample checks conversation recovery. It is fixture text, not an AI response or operating instruction.','complete',?)").bind(new Date().toISOString()).run();
}
const basePort=Number(process.env.JMAX_QA_PORT_BASE??5291);
if(!Number.isInteger(basePort)||basePort<1024||basePort+accounts.length>65535)throw Error('Invalid local QA port range.');
for(let index=0;index<accounts.length;index++){
  const actor=accounts[index][0],port=basePort+index;
  let accessFailureShown=false;
  const server=http.createServer(async(req,res)=>{
    try{
      const url=`http://127.0.0.1:${port}${req.url}`,headers=new Headers();
      if(recoveryQA&&new URL(url).pathname==='/__qa/chat'){
        if(req.method==='POST'){
          const parts=[];for await(const part of req)parts.push(part);
          const command=JSON.parse(Buffer.concat(parts).toString('utf8'));
          if(!recoveryModes.includes(command.mode)){res.writeHead(400);res.end();return;}
          recovery.mode=command.mode;recovery.failedReads=0;recovery.slowReads=0;
        }
        res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(recovery));return;
      }
      if(recoveryQA&&req.method==='GET'&&new URL(url).pathname==='/api/companion'&&recovery.failedReads>0){
        recovery.failedReads--;res.writeHead(503,{'Content-Type':'text/html'});res.end('<html>FICTIONAL_GATEWAY_CONTENT</html>');return;
      }
      if(recoveryQA&&req.method==='GET'&&new URL(url).pathname==='/api/companion'&&recovery.slowReads>0){recovery.slowReads--;await new Promise(resolve=>setTimeout(resolve,3000));}
      if(process.argv.includes('--access-recovery')&&!accessFailureShown&&req.method==='GET'&&new URL(url).pathname==='/api/workspace'){
        accessFailureShown=true;res.writeHead(403,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Your account has not been assigned to a restaurant.'}));return;
      }
      if(req.method==='GET'&&new URL(url).pathname!=='/team'){
        const asset=await assets(new Request(url));
        if(asset.ok){res.writeHead(asset.status,Object.fromEntries(asset.headers));res.end(Buffer.from(await asset.arrayBuffer()));return}
      }
      for(const [key,value] of Object.entries(req.headers))if(value&&!['host','content-length','connection'].includes(key))headers.set(key,Array.isArray(value)?value.join(','):value);
      headers.set('oai-authenticated-user-id',`${actor}-fixture`);headers.set('oai-authenticated-user-email',`${actor}@example.test`);
      const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>128000){res.writeHead(413);res.end();return}chunks.push(chunk)}
      const ask=recoveryQA&&req.method==='POST'&&new URL(url).pathname==='/api/companion'&&JSON.parse(Buffer.concat(chunks).toString('utf8')).action==='ask';
      const deliveryFault=ask?recovery.mode:'none';if(ask)recovery.askRequests++;
      const generation=worker.dispatchFetch(url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
      if(ask&&deliveryFault==='slow-poll'){
        // Return the saved pending view while generation continues; all later
        // conversation GETs deliberately exceed the former polling interval.
        recovery.slowReads=8;
        for(let check=0;check<40;check++){
          const current=await db.prepare('SELECT pending_request FROM companion_conversations WHERE member_id=?').bind(actor).first();
          if(current?.pending_request)break;
          await new Promise(resolve=>setTimeout(resolve,100));
        }
        const pending=await worker.dispatchFetch(`http://127.0.0.1:${port}/api/companion?locationId=review`,{headers});
        res.writeHead(pending.status,Object.fromEntries(pending.headers));res.end(Buffer.from(await pending.arrayBuffer()));
        void generation.then(response=>response.body?.cancel()).catch(()=>{});return;
      }
      const response=await generation;
      if(ask&&response.ok&&['lost-response','lost-response-and-read','hung-response'].includes(deliveryFault)){
        recovery.mode='none';
        if(deliveryFault==='lost-response-and-read')recovery.failedReads=1;
        if(deliveryFault==='hung-response'){
          const bytes=Buffer.from(await response.arrayBuffer());
          const timer=setTimeout(()=>{if(!res.destroyed){res.writeHead(response.status,Object.fromEntries(response.headers));res.end(bytes);}},65000);
          res.once('close',()=>clearTimeout(timer));return;
        }
        await response.body?.cancel();res.writeHead(502,{'Content-Type':'text/html'});res.end('<html>FICTIONAL_GATEWAY_CONTENT</html>');return;
      }
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
    }catch(error){res.writeHead(500);res.end('Local review request failed.');console.error(error instanceof Error?error.message:'Review error')}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});servers.push(server);
  console.log(`${accounts[index][1]}: http://127.0.0.1:${port}/team`);
}
async function shutdown(){for(const server of servers)server.close();await worker.dispose();process.exit(0)}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
