import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { recoveredStandards } from '../.sites-runtime/shared/recovered-standards.mjs';
import { sourceLibrary } from '../.sites-runtime/shared/source-library-data.mjs';

process.env.MINIFLARE_REGISTRY_PATH ??= path.resolve('.wrangler/registry');

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test('unpublished recovered source material is absent from downloadable browser assets',()=>{
  const files=[];
  function collect(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())collect(file);else files.push(file);}}
  collect('dist/client');assert.ok(files.some(f=>f.endsWith('.js')));
  for(const file of files.filter(f=>/\.(js|json|map|html)$/.test(f))){const content=fs.readFileSync(file,'utf8');for(const s of recoveredStandards){assert.equal(content.includes(s.id),false,`${file} includes unpublished source ${s.id}`);for(const ref of s.references)assert.equal(content.includes(ref.excerpt),false,`${file} includes a recovered source excerpt`);}for(const source of sourceLibrary.documents){assert.equal(content.includes(source.id),false,`${file} includes private source ${source.id}`);assert.equal(content.includes(source.sha256),false,`${file} includes a private source fingerprint`);}}
});

test("built worker renders preview metadata and protects its workspace endpoint", async (t) => {
  // Execute the artifact in its actual runtime, including cloudflare:workers imports.
  const worker = new Miniflare({
    modules: true,
    scriptPath: fileURLToPath(new URL('../dist/server/index.js', import.meta.url)),
    modulesRoot: fileURLToPath(new URL('../dist/server/', import.meta.url)),
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    compatibilityDate: '2026-05-15',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'],
    bindings: {JMAX_REVIEW_OWNER_EMAIL:'owner@example.test'},
    serviceBindings: { ASSETS: () => new Response('Not found', { status: 404 }) },
  });
  t.after(() => worker.dispose());
  const response = await worker.dispatchFetch('http://localhost/', { headers: { accept: 'text/html' } });

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.match(await response.text(), developmentPreviewMeta);
  const shared=await worker.dispatchFetch('http://localhost/team',{headers:{accept:'text/html'}});
  assert.equal(shared.status,200);
  const shell=await shared.text();
  assert.match(shell,/Your JMAX workspace/);
  assert.doesNotMatch(shell,/Review employee|Choose role/);
  const unauthorized = await worker.dispatchFetch('http://localhost/api/workspace');
  assert.equal(unauthorized.status, 401);
  assert.match(unauthorized.headers.get('cache-control'), /no-store/);
  const handoff=await worker.dispatchFetch('http://localhost/api/operations/handoff?locationId=review');
  assert.equal(handoff.status,401);
  assert.match(handoff.headers.get('cache-control'),/no-store/);
  const library=await worker.dispatchFetch('http://localhost/api/source-library?locationId=berts');assert.equal(library.status,401);assert.match(library.headers.get('cache-control'),/no-store/);
  const toast=await worker.dispatchFetch('http://localhost/api/integrations/toast?locationId=review');
  assert.equal(toast.status,401);
  assert.match(toast.headers.get('cache-control'),/no-store/);
  const access=await worker.dispatchFetch('http://localhost/api/access?locationId=review');
  assert.equal(access.status,401);
  assert.match(access.headers.get('cache-control'),/no-store/);
  const reminders=await worker.dispatchFetch('http://localhost/api/reminders?locationId=review');
  assert.equal(reminders.status,401);
  const db=await worker.getD1Database('DB');
  for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
  await db.prepare("INSERT INTO locations(id,name,timezone) VALUES('scheduled-test','Fictional scheduled test','America/New_York')").run();
  const scheduled=await (await worker.getWorker()).scheduled();
  assert.equal(scheduled.outcome,'ok');
  const run=await db.prepare("SELECT checked_at,scheduled_at FROM review_reminder_runs WHERE location_id='scheduled-test'").first();
  assert.ok(run?.scheduled_at);assert.equal(run.checked_at,run.scheduled_at);
  const locked=await worker.dispatchFetch('http://localhost/api/review/manager/workspace');assert.equal(locked.status,401);
  const review=await worker.dispatchFetch('http://localhost/api/review/manager/workspace?locationId=owner-review',{headers:{'oai-authenticated-user-email':'owner@example.test'}});assert.equal(review.status,200);
  const managerWorkspace=await review.json();assert.equal(managerWorkspace.records.filter(r=>r.kind==='shift').length,3);assert.equal(managerWorkspace.recoveredStandards.length,7);
  const employee=await worker.dispatchFetch('http://localhost/api/review/employee/workspace?locationId=owner-review',{headers:{'oai-authenticated-user-email':'owner@example.test'}});assert.equal(employee.status,200);assert.deepEqual((await employee.json()).recoveredStandards,[]);
});

