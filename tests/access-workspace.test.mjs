import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {handleAccess} from '../.sites-runtime/shared/access-service.mjs';
import {handleWorkspace} from '../.sites-runtime/shared/service.mjs';
import {normalizeToastRoster} from '../.sites-runtime/shared/toast-roster.mjs';
import {localDate} from '../.sites-runtime/shared/local-time.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
const guid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const profile={name:'Sample New Cook',email:'new@example.test',area:'BOH',position:'Cook',capabilities:[],qualifications:[]};
const headers=actor=>actor?{'oai-authenticated-user-id':actor+'-identity','oai-authenticated-user-email':actor+'@example.test'}:{};
function ok(r){assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
async function fixture(t){
  const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
  for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
  await db.batch(['a','b'].map(id=>db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(id,'Fictional '+id,'America/New_York')));
  for(const [actor,caps,position,location] of [['admin',['location.manage'],'Administrator','a'],['second',['location.manage'],'Administrator','a'],['manager',['schedule.manage','tasks.manage'],'Manager','a'],['worker',[],'Cook','a'],['dish',['location.manage'],'Dishwasher','a'],['outsider',['location.manage'],'Administrator','b']]){
    await db.prepare('INSERT INTO memberships(id,email,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?)').bind(actor,actor+'@example.test',location,'Fictional '+actor,'BOH',position,JSON.stringify(caps),JSON.stringify([position])).run();
  }
  const roster=normalizeToastRoster([{guid:'toast-new',firstName:'Sample',lastName:'New Cook',email:'new@example.test',jobReferences:[{guid:'cook'},{guid:'dish'}]},{guid:'toast-system',firstName:'System',lastName:'Login',email:'shared@example.test',jobReferences:[]},{guid:'toast-old',firstName:'Sample',lastName:'Archived',deleted:true,jobReferences:[]}],[{guid:'cook',title:'Cook'},{guid:'dish',title:'Dishwasher'}],guid,'2026-09-06T22:00:00.000Z');
  await db.prepare('INSERT INTO toast_rosters(location_id,restaurant_guid,data,retrieved_at,requested_by) VALUES(?,?,?,?,?)').bind('a',guid,JSON.stringify(roster),roster.retrievedAt,'admin').run();
  async function access(actor,action,input={},record,options={}){
    const body={requestId:options.requestId??crypto.randomUUID(),locationId:options.locationId??'a',action,input,...(record?{recordId:record.id??record.recordId,expectedRevision:record.revision}:{})};
    const response=await handleAccess(new Request('https://test.example/api/access',{method:'POST',headers:{...headers(actor),Origin:options.origin??'https://test.example','Content-Type':'application/json'},body:JSON.stringify(body)}),db);
    return {status:response.status,data:await response.json(),body};
  }
  async function state(actor='admin',location='a'){
    const response=await handleAccess(new Request('https://test.example/api/access?locationId='+location,{headers:headers(actor)}),db);return {status:response.status,data:await response.json()};
  }
  async function workspace(actor,action,input={},record,options={}){
    const response=await handleWorkspace(new Request('https://test.example/api/workspace'+(action?'':'?locationId=a'),{method:action?'POST':'GET',headers:{...headers(actor),Origin:'https://test.example','Content-Type':'application/json'},...(action?{body:JSON.stringify({requestId:options.requestId??crypto.randomUUID(),locationId:'a',action,input,...(record?{recordId:record.recordId,expectedRevision:record.revision}:{})})}:{})}),db);return {status:response.status,data:await response.json()};
  }
  async function draft(overrides={},record){
    return access('admin','review.save',{profile,note:'Fictional identity review',restaurantGuid:guid,sourceAt:roster.retrievedAt,employeeId:'toast-new',...overrides},record);
  }
  return {db,roster,state,access,workspace,draft};
}
test('employee setup excludes ordinary managers, Dish, other locations and cross-site actions',async t=>{
  const f=await fixture(t);
  for(const actor of ['worker','manager','dish','outsider'])assert.equal((await f.state(actor)).status,403);
  assert.equal((await f.state(null)).status,401);
  assert.equal((await f.state('admin','b')).status,403);
  assert.equal((await f.access('admin','review.save',{},undefined,{origin:'https://other.example'})).status,403);
  const s=ok(await f.state());assert.equal(s.accounts.length,5);assert.equal(s.roster.employees.length,3);
  assert.ok(s.accounts.every(a=>!('auth_user_id' in a)&&!('authUserId' in a)));
});
test('a saved draft does not grant access; enabling requires identity review and never infers station clearance',async t=>{
  const f=await fixture(t),review=ok(await f.draft());
  assert.equal((await f.workspace('new')).status,403);
  assert.equal(ok(await f.state()).reviews[0].status,'draft');
  assert.equal((await f.access('admin','review.apply',{note:'Unchecked'},review)).status,400);
  const enabled=ok(await f.access('admin','review.apply',{note:'Individual and email checked',identityConfirmed:true},review));
  const w=ok(await f.workspace('new'));assert.equal(w.me.id,enabled.recordId);assert.deepEqual(w.me.capabilities,[]);assert.deepEqual(w.me.qualifications,[]);
  const period={personId:w.me.id,position:'Cook',start:'2026-09-14T16:00:00-04:00',end:'2026-09-14T22:00:00-04:00'};
  assert.equal((await f.workspace('manager','shift.save',period)).status,400);
  const account=ok(await f.state()).accounts.find(a=>a.id===w.me.id);
  assert.equal((await f.access('admin','account.save',{profile:{...profile,qualifications:['Cook']},identityConfirmed:true,note:'Missing training confirmation'},account)).status,400);
  ok(await f.access('admin','account.save',{profile:{...profile,qualifications:['Cook']},identityConfirmed:true,clearancesConfirmed:true,note:'Fictional training record verified'},account));
  ok(await f.workspace('manager','shift.save',period));
});
test('excluded and archived records cannot be enabled; invalid permissions and Dish escalation are rejected',async t=>{
  const f=await fixture(t);
  const excluded=ok(await f.draft({employeeId:'toast-system',exclude:true,profile:{...profile,name:'Shared login',email:''}}));
  assert.equal((await f.access('admin','review.apply',{note:'No',identityConfirmed:true},excluded)).status,409);
  assert.equal((await f.draft({employeeId:'toast-old'})).status,400);
  assert.equal((await f.draft({profile:{...profile,capabilities:['root']}})).status,400);
  assert.equal((await f.draft({profile:{...profile,position:'dishwasher',capabilities:['location.manage']}})).status,400);
  const draft=ok(await f.draft({profile:{...profile,position:'dishwasher',qualifications:['Dishwasher']}}));
  const applied=ok(await f.access('admin','review.apply',{note:'Dish identity and clearance checked',identityConfirmed:true,clearancesConfirmed:true},draft));
  const s=ok(await f.workspace('new'));assert.equal(s.me.id,applied.recordId);assert.equal(s.me.position,'Dishwasher');assert.deepEqual(s.me.capabilities,[]);
  assert.equal((await f.state('new')).status,403);
});
test('source refresh invalidates an earlier review and keeps access unchanged until reviewed again',async t=>{
  const f=await fixture(t),draft=ok(await f.draft());
  const changed={...f.roster,retrievedAt:'2026-09-06T23:00:00.000Z'};changed.employees=changed.employees.map(p=>p.toastEmployeeId==='toast-new'?{...p,name:'Changed name'}:p);
  await f.db.prepare('UPDATE toast_rosters SET data=?,retrieved_at=? WHERE location_id=?').bind(JSON.stringify(changed),changed.retrievedAt,'a').run();
  assert.equal((await f.access('admin','review.apply',{note:'Stale',identityConfirmed:true},draft)).status,409);
  assert.equal((await f.draft({},draft)).status,409);
  const updated=ok(await f.draft({sourceAt:changed.retrievedAt,profile:{...profile,name:'Changed name'}},draft));
  ok(await f.access('admin','review.apply',{note:'New source checked',identityConfirmed:true},updated));
  assert.equal(ok(await f.workspace('new')).me.name,'Changed name');
});
test('duplicate login requires an explicit existing-account link and preserves its suspended state and permissions',async t=>{
  const f=await fixture(t);ok(await f.workspace('worker'));
  const account=ok(await f.state()).accounts.find(a=>a.id==='worker');
  const draft=ok(await f.draft({profile:{...profile,email:account.email,capabilities:['orders.review'],qualifications:['Fry']}}));
  assert.equal((await f.access('admin','review.apply',{note:'Do not duplicate',identityConfirmed:true,clearancesConfirmed:true},draft)).status,409);
  const suspended=ok(await f.access('admin','account.suspend',{note:'Fixture pause'},account));
  ok(await f.access('admin','review.apply',{note:'Existing identity verified',identityConfirmed:true,memberId:'worker',memberRevision:suspended.revision},draft));
  const linked=ok(await f.state()).accounts.find(a=>a.id==='worker');
  assert.equal(linked.active,false);assert.deepEqual(linked.capabilities,[]);assert.deepEqual(linked.qualifications,['Cook']);assert.equal(linked.revision,suspended.revision);
  assert.equal((await f.workspace('worker')).status,403);
});
test('suspension blocks further requests and retains outstanding work; bound identity and self-access stay protected',async t=>{
  const f=await fixture(t);ok(await f.workspace('worker'));
  const task=ok(await f.workspace('manager','task.create',{ownerId:'worker',title:'Fictional task',detail:'Fixture only',kind:'task',due:'2026-09-15T20:00:00Z'}));
  let s=ok(await f.state()),worker=s.accounts.find(a=>a.id==='worker');
  assert.ok(worker.outstanding>0);
  assert.equal((await f.access('admin','account.save',{profile:{...profile,email:worker.email,name:worker.name,area:'FOH',qualifications:['Cook']},identityConfirmed:true,note:'Wrong department while work remains'},worker)).status,409);
  assert.equal((await f.access('admin','account.save',{profile:{...profile,email:'stolen@example.test'},identityConfirmed:true,note:'Changed identity'},worker)).status,409);
  assert.equal((await f.access('admin','account.suspend',{note:'Self'},s.accounts.find(a=>a.id==='admin'))).status,403);
  const suspended=ok(await f.access('admin','account.suspend',{note:'Pause access immediately'},worker));
  assert.equal((await f.workspace('worker')).status,403);
  assert.equal((await f.workspace('worker','task.transition',{step:'ready',note:'Must fail'},task)).status,403);
  assert.equal((await f.db.prepare('SELECT revision FROM records WHERE id=?').bind(task.recordId).first()).revision,task.revision);
  s=ok(await f.state());worker=s.accounts.find(a=>a.id==='worker');assert.equal(worker.outstanding,1);
  assert.equal((await f.access('admin','account.save',{profile:{...profile,email:worker.email,name:worker.name,area:'FOH',qualifications:['Cook']},identityConfirmed:true,note:'Suspending must not bypass work reassignment'},worker)).status,409);
  ok(await f.access('admin','account.save',{profile:{name:worker.name,email:worker.email,area:worker.area,position:worker.position,capabilities:worker.capabilities,qualifications:worker.qualifications},identityConfirmed:true,note:'Reviewed return'}, {id:worker.id,revision:suspended.revision}));
  ok(await f.workspace('worker'));
});
test('identical uncertain retries enable exactly one account; reused request identifiers cannot change intent',async t=>{
  const f=await fixture(t),draft=ok(await f.draft()),requestId=crypto.randomUUID(),input={note:'Reviewed once',identityConfirmed:true};
  const results=await Promise.all([f.access('admin','review.apply',input,draft,{requestId}),f.access('admin','review.apply',input,draft,{requestId})]);
  // A racing read may see applied state before the receipt is loaded. The same
  // request still resolves on retry, without creating a second account.
  assert.ok(results.some(r=>r.status===200));
  const retry=ok(await f.access('admin','review.apply',input,draft,{requestId}));
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE email='new@example.test'").first()).n,1);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM access_changes WHERE action='review.apply'").first()).n,1);
  assert.equal(retry.recordId,results.find(r=>r.status===200).data.recordId);
  assert.equal((await f.access('admin','review.apply',{...input,note:'Different intent'},draft,{requestId})).status,409);
});
test('access change rollback and concurrent administrators cannot leave partial permissions or lock everyone out',async t=>{
  const f=await fixture(t),s=ok(await f.state()),worker=s.accounts.find(a=>a.id==='worker');
  await f.db.prepare("CREATE TRIGGER fail_access_change BEFORE INSERT ON access_changes BEGIN SELECT RAISE(ABORT,'fixture failure'); END").run();
  assert.equal((await f.access('admin','account.suspend',{note:'Should roll back'},worker)).status,503);
  assert.equal((await f.db.prepare("SELECT active FROM memberships WHERE id='worker'").first()).active,1);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM command_receipts').first()).n,0);
  await f.db.prepare('DROP TRIGGER fail_access_change').run();
  ok(await f.state('second'));const latest=ok(await f.state());
  const a=latest.accounts.find(a=>a.id==='admin'),b=latest.accounts.find(a=>a.id==='second');
  const changes=await Promise.all([f.access('admin','account.suspend',{note:'Admin fixture A'},b),f.access('second','account.suspend',{note:'Admin fixture B'},a)]);
  assert.equal(changes.filter(r=>r.status===200).length,1);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE active=1 AND id IN ('admin','second')").first()).n,1);
});

