import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {projectFoodAdvisor,explicitShelfLifeDays} from '../.sites-runtime/shared/food-advisor-bridge.mjs';
import {handleFoodAdvisor} from '../.sites-runtime/shared/food-advisor-service.mjs';
const scope={locationId:'a',dataset:'operating',sourceRestaurantId:'a',foodRevision:0};
const recipe={sourceId:'source-recipe',title:'Canonical ranch',recipeType:'prep',yieldUOM:'each',shelfLife:'3 days',source:{dataset:'operating',sourceRestaurantId:'a'}};
const recipes=[{id:'recipe',revision:1,locationId:'a',dataset:'operating',recipe}];
const definition={id:'definition',revision:1,locationId:'a',dataset:'operating',kind:'definition',status:'active',foodKind:'foodrecipe',foodRecordId:'recipe',foodRevision:1,countUnit:'each',par:20,track:'daily'};
const rec={id:'advice',restaurantId:'a',recipeId:'source-recipe',recipeName:'Source name',currentPar:20,recommendedPar:30,reasoning:'Source history',status:'pending',createdAt:'2026-10-07T12:00:00Z',unit:'each',shelfLife:'3 days',shelfLifeDays:3,shelfLifeSource:'recipe',sourceCurrent:true};
const snapshot={restaurantId:'a',revision:'source-one',generatedAt:'2026-10-07T12:00:00Z',sparse:false,recommendations:[rec]};
const project=(s=snapshot,r=recipes,d=[definition])=>projectFoodAdvisor(scope,s,r,d);

test('canonical mapping projects target PAR without subtracting counts or writing inventory',()=>{
 const before=JSON.stringify([snapshot,recipes,definition]),review=project();assert.equal(review.status,'ready');assert.equal(review.rows[0].recommendedPar,30);assert.equal(review.rows[0].title,'Canonical ranch');assert.equal(review.rows[0].definitionId,'definition');assert.equal(JSON.stringify([snapshot,recipes,definition]),before);
});
test('cross-restaurant, unmapped, ambiguous and stale sources cannot produce applicable advice',()=>{
 for(const s of [{...snapshot,restaurantId:'b'},{...snapshot,recommendations:[{...rec,restaurantId:'b'}]},{...snapshot,recommendations:[{...rec,recipeId:'wrong'}]},{...snapshot,recommendations:[{...rec,sourceCurrent:false}]}])assert.equal(project(s).status,'needs-review');
 assert.equal(project(snapshot,[...recipes,recipes[0]]).status,'needs-review');assert.equal(project(snapshot,recipes,[{...definition,foodRevision:2}]).status,'needs-review');
});
test('sparse history and unusable canonical shelf life stay blocked',()=>{
 assert.equal(project({...snapshot,sparse:true}).rows[0].status,'needs-review');
 for(const shelfLife of ['', 'refrigerated','3-5 days','until gone'])assert.equal(project(snapshot,[{...recipes[0],recipe:{...recipe,shelfLife}}]).rows[0].status,'needs-review');
 assert.equal(explicitShelfLifeDays('48 hours'),2);assert.equal(explicitShelfLifeDays('0 days'),null);
});
test('culinary cup label cannot automatically become a portion cup conversion',()=>{
 const s={...snapshot,recommendations:[{...rec,unit:'cup'}]},r=[{...recipes[0],recipe:{...recipe,yieldUOM:'cup'}}],d=[{...definition,countUnit:'cup'}];
 assert.equal(project(s,r,d).rows[0].status,'needs-review');
 const mapped={...s,portionMappings:[{prepItemId:'portion-source',recipeId:'source-recipe',countUnit:'cup',recipeUnit:'cup',recipeUnitsPerCountUnit:0.25,reviewedBy:'reviewer',reviewedAt:'2026-10-07T12:00:00Z',reviewNote:'Explicit measured portion conversion'}]};
 assert.equal(project(mapped,r,d).rows[0].recommendedPar,120);assert.equal(project(mapped,r,d).rows[0].status,'ready');
});
test('duplicate advice and invalid source targets require review',()=>{
 assert.ok(project({...snapshot,recommendations:[rec,rec]}).rows.every(r=>r.status==='needs-review'));
 assert.equal(project({...snapshot,recommendations:[{...rec,recommendedPar:null}]}).status,'needs-review');
});

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

