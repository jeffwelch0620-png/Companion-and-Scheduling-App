import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {handleFoodWorkflows} from '../.sites-runtime/shared/food-workflow-service.mjs';
import {handleEmployeePrep} from '../.sites-runtime/shared/employee-prep-service.mjs';
import {planLines,completedPrepQuantity,prepQuantityMode} from '../.sites-runtime/shared/food-workflow-model.mjs';
import {projectFoodAdvisor} from '../.sites-runtime/shared/food-advisor-bridge.mjs';

const line=(extra={})=>({definitionId:'d',definitionRevision:1,foodRecordId:'recipe',foodRevision:1,title:'Ready French portions',countUnit:'cup',par:15,quantity:7.5,note:'Approximate half sixth pan',...extra});
test('whole portions retain approximate stock, round only production up, preserve null and zero',()=>{
 const rows=planLines({lines:[line({quantityMode:'whole-portions'}),line({quantityMode:'continuous'}),line(),line({quantityMode:'whole-portions',quantity:null}),line({quantityMode:'whole-portions',quantity:16}),line({quantityMode:'whole-portions',quantity:14.99999})]});
 assert.deepEqual(rows.map(r=>r.plannedQty),[8,7.5,7.5,null,0,1]);assert.equal(rows[0].quantity,7.5);
 assert.equal(completedPrepQuantity(0,'whole-portions'),0);assert.equal(completedPrepQuantity(7.5,'continuous'),7.5);
 assert.throws(()=>completedPrepQuantity(7.5,'whole-portions'),/whole number/);assert.throws(()=>prepQuantityMode('cup'),/Choose/);assert.throws(()=>prepQuantityMode(null),/Choose/);
});
test('advisor keeps fractional mapped targets review-only for discrete portions without guessing a conversion',()=>{
 const scope={locationId:'berts',dataset:'operating',sourceRestaurantId:'source-berts',foodRevision:1},recipe={sourceId:'french',title:'French',recipeType:'prep',yieldUOM:'each',shelfLife:'5 days',source:{dataset:'operating',sourceRestaurantId:'source-berts'}},recipes=[{id:'recipe',revision:1,locationId:'berts',dataset:'operating',recipe}],definition={id:'def',revision:1,locationId:'berts',dataset:'operating',status:'active',foodKind:'foodrecipe',foodRecordId:'recipe',foodRevision:1,countUnit:'each',quantityMode:'whole-portions',par:15};
 const recommendation={id:'advice',restaurantId:'source-berts',recipeId:'french',recipeName:'French',currentPar:15,recommendedPar:15.5,reasoning:'Source forecast',status:'pending',createdAt:'2026-10-08T12:00:00Z',unit:'each',shelfLife:'5 days',shelfLifeDays:5,shelfLifeSource:'recipe',sourceCurrent:true},snapshot={restaurantId:'source-berts',revision:'current',generatedAt:'2026-10-08T12:00:00Z',sparse:false,recommendations:[recommendation]};
 const before=JSON.stringify([snapshot,recipes,definition]),discrete=projectFoodAdvisor(scope,snapshot,recipes,[definition]);assert.equal(discrete.status,'needs-review');assert.equal(discrete.rows[0].recommendedPar,15.5);assert.match(discrete.rows[0].reasons.join(' '),/fractional/);assert.equal(JSON.stringify([snapshot,recipes,definition]),before);
 assert.equal(projectFoodAdvisor(scope,snapshot,recipes,[{...definition,quantityMode:'continuous'}]).status,'ready');
 assert.equal(projectFoodAdvisor(scope,{...snapshot,recommendations:[{...recommendation,recommendedPar:16}]},recipes,[definition]).status,'ready');
});

