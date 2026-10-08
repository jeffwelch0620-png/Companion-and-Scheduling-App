import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {Miniflare} from 'miniflare';
import {postAuthorityBoundDraftReceipt} from '../.sites-runtime/shared/food-authority-bridge-prototype.mjs';
process.env.MINIFLARE_REGISTRY_PATH??=path.resolve('.wrangler/registry');
const at='2026-10-02T12:00:00Z';
async function fixture(t,role='boh-manager'){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',compatibilityDate:'2026-05-22',d1Databases:['DB']});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');
 for(const file of [...fs.readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort().map(x=>'drizzle/'+x),'prototypes/authority-grants-DRAFT.sql','drafts/commissary-receipt-ledger.sql','prototypes/food-authority-bridge-DRAFT.sql'])await db.batch(fs.readFileSync(file,'utf8').split('--> statement-breakpoint').filter(x=>x.trim()).map(x=>db.prepare(x)));
 await db.prepare("INSERT INTO locations(id,name,timezone) VALUES('fixture-store','Fixture','America/New_York')").run();
 await db.prepare("INSERT INTO memberships(id,email,location_id,name,area,position,capabilities,qualifications,auth_user_id) VALUES('fixture-member','fixture@example.test','fixture-store','Fixture','BOH','Owner','[\"location.manage\"]','[]','fixture-auth')").run();
 await db.prepare("INSERT INTO prototype_authority_principals(organization_id,person_id,auth_user_id,active,verified_at,verified_by_person_id,source_ref) VALUES('fixture-org','fixture-person','fixture-auth',1,'2026-10-01T00:00:00Z','fixture-verifier','Fixture verified identity')").run();
 if(role)await db.prepare('INSERT INTO prototype_authority_grants VALUES(?,?,?,?,?,?,?,1,1,?,?,?,?,?)').bind('fixture-grant','fixture-org','fixture-person',role==='owner'?null:'fixture-member',role==='owner'?null:1,role==='owner'?null:'fixture-store',role,'2026-10-01T00:00:00Z',role.startsWith('covering')?'2026-10-02T13:00:00Z':null,'2026-10-01T00:00:00Z','fixture-verifier','Fixture designation').run();
 await db.batch([db.prepare("INSERT INTO draft_food_batches VALUES('fixture-batch','fixture-product',1,'fixture-owner','fixture-production','gal',1)"),db.prepare("INSERT INTO draft_food_receipt_mappings VALUES('fixture-map',1,1,'fixture-batch','fixture-consumer','fixture-storage','fixture-destination')"),db.prepare("INSERT INTO draft_food_balances VALUES('fixture-batch','fixture-storage',10,0)"),db.prepare("INSERT INTO draft_food_balances VALUES('fixture-batch','fixture-destination',0,0)"),db.prepare("INSERT INTO prototype_food_receipt_bindings VALUES('fixture-binding','fixture-org','fixture-map','fixture-storage','fixture-destination','fixture-store','fixture-person',1,1)")]);
 const binding={bindingId:'fixture-binding',bindingRevision:1,organizationId:'fixture-org',destinationStoreId:'fixture-store',department:'BOH',context:{receivingLocationId:'fixture-destination',sourceLocationId:'fixture-storage',owningRestaurantId:'fixture-owner',product:{id:'fixture-product',revision:1,unit:'gal'},sourceRevision:0,destinationRevision:0},mapping:{id:'fixture-map',revision:1,batchId:'fixture-batch',batchRevision:1,consumingRestaurantId:'fixture-consumer',productionLocationId:'fixture-production'}};
 const input={requestId:'fixture-request',sourceLocationId:'fixture-storage',destinationLocationId:'fixture-destination',owningRestaurantId:'fixture-owner',productId:'fixture-product',productRevision:1,sourceRevision:0,destinationRevision:0,quantity:4,unit:'gal',receivedAt:'2026-10-02T11:00:00Z',confirmed:true,actorId:'spoofed-owner',canReceive:true,role:'owner'};
 const snapshot=async()=>Object.fromEntries(await Promise.all(['balances','receipts','movements','receipt_heads','receipt_guards'].map(async n=>[n,(await db.prepare(`SELECT * FROM draft_food_${n} ORDER BY 1,2`).all()).results])));
 const post=(database=db,b=binding,clock=()=>at,auth='fixture-auth',body=input)=>postAuthorityBoundDraftReceipt(database,auth,b,body,'fixture-receipt',clock);
 return {db,binding,input,post,snapshot};
}
test('explicit department and owner grants combine with verified requester/storage binding',async t=>{
 for(const role of ['boh-manager','foh-manager','owner'])await t.test(role,async t=>{const f=await fixture(t,role),r=await f.post(f.db,{...f.binding,department:role==='foh-manager'?'FOH':'BOH'});assert.equal(r.receipt.receivedBy,'fixture-person');assert.equal(r.receipt.owningRestaurantId,'fixture-owner');assert.equal(r.mapping.productionLocationId,'fixture-production');const s=await f.snapshot();assert.equal(s.movements.length,2);assert.deepEqual(s.balances.map(x=>x.quantity),[4,6]);});
});
test('client/title/admin spoof, wrong department, identity or organization cannot post',async t=>{
 for(const role of [null,'foh-manager'])await t.test(String(role),async t=>{const f=await fixture(t,role),before=await f.snapshot();await assert.rejects(()=>f.post());assert.deepEqual(await f.snapshot(),before);});
 const f=await fixture(t);for(const [b,auth]of [[f.binding,'unverified-auth'],[{...f.binding,organizationId:'foreign-org'},'fixture-auth']]){const before=await f.snapshot();await assert.rejects(()=>f.post(f.db,b,()=>at,auth));assert.deepEqual(await f.snapshot(),before);}
});
test('expired coverage and commit-time grant/member/principal/requester revocation roll back all stock/history',async t=>{
 for(const mutation of ["UPDATE prototype_authority_grants SET active=0 WHERE id='fixture-grant'","UPDATE memberships SET revision=revision+1 WHERE id='fixture-member'","UPDATE prototype_authority_principals SET active=0 WHERE person_id='fixture-person'","UPDATE prototype_food_receipt_bindings SET active=0 WHERE id='fixture-binding'",null])await t.test(mutation??'coverage expiry',async t=>{
  const f=await fixture(t,'covering-boh'),before=await f.snapshot();let calls=0;
  const wrapped={prepare:f.db.prepare.bind(f.db),batch:async stmts=>{if(stmts.length!==3&&mutation)await f.db.prepare(mutation).run();return f.db.batch(stmts);}};
  const clock=()=>++calls===1?at:mutation?at:'2026-10-02T13:00:00Z';await assert.rejects(()=>f.post(wrapped,f.binding,clock));assert.deepEqual(await f.snapshot(),before);
 });
});
test('coverage expiring after precheck and prior read rejects at final batch',async t=>{
 const f=await fixture(t,'covering-boh'),before=await f.snapshot();let late=false;
 const wrapped={batch:f.db.batch.bind(f.db),prepare(sql){const statement=f.db.prepare(sql);if(!sql.startsWith('SELECT fingerprint,data'))return statement;
  return new Proxy(statement,{get(target,prop){if(prop==='bind')return(...args)=>{const bound=target.bind(...args);return new Proxy(bound,{get(b,p){if(p==='first')return async()=>{const row=await b.first();late=true;return row;};const method=Reflect.get(b,p);return typeof method==='function'?method.bind(b):method;}});};const method=Reflect.get(target,prop);return typeof method==='function'?method.bind(target):method;}});
 }};
 await assert.rejects(()=>f.post(wrapped,f.binding,()=>late?'2026-10-02T13:00:00Z':at));assert.deepEqual(await f.snapshot(),before);
});
test('revocation after initial authorization blocks prior receipt replay without leaking saved data',async t=>{
 const f=await fixture(t);await f.post();const before=await f.snapshot();let revoked=false;
 const wrapped={batch:f.db.batch.bind(f.db),prepare(sql){const statement=f.db.prepare(sql);if(!sql.startsWith('SELECT fingerprint,data'))return statement;
  return new Proxy(statement,{get(target,prop){if(prop==='bind')return(...args)=>{const bound=target.bind(...args);return new Proxy(bound,{get(b,p){if(p==='first')return async()=>{if(!revoked){revoked=true;await f.db.prepare("UPDATE prototype_authority_grants SET active=0 WHERE id='fixture-grant'").run();}return b.first();};const method=Reflect.get(b,p);return typeof method==='function'?method.bind(b):method;}});};const method=Reflect.get(target,prop);return typeof method==='function'?method.bind(target):method;}});
 }};
 await assert.rejects(()=>f.post(wrapped));assert.deepEqual(await f.snapshot(),before);
});
test('authority wrapping preserves exact retry and changed-request conflict without extra stock legs',async t=>{
 const f=await fixture(t),one=await f.post(),before=await f.snapshot(),two=await f.post();assert.deepEqual(two,one);assert.deepEqual(await f.snapshot(),before);
 await assert.rejects(()=>f.post(f.db,f.binding,()=>at,'fixture-auth',{...f.input,quantity:3}));assert.deepEqual(await f.snapshot(),before);assert.equal(before.movements.length,2);
});