async function shiftDraft(f,day,record){return ok(await f.workspace('manager','shift.save',{personId:'worker',position:'Cook',start:day+'T16:00:00-04:00',end:day+'T22:00:00-04:00',note:'Fictional weekly draft'},record));}

const today=()=>localDate(new Date().toISOString(),'America/New_York');
const futureDay=()=>new Date(Date.now()+7*86400000).toISOString().slice(0,10);
const departure=(overrides={})=>({confirmed:true,departureReason:'quit',endedDate:today(),note:'Fictional departure reviewed',...overrides});
const accountProfile=a=>({name:a.name,email:a.email,area:a.area,position:a.position,capabilities:a.capabilities,qualifications:a.qualifications});

test('correction help counts as outstanding work and survives employee departure without exposing private details',async t=>{
  const f=await fixture(t),at=new Date().toISOString();
  const data={shiftId:'fixture-shift',standardId:'fixture-standard',standardRevision:1,standard:{title:'Fictional Cook close',zone:'Practice area',position:'Cook',version:1,criteria:['Fictional kit ready'],source:'Test only',verification:'manager',status:'approved',history:[]},managerId:'manager',due:futureDay()+'T23:00:00Z',phase:'correction',answers:[],correction:{personId:'worker',assignedBy:'manager',assignedAt:at,note:'Fictional helper assignment'},history:[{actorId:'manager',at,action:'correction-assigned',note:'Worker helps; second remains owner'}]};
  await f.db.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind('helper-close','a','close','second','BOH',1,JSON.stringify(data),at).run();
  let worker=ok(await f.state()).accounts.find(a=>a.id==='worker');assert.equal(worker.outstanding,1);assert.deepEqual(worker.responsibilities,[{category:'Closing responsibilities',count:1}]);
  assert.equal((await f.access('admin','account.save',{profile:{...accountProfile(worker),qualifications:[]},identityConfirmed:true,clearancesConfirmed:true,note:'Cannot remove clearance with linked correction work'},worker)).status,409);
  ok(await f.access('admin','account.archive',departure({note:'Private helper departure note'}),worker));
  worker=ok(await f.state()).accounts.find(a=>a.id==='worker');assert.equal(worker.active,false);assert.equal(worker.outstanding,1);
  const row=await f.db.prepare('SELECT owner_id,revision,data FROM records WHERE id=?').bind('helper-close').first();assert.equal(row.owner_id,'second');assert.equal(row.revision,1);assert.deepEqual(JSON.parse(row.data),data);
  const manager=ok(await f.workspace('manager'));assert.deepEqual(manager.formerMembers,[{id:'worker',name:'Fictional worker'}]);assert.equal(JSON.stringify(manager).includes('Private helper departure note'),false);assert.equal((await f.workspace('worker')).status,403);
  await f.db.prepare('UPDATE records SET data=? WHERE id=?').bind(JSON.stringify({...data,phase:'closed'}),'helper-close').run();
  assert.equal(ok(await f.state()).accounts.find(a=>a.id==='worker').outstanding,0);
});

