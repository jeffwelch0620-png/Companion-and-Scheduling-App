import pg from 'pg';
import { createHash } from 'node:crypto';
import { connection } from './test-config.mjs';
import { reviewReferenceMapping } from './reference-mapping.mjs';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;

/** New references only; fixed fictional connection, never a production importer. */
export async function rehearseReferenceImport({ snapshot, batchId, expectedScopeRevision, reviewNote, allow }) {
  if (allow !== 'fictional-local-only') throw Error('fictional_import_acknowledgment_required');
  if (!uuid.test(batchId ?? '') || !Number.isInteger(expectedScopeRevision) || expectedScopeRevision < 0 || expectedScopeRevision >= 2147483647 ||
      typeof reviewNote !== 'string' || !reviewNote.trim() || reviewNote.trim().length > 2000) throw Error('invalid_import_review');
  // Snapshot the caller input before asynchronous work; archive exactly what was validated.
  const source = JSON.parse(JSON.stringify(snapshot));
  const reviewed = reviewReferenceMapping(source);
  if (reviewed.status !== 'reviewable') throw Error('mapping_blocked');
  if (!source.members.length) throw Error('empty_import');
  const hash = createHash('sha256').update(JSON.stringify(stable({ source, expectedScopeRevision, reviewNote }))).digest('hex');
  const client = new pg.Client({ ...connection, user: 'candidate_owner' });
  await client.connect();
  try {
    await client.query('BEGIN');
    const identity = (await client.query('SELECT current_database() AS db, current_user AS role')).rows[0];
    if (identity.db !== connection.database || identity.role !== 'candidate_owner') throw Error('fictional_target_required');
    const scope = (await client.query('SELECT revision FROM candidate_identity.restaurants WHERE id=$1 FOR UPDATE', [source.restaurantId])).rows[0];
    if (!scope) throw Error('restaurant_mapping_required');
    const prior = (await client.query('SELECT source_hash, result FROM candidate_operations.reference_import_receipts WHERE batch_id=$1', [batchId])).rows[0];
    if (prior) {
      if (prior.source_hash !== hash) throw Error('import_batch_conflict');
      await client.query('COMMIT');
      return { ...prior.result, replayed: true };
    }
    if (scope.revision !== expectedScopeRevision) throw Error('target_scope_revision_conflict');
    const p = reviewed.proposals;
    // Refuse even identical existing IDs. Shared people require a separate linking review.
    const conflicts = await client.query(`SELECT EXISTS(SELECT 1 FROM candidate_identity.people WHERE id=ANY($1::uuid[]))
      OR EXISTS(SELECT 1 FROM candidate_identity.memberships WHERE id=ANY($2::uuid[]) OR (restaurant_id=$5 AND person_id=ANY($1::uuid[])))
      OR EXISTS(SELECT 1 FROM candidate_operations.shift_references WHERE id=ANY($3::uuid[]))
      OR EXISTS(SELECT 1 FROM candidate_operations.standard_references WHERE id=ANY($4::uuid[])) AS conflict`,
      [p.memberships.map(m => m.person_id), p.memberships.map(m => m.id), p.shifts.map(s => s.id), p.standards.map(s => s.id), source.restaurantId]);
    if (conflicts.rows[0].conflict) throw Error('target_reference_conflict');
    for (const m of p.memberships) {
      await client.query('INSERT INTO candidate_identity.people(id,name) VALUES($1,$2)', [m.person_id, m.name]);
      await client.query(`INSERT INTO candidate_identity.memberships(id,person_id,restaurant_id,department,position,active,schedule_only)
        VALUES($1,$2,$3,$4,$5,$6,$7)`, [m.id,m.person_id,m.restaurant_id,m.department,m.position,m.active,m.schedule_only]);
    }
    for (const s of p.shifts) await client.query(`INSERT INTO candidate_operations.shift_references
      (id,restaurant_id,member_id,department,position,starts_at,ends_at,revision,published,cancelled)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [s.id,s.restaurant_id,s.member_id,s.department,s.position,s.starts_at,s.ends_at,s.revision,s.published,s.cancelled]);
    for (const s of p.standards) await client.query(`INSERT INTO candidate_operations.standard_references
      (id,restaurant_id,department,title,zone,position,revision,version,verification,status,criteria)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`, [s.id,s.restaurant_id,s.department,s.title,s.zone,s.position,s.revision,s.version,s.verification,s.status,JSON.stringify(s.criteria)]);
    for (const link of p.shiftStandardLinks) await client.query(`INSERT INTO candidate_operations.shift_standard_links
      (shift_id,standard_id,restaurant_id) VALUES($1,$2,$3)`, [link.shift_id,link.standard_id,link.restaurant_id]);
    const next = (await client.query('UPDATE candidate_identity.restaurants SET revision=revision+1 WHERE id=$1 RETURNING revision', [source.restaurantId])).rows[0].revision;
    const result = { batchId: batchId.toLowerCase(), restaurantId: source.restaurantId, sourceHash: hash, workspaceRevision: next,
      memberships: p.memberships.length, shifts: p.shifts.length, standards: p.standards.length, shiftStandardLinks: p.shiftStandardLinks.length };
    await client.query(`INSERT INTO candidate_operations.reference_import_receipts
      (batch_id,restaurant_id,source_hash,source_snapshot,review_note,expected_scope_revision,result) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb)`,
      [batchId,source.restaurantId,hash,JSON.stringify(source),reviewNote,expectedScopeRevision,JSON.stringify(result)]);
    await client.query('COMMIT');
    return { ...result, replayed: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { await client.end(); }
}
