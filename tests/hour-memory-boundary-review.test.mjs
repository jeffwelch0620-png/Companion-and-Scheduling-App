import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {openPositionDatabase} from './all-position-week-fixture.mjs';
const runtime=process.env.JMAX_MEMORY_BOUNDARY_RUNTIME??'.sites-runtime/hour-memory-ranking';
const {readCompanionMemory,recalledRowsStillPresent}=await import('../'+runtime+'/companion-memory.mjs');
const receipts=[];
function fixture(){
 const db=openPositionDatabase(':memory:');
 db.sqlite.exec('CREATE TABLE companion_turns(request_id TEXT,conversation_id TEXT,location_id TEXT,member_id TEXT,fingerprint TEXT,question TEXT,answer TEXT,status TEXT,sources TEXT,scope TEXT,error TEXT,at TEXT,focus TEXT,memory_refs TEXT);CREATE TABLE companion_archives(id TEXT,location_id TEXT,member_id TEXT,membership_revision INTEGER)');
 const archive=(id,loc='berts',member='worker',revision=1)=>db.sqlite.prepare('INSERT INTO companion_archives VALUES(?,?,?,?)').run(id,loc,member,revision);
 const seed=(id,q,{conversation='original',loc='berts',member='worker',sources=[],scope=[],focus=null,refs=[],at='2026-10-01T00:00:00Z'}={})=>db.sqlite.prepare('INSERT INTO companion_turns VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,conversation,loc,member,'fixture',q,'STALE_ASSISTANT_METHOD_MUST_NOT_REVIVE','complete',JSON.stringify(sources),JSON.stringify(scope),'',at,JSON.stringify(focus),JSON.stringify(refs));
 const w={location:{id:'berts',revision:7,timezone:'America/New_York'},me:{id:'worker',position:'Server',area:'FOH',capabilities:[]},records:[],members:[]},c={id:'current',membership_revision:1};
 const read=(options={})=>readCompanionMemory(db.db,w,c,'Recall my Marigold preference.',Date.parse('2026-11-01'),{excludeIds:[],workforce:true,...options});
 archive('original');return {db,w,c,archive,seed,read};
}
test('ordinary personal preference wording retains adjacent correction through changed work scope without old assistant methods',async()=>{
 const f=fixture();try{
 const oldWeek={id:'schedule-week_2026-10-05',revision:2,kind:'schedule-week',title:'Old week'};
 f.seed('original','Please remember my preference for short Marigold answers.',{scope:[oldWeek]});
 f.seed('correction','Actually, explain in detail while training, with one example.',{scope:[oldWeek],at:'2026-10-01T00:00:10Z'});
 const r=await f.read();assert.deepEqual(new Set(r.entries.map(e=>e.requestId)),new Set(['original','correction']));assert.ok(r.entries.every(e=>e.priorAssistantAnswer===undefined&&e.sources.length===0));assert.deepEqual(r.validationSources,[]);receipts.push({case:'Personal correction survives stale scope as report only',passed:true});
 }finally{f.db.close();}
});
test('personal ranking cannot resurrect stale attached approved methods or a retired guide',async()=>{
 const f=fixture();try{
 const guide={id:'guide',revision:1,kind:'standard',title:'Old method'};f.w.records=[{id:'guide',locationId:'berts',ownerId:'worker',kind:'standard',revision:2,data:{status:'retired'}}];
 f.seed('source-backed','I prefer this Marigold method in my approved guide.',{sources:[guide],scope:[guide],focus:guide});const r=await f.read();assert.deepEqual(r.entries,[]);receipts.push({case:'Retired source method excluded',passed:true});
 }finally{f.db.close();}
});
test('an explicit current task cannot inherit unrelated historical personal dialogue',async()=>{
 const f=fixture();try{f.seed('personal','I prefer short Marigold answers.');const r=await f.read({selectedWork:{id:'new-task',revision:2,kind:'task',title:'New task'}});assert.deepEqual(r.entries,[]);receipts.push({case:'Selected work remains scoped',passed:true});}finally{f.db.close();}
});
test('personal ranking retains membership and restaurant privacy boundaries',async()=>{
 const f=fixture();try{
 for(const [id,loc,member,revision] of [['peer','berts','peer',1],['foreign','rudds','worker',1],['old-access','berts','worker',0]]){f.archive(id,loc,member,revision);f.seed(id,'I prefer private Marigold answers.',{conversation:id,loc,member});}
 f.seed('own','I prefer short Marigold answers.');const r=await f.read();assert.deepEqual(r.entries.map(e=>e.requestId),['own']);receipts.push({case:'Coworker, restaurant and old membership excluded',passed:true});
 }finally{f.db.close();}
});
test('deleted upstream memory invalidates personal corrections and in-flight recalled dependencies',async()=>{
 const f=fixture();try{
 f.archive('derived');f.seed('original','I prefer short Marigold answers.');f.seed('derived','Please remember my Marigold preference.',{conversation:'derived',refs:['original'],at:'2026-10-01T00:00:20Z'});
 const before=await f.read();assert.equal(await recalledRowsStillPresent(f.db.db,f.w,f.c,before.rows),true);
 f.db.sqlite.prepare('DELETE FROM companion_archives WHERE id=?').run('original');f.db.sqlite.prepare('DELETE FROM companion_turns WHERE conversation_id=?').run('original');
 assert.equal(await recalledRowsStillPresent(f.db.db,f.w,f.c,before.rows),false);assert.deepEqual((await f.read()).entries,[]);receipts.push({case:'Upstream deletion retained',passed:true});
 }finally{f.db.close();}
});
test.after(()=>fs.writeFileSync('evidence/hour-trial/berts-boh/memory-boundary-review.json',JSON.stringify({externalProviderCalls:0,runtime,sourceSha256:createHash('sha256').update(fs.readFileSync('app/shared/companion-memory.ts')).digest('hex'),runtimeSha256:createHash('sha256').update(fs.readFileSync(runtime+'/companion-memory.mjs')).digest('hex'),receipts,proof:'Read-only historical memory retrieval and dependency checks over fictional isolated SQLite. No generated-model helpfulness claim.'},null,2)+'\n'));
