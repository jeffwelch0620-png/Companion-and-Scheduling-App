import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewReferenceMapping } from './reference-mapping.mjs';
const id = n => `10000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
function fixture() {
  return { restaurantId: 'fictional', members: [{ revision: 3, active: true, member: {
    id: 'employee-text-id', locationId: 'fictional', name: 'Example Employee', area: 'BOH', position: 'Cook',
    capabilities: ['location.manage'], qualifications: ['Cook'], scheduleJobs: ['Dishwasher'], scheduleOnly: true,
  } }], records: [
    { id: 'shift-text-id', locationId: 'fictional', ownerId: 'employee-text-id', area: 'BOH', revision: 2, kind: 'shift',
      data: { personId: 'employee-text-id', start: '2031-01-01T09:00:00-05:00', end: '2031-01-01T17:00:00-05:00', position: 'Cook', published: true, cancelled: false } },
    { id: 'standard-text-id', locationId: 'fictional', ownerId: 'employee-text-id', area: 'BOH', revision: 4, kind: 'standard',
      data: { title: 'Example standard', zone: 'Example station', position: 'Cook', criteria: ['Clean'], version: 7, status: 'approved', verification: 'senior-then-manager', guide: { purpose: 'Retain in archive' } } },
  ], mappings: [
    { kind: 'member', sourceId: 'employee-text-id', sourceRevision: 3, restaurantId: 'fictional', targetId: id(1), personId: id(2) },
    { kind: 'shift', sourceId: 'shift-text-id', sourceRevision: 2, restaurantId: 'fictional', targetId: id(3) },
    { kind: 'standard', sourceId: 'standard-text-id', sourceRevision: 4, restaurantId: 'fictional', targetId: id(4) },
  ] };
}
test('explicit membership maps shift employee separately from source text IDs, preserving revisions and flags', () => {
  const source = fixture(), before = structuredClone(source), result = reviewReferenceMapping(source);
  assert.equal(result.status, 'reviewable');
  assert.equal(result.proposals.shifts[0].member_id, id(1));
  assert.equal(result.proposals.shifts[0].starts_at, '2031-01-01T14:00:00.000Z');
  assert.equal(result.proposals.memberships[0].schedule_only, true);
  assert.equal(result.proposals.standards[0].revision, 4);
  assert.equal(result.proposals.standards[0].version, 7);
  assert.deepEqual(source, before);
  for (const key of ['capabilities', 'qualifications', 'scheduleJobs', 'authUserId', 'checkout_profile'])
    assert.equal(Object.hasOwn(result.proposals.memberships[0], key), false);
  assert.ok(result.requires.includes('source-archive'));
});
function blocked(source, code) {
  const result = reviewReferenceMapping(source);
  assert.equal(result.status, 'blocked'); assert.equal(result.proposals, null);
  assert.ok(result.issues.some(i => i.code === code), JSON.stringify(result.issues));
}
test('missing and stale mappings block the entire proposal', () => {
  const a = fixture(); a.mappings.pop(); blocked(a, 'missing_mapping');
  const b = fixture(); b.mappings[0].sourceRevision = 2; blocked(b, 'stale_mapping');
});
test('cross-restaurant records and mappings are rejected', () => {
  const a = fixture(); a.records[0].locationId = 'other'; blocked(a, 'record_scope_or_owner');
  const b = fixture(); b.mappings[0].restaurantId = 'other'; blocked(b, 'invalid_mapping');
});
test('duplicate source and target IDs cannot silently overwrite mappings', () => {
  const a = fixture(); a.records.push(structuredClone(a.records[0])); blocked(a, 'duplicate_source');
  const b = fixture(); b.mappings.push({ ...b.mappings[0], sourceId: 'second' }); blocked(b, 'duplicate_mapping');
});
test('equal names do not link people and duplicate person memberships require model review', () => {
  const a = fixture(); a.members.push({ ...structuredClone(a.members[0]), member: { ...a.members[0].member, id: 'second' } });
  blocked(a, 'missing_mapping');
  a.mappings.push({ ...a.mappings[0], sourceId: 'second', targetId: id(5) });
  blocked(a, 'multiple_memberships_for_person');
});
test('unknown employees, ambiguous shift times and release history require review', () => {
  const a = fixture(); a.records[0].data.personId = 'unknown'; blocked(a, 'invalid_shift');
  const b = fixture(); b.records[0].data.start = '2031-01-01T09:00:00'; blocked(b, 'invalid_shift');
  const c = fixture(); c.records[0].data.releasedAt = '2031-01-01T22:00:00Z'; blocked(c, 'released_shift_requires_review');
});
test('empty criteria, unsupported workflows and unused mappings are not silently dropped', () => {
  const a = fixture(); a.records[1].data.criteria = []; blocked(a, 'invalid_standard');
  const b = fixture(); b.records.push({ id: 'order', kind: 'order' }); blocked(b, 'unsupported_record');
  const c = fixture(); c.mappings.push({ ...c.mappings[1], sourceId: 'unused', targetId: id(6) }); blocked(c, 'unused_mapping');
});
test('persisted member revision and active state are required beyond the UI projection', () => {
  const a = fixture(); delete a.members[0].revision; blocked(a, 'stale_mapping');
  const b = fixture(); delete b.members[0].active; blocked(b, 'invalid_member');
});
