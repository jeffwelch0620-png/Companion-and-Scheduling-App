import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fixture} from './maintenance-meter-fixture.mjs';
import {loadExplicitAuthority,authorityTransactionGuard} from '../.sites-runtime/shared/authority-persistence-prototype.mjs';
const at='2026-10-02T12:00:00Z',resource={organizationId:'fictional-org',storeId:'a'};
async function setup(t,role='gm'){
 const f=await fixture(t);
 for(const sql of fs.readFileSync('prototypes/authority-grants-DRAFT.sql','utf8').split('--> statement-breakpoint').filter(s=>s.trim()))await f.db.prepare(sql).run();
 await f.db.prepare("INSERT INTO prototype_authority_principals(organization_id,person_id,auth_user_id,active,verified_at,verified_by_person_id,source_ref) VALUES('fictional-org','fictional-person','manager-identity',1,'2026-10-01T00:00:00Z','fictional-verifier','Fictional verified identity')").run();
 await f.db.prepare('INSERT INTO prototype_authority_grants(id,organization_id,person_id,membership_id,membership_revision,store_id,role,active,starts_at,ends_at,verified_at,verified_by_person_id,source_ref) VALUES(?,?,?,?,?,?,?,1,?,?,?,?,?)').bind('fictional-grant','fictional-org','fictional-person',role==='owner'?null:'manager',role==='owner'?null:1,role==='owner'?null:'a',role,'2026-10-01T00:00:00Z',role.startsWith('covering')?'2026-10-02T13:00:00Z':null,'2026-10-01T00:00:00Z','fictional-verifier','Fictional designation').run();
 const load=(action='foh.service',date=at,r=resource)=>loadExplicitAuthority(f.db,'manager-identity','fictional-org','a',action,r,date);
 return {...f,load};
}
test('persisted authority loads explicit grants and separates admin/title and coverage from owners/pay',async t=>{
 const f=await setup(t,'covering-foh');
 assert.equal((await f.load()).allowed,true);
 assert.equal((await f.load('frontline.rate.read',at,{...resource,scheduleWriting:true})).allowed,false);
 assert.equal((await f.load('incident.read')).allowed,false);
 await f.db.prepare("UPDATE memberships SET position='Owner',capabilities='[\"location.manage\"]' WHERE id='manager'").run();
 assert.equal((await f.load('incident.read')).allowed,false);
 await f.db.prepare("UPDATE prototype_authority_grants SET role='owner',membership_id=NULL,membership_revision=NULL,store_id=NULL,ends_at=NULL WHERE id='fictional-grant'").run();
 assert.equal((await f.load('incident.read')).allowed,true);
 assert.equal((await f.load('manager.pay.read')).allowed,true);
});
test('persisted grant reads fail closed for revoke, expiry, membership revision mismatch and wrong tenancy',async t=>{
 const f=await setup(t);
 assert.equal((await f.load()).allowed,true);
 assert.equal((await f.load('foh.service',at,{...resource,storeId:'b'})).allowed,false);
 await f.db.prepare("UPDATE memberships SET revision=revision+1 WHERE id='manager'").run();
 assert.equal((await f.load()).allowed,false);
 await f.db.prepare("UPDATE prototype_authority_grants SET membership_revision=2,ends_at=? WHERE id='fictional-grant'").bind(at).run();
 assert.equal((await f.load()).allowed,false);
 await f.db.prepare("UPDATE prototype_authority_grants SET ends_at=NULL,active=0 WHERE id='fictional-grant'").run();
 assert.equal((await f.load()).allowed,false);
 await f.db.prepare("UPDATE prototype_authority_principals SET active=0 WHERE person_id='fictional-person'").run();
 assert.equal(await f.load(),null);
 assert.equal(await loadExplicitAuthority(f.db,'manager-identity','foreign','a','foh.service',{...resource,organizationId:'foreign'},at),null);
});
test('transaction guard prevents stale grant, principal, membership and expired authority from writing',async t=>{
 for(const [label,mutation,commitAt] of [
  ['grant',"UPDATE prototype_authority_grants SET active=0 WHERE id='fictional-grant'",at],
  ['principal',"UPDATE prototype_authority_principals SET source_ref='Fictional corrected evidence' WHERE person_id='fictional-person'",at],
  ['membership',"UPDATE memberships SET revision=revision+1 WHERE id='manager'",at],
  ['expiry',null,'2026-10-02T13:00:00Z'],
 ])await t.test(label,async t=>{
  const f=await setup(t,'covering-foh'),proof=await f.load();assert.equal(proof.allowed,true);
  const guard=authorityTransactionGuard(proof,commitAt);
  if(mutation)await f.db.prepare(mutation).run();
  const result=await f.db.batch([
   f.db.prepare(`UPDATE locations SET revision=revision+1,last_command='fictional-guarded' WHERE id='a' AND ${guard.sql}`).bind(...guard.values),
   f.db.prepare("INSERT INTO audit_events(id,location_id,actor_id,action,record_id,at,revision) SELECT 'fictional-audit','a','manager','prototype.authority','fictional-record',?,2 WHERE EXISTS(SELECT 1 FROM locations WHERE id='a' AND last_command='fictional-guarded')").bind(commitAt),
  ]);
  assert.equal(result[0].meta.changes,0);assert.equal(result[1].meta.changes,0);
  assert.equal((await f.db.prepare("SELECT revision FROM locations WHERE id='a'").first()).revision,0);
 });
});
test('valid proof commits once and revision/history constraints retain corrected grants',async t=>{
 const f=await setup(t),proof=await f.load(),guard=authorityTransactionGuard(proof,at);
 const result=await f.db.prepare(`UPDATE locations SET revision=revision+1 WHERE id='a' AND revision=0 AND ${guard.sql}`).bind(...guard.values).run();assert.equal(result.meta.changes,1);
 assert.equal((await f.db.prepare(`UPDATE locations SET revision=revision+1 WHERE id='a' AND revision=0 AND ${guard.sql}`).bind(...guard.values).run()).meta.changes,0);
 await f.db.prepare("UPDATE prototype_authority_grants SET source_ref='Fictional corrected source' WHERE id='fictional-grant'").run();
 assert.equal((await f.db.prepare("SELECT revision FROM prototype_authority_grants WHERE id='fictional-grant'").first()).revision,2);
 assert.equal((await f.db.prepare("SELECT count(*) AS n FROM prototype_authority_history WHERE entity='grant'").first()).n,1);
 assert.equal((await f.db.prepare(`SELECT 1 AS allowed WHERE ${guard.sql}`).bind(...guard.values).first()),null);
 await assert.rejects(()=>f.db.prepare("UPDATE prototype_authority_grants SET revision=1 WHERE id='fictional-grant'").run());
 await assert.rejects(()=>f.db.prepare("DELETE FROM prototype_authority_grants WHERE id='fictional-grant'").run());
 assert.deepEqual(authorityTransactionGuard(null,at),{sql:'0',values:[]});
});
