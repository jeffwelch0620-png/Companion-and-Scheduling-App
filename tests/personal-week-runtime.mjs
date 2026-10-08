// Isolated, disposable software rehearsal. Never used by the hosted application.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {Miniflare} from 'miniflare';
import {localInstant,nextDate} from '../.sites-runtime/shared/local-time.mjs';

export const weekStart='2026-09-21',zone='America/New_York';
export const accounts=[['owner','Morgan Manager','Owner','Executive',['location.manage','people.manage','people.approve','tasks.manage','standards.approve','schedule.manage','schedule.publish','schedule.change','close.confirm']],['cook','Casey Cook','Cook','BOH',[]],['host','Harper Host','Host','FOH',[]],['dish','Drew Dish','Dishwasher','BOH',[]],['backup','Robin Cook','Cook','BOH',[]]];
export async function createPersonalWeek({automaticLearning=false}={}){
 process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
 let at=localInstant(weekStart,'08:00',zone);const captures=[];
 const wrapper=path.resolve('.sites-runtime/personal-week-worker.js');
 // Freeze only the disposable Worker, so API and browser observe the same day.
 // This wrapper is outside dist and cannot be included in a Sites archive.
 fs.mkdirSync(path.dirname(wrapper),{recursive:true});
 fs.writeFileSync(wrapper,`import app from '../dist/server/index.js';\nconst RealDate=Date;let clock=0;globalThis.Date=class extends RealDate {constructor(...args){super(...(args.length?args:[clock]))}static now(){return clock}};export default {fetch(request,env,ctx){clock=RealDate.parse(request.headers.get('x-fictional-rehearsal-time'));if(!Number.isFinite(clock))return new Response('Fictional time required',{status:400});return app.fetch(request,env,ctx)}};`);
 const root=path.resolve('dist/client');
 const assets=async request=>{let file;try{file=path.resolve(root,'.'+decodeURIComponent(new URL(request.url).pathname))}catch{return new Response('Not found',{status:404})}if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return new Response('Not found',{status:404});return new Response(fs.readFileSync(file),{headers:{'Content-Type':({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'})[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}})};
 const worker=new Miniflare({modules:true,scriptPath:wrapper,modulesRoot:path.resolve('.'),modulesRules:[{type:'ESModule',include:['**/*.js']}],compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{OPENAI_API_KEY:'sk-fictional-week-only'},serviceBindings:{ASSETS:assets},outboundService:async request=>{
  if(request.url!=='https://api.openai.com/v1/responses')return new Response('No external calls in rehearsal',{status:403});
  const body=await request.json(),context=JSON.parse(body.input[1].content.split('\n').slice(1).join('\n'));captures.push(context);
  const station=context.selectedShift?.station??context.myShift?.station,approved=context.myShift?.approvedGuideIds?.length||context.evidence?.some(item=>item.source.kind==='standard');
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:'Fictional context check: '+(context.selectedEmployee?.name?context.selectedEmployee.name+' · ':'')+(station??'No assigned station')+'. '+(approved?'Approved source available.':'No approved station method is available; ask your manager.')+' This is a software test reply.',sourceIds:[]})}]}]});
 }});
 const db=await worker.getD1Database('DB');
 try{
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind('week','Fictional weekly rehearsal',zone).run();
 for(const [id,name,job,area,caps] of accounts)await db.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,schedule_jobs) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,id+'@example.test',id,'week',name,area,job,JSON.stringify(caps),'[]',JSON.stringify([job])).run();
 const request=async(actor,pathname,body)=>worker.dispatchFetch('http://127.0.0.1:5511'+pathname,{method:body?'POST':'GET',headers:{Origin:'http://127.0.0.1:5511','Content-Type':'application/json','oai-authenticated-user-id':actor,'oai-authenticated-user-email':actor+'@example.test','x-fictional-rehearsal-time':at},...(body?{body:JSON.stringify(body)}:{})});
 const get=async actor=>{const r=await request(actor,'/api/workspace?locationId=week');if(!r.ok)throw Error(await r.text());return r.json()};
 const call=async(actor,action,input={},record,requestId=crypto.randomUUID())=>{const r=await request(actor,'/api/workspace',{locationId:'week',requestId,action,input,...(record?{recordId:record.id??record.recordId,expectedRevision:record.revision}:{})});const data=await r.json();if(!r.ok)throw Object.assign(Error(action+': '+JSON.stringify(data)),{status:r.status});return data};
 const fresh=async(actor,r)=>(await get(actor)).records.find(x=>x.id===(r.id??r.recordId));
 const stations={},guides={};
 for(const [title,job,area] of [['Fry','Cook','BOH'],['Grill','Cook','BOH'],['Pizza','Cook','BOH'],['Seating','Host','FOH'],['Busser','Host','FOH'],['Back Window','Host','FOH'],['Food Runner','Host','FOH']]){
  let guide={recordId:'guide-'+title.replaceAll(' ','-'),revision:1};
  await db.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,1,?,?)').bind(guide.recordId,'week','standard','owner',area,JSON.stringify({title:title+' practice guide',zone:title,position:title,version:1,status:'draft',history:[],source:'Fictional software rehearsal only',criteria:['The '+title+' practice card is in the empty tray.',...(automaticLearning?['The practice card is checked with the reviewer.']:[])],verification:'manager',guide:{purpose:'Rehearse the '+title+' software path.',preparation:['Read the fictional '+title+' card.'],steps:['Place only the '+title+' practice card in the test tray.'],troubleshooting:['If the practice card is missing, ask Morgan Manager.'],escalation:'Ask Morgan Manager about the fictional practice.'}}),at).run();
  if(title!=='Pizza')guide=await call('owner','standard.approve',{validated:true,note:'Software fixture; no restaurant standard approved.'},guide);
  guides[title]=guide;
  stations[title]=await call('owner','station.save',{title,area,levels:[],independentLevel:null,status:'active',note:'Fictional weekly setup',setup:{jobs:[job],allJobMembers:true,memberIds:[],standardIds:[guide.recordId],managerId:'owner',goals:automaticLearning?[]:[{id:'practice-'+title,title:'Practice '+title,definition:'Demonstrate the '+title+' practice card with the reviewing manager.',dueDays:3,standardId:guide.recordId}]}});
 }
 const shifts={};
 for(let day=0;day<7;day++)for(const actor of ['cook','host','dish']){
  if(actor==='cook'&&day===4)continue;
  const station=actor==='cook'?['Fry','Grill','Grill','Fry',null,'Pizza','Grill'][day]:actor==='host'?['Seating','Busser','Back Window','Food Runner','Food Runner','Seating','Busser'][day]:null;
  const date=nextDate(weekStart,day),overnight=actor==='cook'&&day===6,position=accounts.find(a=>a[0]===actor)[2];
  const shift=await call('owner','shift.save',{personId:actor,position,...(station?{stationId:stations[station].recordId}:{}),start:localInstant(date,overnight?'22:00':'10:00',zone),end:localInstant(overnight?nextDate(date):date,overnight?'02:00':'18:00',zone)});shifts[actor+'-'+day]=shift;
 }
 const all=(await get('owner')).records.filter(r=>r.kind==='shift').sort((a,b)=>b.data.start.localeCompare(a.data.start));
 await call('owner','shift.publish-batch',{weekStart,confirmed:true,note:'Fictional seven-day review only',drafts:all.map(r=>({id:r.id,revision:r.revision,closing:[]}))});
 await call('owner','shift.save',{personId:'cook',position:'Cook',stationId:stations.Pizza.recordId,start:localInstant(nextDate(weekStart,4),'19:00',zone),end:localInstant(nextDate(weekStart,4),'20:00',zone)});
 return {worker,db,assets,captures,stations,guides,shifts,get,call,request,fresh,get at(){return at},setTime(value){at=value},dispose:()=>worker.dispose()};
 }catch(error){await worker.dispose();throw error}
}