test('manual new hire stays disabled until saved identity and training are explicitly reviewed',async t=>{
  const f=await fixture(t),p={...profile,qualifications:['Cook']};
  const saved=ok(await f.access('admin','hire.save',{profile:p,hireDate:today(),note:'Fictional new hire; Toast not connected'}));
  let account=ok(await f.state()).accounts.find(a=>a.id===saved.recordId);
  assert.equal(account.active,false);assert.equal(account.employment.status,'onboarding');assert.equal(account.employment.hireDate,today());
  assert.equal((await f.workspace('new')).status,403);
  assert.equal((await f.workspace('manager','shift.save',{personId:account.id,position:'Cook',start:futureDay()+'T16:00:00Z',end:futureDay()+'T20:00:00Z'})).status,400);
  assert.equal((await f.access('admin','hire.save',{profile:p,hireDate:today(),note:'Duplicate must fail'})).status,409);
  assert.equal((await f.access('admin','hire.activate',{note:'Identity not confirmed'},account)).status,400);
  assert.equal((await f.access('admin','hire.activate',{identityConfirmed:true,note:'Training not confirmed'},account)).status,400);
  const updated=ok(await f.access('admin','hire.save',{profile:{...p,name:'Reviewed New Cook'},hireDate:today(),note:'Saved correction'},account));
  assert.equal((await f.access('admin','hire.activate',{identityConfirmed:true,clearancesConfirmed:true,note:'Stale draft'},account)).status,409);
  ok(await f.access('admin','hire.activate',{profile:{...p,email:'injected@example.test',capabilities:['location.manage']},identityConfirmed:true,clearancesConfirmed:true,note:'Saved setup checked'},updated));
  const w=ok(await f.workspace('new'));assert.equal(w.me.id,saved.recordId);assert.equal(w.me.name,'Reviewed New Cook');assert.deepEqual(w.me.capabilities,[]);assert.deepEqual(w.me.qualifications,['Cook']);
  account=ok(await f.state()).accounts.find(a=>a.id===saved.recordId);assert.equal(account.employment.status,'active');
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM access_reviews WHERE member_id=?').bind(account.id).first()).n,0);
});

