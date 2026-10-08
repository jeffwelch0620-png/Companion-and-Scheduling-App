// Local-only browser acceptance. Every identity and record is fictional.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
const temporary=path.resolve('../../../preview-tmp');
fs.mkdirSync(temporary,{recursive:true});
process.env.TEMP=temporary;process.env.TMP=temporary;
process.env.MINIFLARE_REGISTRY_PATH=path.resolve('.wrangler/module-access-preview-registry');
const {Miniflare}=await import('miniflare');
const root=path.resolve(process.env.JMAX_TEST_DIST??'dist');
const assetsRoot=path.join(root,'client');
async function assets(request){
 let file;try{file=path.resolve(assetsRoot,`.${decodeURIComponent(new URL(request.url).pathname)}`)}catch{return new Response('Not found',{status:404})}
 if(!file.startsWith(assetsRoot+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return new Response('Not found',{status:404});
 const mime={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'}[path.extname(file)]??'application/octet-stream';
 return new Response(fs.readFileSync(file),{headers:{'Content-Type':mime,'Cache-Control':'no-store'}});
}
const worker=new Miniflare({modules:true,scriptPath:path.join(root,'server/index.js'),modulesRoot:path.join(root,'server'),modulesRules:[{type:'ESModule',include:['**/*.js']}],compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],serviceBindings:{ASSETS:assets},outboundService:()=>new Response('External services disabled in fictional browser acceptance.',{status:503})});
const db=await worker.getD1Database('DB');
for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync(`drizzle/${file}`,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
const locations={berts:"Bert's",rudds:"Rudd's",papa:"Papa Leone's",comm:'Commissary'};
for(const [id,name] of Object.entries(locations))await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(id,`DEMO ONLY · ${name}`,'America/New_York').run();
const actors=[
 ['owner','combined','Owner',['location.manage','tasks.manage']],
 ['gm','combined','General manager',['tasks.manage','operations.store']],
 ['foh','FOH','Service manager',['tasks.manage','people.manage']],
 ['boh','BOH','Kitchen manager',['tasks.manage','people.manage','orders.request','standards.approve']],
 ['cook','BOH','Cook',[]],['dish','BOH','Dishwasher',[]],
];
for(const [actor,area,position,caps] of actors)for(const location of actor==='owner'?Object.keys(locations):['berts'])await db.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,active) VALUES(?,?,?,?,?,?,?,?,?,1)').bind(`${actor}-${location}`,`${actor}@example.test`,`${actor}-preview-identity`,location,actor==='dish'?'DEMO AM Dishwasher':`DEMO ${position}`,location==='comm'?'production':area,position,JSON.stringify(caps),JSON.stringify([position])).run();
for(const [actor,label] of [['pm1','DEMO PM Dishwasher 1'],['pm2','DEMO PM Dishwasher 2']])await db.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,active) VALUES(?,?,?,?,?,?,?,?,?,1)').bind(`${actor}-berts`,`${actor}@example.test`,`${actor}-preview-identity`,'berts',label,'BOH','Dishwasher','[]',JSON.stringify(['Dishwasher'])).run();
// The home derives operating areas from non-admin members or records. Owner
// authority is not a department, so use a fictional production membership to
// establish the commissary's operating area without inventing FOH/BOH there.
await db.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,active) VALUES(?,?,?,?,?,?,?,?,?,1)').bind('production-comm','production@example.test','production-preview-identity','comm','DEMO Commissary production manager','production','Production manager',JSON.stringify(['tasks.manage']),JSON.stringify(['Production manager'])).run();
// A second independently authenticated BOH manager verifies created work.
await db.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,active) VALUES(?,?,?,?,?,?,?,?,?,1)').bind('verifier-berts','verifier@example.test','verifier-preview-identity','berts','DEMO Independent kitchen verifier','BOH','Kitchen manager',JSON.stringify(['tasks.manage','standards.approve']),JSON.stringify(['Kitchen manager'])).run();
const due=new Date(Date.now()+86400000).toISOString();
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
async function request(actor,location,action,input={},record){
 const response=await worker.dispatchFetch('http://127.0.0.1:6901/api/workspace',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://127.0.0.1:6901','oai-authenticated-user-id':`${actor}-preview-identity`,'oai-authenticated-user-email':`${actor}@example.test`},body:JSON.stringify({requestId:crypto.randomUUID(),locationId:location,action,input,...(record?{recordId:record.recordId,expectedRevision:record.revision}:{})})});
 const result=await response.json();if(!response.ok)throw Error(`${action}: ${response.status} ${JSON.stringify(result)}`);return result;
}
const seeded={};
for(const actor of ['cook','dish'])seeded[`${actor}Task`]=await request('boh','berts','task.create',{ownerId:`${actor}-berts`,title:`DEMO ${actor==='dish'?'Dish rack':'Prep station'} assignment`,detail:'Fictional manager assignment. Report ready, then use the independent verifier account to confirm the work.',kind:'task',due});
seeded.dishMessage=await request('boh','berts','message.send',{recipients:['dish-berts'],title:'DEMO Dish handoff',body:'Confirm this fictional assignment and reply to your manager.'});
seeded.cookFeedback=await request('cook','berts','feedback.save',{text:'DEMO Cook support request: please confirm next action.',shared:true});
for(const department of ['FOH','BOH']){
 const actor=department.toLowerCase();
 const issue=await request(actor,'berts','managerlog.create',{title:`DEMO ${department} attention item`,detail:'Fictional operational issue for workflow access acceptance.',category:'Maintenance',priority:'routine',department,ownerId:`${actor}-berts`,due});
 seeded[`${actor}Issue`]=issue;
 let summary=await request('gm','berts','shiftentry.save',{businessDate:today,department,shift:'closing',readiness:'action-needed',summary:`DEMO ${department}: review the linked manager issue.`,tomorrowNote:'Check the saved next action.',issueIds:[issue.recordId]});
 seeded[`${actor}Summary`]=await request('gm','berts','shiftentry.submit',{},summary);
}
let guide=await request('boh','berts','standard.save',{title:'DEMO Approved Dish instructions',zone:'module-dish-approved',position:'Dishwasher',criteria:['Fictional observable completion'],source:'Fictional reviewed instruction source',version:1,verification:'manager',guide:{purpose:'Fictional task guidance only.',preparation:[],steps:['Check with the fictional manager.'],troubleshooting:[],escalation:'Ask the manager when uncertain.'}});
// Approval uses a distinct authenticated reviewer with explicit guide authority.
seeded.dishGuide=await request('verifier','berts','standard.approve',{validated:true,note:'Fictional source checked'},guide);
fs.writeFileSync(path.resolve('.sites-runtime/module-access-preview-records.json'),JSON.stringify({fictional:true,businessDate:today,locations,records:seeded},null,2));
const servers=[];
async function serve(actor,port,role){
 const server=http.createServer(async(req,res)=>{try{
  const url=`http://127.0.0.1:${port}${req.url}`;
  if(req.method==='GET'){const asset=await assets(new Request(url));if(asset.ok){res.writeHead(asset.status,Object.fromEntries(asset.headers));res.end(Buffer.from(await asset.arrayBuffer()));return}}
  const headers=new Headers();for(const [k,v] of Object.entries(req.headers))if(v&&!['host','content-length','connection'].includes(k))headers.set(k,Array.isArray(v)?v.join(','):v);
  headers.set('oai-authenticated-user-id',`${actor}-preview-identity`);headers.set('oai-authenticated-user-email',`${actor}@example.test`);
  const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>128000){res.writeHead(413);res.end();return}chunks.push(chunk)}
  const response=await worker.dispatchFetch(url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(error){res.writeHead(500);res.end('Local acceptance request failed.');console.error(error.message)}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});servers.push(server);
 console.log(`DEMO ${actor}: http://127.0.0.1:${port}/module-access?role=${role}&location=berts`);
}
for(const [i,[actor]] of actors.entries())await serve(actor,6901+i,i===0?'owner':i===1?'general-manager':i<4?'department-manager':'frontline');
await serve('verifier',6907,'department-manager');
await serve('pm1',6908,'frontline');
await serve('pm2',6909,'frontline');
console.log('READY: shared disposable database; outbound services disabled; independent verifier on 6907, AM Dish on 6906, distinct PM Dish on 6908/6909. Type stop to dispose.');
async function shutdown(){for(const server of servers)server.close();await worker.dispose();process.exit(0)}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);process.stdin.setEncoding('utf8');process.stdin.on('data',value=>{if(value.trim()==='stop')void shutdown()});