async function serve(){
 const runtime=await createPersonalWeek({automaticLearning:process.argv.includes('--learning')}),servers=[];
 if(process.argv.includes('--learning'))await runtime.db.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,schedule_jobs) VALUES(?,?,?,?,?,?,?,?,?,?)').bind('gm','gm@example.test','gm','week','Independent Approver','Executive','Owner',JSON.stringify(['location.manage','people.approve']),'[]','[]').run();
 for(const [i,account] of accounts.entries()){
  const actor=account[0],port=5511+i;
  const server=http.createServer(async(req,res)=>{try{
   const url=new URL(req.url,'http://127.0.0.1:'+port);
   if(url.pathname==='/_week/time'){const day=Number(url.searchParams.get('day')),hour=url.searchParams.get('hour')??'12:00';if(!Number.isInteger(day)||day<0||day>7||!/^\d{2}:\d{2}$/.test(hour))throw Error('Invalid test time');runtime.setTime(localInstant(nextDate(weekStart,day),hour,zone));res.writeHead(302,{Location:'/team'});res.end();return}
   if(url.pathname==='/_week/clock.js'){res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});res.end(`{const RealDate=Date,base=RealDate.now(),at=${Date.parse(runtime.at)};globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[at+RealDate.now()-base]))}static now(){return at+RealDate.now()-base}}}`);return}
   if(url.pathname==='/_week'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Fictional week controls</title><h1>Fictional week only</h1><p>'+actor+' · '+runtime.at+'</p>'+['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday','Monday overnight'].map((name,d)=>'<p><a href="/_week/time?day='+d+'&hour='+(d===7?'01:00':d===6?'23:00':'12:00')+'">'+name+'</a></p>').join('')+'<a href="/team">Open Companion</a></html>');return}
   if(req.method==='GET'&&url.pathname!=='/team'){const asset=await runtime.assets(new Request(url));if(asset.ok){res.writeHead(asset.status,Object.fromEntries(asset.headers));res.end(Buffer.from(await asset.arrayBuffer()));return}}
   const headers=new Headers();for(const [k,v] of Object.entries(req.headers))if(v&&!['host','connection','content-length'].includes(k))headers.set(k,Array.isArray(v)?v.join(','):v);
   headers.set('oai-authenticated-user-id',actor);headers.set('oai-authenticated-user-email',actor+'@example.test');headers.set('x-fictional-rehearsal-time',runtime.at);
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const response=await runtime.worker.dispatchFetch(url.href,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
   const outHeaders=Object.fromEntries(response.headers);delete outHeaders['content-length'];
   res.writeHead(response.status,outHeaders);
   if(response.headers.get('Content-Type')?.includes('text/html'))res.end((await response.text()).replace('<head>','<head><script src="/_week/clock.js"></script>'));
   else res.end(Buffer.from(await response.arrayBuffer()));
  }catch(error){res.writeHead(500);res.end('Fictional review error: '+error.message)}});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});servers.push(server);console.log(account[1]+': http://127.0.0.1:'+port+'/_week');
 }
 const stop=async()=>{for(const s of servers)s.close();await runtime.dispose();process.exit(0)};process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await serve();