test('archiving blocks access and assignments but preserves work, names and private departure history',async t=>{
  const f=await fixture(t);ok(await f.workspace('worker'));
  const task=ok(await f.workspace('manager','task.create',{ownerId:'worker',title:'Unfinished fixture',detail:'Private work detail',kind:'task',due:futureDay()+'T20:00:00Z'}));
  const shift=await shiftDraft(f,futureDay()),worker=ok(await f.state()).accounts.find(a=>a.id==='worker');
  const saved=ok(await f.access('admin','account.archive',departure({note:'Private departure note'}),worker));
  assert.equal((await f.workspace('worker')).status,403);
  assert.equal((await f.workspace('worker','task.transition',{step:'ready',note:'Denied'},task)).status,403);
  const archived=ok(await f.state()).accounts.find(a=>a.id==='worker');
  assert.equal(archived.active,false);assert.equal(archived.employment.status,'archived');assert.equal(archived.employment.departureReason,'quit');assert.equal(archived.outstanding,2);
  assert.deepEqual(archived.responsibilities,[{category:'Upcoming shifts',count:1},{category:'Operational tasks',count:1}]);
  for(const record of [task,shift]){const row=await f.db.prepare('SELECT owner_id,revision FROM records WHERE id=?').bind(record.recordId).first();assert.equal(row.owner_id,'worker');assert.equal(row.revision,record.revision);}
  const manager=ok(await f.workspace('manager'));assert.equal(manager.members.some(m=>m.id==='worker'),false);assert.deepEqual(manager.formerMembers,[{id:'worker',name:'Fictional worker'}]);
  assert.equal(JSON.stringify(manager).includes('Private departure note'),false);assert.equal(JSON.stringify(manager.formerMembers).includes('quit'),false);
  assert.deepEqual(ok(await f.workspace('second')).formerMembers,[]);
  assert.equal((await f.workspace('manager','shift.save',{personId:'worker',position:'Cook',start:futureDay()+'T16:00:00Z',end:futureDay()+'T20:00:00Z'})).status,400);
  await f.db.prepare("UPDATE memberships SET qualifications='[\"Cook\"]' WHERE id='second'").run();
  ok(await f.workspace('manager','shift.save',{personId:'second',position:'Cook',start:futureDay()+'T16:00:00Z',end:futureDay()+'T20:00:00Z',note:'Reassigned departed employee draft'},shift));
  assert.equal((await f.db.prepare('SELECT owner_id FROM records WHERE id=?').bind(shift.recordId).first()).owner_id,'second');
  assert.equal(ok(await f.state()).accounts.find(a=>a.id==='worker').outstanding,1);
  assert.equal((await f.access('admin','account.archive',departure(),saved)).status,409);
});