function fixture(t){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
 const db={prepare(sql){let args=[];return {bind(...v){args=v;return this;},async all(){return {results:sqlite.prepare(sql).all(...args),meta:{changes:Number(sqlite.prepare('SELECT changes() AS n').get().n)}};},async first(){return sqlite.prepare(sql).get(...args)??null;},async run(){const r=sqlite.prepare(sql).run(...args);return {results:[],meta:{changes:Number(r.changes)}};}};},async batch(stmts){sqlite.exec('BEGIN');try{const results=[];for(const s of stmts)results.push(await s.all());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};db.withSession=()=>db;
 for(const f of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync('drizzle/'+f,'utf8').replaceAll('--> statement-breakpoint',''));
 sqlite.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').run('berts','Fictional Bert','America/New_York');
 for(const [actor,position,caps] of [['manager','BOH Manager',['tasks.manage']],['worker','Back Window',[]]])sqlite.prepare("INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,'berts',?,'BOH',?,?,'[]')").run(actor,actor+'@example.test',actor+'-identity','Fictional '+actor,position,JSON.stringify(caps));
 sqlite.prepare("INSERT INTO food_state(location_id) VALUES('berts')").run();
 const recipe={title:'Fictional French',recipeType:'prep',sourceId:'french',yieldQty:15,yieldUOM:'cup',procedure:'Test-only source procedure',equipment:'Ready portion cups',shelfLife:'5 days',portionNote:'3.25 oz containers',lines:[],source:{sourceRestaurantId:'fictional-berts',dataset:'operating'}};
 sqlite.prepare("INSERT INTO food_records(id,location_id,kind,dataset,source_restaurant_id,source_key,title,owner_id,area,revision,data,updated_at) VALUES('recipe','berts','foodrecipe','operating','fictional-berts','french','Fictional French','manager','BOH',1,?,?)").run(JSON.stringify(recipe),new Date().toISOString());
 const invoke=async(actor,handler,route,body)=>{const r=await handler(new Request('http://localhost'+route,{headers:{'oai-authenticated-user-id':actor+'-identity','oai-authenticated-user-email':actor+'@example.test',Origin:'http://localhost','Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})}),db);return {status:r.status,data:await r.json()};};
 const call=(actor,action,input,record,requestId=crypto.randomUUID())=>invoke(actor,handleFoodWorkflows,'/api/food/workflows',{locationId:'berts',requestId,action,input:{dataset:'operating',...input},...(record?{recordId:record.recordId,expectedRevision:record.revision}:{})});
 const saved=r=>JSON.parse(sqlite.prepare('SELECT data FROM food_workflows WHERE id=?').get(r.recordId).data);
 const state=()=>JSON.stringify(Object.fromEntries(['food_workflows','food_workflow_events','food_receipts','food_records','audit_events'].map(table=>[table,sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()])));
 return {sqlite,call,saved,state,assigned:()=>invoke('worker',handleEmployeePrep,'/api/food/assigned-prep?locationId=berts')};
}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
const NativeDate=Date;
test('actual Food handlers enforce reviewed discrete production for employee and manager without inventory changes',async t=>{
 globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:['2026-10-08T22:00:00Z']));}static now(){return NativeDate.parse('2026-10-08T22:00:00Z');}};t.after(()=>{globalThis.Date=NativeDate;});
 const f=fixture(t),input={foodRecordId:'recipe',foodRevision:1,track:'daily',countUnit:'cup',quantityMode:'whole-portions',par:15,reviewNote:'Ready 3.25 oz portion cups, whole produced units; fractional on-hand is an approximation.',confirmed:true};
 for(const bad of [{quantityMode:'cup'},{quantityMode:null},{par:15.5}]){const before=f.state();assert.equal((await f.call('manager','definition.save',{...input,...bad})).status,400);assert.equal(f.state(),before);}
 let def=ok(await f.call('manager','definition.save',input));assert.equal(f.saved(def).quantityMode,'whole-portions');
 // A later par-only advisor update must preserve the reviewed production semantics.
 const {quantityMode:omitted,...withoutMode}=input;def=ok(await f.call('manager','definition.save',{...withoutMode,reviewNote:'Reviewed unchanged target from source advice.'},def));assert.equal(f.saved(def).quantityMode,'whole-portions');
 let count=ok(await f.call('manager','count.create',{track:'daily',businessDate:'2026-10-08'}));count=ok(await f.call('manager','count.save',{lines:[{definitionId:def.recordId,quantity:7.5,note:'Half sixth pan estimated ready cups'}]},count));count=ok(await f.call('manager','count.submit',{confirmed:true},count));
 let plan=ok(await f.call('manager','plan.generate',{countId:count.recordId,countRevision:count.revision,targetDate:'2026-10-09'}));assert.equal(f.saved(plan).lines[0].quantity,7.5);assert.equal(f.saved(plan).lines[0].plannedQty,8);assert.equal(f.saved(plan).lines[0].quantityMode,'whole-portions');
 plan=ok(await f.call('manager','plan.release',{confirmed:true},plan));plan=ok(await f.call('manager','plan.assign',{definitionId:def.recordId,assignedTo:'worker'},plan));const assigned=ok(await f.assigned());assert.equal(assigned.items[0].quantityMode,'whole-portions');assert.equal(assigned.items[0].quantity,8);
 for(const [actor,action] of [['worker','plan.employee-complete'],['manager','plan.complete']]){const before=f.state();const rejected=await f.call(actor,action,{definitionId:def.recordId,quantity:7.5,note:'Fractional observed stock is not discrete production.',confirmed:true},plan);assert.equal(rejected.status,400);assert.match(rejected.data.error,/whole number/);assert.equal(f.state(),before);}
 const stock=f.sqlite.prepare('SELECT * FROM food_records').all(),rid=crypto.randomUUID(),previous=plan;plan=ok(await f.call('worker','plan.employee-complete',{definitionId:def.recordId,quantity:8,confirmed:true},previous,rid));assert.equal(f.saved(plan).lines[0].completedQty,8);const after=f.state();assert.deepEqual(ok(await f.call('worker','plan.employee-complete',{definitionId:def.recordId,quantity:8,confirmed:true},previous,rid)),plan);assert.equal(f.state(),after);assert.deepEqual(f.sqlite.prepare('SELECT * FROM food_records').all(),stock);
 // Names alone cannot switch semantics: recipe measuring cups remain fractional.
 def=ok(await f.call('manager','definition.save',{...input,quantityMode:'continuous',par:15.5},def));assert.equal(f.saved(def).quantityMode,'continuous');
 count=ok(await f.call('manager','count.reopen',{reason:'Reviewed measured-volume definition; keep approximate physical count.'},count));assert.equal(f.saved(count).lines[0].quantity,7.5);count=ok(await f.call('manager','count.submit',{confirmed:true},count));
 let measured=ok(await f.call('manager','plan.generate',{countId:count.recordId,countRevision:count.revision,targetDate:'2026-10-10'}));measured=ok(await f.call('manager','plan.release',{confirmed:true},measured));measured=ok(await f.call('manager','plan.complete',{definitionId:def.recordId,quantity:7.5,note:'Measured volume below planned eight.',confirmed:true},measured));assert.equal(f.saved(measured).lines[0].completedQty,7.5);
});
