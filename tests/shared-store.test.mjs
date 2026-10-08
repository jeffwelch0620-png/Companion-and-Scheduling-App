import test from 'node:test';
import assert from 'node:assert/strict';
import {handleSharedStore,handleSharedStoreSession} from '../.sites-runtime/shared/shared-store-service.mjs';
import {sharedStoreCookie} from '../.sites-runtime/shared/shared-store-contract.mjs';

// Transport/auth boundary tests use synthetic provider responses. Atomic save,
// history, receipt and rollback behavior is tested separately against real local
// PostgreSQL by shared-store-postgres tests; these mocks do not prove SQL behavior.
const userId='11111111-1111-4111-8111-111111111111',token='synthetic-access-token-123456789';
const bindings={SUPABASE_URL:'https://shared.example.test',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fictional',SUPABASE_SECRET_KEY:'sb_secret_fictional'};
const member={id:'existing-manager-id',locationId:'berts',name:'Fictional manager',area:'BOH',position:'Cook',capabilities:['tasks.manage'],qualifications:[]};
const blank=()=>({workspace:{location:{id:'berts',name:"Bert's",timezone:'America/New_York',revision:3},me:{...member},members:[{...member}],records:[]},membershipRevision:2});
const input={title:'Fictional first shared note',detail:'Local verification only.',department:'BOH',ownerId:member.id,category:'Other',priority:'routine',due:'2026-10-02T17:00:00Z'};
const create=()=>({requestId:crypto.randomUUID(),locationId:'berts',action:'managerlog.create',input:{...input}});
const request=(body,headers={},suffix='')=>new Request('https://jmax.example.test/api/shared-store'+suffix,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers:{Origin:'https://jmax.example.test','Content-Type':'application/json',Authorization:'Bearer '+token,...headers}});
function fixture(options={}){
 const calls=[];
 const fetcher=async(url,init={})=>{
  calls.push({url,init,body:init.body?JSON.parse(init.body):null});
  if(options.failTransport)throw Error('private upstream diagnostic must not be exposed');
  const path=new URL(url).pathname;
  if(path==='/auth/v1/token')return Response.json({access_token:token,refresh_token:'never-return-this-refresh-token',expires_in:3600});
  if(path==='/auth/v1/user')return options.invalidAuth?Response.json({message:'private auth diagnostic'},{status:401}):Response.json({id:userId,email:'manager@example.test',is_anonymous:!!options.anonymous});
  if(options.rpcError)return Response.json(options.rpcError,{status:options.rpcStatus??503});
  const name=path.split('/').at(-1);
  if(name==='jmax_shared_memberships')return Response.json({...(!options.oldPolicy?{restaurantAccess:options.noMembership?null:options.policy??{version:1,kind:'restaurant',homeLocationId:'berts',revision:0}}:{}),memberships:options.noMembership?[]:options.memberships??[{id:member.id,locationId:'berts',name:member.name,position:member.position,locationName:"Bert's"}]});
  if(name==='jmax_shared_receipt')return Response.json(options.receipt??null);
  if(name==='jmax_shared_workspace')return Response.json(options.snapshot??blank());
  if(name==='jmax_shared_commit'){const args=JSON.parse(init.body);return Response.json({recordId:args.p_record_id,revision:args.p_records[0].revision,workspaceRevision:args.p_workspace_revision+1});}
  throw Error('Unexpected endpoint: '+path);
 };
 return {calls,fetcher,call:(req,env=bindings)=>handleSharedStore(req,env,fetcher),session:(req,env=bindings)=>handleSharedStoreSession(req,env,fetcher)};
}
test('missing shared configuration fails closed without network or local identity fallback',async()=>{
 const f=fixture();let response=await f.call(request(null),{});assert.equal(response.status,503);assert.equal(f.calls.length,0);
 response=await f.session(request(null,{},'/session'),{});assert.deepEqual(await response.json(),{configured:false,signedIn:false,message:'The shared connection is waiting for its server setup. Local review records are separate.'});assert.equal(f.calls.length,0);
 const forged=new Request('https://jmax.example.test/api/shared-store?access_token='+token,{headers:{'oai-authenticated-user-id':userId,'oai-authenticated-user-email':'manager@example.test'}});assert.equal((await f.call(forged)).status,401);assert.equal(f.calls.length,0);
});
test('real user verification boundary rejects invalid and anonymous access before any privileged RPC',async()=>{
 for(const options of [{invalidAuth:true},{anonymous:true}]){const f=fixture(options),r=await f.call(request(null));assert.equal(r.status,401);assert.equal(f.calls.length,1);assert.ok(f.calls[0].url.endsWith('/auth/v1/user'));assert.equal(new Headers(f.calls[0].init.headers).get('apikey'),bindings.SUPABASE_PUBLISHABLE_KEY);assert.equal(new Headers(f.calls[0].init.headers).get('authorization'),'Bearer '+token);}
});
test('verified principal reaches only server RPC and manager-log records retain existing identity model',async()=>{
 const f=fixture(),command=create(),response=await f.call(request(command));assert.equal(response.status,200);const saved=await response.json(),commit=f.calls.find(c=>c.url.endsWith('/jmax_shared_commit'));
 assert.equal(commit.body.p_auth_user_id,userId);assert.equal(commit.body.p_actor_id,member.id);assert.equal(commit.body.p_membership_revision,2);assert.equal(commit.body.p_workspace_revision,3);assert.equal(commit.body.p_request_id,command.requestId);assert.match(commit.body.p_fingerprint,/^[0-9a-f]{64}$/);
 assert.equal(commit.body.p_records.length,1);const record=commit.body.p_records[0];assert.equal(record.id,saved.recordId);assert.equal(record.ownerId,member.id);assert.equal(record.locationId,'berts');assert.equal(record.data.history[0].actorId,member.id);assert.equal(record.data.history[0].action,'created');
 const headers=new Headers(commit.init.headers);assert.equal(headers.get('apikey'),bindings.SUPABASE_SECRET_KEY);assert.equal(headers.get('authorization'),null);assert.equal(commit.init.redirect,'error');assert.equal(commit.init.cache,'no-store');assert.ok(!JSON.stringify(saved).includes('secret'));
});
test('legacy service key stays server-side and is never used to verify a user',async()=>{
 const f=fixture();assert.equal((await f.call(request(null),{SUPABASE_URL:bindings.SUPABASE_URL,SUPABASE_ANON_KEY:'legacy-public',SUPABASE_SERVICE_ROLE_KEY:'legacy-service-only'})).status,200);
 assert.equal(new Headers(f.calls[0].init.headers).get('apikey'),'legacy-public');assert.equal(new Headers(f.calls[0].init.headers).get('authorization'),'Bearer '+token);
 assert.equal(new Headers(f.calls[1].init.headers).get('apikey'),'legacy-service-only');assert.equal(new Headers(f.calls[1].init.headers).get('authorization'),'Bearer legacy-service-only');
});
test('same-origin check and strict command envelope reject identity or record injection',async()=>{
 const f=fixture();assert.equal((await f.call(request(create(),{Origin:'https://other.example.test'}))).status,403);assert.equal(f.calls.length,0);
 for(const command of [{...create(),authUserId:userId},{...create(),records:[]},{...create(),input:{...input,role:'owner'}},{...create(),action:'managerlog.resolve'},{...create(),recordId:'choose-my-record'}])assert.equal((await f.call(request(command))).status,400);
 assert.equal(f.calls.filter(c=>c.url.endsWith('/jmax_shared_commit')).length,0);
});
test('restaurant mismatch and department permissions prevent a proposed save',async()=>{
 const wrong=blank();wrong.workspace.location.id='another-restaurant';const foreign=fixture({snapshot:wrong});assert.equal((await foreign.call(request(create()))).status,503);
 const scoped=blank();scoped.workspace.me.area='FOH';scoped.workspace.members[0].area='FOH';const department=fixture({snapshot:scoped});assert.equal((await department.call(request(create()))).status,403);assert.ok(!department.calls.some(c=>c.url.endsWith('/jmax_shared_commit')));
 const worker=blank();worker.workspace.me.capabilities=[];assert.equal((await fixture({snapshot:worker}).call(request(null,{},'?locationId=berts'))).status,403);
});
test('exact retry receipt returns before reading stale workspace or rerunning domain mutation',async()=>{
 const prior={recordId:'retained-record-id',revision:2,workspaceRevision:5},f=fixture({receipt:prior});
 const response=await f.call(request({requestId:'retained-request',locationId:'berts',action:'managerlog.note',recordId:prior.recordId,expectedRevision:1,input:{note:'Same note'}}));assert.equal(response.status,200);assert.deepEqual(await response.json(),prior);assert.equal(f.calls.length,3);assert.ok(f.calls[2].url.endsWith('/jmax_shared_receipt'));
});