test('departure validation, temporary suspension and administrator boundaries remain distinct',async t=>{
  const f=await fixture(t),state=ok(await f.state());
  for(const actor of ['worker','manager','dish','outsider'])assert.equal((await f.access(actor,'account.archive',departure(),state.accounts.find(a=>a.id==='worker'))).status,403);
  const worker=ok(await f.state()).accounts.find(a=>a.id==='worker');
  assert.equal((await f.access('admin','account.archive',departure(),state.accounts.find(a=>a.id==='admin'))).status,403);
  for(const input of [departure({confirmed:false}),departure({departureReason:'unknown'}),departure({endedDate:futureDay()}),departure({endedDate:'2026-02-30'})])assert.equal((await f.access('admin','account.archive',input,worker)).status,400);
  const paused=ok(await f.access('admin','account.suspend',{note:'Temporary pause'},worker));
  assert.equal(ok(await f.state()).accounts.find(a=>a.id==='worker').employment.status,'active');
  assert.equal((await f.access('admin','account.archive',departure(),worker)).status,409);
  ok(await f.access('admin','account.archive',departure({departureReason:'terminated'}),paused));
  const ended=ok(await f.state()).accounts.find(a=>a.id==='worker');assert.equal(ended.employment.departureReason,'terminated');assert.equal(ended.active,false);
  const hire=ok(await f.access('admin','hire.save',{profile,hireDate:futureDay(),note:'Future start'}));
  // A withdrawn offer can be archived before its planned start without enabling it.
  ok(await f.access('admin','account.archive',departure({departureReason:'other'}),hire));
});