test('built chat worker reaches its provider, saves the reply, and rejects redirects without following them',async t=>{
  let redirect=false,calls=0;
  const worker=new Miniflare({modules:true,scriptPath:path.resolve('dist/server/index.js'),modulesRoot:path.resolve('dist/server'),modulesRules:[{type:'ESModule',include:['**/*.js']}],compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{OPENAI_API_KEY:'sk-fictional-runtime-test'},serviceBindings:{ASSETS:()=>new Response('Not found',{status:404})},outboundService:async request=>{
    calls++;assert.equal(request.url,'https://api.openai.com/v1/responses');assert.equal(request.method,'POST');
    const data=await request.json();assert.equal(data.store,false);assert.equal(data.text.format.type,'json_schema');const context=JSON.parse(data.input[1].content.split('\n').slice(1).join('\n'));assert.equal(context.communicationPreference.explanationStyle,'brief');assert.equal(context.selectedWork.id,'attached-goal');assert.equal(context.product,'workforce');
    if(redirect)return new Response(null,{status:307,headers:{Location:'https://other.example/blocked'}});
    return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:'Hello from the fictional provider.',sourceIds:[]})}]}]});
  }});t.after(()=>worker.dispose());const db=await worker.getD1Database('DB');
  for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
  await db.prepare("INSERT INTO locations(id,name,timezone) VALUES('test','Test','America/New_York')").run();
  await db.prepare("INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES('test','test@example.test','test-id','test','Test','FOH','Server','[]','[]')").run();
  await db.prepare('INSERT INTO records(id,location_id,kind,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,1,?,?)').bind('attached-goal','test','goal','test','FOH',JSON.stringify({title:'Runtime attachment',definition:'Fictional learning goal',type:'development',managerId:'test',phase:'active',due:'2026-09-14T23:00:00Z',history:[]}),new Date().toISOString()).run();
  const headers={'oai-authenticated-user-id':'test-id','oai-authenticated-user-email':'test@example.test',Origin:'http://localhost','Content-Type':'application/json'};
  const read=async()=>await(await worker.dispatchFetch('http://localhost/api/companion?locationId=test',{headers})).json();
  const ask=async v=>worker.dispatchFetch('http://localhost/api/companion',{method:'POST',headers,body:JSON.stringify({locationId:'test',action:'ask',conversationId:v.conversationId,expectedRevision:v.revision,requestId:crypto.randomUUID(),question:'Hello JMAX',focus:{id:'attached-goal',revision:1}})});
  const initial=await read();assert.equal(initial.explanationStyle,'balanced');
  const preference=await worker.dispatchFetch('http://localhost/api/companion',{method:'POST',headers,body:JSON.stringify({locationId:'test',action:'preferences',conversationId:initial.conversationId,expectedRevision:initial.revision,explanationStyle:'brief'})});
  assert.equal(preference.status,200);assert.equal((await preference.json()).explanationStyle,'brief');assert.equal(calls,0);
  const first=await ask(await read());assert.equal(first.status,200);const firstTurn=(await first.json()).turns[0];assert.equal(firstTurn.answer,'Hello from the fictional provider.');assert.equal(firstTurn.focus.id,'attached-goal');assert.equal(firstTurn.sources[0].id,'attached-goal');assert.equal(calls,1);
  await db.prepare("UPDATE companion_conversations SET last_started=0 WHERE member_id='test'").run();redirect=true;
  const second=await ask(await read());assert.equal(second.status,503);assert.equal(calls,2);const saved=await read();assert.equal(saved.turns[1].status,'failed');assert.equal(saved.turns[1].answer,'');
  const start=await worker.dispatchFetch('http://localhost/api/companion',{method:'POST',headers,body:JSON.stringify({locationId:'test',action:'start-new',conversationId:saved.conversationId,expectedRevision:saved.revision})});
  assert.equal(start.status,200);const current=await start.json();assert.equal(current.turns.length,0);assert.equal(current.explanationStyle,'brief');assert.equal(calls,2);
  const history=await worker.dispatchFetch('http://localhost/api/companion?locationId=test&history=1',{headers});assert.equal(history.status,200);assert.equal((await history.json()).conversations[0].id,saved.conversationId);
  const archived=await worker.dispatchFetch('http://localhost/api/companion?locationId=test&archived='+saved.conversationId,{headers});assert.equal(archived.status,200);const old=await archived.json();assert.equal(old.turns[0].answer,firstTurn.answer);assert.equal(old.turns[0].focus.id,'attached-goal');assert.equal(old.turns[1].status,'failed');
  const anonymous=await worker.dispatchFetch('http://localhost/api/companion?locationId=test&archived='+saved.conversationId);assert.equal(anonymous.status,401);
});