test('shared server requires installed access policy and rejects broad memberships before workspace or receipt',async()=>{
 const old=fixture({oldPolicy:true});assert.equal((await old.call(request(create()))).status,503);assert.equal(old.calls.length,2);
 const rows=['berts','rudds','papa'].map(locationId=>({id:'member-'+locationId,locationId,name:'Fictional owner title',position:'Owner',locationName:locationId}));
 for(const policy of [{version:1,kind:'restaurant',homeLocationId:'berts',revision:1},{version:1,kind:'commissary',homeLocationId:'comm',revision:1}]){
  const f=fixture({policy,memberships:rows});assert.equal((await f.call(request(create()))).status,403);assert.equal(f.calls.length,2);
 }
 const owner=fixture({policy:{version:1,kind:'jay',homeLocationId:'berts',revision:1},memberships:rows});assert.equal((await owner.call(request(null))).status,200);
 const home=fixture();assert.equal((await home.call(request(null,{},'?locationId=papa'))).status,403);assert.equal(home.calls.length,2);
});
test('expected transactional conflicts are returned while unexpected upstream diagnostics are sanitized',async()=>{
 const conflict=fixture({rpcStatus:409,rpcError:{code:'PT409',message:'This record changed. Refresh before saving.'}});assert.equal((await conflict.call(request(create()))).status,409);
 const failed=fixture({rpcStatus:400,rpcError:{code:'22P02',message:'private SQL with sensitive values'}});const response=await failed.call(request(create()));assert.equal(response.status,503);assert.ok(!(await response.text()).includes('private SQL'));
 const offline=await fixture({failTransport:true}).call(request(create()));assert.equal(offline.status,503);assert.ok(!(await offline.text()).includes('private upstream'));
});
test('password sign-in verifies account and membership then sets only the separate HttpOnly cookie',async()=>{
 const f=fixture(),response=await f.session(request({action:'sign-in',email:'Manager@example.test',password:'not-a-real-password'},{Authorization:''},'/session'));assert.equal(response.status,200);assert.deepEqual(await response.json(),{signedIn:true,user:{id:userId,email:'manager@example.test'}});const cookie=response.headers.get('set-cookie');assert.ok(cookie.startsWith(sharedStoreCookie+'='+token));assert.match(cookie,/HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=3600/);assert.ok(!cookie.includes('refresh'));
 const status=await f.session(new Request('https://jmax.example.test/api/shared-store/session',{headers:{Cookie:cookie.split(';')[0]}}));assert.equal(status.status,200);assert.equal((await status.json()).signedIn,true);
 const signedOut=await f.session(request({action:'sign-out'},{Authorization:''},'/session'));assert.equal(signedOut.status,200);assert.match(signedOut.headers.get('set-cookie'),/Max-Age=0/);
});
test('unapproved shared account never receives a browser session and cookie ambiguity is rejected',async()=>{
 const f=fixture({noMembership:true}),r=await f.session(request({action:'sign-in',email:'manager@example.test',password:'fictional-password'}, {}, '/session'));assert.equal(r.status,403);assert.equal(r.headers.get('set-cookie'),null);
 const dup=new Request('https://jmax.example.test/api/shared-store',{headers:{Cookie:`${sharedStoreCookie}=${token}; ${sharedStoreCookie}=${token}`}});assert.equal((await f.call(dup)).status,401);
});