test('ordinary edits, duplicate hires and Toast links cannot reactivate an archived account; reviewed rehire keeps its identity and history',async t=>{
  const f=await fixture(t);ok(await f.workspace('worker'));
  const worker=ok(await f.state()).accounts.find(a=>a.id==='worker'),p=accountProfile(worker);
  const ended=ok(await f.access('admin','account.archive',departure({departureReason:'terminated'}),worker));
  assert.equal((await f.access('admin','account.save',{profile:p,identityConfirmed:true,note:'Wrong restoration workflow'},ended)).status,409);
  assert.equal((await f.access('admin','hire.save',{profile:p,hireDate:today(),note:'Must not duplicate departed employee'})).status,409);
  const reviewed=ok(await f.draft({profile:p}));
  ok(await f.access('admin','review.apply',{memberId:'worker',memberRevision:ended.revision,identityConfirmed:true,note:'Link only; keep archived'},reviewed));
  assert.equal(ok(await f.state()).accounts.find(a=>a.id==='worker').employment.status,'archived');assert.equal((await f.workspace('worker')).status,403);
  const input={profile:p,hireDate:today(),identityConfirmed:true,note:'Fictional reviewed rehire'};
  assert.equal((await f.access('admin','account.rehire',input,ended)).status,400);
  assert.equal((await f.access('admin','account.rehire',{...input,clearancesConfirmed:true,profile:{...p,email:'someoneelse@example.test'}},ended)).status,409);
  assert.equal((await f.access('admin','account.rehire',{...input,clearancesConfirmed:true,hireDate:'2020-01-01'},ended)).status,400);
  ok(await f.access('admin','account.rehire',{...input,clearancesConfirmed:true},ended));
  const restored=ok(await f.workspace('worker'));assert.equal(restored.me.id,'worker');
  const state=ok(await f.state()),account=state.accounts.find(a=>a.id==='worker');assert.equal(account.employment.status,'active');assert.equal(account.employment.endedDate,null);assert.equal(state.reviews[0].memberId,'worker');
  assert.equal(state.history.find(h=>h.action==='account.archive').employment.departureReason,'terminated');
  assert.equal(state.history.find(h=>h.action==='account.rehire').employment.hireDate,today());
  assert.equal((await f.db.prepare("SELECT auth_user_id FROM memberships WHERE id='worker'").first()).auth_user_id,'worker-identity');
  assert.equal((await f.access('admin','account.archive',departure({endedDate:'2020-01-01'}),account)).status,400);
});

test('an interrupted archive rolls back all state and audit, then identical retries archive once',async t=>{
  const f=await fixture(t),worker=ok(await f.state()).accounts.find(a=>a.id==='worker'),requestId=crypto.randomUUID(),input=departure();
  await f.db.prepare("CREATE TRIGGER fail_access_change BEFORE INSERT ON access_changes BEGIN SELECT RAISE(ABORT,'fixture failure'); END").run();
  assert.equal((await f.access('admin','account.archive',input,worker,{requestId})).status,503);
  const unchanged=ok(await f.state()).accounts.find(a=>a.id==='worker');assert.equal(unchanged.active,true);assert.equal(unchanged.employment.status,'active');assert.equal(unchanged.revision,worker.revision);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM command_receipts').first()).n,0);
  await f.db.prepare('DROP TRIGGER fail_access_change').run();
  const archived=ok(await f.access('admin','account.archive',input,worker,{requestId}));assert.deepEqual(ok(await f.access('admin','account.archive',input,worker,{requestId})),archived);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM access_changes WHERE action='account.archive'").first()).n,1);
  assert.equal((await f.access('admin','account.save',{profile:accountProfile(worker),identityConfirmed:true,note:'Stale open editor'},worker)).status,409);
});

