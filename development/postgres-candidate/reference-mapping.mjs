// Read-only preparation. This module has no database or network dependency.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = v => typeof v === 'string' && v.trim().length > 0;
const revision = v => Number.isInteger(v) && v > 0 && v <= 2147483647;
const instant = v => typeof v === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));

/** Source members must include persisted revision/active state, absent from UI Member. */
export function reviewReferenceMapping({ restaurantId, members, records, mappings, shiftStandardLinks: sourceLinks }) {
  if (!text(restaurantId) || ![members, records, mappings].every(Array.isArray)) throw new TypeError('invalid_mapping_envelope');
  const issues = [], staged = { memberships: [], shifts: [], standards: [] };
  const fail = (code, kind, sourceId) => issues.push({ code, kind, sourceId });
  const index = new Map(), targets = new Set(), sourceKeys = new Set(), memberIndex = new Map();
  for (const m of mappings) {
    if (!m || !['member', 'shift', 'standard'].includes(m.kind) || !text(m.sourceId) || !uuid.test(m.targetId ?? '') ||
        m.restaurantId !== restaurantId || !revision(m.sourceRevision) || (m.kind === 'member' && !uuid.test(m.personId ?? ''))) {
      fail('invalid_mapping', m?.kind, m?.sourceId); continue;
    }
    const key = `${m.kind}:${m.sourceId}`, target = `${m.kind}:${m.targetId.toLowerCase()}`;
    if (index.has(key) || targets.has(target)) { fail('duplicate_mapping', m.kind, m.sourceId); continue; }
    index.set(key, m); targets.add(target);
  }
  function mapping(kind, id, rev) {
    const key = `${kind}:${id}`;
    if (sourceKeys.has(key)) { fail('duplicate_source', kind, id); return; }
    sourceKeys.add(key);
    const m = index.get(key);
    if (!m) { fail('missing_mapping', kind, id); return; }
    if (!revision(rev) || m.sourceRevision !== rev) { fail('stale_mapping', kind, id); return; }
    return m;
  }
  const personScopes = new Set();
  for (const entry of members) {
    const member = entry?.member;
    const m = mapping('member', member?.id, entry?.revision);
    if (!m) continue;
    if (member.locationId !== restaurantId || ![member.name, member.area, member.position].every(text) ||
        typeof entry.active !== 'boolean' || (member.scheduleOnly !== undefined && typeof member.scheduleOnly !== 'boolean')) {
      fail('invalid_member', 'member', member.id); continue;
    }
    const person = m.personId.toLowerCase();
    if (personScopes.has(person)) { fail('multiple_memberships_for_person', 'member', member.id); continue; }
    personScopes.add(person); memberIndex.set(member.id, { member, m });
    staged.memberships.push({ id: m.targetId.toLowerCase(), person_id: person, restaurant_id: restaurantId,
      name: member.name, department: member.area, position: member.position, active: entry.active,
      schedule_only: member.scheduleOnly ?? false, source_revision: entry.revision });
  }
  for (const record of records) {
    if (!record || !['shift', 'standard'].includes(record.kind)) { fail('unsupported_record', record?.kind, record?.id); continue; }
    const m = mapping(record.kind, record.id, record.revision);
    if (!m) continue;
    const d = record.data, owner = memberIndex.get(record.ownerId);
    if (record.locationId !== restaurantId || !text(record.area) || !owner || owner.member.area !== record.area || !d || typeof d !== 'object') {
      fail('record_scope_or_owner', record.kind, record.id); continue;
    }
    const base = { id: m.targetId.toLowerCase(), restaurant_id: restaurantId, department: record.area, revision: record.revision };
    if (record.kind === 'shift') {
      const employee = memberIndex.get(d.personId);
      if (!employee || employee.member.area !== record.area || !text(d.position) || !instant(d.start) || !instant(d.end) ||
          Date.parse(d.end) <= Date.parse(d.start) || typeof d.published !== 'boolean' || typeof d.cancelled !== 'boolean') {
        fail('invalid_shift', record.kind, record.id); continue;
      }
      // Existing checkout must be reconciled through release/audit rules, never copied.
      if (d.releasedAt) { fail('released_shift_requires_review', record.kind, record.id); continue; }
      staged.shifts.push({ ...base, member_id: employee.m.targetId.toLowerCase(), position: d.position,
        starts_at: new Date(d.start).toISOString(), ends_at: new Date(d.end).toISOString(), published: d.published, cancelled: d.cancelled });
    } else {
      if (![d.title, d.zone, d.position].every(text) || !revision(d.version) || !['draft', 'approved', 'retired'].includes(d.status) ||
          !['manager', 'senior-then-manager'].includes(d.verification) || !Array.isArray(d.criteria) ||
          d.criteria.length < 1 || d.criteria.length > 100 || !d.criteria.every(text)) {
        fail('invalid_standard', record.kind, record.id); continue;
      }
      staged.standards.push({ ...base, title: d.title, zone: d.zone, position: d.position, version: d.version,
        verification: d.verification, status: d.status, criteria: [...d.criteria] });
    }
  }
  for (const [key, m] of index) if (!sourceKeys.has(key)) fail('unused_mapping', m.kind, m.sourceId);
  // Links are review inputs, never inferred from matching names or positions.
  staged.shiftStandardLinks = [];
  if (sourceLinks !== undefined && !Array.isArray(sourceLinks)) fail('invalid_shift_standard_links', 'link');
  const pairs = new Set();
  for (const link of Array.isArray(sourceLinks) ? sourceLinks : []) {
    if (!link || Object.keys(link).some(k => !['shiftId','shiftRevision','standardId','standardRevision'].includes(k))) {
      fail('invalid_shift_standard_link', 'link'); continue;
    }
    const sm = index.get(`shift:${link.shiftId}`), tm = index.get(`standard:${link.standardId}`);
    const shift = staged.shifts.find(s => s.id === sm?.targetId.toLowerCase());
    const standard = staged.standards.find(s => s.id === tm?.targetId.toLowerCase());
    if (!shift || !standard || link.shiftRevision !== shift.revision || link.standardRevision !== standard.revision ||
        shift.department !== standard.department || shift.position !== standard.position || shift.cancelled || standard.status !== 'approved') {
      fail('unresolved_shift_standard_link', 'link', link.shiftId); continue;
    }
    const pair = `${shift.id}:${standard.id}`;
    if (pairs.has(pair)) { fail('duplicate_shift_standard_link', 'link', link.shiftId); continue; }
    pairs.add(pair); staged.shiftStandardLinks.push({shift_id:shift.id,standard_id:standard.id,restaurant_id:restaurantId});
  }
  // Partial proposals are deliberately withheld when any reference is unresolved.
  return { status: issues.length ? 'blocked' : 'reviewable', issues, proposals: issues.length ? null : staged,
    requires: ['reviewed-person-identity', 'separate-access-review', 'source-archive', 'target-conflict-check', 'transactional-import'] };
}
