import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Miniflare } from 'miniflare';
import { handleSourceLibrary } from '../.sites-runtime/shared/source-library.mjs';
import { sourceLibrary } from '../.sites-runtime/shared/source-library-data.mjs';
import { sourceCanPublish } from '../.sites-runtime/shared/source-library-types.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');

test('source intake retains scope, missing approval and duplicate relationships without promoting drafts',()=>{
  assert.equal(sourceLibrary.documents.length,26);assert.equal(sourceLibrary.conflicts.length,8);
  const ids=new Set(sourceLibrary.documents.map(d=>d.id));assert.equal(ids.size,26);
  for(const d of sourceLibrary.documents)assert.equal(createHash('sha256').update(d.content).digest('hex'),d.textSha256);
  for(const d of sourceLibrary.documents){assert.equal(d.locationId,'berts');assert.match(d.sha256,/^[a-f0-9]{64}$/);assert.ok(d.roles.length&&d.stations.length&&d.documentType&&d.assignment);assert.equal(d.sourceOwner,null);assert.equal(d.lastApprovedDate,null);assert.equal(sourceCanPublish(d,sourceLibrary.conflicts),false);assert.ok(d.content.length>100);assert.ok(d.relatedVersions.every(id=>ids.has(id)));assert.ok(d.conflicts.every(id=>sourceLibrary.conflicts.some(c=>c.id===id)));}
  const duplicates=sourceLibrary.documents.filter(d=>d.duplicates.length);assert.equal(duplicates.length,2);assert.equal(duplicates[0].textSha256,duplicates[1].textSha256);assert.notEqual(duplicates[0].sha256,duplicates[1].sha256);
});

test('approval requires an actual owner, approval evidence, real date and resolved conflicts',()=>{
 const base={...sourceLibrary.documents[0],sourceStatus:'current',publicationStatus:'approved',sourceOwner:'Fictional approver',lastApprovedDate:'2026-09-10',approvalEvidence:'Fictional signed review',conflicts:[],supersededBy:null};
 assert.equal(sourceCanPublish(base,[]),true);
 for(const change of [{sourceOwner:null},{lastApprovedDate:'2026-02-30'},{lastApprovedDate:null},{approvalEvidence:''},{sourceStatus:'draft'},{sourceStatus:'archived'},{supersededBy:'replacement'},{conflicts:['missing']},{conflicts:['open']}])assert.equal(sourceCanPublish({...base,...change},[{id:'open',status:'unresolved'}]),false);
 assert.equal(sourceCanPublish({...base,conflicts:['reviewed']},[{id:'reviewed',status:'resolved'}]),true);
});

test('source API is owner-only, restaurant-scoped, read-only and loads raw content only on demand',async t=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const name of fs.readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())await db.batch(fs.readFileSync('drizzle/'+name,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s)));
 for(const location of ['berts','rudds'])await db.prepare('INSERT INTO locations(id,name,timezone) VALUES(?,?,?)').bind(location,'Fictional '+location,'America/New_York').run();
 for(const [id,location,position,caps] of [['owner','berts','Owner',['location.manage']],['employee','berts','Server',[]],['manager','berts','Kitchen Manager',['standards.approve']],['dish','berts','Dishwasher',['location.manage']],['other-owner','rudds','Owner',['location.manage']]])await db.prepare('INSERT INTO memberships(id,email,auth_user_id,location_id,name,area,position,capabilities,qualifications) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,id+'@example.test',id,location,id,'BOH',position,JSON.stringify(caps),'[]').run();
 const call=async(actor,location='berts',documentId='',method='GET')=>handleSourceLibrary(new Request('https://test.example/api/source-library?locationId='+location+(documentId?'&documentId='+documentId:''),{method,headers:actor?{'oai-authenticated-user-id':actor,'oai-authenticated-user-email':actor+'@example.test'}:{}}),db);
 assert.equal((await call(null)).status,401);for(const actor of ['employee','manager','dish'])assert.equal((await call(actor)).status,403);
 assert.equal((await call('owner','rudds')).status,403);assert.equal((await call('owner','berts','','POST')).status,405);
 const response=await call('owner');assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);const index=await response.json();assert.equal(index.documents.length,26);assert.ok(index.documents.every(d=>!('content' in d)&&d.publicationStatus==='reference_only'));
 const first=index.documents[0],detail=await call('owner','berts',first.id);assert.equal((await detail.json()).document.content,sourceLibrary.documents[0].content);
 const other=await call('other-owner','rudds');const empty=await other.json();assert.deepEqual(empty.documents,[]);assert.deepEqual(empty.conflicts,[]);assert.equal((await call('other-owner','rudds',first.id)).status,404);
 await db.prepare("UPDATE memberships SET active=0 WHERE id='owner'").run();assert.equal((await call('owner')).status,403);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM records').first()).n,0);
});
