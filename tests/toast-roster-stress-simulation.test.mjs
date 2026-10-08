import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {openPositionDatabase} from './all-position-week-fixture.mjs';
const runtime=path.resolve(process.env.JMAX_TOAST_ROSTER_RUNTIME??'.sites-runtime/shared');
const {handleToast}=await import(pathToFileURL(path.join(runtime,'toast-service.mjs')));
const {handleAccess}=await import(pathToFileURL(path.join(runtime,'access-service.mjs')));
const {handleToastSchedule}=await import(pathToFileURL(path.join(runtime,'toast-schedule-service.mjs')));
const {tokenHash,employeeCookie}=await import(pathToFileURL(path.join(runtime,'employee-session.mjs')));
const dir=path.resolve('evidence/schedule-toast-simulations-2026-10-08/roster/'+crypto.randomUUID());fs.mkdirSync(dir,{recursive:true});
const hash=()=>Object.fromEntries(fs.readdirSync(runtime).filter(f=>f.endsWith('.mjs')).sort().map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(runtime,f))).digest('hex')]));
const initialHashes=hash(),results=[];
const GUID='11111111-1111-4111-8111-111111111111',EMP='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',JOB='33333333-3333-4333-8333-333333333333',NEWEMP='44444444-4444-4444-8444-444444444444';
const profile={name:'Fictional New Cook',email:'new@example.test',area:'BOH',position:'Cook',capabilities:[],qualifications:[]};
const employee=(guid=EMP,extra={})=>({guid,firstName:'Fictional',lastName:'New Cook',email:'new@example.test',deleted:false,jobReferences:[{guid:JOB}],...extra});
const realDate=Date;
async function fixture(t,label,loc='berts'){
 const file=path.join(dir,label+'.sqlite');let store=openPositionDatabase(file),now=realDate.parse('2026-10-08T16:00:00Z');
 globalThis.Date=class extends realDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 t.after(()=>{store.close();globalThis.Date=realDate;});
 for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())store.sqlite.exec(fs.readFileSync('drizzle/'+f,'utf8').replaceAll('--> statement-breakpoint',''));
 for(const l of ['berts','rudds','papa','comm'])store.sqlite.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').run(l,'Fictional '+l,'America/New_York');
 for(const [actor,caps,location,active=1] of [['admin',['location.manage'],loc],['manager',['tasks.manage','schedule.manage'],loc],['worker',[],loc],['suspended',[],loc,0],['foreign',['location.manage'],'comm']])store.sqlite.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,active) VALUES(?,?,?,?,?,?,?,?,?,?)').run(actor,actor+'@example.test',actor+'-identity',location,'Fictional '+actor,'BOH',actor==='admin'?'General manager':'Cook',JSON.stringify(caps),'[]',active);
 for(const l of ['berts','rudds','papa'])store.sqlite.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?,?)').run('jay-'+l,'jay@example.test','jay-identity',l,'Fictional Jay','BOH','Owner','["location.manage"]','[]');
 store.sqlite.prepare('INSERT INTO restaurant_access(auth_user_id,kind,home_location_id) VALUES(?,?,?)').run('jay-identity','jay',loc);
 store.sqlite.prepare('INSERT INTO restaurant_access(auth_user_id,kind,home_location_id) VALUES(?,?,?)').run('foreign-identity','commissary','comm');
 const bindings={TOAST_LOCATION_ID:loc,TOAST_RESTAURANT_GUID:GUID,TOAST_CLIENT_ID:'fictional-client',TOAST_CLIENT_SECRET:'fictional-secret'};
 let employees=[employee()],jobs=[{guid:JOB,title:'General manager',deleted:false}];let mode='normal',calls=[],during;
 const fetcher=async(url,options)=>{const u=new URL(url);calls.push({path:u.pathname,method:options.method});assert.equal(u.origin,'https://ws-api.toasttab.com');assert.equal(options.redirect,'manual');
  if(u.pathname.includes('/authentication/'))return Response.json({status:'SUCCESS',token:{tokenType:'Bearer',accessToken:'fictional-token',expiresIn:3600}});
  assert.equal(options.method,'GET');assert.equal(options.headers['Toast-Restaurant-External-ID'],GUID);
  if(during){const fn=during;during=undefined;await fn();}
  if(mode==='timeout')throw new DOMException('Fictional timeout','TimeoutError');
  if(mode==='forbidden')return new Response('PRIVATE_PROVIDER_BODY',{status:403});
  if(mode==='partial'&&u.pathname.endsWith('/jobs'))return new Response('PRIVATE_PROVIDER_BODY',{status:500});
  if(u.pathname.endsWith('/shifts'))return Response.json([{guid:'55555555-5555-4555-8555-555555555555',employeeReference:{guid:EMP},jobReference:{guid:JOB},inDate:'2026-10-08T16:00:00Z',outDate:'2026-10-08T20:00:00Z',modifiedDate:'2026-10-08T12:00:00Z',deleted:false}]);
  return Response.json(u.pathname.endsWith('/employees')?employees:jobs);
 };
 const req=(actor,route,body,location=loc)=>new Request('https://roster.example/api/'+route+'?locationId='+location+'&weekStart=2026-10-05',{headers:{'oai-authenticated-user-id':actor+'-identity','oai-authenticated-user-email':actor+'@example.test',Origin:'https://roster.example','Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 const read=async(response)=>({status:response.status,data:await response.json()});
 const toast=(actor='admin',post=true,location=loc,config=bindings)=>handleToast(req(actor,'integrations/toast',post?{locationId:location}:undefined,location),store.db,config,fetcher).then(read);
 const state=()=>handleAccess(req('admin','access'),store.db,bindings).then(read);
 const access=(action,input,record,rid=crypto.randomUUID())=>handleAccess(req('admin','access',{locationId:loc,requestId:rid,action,input,...(record?{recordId:record.recordId??record.id,expectedRevision:record.revision}:{})}),store.db,bindings).then(read);
 const snapshot=()=>JSON.stringify(store.sqlite.prepare('SELECT * FROM memberships ORDER BY id').all());
 const roster=()=>store.sqlite.prepare('SELECT data FROM toast_rosters WHERE location_id=?').get(loc)?.data;
 return {file,bindings,toast,state,access,snapshot,roster,req,fetcher,get store(){return store;},get calls(){return calls;},set employees(v){employees=v;},set jobs(v){jobs=v;},set mode(v){mode=v;},set during(v){during=v;},advance:(ms=61000)=>{now+=ms;},reopen:()=>{store.close();store=openPositionDatabase(file);},preview:()=>handleToastSchedule(req('admin','integrations/toast-schedule'),store.db,bindings,fetcher).then(read),draft:async()=>{const s=await state();return access('review.save',{profile,note:'Fictional checked personal identity',restaurantGuid:GUID,sourceAt:s.data.roster.retrievedAt,employeeId:s.data.roster.employees.find(p=>!p.archived).toastEmployeeId});}};
}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
function scenario(name,run){test(name,{concurrency:false},async t=>{const row={name,status:'running',checks:[]};results.push(row);try{await run(t,row);row.status='passed';}catch(e){row.status='failed';row.error=String(e.stack??e);throw e;}finally{fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify({results,runtime,initialHashes,finalHashes:hash(),runtimeUnchanged:JSON.stringify(initialHashes)===JSON.stringify(hash()),externalCalls:0,limits:['Fictional Toast HTTP responses and durable SQLite through actual protected handlers; no production connection or writes.','Roster refresh is import preview only; local access requires an explicit personal identity review.']},null,2)+'\n');}});}

for(const loc of ['berts','rudds','papa'])scenario(loc+': seven durable refreshes preserve access, permissions and upstream job identifiers',async(t,row)=>{
 const f=await fixture(t,loc,loc),original=f.snapshot();
 for(let n=1;n<=7;n++){
  f.employees=[employee(EMP,{firstName:'Updated '+n,payRate:99,wage:99,passcode:'PRIVATE_PASSCODE',phoneNumber:'PRIVATE_PHONE',jobReferences:[{guid:JOB},{guid:NEWEMP}]}),employee(NEWEMP,{email:'new@example.test'})];
  const result=ok(await f.toast());assert.equal(f.snapshot(),original);assert.equal(result.roster.employees[0].jobs.length,2);assert.ok(result.roster.employees.every(p=>p.issues.some(i=>i.includes('do not merge'))));assert.doesNotMatch(f.roster(),/PRIVATE_PASSCODE|PRIVATE_PHONE|payRate|wage|fictional-secret|fictional-token/);assert.equal((await f.state()).data.accounts.length,5);
  assert.equal((await f.toast()).status,429);f.reopen();assert.deepEqual(ok(await f.toast('admin',false)).roster,result.roster);assert.equal(f.snapshot(),original);f.advance();row.checks.push({day:n,refresh:true,persistence:true,noAccessMutation:true,duplicateEmailFlag:true,upstreamJobsPreserved:true});
 }
 assert.equal(f.calls.filter(c=>c.path.includes('authentication')).length,1);
 const count=f.calls.length;for(const actor of ['worker','manager','foreign'])assert.equal((await f.toast(actor)).status,403);assert.equal((await f.toast('admin',true,loc==='berts'?'rudds':'berts')).status,403);assert.equal(f.calls.length,count);
 ok(await f.toast('jay',false));
});

scenario('malformed, incomplete and timed-out refreshes keep the durable last good roster',async(t,row)=>{
 const f=await fixture(t,'malformed');ok(await f.toast());const saved=f.roster(),members=f.snapshot();
 for(const [name,mode,employees,jobs,expected] of [['duplicate employee','normal',[employee(),employee()],undefined,502],['duplicate job','normal',undefined,[{guid:JOB,title:'Cook'},{guid:JOB,title:'Dish'}],502],['missing references','normal',[employee(EMP,{jobReferences:null})],undefined,502],['partial response','partial',undefined,undefined,502],['timeout','timeout',undefined,undefined,503],['forbidden','forbidden',undefined,undefined,503],['empty employees','normal',[],undefined,502]]){
  f.advance();f.mode=mode;f.employees=employees??[employee()];f.jobs=jobs??[{guid:JOB,title:'Cook'}];const r=await f.toast();assert.equal(r.status,expected,name+' '+JSON.stringify(r.data));assert.equal(f.roster(),saved);assert.equal(f.snapshot(),members);assert.doesNotMatch(JSON.stringify(r.data),/PRIVATE_PROVIDER_BODY|fictional-token|fictional-secret/);f.reopen();assert.equal(f.roster(),saved);row.checks.push({case:name,status:r.status,savedRosterPreserved:true});
 }
});

scenario('actual reviewed onboarding maps the employee GUID into pulled Toast shifts',async(t,row)=>{
 const f=await fixture(t,'actual-onboarding');ok(await f.toast());const draft=ok(await f.draft());const input={identityConfirmed:true,note:'Checked individual and email'};const enabled=ok(await f.access('review.apply',input,draft,'apply-once'));f.reopen();assert.deepEqual(ok(await f.access('review.apply',input,draft,'apply-once')),enabled);
 const review=f.store.sqlite.prepare('SELECT status,employee_id,member_id FROM access_reviews').get();assert.equal(review.status,'applied');row.checks.push({actualReviewStatus:review.status,enabledMember:enabled.recordId});
 const preview=ok(await f.preview());row.actualPreview=preview;assert.deepEqual(preview.employees,[{toastEmployeeId:EMP,memberId:enabled.recordId,name:profile.name}]);
});

scenario('archived employee with a new Toast GUID can relink only through explicit checked rehire',async(t,row)=>{
 const f=await fixture(t,'rehire-guid');ok(await f.toast());const enabled=ok(await f.access('review.apply',{identityConfirmed:true,note:'Original checked identity'},ok(await f.draft())));let account=ok(await f.state()).accounts.find(a=>a.id===enabled.recordId);
 const archived=ok(await f.access('account.archive',{confirmed:true,departureReason:'quit',endedDate:'2026-10-08',note:'Fictional original employment ended'},account));f.advance();f.employees=[employee(EMP,{deleted:true}),employee(NEWEMP)];ok(await f.toast());assert.equal(ok(await f.state()).accounts.find(a=>a.id===enabled.recordId).active,false);
 const fresh=ok(await f.draft());assert.equal((await f.access('review.apply',{identityConfirmed:true,replaceArchivedToastLink:true,note:'Cannot substitute for checked rehire',memberId:enabled.recordId,memberRevision:archived.revision},fresh)).status,409);
 const rehire=ok(await f.access('account.rehire',{profile,identityConfirmed:true,hireDate:'2026-10-09',note:'Explicit checked return'}, {id:enabled.recordId,revision:archived.revision}));
 const edited=ok(await f.access('account.save',{profile:{...profile,name:'Fictional New Cook returned'},identityConfirmed:true,note:'Reviewed ordinary profile correction after rehire'}, {id:enabled.recordId,revision:rehire.revision}));
 const input={identityConfirmed:true,note:'Checked new Toast GUID belongs to returning employee',memberId:enabled.recordId,memberRevision:edited.revision};assert.equal((await f.access('review.apply',input,fresh)).status,409);
 const before=f.snapshot(),linked=await f.access('review.apply',{...input,replaceArchivedToastLink:true},fresh,'explicit-relink-once');row.actualRelink=linked;assert.equal(linked.status,200,'Rehired same identity must be able to replace the retired GUID without duplicating the employee');f.reopen();assert.deepEqual(ok(await f.access('review.apply',{...input,replaceArchivedToastLink:true},fresh,'explicit-relink-once')),linked.data);assert.equal(f.snapshot(),before);
 const saved=f.store.sqlite.prepare('SELECT employee_id,status,member_id,data FROM access_reviews ORDER BY employee_id').all();const old=saved.find(r=>r.employee_id===EMP),current=saved.find(r=>r.employee_id===NEWEMP);assert.equal(old.status,'excluded');assert.equal(old.member_id,null);assert.equal(JSON.parse(old.data).retiredMemberId,enabled.recordId);assert.equal(current.status,'applied');assert.equal(current.member_id,enabled.recordId);assert.equal(f.store.sqlite.prepare("SELECT count(*) n FROM memberships WHERE email='new@example.test'").get().n,1);row.checks.push({explicitRehireRequired:true,explicitReplacementRequired:true,sameMembershipPreserved:true,oldReviewRetained:true,idempotentAfterReopen:true});
});

scenario('ambiguous normalized GUID and schedule-only identities remain unmatched',async(t,row)=>{
 const f=await fixture(t,'mapping-boundaries');ok(await f.toast());const enabled=ok(await f.access('review.apply',{identityConfirmed:true,note:'Checked individual'},ok(await f.draft())));assert.equal(ok(await f.preview()).employees.length,1);
 f.store.sqlite.prepare("UPDATE memberships SET schedule_only=1 WHERE id=?").run(enabled.recordId);assert.deepEqual(ok(await f.preview()).employees,[]);f.store.sqlite.prepare("UPDATE memberships SET schedule_only=0 WHERE id=?").run(enabled.recordId);
 f.store.sqlite.prepare("INSERT INTO access_reviews(id,location_id,restaurant_guid,employee_id,source_at,source,data,status,member_id,revision,updated_at) VALUES(?,?,?,?,?,'{}','{}','applied','worker',1,?)").run('legacy-ambiguous','berts',GUID,EMP.toUpperCase(),'2026-10-08','2026-10-08');assert.deepEqual(ok(await f.preview()).employees,[]);row.checks.push({scheduleOnlyExcluded:true,normalizedAmbiguityExcluded:true});
});

scenario('timezone change during the external read rejects the obsolete schedule interpretation',async(t,row)=>{
 const f=await fixture(t,'timezone-race');f.during=async()=>f.store.sqlite.prepare("UPDATE locations SET timezone='Pacific/Honolulu',revision=revision+1 WHERE id='berts'").run();const result=await f.preview();row.actual=result;assert.equal(result.status,409);assert.equal(result.data.snapshot,undefined);
});

scenario('loss of authority during roster refresh never saves or exposes the upstream result',async(t,row)=>{
 const f=await fixture(t,'revocation');f.during=async()=>f.store.sqlite.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='admin'").run();const r=await f.toast();assert.equal(r.status,403);assert.equal(r.data.roster,undefined);assert.equal(f.roster(),undefined);assert.equal(f.store.sqlite.prepare("SELECT count(*) n FROM audit_events WHERE action='toast.roster-read'").get().n,0);row.checks.push({revokedDuringRead:true,zeroRosterWrites:true});
});

scenario('a revoked phone session cannot publish a roster or fall back to owner browser headers',async(t,row)=>{
 const f=await fixture(t,'roster-phone-race'),token='c'.repeat(64),hashed=await tokenHash(token),revision=f.store.sqlite.prepare("SELECT revision FROM memberships WHERE id='admin'").get().revision;
 f.store.sqlite.prepare('INSERT INTO employee_sessions(token_hash,auth_user_id,member_id,member_revision,created_at,expires_at) VALUES(?,?,?,?,?,?)').run(hashed,'admin-identity','admin',revision,Date.now(),Date.now()+86400000);
 f.during=async()=>f.store.sqlite.prepare('DELETE FROM employee_sessions WHERE token_hash=?').run(hashed);
 const req=f.req('jay','integrations/toast',{locationId:'berts'});req.headers.set('Cookie',employeeCookie+'='+token);
 const response=await handleToast(req,f.store.db,f.bindings,f.fetcher),data=await response.json();row.actual={status:response.status,rosterReturned:!!data.roster};assert.ok(f.calls.some(c=>c.path==='/labor/v1/employees'),'The session must be valid before the paused upstream read');assert.equal(response.status,401);assert.equal(data.roster,undefined);assert.equal(f.roster(),undefined);
});

scenario('connection changed during the roster read cannot publish the old restaurant result',async(t,row)=>{
 const f=await fixture(t,'roster-connection-race');f.during=async()=>{f.bindings.TOAST_RESTAURANT_GUID=NEWEMP;};const result=await f.toast();row.actual={status:result.status,rosterReturned:!!result.data.roster};assert.equal(result.status,409);assert.equal(result.data.roster,undefined);assert.equal(f.roster(),undefined);
});

test.after(()=>console.log('Toast roster stress evidence: '+path.join(dir,'summary.json')));
