import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {handleEmployeePrep} from '../.sites-runtime/shared/employee-prep-service.mjs';
import {handleFoodWorkflows} from '../.sites-runtime/shared/food-workflow-service.mjs';

// SQLite adapter exercises the authenticated service without the unavailable
// Workers runtime. Worker deployment acceptance remains a separate check.
function fixture(t){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
 const db={prepare(sql){let params=[];return {bind(...v){params=v;return this;},async all(){const results=sqlite.prepare(sql).all(...params);return {results,meta:{changes:Number(sqlite.prepare("SELECT changes() AS n").get().n)}};},async first(){return sqlite.prepare(sql).get(...params)??null;},async run(){const r=sqlite.prepare(sql).run(...params);return {meta:{changes:Number(r.changes)},results:[]};}};},async batch(stmts){sqlite.exec('BEGIN');try{const result=[];for(const s of stmts){try{result.push(await s.all());}catch(e){if(!String(e.message).includes('does not return'))throw e;result.push(await s.run());}}sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 db.withSession=()=>db;
 for(const file of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync('drizzle/'+file,'utf8').replaceAll('--> statement-breakpoint',''));
 for(const loc of ['a','b'])sqlite.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').run(loc,loc,'America/New_York');
 for(const [person,loc,caps,only] of [['manager','a',['tasks.manage'],0],['worker','a',[],0],['other','a',[],0],['foreign','b',[],0],['schedule','a',[],1]])sqlite.prepare("INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications,active,schedule_only) VALUES(?,?,?,?,?,'BOH','Cook',?,'[]',1,?)").run(person,person+'@example.test',person+'-identity',loc,person,JSON.stringify(caps),only);
 sqlite.prepare('INSERT INTO food_state(location_id) VALUES(?)').run('a');
 const recipe={title:'Fictional prep',procedure:'Mix and portion.',equipment:'Bowl',portionNote:'One cup',yieldQty:4,yieldUOM:'cup',costCents:12345,ingredients:[{costCents:999}]};
 sqlite.prepare('INSERT INTO food_records(id,location_id,kind,dataset,source_restaurant_id,source_key,title,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('recipe','a','foodrecipe','operating','a','recipe','Fictional prep','manager','BOH',1,JSON.stringify(recipe),'2026-10-07');
 const line={definitionId:'line',foodRecordId:'recipe',foodRevision:1,title:'Fictional prep',countUnit:'cup',par:4,quantity:1,plannedQty:3,completedQty:null,completedAt:null,completedBy:null,completionNote:'',assignedTo:'worker'};
 const plan={id:'plan',locationId:'a',dataset:'operating',revision:1,kind:'plan',status:'released',targetDate:'2026-10-08',track:'daily',countId:'count',countRevision:1,lines:[line],blockers:[],createdBy:'manager',createdAt:'2026-10-07',updatedAt:'2026-10-07',releasedBy:'manager',releasedAt:'2026-10-07'};
 sqlite.prepare('INSERT INTO food_workflows(id,location_id,dataset,kind,natural_key,revision,status,data,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('plan','a','operating','plan','daily:day',1,'released',JSON.stringify(plan),'2026-10-07');
 const request=(person,loc='a',method='GET',body)=>new Request('http://localhost/api/food/assigned-prep?locationId='+loc,{method,headers:{'oai-authenticated-user-id':person+'-identity','oai-authenticated-user-email':person+'@example.test',Origin:'http://localhost','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 return {db,sqlite,request};
}
test('authenticated assigned-prep endpoint excludes other people and stores',async t=>{
 const f=fixture(t);let r=await handleEmployeePrep(f.request('worker'),f.db);assert.equal(r.status,200);assert.equal((await r.json()).items.length,1);
 r=await handleEmployeePrep(f.request('other'),f.db);assert.equal(r.status,200);assert.deepEqual((await r.json()).items,[]);
 assert.equal((await handleEmployeePrep(f.request('foreign'),f.db)).status,403);
 assert.equal((await handleEmployeePrep(f.request('schedule'),f.db)).status,403);
 assert.equal((await handleEmployeePrep(f.request('worker','a','POST',{}),f.db)).status,405);
});

const completion=(overrides={})=>({requestId:'complete-request',locationId:'a',action:'plan.employee-complete',recordId:'plan',expectedRevision:1,input:{dataset:'operating',definitionId:'line',quantity:3,confirmed:true,note:''},...overrides});
const savedPlan=f=>JSON.parse(f.sqlite.prepare("SELECT data FROM food_workflows WHERE id='plan'").get().data);
const counts=f=>Object.fromEntries(['food_workflow_events','food_receipts','audit_events'].map(table=>[table,f.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]));

test('assigned employee receives preparation instructions without recipe costs',async t=>{
 const f=fixture(t),r=await handleEmployeePrep(f.request('worker'),f.db),item=(await r.json()).items[0];
 assert.deepEqual(item.recipe,{title:'Fictional prep',procedure:'Mix and portion.',equipment:'Bowl',portionNote:'One cup',yieldQty:4,yieldUOM:'cup',shelfLife:'',ingredients:[]});
 assert.equal(JSON.stringify(item).includes('costCents'),false);
});

test('assigned recipe carries source shelf life and scoped ingredient portions without supplier costs',async t=>{
 const f=fixture(t),recipe=JSON.parse(f.sqlite.prepare("SELECT data FROM food_records WHERE id='recipe'").get().data);
 recipe.shelfLife='Source reference: 3 days refrigerated';recipe.lines=[{sourceType:'item',controlNumber:'milk',qty:2},{sourceType:'prep',recipeId:'base',qty:0.5},{sourceType:'item',controlNumber:'missing',qty:1}];
 f.sqlite.prepare("UPDATE food_records SET data=? WHERE id='recipe'").run(JSON.stringify(recipe));
 const add=(recordId,loc,kind,dataset,sourceRestaurant,key,data)=>f.sqlite.prepare('INSERT INTO food_records(id,location_id,kind,dataset,source_restaurant_id,source_key,title,owner_id,area,revision,data,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(recordId,loc,kind,dataset,sourceRestaurant,key,data.title,'manager','BOH',1,JSON.stringify(data),'2026-10-07');
 add('milk','a','fooditem','operating','a','milk',{title:'Milk',portionSize:4,portionUOM:'fl oz',vendorSkus:[{price:999}],costCents:999});
 add('base','a','foodrecipe','operating','a','base',{title:'Prepared base',yieldUOM:'qt',costCents:999});
 add('foreign-ingredient','b','fooditem','operating','b','missing',{title:'FOREIGN SECRET',portionSize:8,portionUOM:'oz'});
 add('demo-ingredient','a','fooditem','demo','a','missing',{title:'DEMO SECRET',portionSize:8,portionUOM:'oz'});
 const response=await handleEmployeePrep(f.request('worker'),f.db);assert.equal(response.status,200);const item=(await response.json()).items[0];
 assert.equal(item.recipe.shelfLife,recipe.shelfLife);
 assert.deepEqual(item.recipe.ingredients,[{name:'Milk',quantity:2,unit:'portion(s)',portionGuidance:'Each portion: 4 fl oz',notice:''},{name:'Prepared base',quantity:0.5,unit:'qt',portionGuidance:'',notice:''},{name:'Ingredient not mapped',quantity:1,unit:'portion(s)',portionGuidance:'',notice:'Ask your manager to review this ingredient mapping.'}]);
 assert.doesNotMatch(JSON.stringify(item),/costCents|vendorSkus|999|FOREIGN SECRET|DEMO SECRET/);
});

test('ingredient lookup does not mix a different source restaurant or invent a missing portion unit',async t=>{
 const f=fixture(t),recipe=JSON.parse(f.sqlite.prepare("SELECT data FROM food_records WHERE id='recipe'").get().data);
 recipe.lines=[{sourceType:'item',controlNumber:'other-source',qty:1},{sourceType:'item',controlNumber:'unmeasured',qty:2}];
 f.sqlite.prepare("UPDATE food_records SET data=? WHERE id='recipe'").run(JSON.stringify(recipe));
 for(const [recordId,source,key,data] of [['different-source','elsewhere','other-source',{title:'OTHER SOURCE SECRET',portionSize:4,portionUOM:'oz'}],['unmeasured','a','unmeasured',{title:'Unmeasured ingredient',portionSize:null,portionUOM:''}]])f.sqlite.prepare('INSERT INTO food_records(id,location_id,kind,dataset,source_restaurant_id,source_key,title,owner_id,area,revision,data,updated_at) VALUES(?,?,\'fooditem\',\'operating\',?,?,?,?,?,1,?,?)').run(recordId,'a',source,key,data.title,'manager','BOH',JSON.stringify(data),'2026-10-07');
 const response=await handleEmployeePrep(f.request('worker'),f.db);assert.equal(response.status,200);const ingredients=(await response.json()).items[0].recipe.ingredients;
 assert.equal(ingredients[0].name,'Ingredient not mapped');assert.equal(ingredients[1].unit,'portion(s)');assert.equal(ingredients[1].portionGuidance,'');assert.match(ingredients[1].notice,/not supplied/);
});

test('assigned employee completion updates manager plan, history and employee view once',async t=>{
 const f=fixture(t),r=await handleFoodWorkflows(f.request('worker','a','POST',completion()),f.db);assert.equal(r.status,200,JSON.stringify(await r.clone().json()));
 const plan=savedPlan(f);assert.equal(plan.status,'completed');assert.equal(plan.revision,2);assert.equal(plan.lines[0].completedQty,3);assert.equal(plan.lines[0].completedBy,'worker');
 assert.deepEqual((await (await handleEmployeePrep(f.request('worker'),f.db)).json()).items,[]);
 assert.deepEqual(counts(f),{food_workflow_events:1,food_receipts:1,audit_events:1});
 assert.equal(f.sqlite.prepare("SELECT data FROM food_records WHERE id='recipe'").get().data.includes('costCents'),true);
});

test('completion retry returns its receipt without duplicating completion or stock',async t=>{
 const f=fixture(t),body=completion();const first=await handleFoodWorkflows(f.request('worker','a','POST',body),f.db);
 const snapshot=savedPlan(f),state=f.sqlite.prepare("SELECT revision FROM food_state WHERE location_id='a'").get().revision;
 const retry=await handleFoodWorkflows(f.request('worker','a','POST',body),f.db);assert.equal(first.status,200);assert.equal(retry.status,200);assert.deepEqual(await retry.json(),await first.json());
 assert.deepEqual(savedPlan(f),snapshot);assert.equal(f.sqlite.prepare("SELECT revision FROM food_state WHERE location_id='a'").get().revision,state);assert.deepEqual(counts(f),{food_workflow_events:1,food_receipts:1,audit_events:1});
 const changed=completion({input:{...body.input,quantity:2,note:'Short'}});assert.equal((await handleFoodWorkflows(f.request('worker','a','POST',changed),f.db)).status,409);
});

test('other employees, foreign restaurant and schedule-only users cannot complete the assigned work',async t=>{
 const f=fixture(t);for(const person of ['other','foreign','schedule'])assert.equal((await handleFoodWorkflows(f.request(person,'a','POST',completion()),f.db)).status,403,person);
 assert.equal(savedPlan(f).revision,1);assert.deepEqual(counts(f),{food_workflow_events:0,food_receipts:0,audit_events:0});
});

test('unauthenticated and cross-origin completion requests cannot mutate prep',async t=>{
 const f=fixture(t),body=completion();const unauth=new Request('http://localhost/api/food/workflows',{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await handleFoodWorkflows(unauth,f.db)).status,401);
 const cross=f.request('worker','a','POST',body);cross.headers.set('Origin','http://attacker.test');assert.equal((await handleFoodWorkflows(cross,f.db)).status,403);
 assert.equal(savedPlan(f).revision,1);
});

test('stale plan or recipe revision rejects completion without recording an event',async t=>{
 const f=fixture(t);assert.equal((await handleFoodWorkflows(f.request('worker','a','POST',completion({expectedRevision:2})),f.db)).status,409);
 f.sqlite.prepare("UPDATE food_records SET revision=2 WHERE id='recipe'").run();assert.equal((await handleFoodWorkflows(f.request('worker','a','POST',completion()),f.db)).status,409);
 const view=await handleEmployeePrep(f.request('worker'),f.db),item=(await view.json()).items[0];assert.equal(item.recipe,null);assert.match(item.recipeNotice,/changed/);
 assert.equal(savedPlan(f).revision,1);assert.deepEqual(counts(f),{food_workflow_events:0,food_receipts:0,audit_events:0});
});

test('short production requires explanation and records zero as a real reported quantity',async t=>{
 const f=fixture(t),body=completion();assert.equal((await handleFoodWorkflows(f.request('worker','a','POST',completion({input:{...body.input,quantity:0}})),f.db)).status,400);
 assert.equal(savedPlan(f).revision,1);
 const r=await handleFoodWorkflows(f.request('worker','a','POST',completion({input:{...body.input,quantity:0,note:'Ingredient unavailable; manager informed.'}})),f.db);assert.equal(r.status,200);
 const line=savedPlan(f).lines[0];assert.equal(line.completedQty,0);assert.equal(line.completionNote,'Ingredient unavailable; manager informed.');assert.equal(line.plannedQty,3);
});

test('completion cannot bypass release, confirmation or quantity validation',async t=>{
 const f=fixture(t),body=completion();for(const input of [{...body.input,confirmed:false},{...body.input,quantity:-1},{...body.input,quantity:null},{...body.input,quantity:'3'}])assert.equal((await handleFoodWorkflows(f.request('worker','a','POST',completion({input})),f.db)).status,400);
 const draft={...savedPlan(f),status:'draft'};f.sqlite.prepare("UPDATE food_workflows SET status='draft',data=? WHERE id='plan'").run(JSON.stringify(draft));assert.equal((await handleFoodWorkflows(f.request('worker','a','POST',body),f.db)).status,400);
 assert.equal(savedPlan(f).revision,1);assert.deepEqual(counts(f),{food_workflow_events:0,food_receipts:0,audit_events:0});
});

test('access revoked during completion rolls back all workflow writes',async t=>{
 const f=fixture(t),batch=f.db.batch;f.db.batch=async statements=>{if(statements.length===6)f.sqlite.prepare("UPDATE memberships SET active=0,revision=revision+1 WHERE id='worker'").run();return batch(statements);};
 const r=await handleFoodWorkflows(f.request('worker','a','POST',completion()),f.db);assert.equal(r.status,403);
 assert.equal(savedPlan(f).revision,1);assert.deepEqual(counts(f),{food_workflow_events:0,food_receipts:0,audit_events:0});assert.equal(f.sqlite.prepare("SELECT revision FROM food_state WHERE location_id='a'").get().revision,0);
});

test('concurrent food change prevents a stale completion from overwriting the current state',async t=>{
 const f=fixture(t),batch=f.db.batch;f.db.batch=async statements=>{if(statements.length===6)f.sqlite.prepare("UPDATE food_state SET revision=revision+1 WHERE location_id='a'").run();return batch(statements);};
 const r=await handleFoodWorkflows(f.request('worker','a','POST',completion()),f.db);assert.equal(r.status,409);
 assert.equal(savedPlan(f).revision,1);assert.deepEqual(counts(f),{food_workflow_events:0,food_receipts:0,audit_events:0});assert.equal(f.sqlite.prepare("SELECT revision FROM food_state WHERE location_id='a'").get().revision,1);
});

test('reporting one line keeps other assigned work and planned quantities intact',async t=>{
 const f=fixture(t),plan=savedPlan(f);plan.lines.push({...plan.lines[0],definitionId:'second-line',assignedTo:'other'});
 f.sqlite.prepare("UPDATE food_workflows SET data=? WHERE id='plan'").run(JSON.stringify(plan));
 assert.equal((await handleFoodWorkflows(f.request('worker','a','POST',completion()),f.db)).status,200);
 const saved=savedPlan(f);assert.equal(saved.status,'released');assert.equal(saved.lines[1].completedAt,null);assert.equal(saved.lines[1].plannedQty,3);
 assert.equal((await (await handleEmployeePrep(f.request('other'),f.db)).json()).items.length,1);
});
test('employee assignment request cannot acquire manager prep access',async t=>{
 const f=fixture(t),body={requestId:'request',locationId:'a',action:'plan.assign',recordId:'plan',expectedRevision:1,input:{dataset:'operating',definitionId:'line',assignedTo:'other'}};
 const result=await handleFoodWorkflows(f.request('worker','a','POST',body),f.db);assert.equal(result.status,403);
 assert.equal(f.sqlite.prepare("SELECT revision FROM food_workflows WHERE id='plan'").get().revision,1);
});
test('manager reassignment updates the same plan and moves employee visibility',async t=>{
 const f=fixture(t),body={requestId:'manager-request',locationId:'a',action:'plan.assign',recordId:'plan',expectedRevision:1,input:{dataset:'operating',definitionId:'line',assignedTo:'other'}};
 const result=await handleFoodWorkflows(f.request('manager','a','POST',body),f.db);assert.equal(result.status,200,JSON.stringify(await result.clone().json()));
 const oldView=await handleEmployeePrep(f.request('worker'),f.db),newView=await handleEmployeePrep(f.request('other'),f.db);
 assert.deepEqual((await oldView.json()).items,[]);assert.equal((await newView.json()).items.length,1);
 const saved=f.sqlite.prepare("SELECT data FROM food_workflows WHERE id='plan'").get();assert.equal(JSON.parse(saved.data).lines[0].assignedTo,'other');
 assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM food_workflows').get().n,1);
});
test('assignment rejects a foreign employee without changing the released plan',async t=>{
 const f=fixture(t),body={requestId:'bad-request',locationId:'a',action:'plan.assign',recordId:'plan',expectedRevision:1,input:{dataset:'operating',definitionId:'line',assignedTo:'foreign'}};
 assert.equal((await handleFoodWorkflows(f.request('manager','a','POST',body),f.db)).status,400);
 assert.equal(f.sqlite.prepare("SELECT revision FROM food_workflows WHERE id='plan'").get().revision,1);
});