const selection=records=>records.map(r=>({id:r.recordId,revision:r.revision,closing:[]}));
async function publisher(f){await f.db.prepare("UPDATE memberships SET capabilities='[\"schedule.manage\",\"schedule.publish\",\"tasks.manage\"]',revision=revision+1 WHERE id='manager'").run();}
test('weekly publishing commits exactly the reviewed drafts and employee notices in one retry-safe change',async t=>{
  const f=await fixture(t),a=await shiftDraft(f,'2026-09-14'),b=await shiftDraft(f,'2026-09-15'),unselected=await shiftDraft(f,'2026-09-16');await publisher(f);
  const input={weekStart:'2026-09-14',drafts:selection([a,b]),confirmed:true,note:'Both exact drafts reviewed'},requestId=crypto.randomUUID();
  const saved=ok(await f.workspace('manager','shift.publish-batch',input,undefined,{requestId}));
  assert.deepEqual(ok(await f.workspace('manager','shift.publish-batch',input,undefined,{requestId})),saved);
  const employee=ok(await f.workspace('worker'));
  assert.equal(employee.records.filter(r=>r.kind==='shift').length,2);assert.equal(employee.records.some(r=>r.id===unselected.recordId),false);
  assert.equal(employee.records.filter(r=>r.kind==='message'&&r.data.title==='Shift published').length,2);
  for(const r of employee.records.filter(r=>r.kind==='shift'))assert.equal(r.data.history.at(-1).note,input.note);
});
test('one stale or unqualified shift prevents the entire weekly selection from publishing',async t=>{
  const f=await fixture(t),a=await shiftDraft(f,'2026-09-14'),b=await shiftDraft(f,'2026-09-15');await publisher(f);
  const changed=await shiftDraft(f,'2026-09-15',b),input={weekStart:'2026-09-14',drafts:selection([a,b]),confirmed:true,note:'Must not partially publish'};
  assert.equal((await f.workspace('manager','shift.publish-batch',input)).status,409);
  assert.equal(ok(await f.workspace('worker')).records.filter(r=>r.kind==='shift'||r.kind==='message').length,0);
  await f.db.prepare("UPDATE memberships SET qualifications='[]',revision=revision+1 WHERE id='worker'").run();
  assert.equal((await f.workspace('manager','shift.publish-batch',{...input,drafts:selection([a,changed])})).status,400);
  assert.equal(ok(await f.workspace('worker')).records.filter(r=>r.kind==='shift'||r.kind==='message').length,0);
});
test('weekly publishing enforces publisher authority, explicit confirmation, unique selections and local start dates',async t=>{
  const f=await fixture(t),a=await shiftDraft(f,'2026-09-14'),input={weekStart:'2026-09-14',drafts:selection([a]),confirmed:true,note:'Boundary checks'};
  assert.equal((await f.workspace('manager','shift.publish-batch',input)).status,403);await publisher(f);
  assert.equal((await f.workspace('manager','shift.publish-batch',{...input,confirmed:false})).status,400);
  assert.equal((await f.workspace('manager','shift.publish-batch',{...input,drafts:selection([a,a])})).status,400);
  const overnight=ok(await f.workspace('manager','shift.save',{personId:'worker',position:'Cook',start:'2026-09-13T23:00:00-04:00',end:'2026-09-14T02:00:00-04:00'}));
  assert.equal((await f.workspace('manager','shift.publish-batch',{...input,drafts:selection([a,overnight])})).status,400);
  const endNight=ok(await f.workspace('manager','shift.save',{personId:'worker',position:'Cook',start:'2026-09-20T23:00:00-04:00',end:'2026-09-21T02:00:00-04:00'}));
  ok(await f.workspace('manager','shift.publish-batch',{...input,drafts:selection([a,endNight])}));
  assert.equal(ok(await f.workspace('worker')).records.filter(r=>r.kind==='shift').length,2);
});