function advisorFixture(t){
 const f=fixture(t);
 f.sqlite.prepare("UPDATE food_records SET data=? WHERE id='recipe'").run(JSON.stringify(recipe));
 f.sqlite.prepare('INSERT INTO food_sources(location_id,dataset,source_restaurant_id) VALUES(?,?,?)').run('a','operating','a');
 f.sqlite.prepare('INSERT INTO food_workflows(id,location_id,dataset,kind,natural_key,revision,status,data,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('definition','a','operating','definition','daily:recipe',1,'active',JSON.stringify(definition),'2026-10-07');
 return {...f,provider:{load:async()=>structuredClone(snapshot)}};
}
const applyBody=review=>({locationId:'a',dataset:'operating',requestId:'apply-request',recommendationId:'advice',sourceRevision:review.sourceRevision,foodRevision:review.foodRevision,definitionRevision:1,confirmed:true});
test('authenticated advisor read is honestly unavailable when no provider is configured',async t=>{
 const f=advisorFixture(t),r=await handleFoodAdvisor(f.request('manager'),f.db);assert.equal(r.status,200);assert.equal((await r.json()).status,'unavailable');assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM food_receipts').get().n,0);
});
test('reviewed advice updates only existing prep definition par, and retry applies once',async t=>{
 const f=advisorFixture(t),review=await (await handleFoodAdvisor(f.request('manager'),f.db,f.provider)).json();assert.equal(review.status,'ready');
 const body=applyBody(review),r=await handleFoodAdvisor(f.request('manager','a','POST',body),f.db,f.provider);assert.equal(r.status,200,JSON.stringify(await r.clone().json()));
 const saved=JSON.parse(f.sqlite.prepare("SELECT data FROM food_workflows WHERE id='definition'").get().data);assert.equal(saved.par,30);assert.equal(saved.revision,2);
 assert.equal(JSON.parse(f.sqlite.prepare("SELECT data FROM food_workflows WHERE id='plan'").get().data).lines[0].plannedQty,3);
 assert.equal(f.sqlite.prepare("SELECT revision FROM food_records WHERE id='recipe'").get().revision,1);
 const retry=await handleFoodAdvisor(f.request('manager','a','POST',body),f.db);assert.equal(retry.status,200);assert.deepEqual(await retry.json(),await r.json());assert.equal(f.sqlite.prepare("SELECT revision FROM food_workflows WHERE id='definition'").get().revision,2);
});
test('changed advice, local state or browser revisions block apply',async t=>{
 const f=advisorFixture(t),review=await (await handleFoodAdvisor(f.request('manager'),f.db,f.provider)).json(),body=applyBody(review);
 for(const changed of [{...body,sourceRevision:'stale'},{...body,definitionRevision:2},{...body,foodRevision:1}])assert.equal((await handleFoodAdvisor(f.request('manager','a','POST',changed),f.db,f.provider)).status,409);
 const changedProvider={load:async()=>({...structuredClone(snapshot),recommendations:[{...rec,recommendedPar:99}]})};assert.equal((await handleFoodAdvisor(f.request('manager','a','POST',body),f.db,changedProvider)).status,409);
 assert.equal(f.sqlite.prepare("SELECT revision FROM food_workflows WHERE id='definition'").get().revision,1);
});
test('wrong actor, restaurant and unreviewed source cannot apply',async t=>{
 const f=advisorFixture(t),review=await (await handleFoodAdvisor(f.request('manager'),f.db,f.provider)).json(),body=applyBody(review);
 for(const person of ['worker','foreign','schedule'])assert.equal((await handleFoodAdvisor(f.request(person,'a','POST',body),f.db,f.provider)).status,403);
 const sparse={load:async()=>({...structuredClone(snapshot),sparse:true})};const sparseReview=await (await handleFoodAdvisor(f.request('manager'),f.db,sparse)).json();assert.equal((await handleFoodAdvisor(f.request('manager','a','POST',applyBody(sparseReview)),f.db,sparse)).status,400);
 assert.equal(f.sqlite.prepare("SELECT revision FROM food_workflows WHERE id='definition'").get().revision,1);
});
