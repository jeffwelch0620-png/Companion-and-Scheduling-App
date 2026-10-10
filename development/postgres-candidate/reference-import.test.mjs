import {fictionalStoreInsert} from './store-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { connection } from './test-config.mjs';
import { rehearseReferenceImport } from './reference-import.mjs';
async function sql(query, values=[], user='candidate_owner') {
  const c = new pg.Client({ ...connection, user }); await c.connect();
  try { return (await c.query(query, values)).rows; } finally { await c.end(); }
}
async function fixture() {
  const restaurantId = `reference-${randomUUID()}`, memberId=randomUUID(), personId=randomUUID(), shiftId=randomUUID(), standardId=randomUUID();
  await sql(fictionalStoreInsert, [restaurantId,'Fictional import test']);
  return { allow: 'fictional-local-only', batchId: randomUUID(), expectedScopeRevision: 0, reviewNote: 'Fictional identity and reference review', snapshot: {
    restaurantId, members: [{ revision: 2, active: true, member: { id:'legacy-member', locationId:restaurantId, name:'Fictional Person', area:'BOH', position:'Cook', scheduleOnly:false, capabilities:['location.manage'], qualifications:['Cook'] } }],
    records: [
      { id:'legacy-shift', kind:'shift', locationId:restaurantId, ownerId:'legacy-member', area:'BOH', revision:3,
        data:{personId:'legacy-member',start:'2031-04-01T09:00:00-04:00',end:'2031-04-01T17:00:00-04:00',position:'Cook',published:true,cancelled:false,history:[{action:'created'}]} },
      { id:'legacy-standard', kind:'standard', locationId:restaurantId, ownerId:'legacy-member', area:'BOH', revision:4,
        data:{title:'Fictional standard',zone:'Station',position:'Cook',version:5,status:'approved',verification:'manager',criteria:['Clean'],guide:{purpose:'Retain complete guide'},provenance:{sourceId:'fictional-source'}} },
    ], mappings:[
      {kind:'member',sourceId:'legacy-member',sourceRevision:2,restaurantId,targetId:memberId,personId},
      {kind:'shift',sourceId:'legacy-shift',sourceRevision:3,restaurantId,targetId:shiftId},
      {kind:'standard',sourceId:'legacy-standard',sourceRevision:4,restaurantId,targetId:standardId},
    ],
  } };
}
async function state(f) {
  return (await sql(`SELECT r.revision,
    (SELECT count(*)::int FROM candidate_identity.memberships WHERE restaurant_id=r.id) AS members,
    (SELECT count(*)::int FROM candidate_operations.shift_references WHERE restaurant_id=r.id) AS shifts,
    (SELECT count(*)::int FROM candidate_operations.standard_references WHERE restaurant_id=r.id) AS standards,
    (SELECT count(*)::int FROM candidate_operations.reference_import_receipts WHERE restaurant_id=r.id) AS receipts
    FROM candidate_identity.restaurants r WHERE id=$1`, [f.snapshot.restaurantId]))[0];
}
const empty = { revision:0, members:0, shifts:0, standards:0, receipts:0 };
test('atomic fictional import archives full source while granting no access or checkout authority', async () => {
  const f=await fixture(), result=await rehearseReferenceImport(f);
  assert.equal(result.replayed,false); assert.equal(result.workspaceRevision,1);
  assert.deepEqual(await state(f), {revision:1,members:1,shifts:1,standards:1,receipts:1});
  const receipt=(await sql('SELECT source_snapshot,review_note FROM candidate_operations.reference_import_receipts WHERE batch_id=$1',[f.batchId]))[0];
  assert.deepEqual(receipt.source_snapshot,f.snapshot); assert.equal(receipt.review_note,f.reviewNote);
  const member=f.snapshot.mappings[0].targetId;
  assert.equal((await sql('SELECT count(*)::int AS n FROM candidate_identity.membership_capabilities WHERE membership_id=$1',[member]))[0].n,0);
  assert.equal((await sql('SELECT count(*)::int AS n FROM candidate_identity.auth_links WHERE person_id=$1',[f.snapshot.mappings[0].personId]))[0].n,0);
  assert.equal((await sql('SELECT checkout_profile FROM candidate_operations.shift_references WHERE id=$1',[f.snapshot.mappings[1].targetId]))[0].checkout_profile,'unreviewed');
  assert.equal((await sql('SELECT count(*)::int AS n FROM candidate_identity.station_clearances WHERE member_id=$1',[member]))[0].n,0);
});
test('concurrent duplicate imports apply once; changed source cannot reuse batch receipt', async () => {
  const f=await fixture(), results=await Promise.all([rehearseReferenceImport(f),rehearseReferenceImport(f)]);
  assert.deepEqual(results.map(r=>r.replayed).sort(),[false,true]);
  assert.deepEqual(await state(f), {revision:1,members:1,shifts:1,standards:1,receipts:1});
  const changed=structuredClone(f); changed.snapshot.members[0].member.name='Changed';
  await assert.rejects(rehearseReferenceImport(changed),/import_batch_conflict/);
});
test('existing target references and people are not overwritten even if identical', async () => {
  const f=await fixture(); await rehearseReferenceImport(f);
  await assert.rejects(rehearseReferenceImport({...f,batchId:randomUUID(),expectedScopeRevision:1}),/target_reference_conflict/);
  const g=await fixture(); g.snapshot.mappings[0].personId=f.snapshot.mappings[0].personId;
  await assert.rejects(rehearseReferenceImport(g),/target_reference_conflict/); assert.deepEqual(await state(g),empty);
});
test('target revision and restaurant mapping must match before writes', async () => {
  const f=await fixture(); await sql('UPDATE candidate_identity.restaurants SET revision=1 WHERE id=$1',[f.snapshot.restaurantId]);
  await assert.rejects(rehearseReferenceImport(f),/target_scope_revision_conflict/);
  assert.deepEqual(await state(f),{...empty,revision:1});
  await sql('DELETE FROM candidate_identity.restaurants WHERE id=$1',[f.snapshot.restaurantId]);
  await assert.rejects(rehearseReferenceImport(f),/restaurant_mapping_required/);
});
test('shift and standard ID collisions are detected independently without partial membership writes', async () => {
  const original=await fixture(); await rehearseReferenceImport(original);
  for (const index of [1,2]) {
    const f=await fixture(); f.snapshot.mappings[index].targetId=original.snapshot.mappings[index].targetId;
    await assert.rejects(rehearseReferenceImport(f),/target_reference_conflict/);
    assert.deepEqual(await state(f),empty);
  }
});
test('failure writing final receipt rolls back people, references and scope revision', async () => {
  const f=await fixture();
  await sql(`CREATE FUNCTION candidate_operations.fail_reference_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fictional_receipt_failure'; END; $$`);
  await sql('CREATE TRIGGER fail_reference_receipt BEFORE INSERT ON candidate_operations.reference_import_receipts FOR EACH ROW EXECUTE FUNCTION candidate_operations.fail_reference_receipt()');
  try {
    await assert.rejects(rehearseReferenceImport(f),/fictional_receipt_failure/); assert.deepEqual(await state(f),empty);
    assert.equal((await sql('SELECT count(*)::int AS n FROM candidate_identity.people WHERE id=$1',[f.snapshot.mappings[0].personId]))[0].n,0);
  } finally { await sql('DROP TRIGGER fail_reference_receipt ON candidate_operations.reference_import_receipts'); await sql('DROP FUNCTION candidate_operations.fail_reference_receipt()'); }
  assert.equal((await rehearseReferenceImport(f)).replayed,false);
});
test('invalid mapping and missing fictional acknowledgment never write', async () => {
  const f=await fixture(); await assert.rejects(rehearseReferenceImport({...f,allow:undefined}),/acknowledgment_required/);
  const bad=structuredClone(f); bad.snapshot.mappings.pop(); await assert.rejects(rehearseReferenceImport(bad),/mapping_blocked/);
  assert.deepEqual(await state(f),empty);
});
test('restricted runtime cannot read archived source or manufacture import receipts', async () => {
  await assert.rejects(sql('SELECT * FROM candidate_operations.reference_import_receipts',[],'candidate_runtime'),/permission denied/);
  await assert.rejects(sql('INSERT INTO candidate_operations.reference_import_receipts DEFAULT VALUES',[],'candidate_runtime'),/permission denied/);
});