const draftInput=(r,day)=>({id:r.recordId,revision:r.revision,input:{personId:'worker',position:'Cook',start:day+'T16:00:00-04:00',end:day+'T22:00:00-04:00'}});
test('bulk draft editing supports exchanged slots, stays unpublished and uncertain retries save exactly once',async t=>{
  const f=await fixture(t),a=await shiftDraft(f,'2026-09-14'),b=await shiftDraft(f,'2026-09-15');
  const input={weekStart:'2026-09-14',confirmed:true,note:'Exchange these two draft slots',drafts:[draftInput(a,'2026-09-15'),draftInput(b,'2026-09-14')]},requestId=crypto.randomUUID();
  const saved=ok(await f.workspace('manager','shift.save-batch',input,undefined,{requestId}));
  assert.deepEqual(ok(await f.workspace('manager','shift.save-batch',input,undefined,{requestId})),saved);
  const shifts=ok(await f.workspace('manager')).records.filter(r=>r.kind==='shift');assert.equal(shifts.length,2);assert.ok(shifts.every(r=>!r.data.published&&r.revision===2&&r.data.history.length===2));
  assert.equal(shifts.find(r=>r.id===a.recordId).data.start,'2026-09-15T20:00:00.000Z');assert.equal(ok(await f.workspace('worker')).records.length,0);
});
test('bulk draft conflicts, stale selections and authority failures cannot partially change a week',async t=>{
  const f=await fixture(t),a=await shiftDraft(f,'2026-09-14'),b=await shiftDraft(f,'2026-09-15');
  const input={weekStart:'2026-09-14',confirmed:true,note:'Conflict checks',drafts:[draftInput(a,'2026-09-16'),draftInput(b,'2026-09-16')]};
  assert.equal((await f.workspace('manager','shift.save-batch',input)).status,400);
  assert.equal((await f.workspace('worker','shift.save-batch',input)).status,404);
  assert.equal((await f.workspace('manager','shift.save-batch',{...input,confirmed:false})).status,400);
  assert.equal((await f.workspace('manager','shift.save-batch',{...input,drafts:[draftInput(a,'2026-09-16'),draftInput(a,'2026-09-17')]})).status,400);
  await shiftDraft(f,'2026-09-15',b);
  assert.equal((await f.workspace('manager','shift.save-batch',{...input,drafts:[draftInput(a,'2026-09-16'),draftInput(b,'2026-09-17')]})).status,409);
  assert.equal(ok(await f.workspace('manager')).records.find(r=>r.id===a.recordId).revision,1);
  await publisher(f);const published=ok(await f.workspace('manager','shift.publish',{},a));
  assert.equal((await f.workspace('manager','shift.save-batch',{...input,drafts:[draftInput(published,'2026-09-17')]})).status,400);
});


test('co-owner setup requires a restaurant-wide administrator and identity confirmation, copies permissions and keeps no invented hire or training data',async t=>{
 const f=await fixture(t),input={name:'Fictional Co-owner',email:'coowner@example.test',coOwner:true,identityConfirmed:true,note:'Confirmed co-owner',capabilities:['orders.review']};
 for(const actor of ['worker','manager','dish','outsider'])assert.equal((await f.access(actor,'administrator.add',input)).status,403);
 await f.db.prepare("UPDATE memberships SET capabilities=? WHERE id='admin'").bind(JSON.stringify(['location.manage','schedule.manage','schedule.publish'])).run();
 assert.equal((await f.access('admin','administrator.add',{...input,identityConfirmed:false})).status,400);
 assert.equal((await f.access('admin','administrator.add',input,undefined,{origin:'https://other.example'})).status,403);
 const requestId=crypto.randomUUID(),created=ok(await f.access('admin','administrator.add',input,undefined,{requestId}));
 assert.deepEqual(ok(await f.access('admin','administrator.add',input,undefined,{requestId})),created);
 const state=ok(await f.state()),account=state.accounts.find(a=>a.id===created.recordId);
 assert.equal(account.position,'Co-owner');assert.equal(account.area,'Executive');assert.equal(account.active,false);assert.equal(account.claimed,false);assert.equal(account.administratorRequest.status,'invited');
 assert.deepEqual(account.capabilities,['location.manage','schedule.manage','schedule.publish']);assert.deepEqual(account.qualifications,[]);assert.equal(account.employment.hireDate,null);
 assert.equal(state.history.filter(h=>h.action==='administrator.add').length,1);
 assert.equal((await f.access('admin','administrator.add',input)).status,409);
 assert.equal((await f.workspace('coowner')).status,403);
 const verified=ok(await f.state()).accounts.find(a=>a.id===account.id);assert.equal(verified.administratorRequest.status,'requested');
 ok(await f.access('admin','administrator.approve',{administratorRequestId:verified.administratorRequest.requestId,identityConfirmed:true,note:'Confirmed this is the invited co-owner'}, {recordId:account.id,revision:verified.revision}));
 const signedIn=ok(await f.workspace('coowner'));assert.equal(signedIn.me.id,account.id);
 assert.equal((await f.state('coowner','b')).status,403);
});
