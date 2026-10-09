# Transactional fictional reference import

`reference-import.mjs` extends the read-only mapping review with a new-reference import rehearsal. It connects only through the candidate loopback configuration as the fixed fictional setup role `candidate_owner`. Each call requires `allow: 'fictional-local-only'`. This is a privileged development helper, not an employee endpoint or a production authorization boundary.

## Contract

Call `rehearseReferenceImport({ snapshot, batchId, expectedScopeRevision, reviewNote, allow })`:

- `snapshot` follows [the mapping contract](REFERENCE_MAPPING_CHECKPOINT.md). The helper copies and validates it before asynchronous work.
- `batchId` is a UUID reused for retries of the same reviewed batch.
- `expectedScopeRevision` is the existing candidate restaurant revision observed for this review. Missing restaurants and changed revisions block new imports.
- `reviewNote` records fictional review context. It does not establish production approver authority.

The caller must already have explicitly mapped the restaurant. The helper does not create restaurant identities or choose target UUIDs. Existing person, membership, shift or standard IDs block new batches, including identical rows. Existing people across restaurants also require a separate linking review. This deliberately prevents overwriting references or merging identities by name.

## Transaction and recovery

One database transaction locks the restaurant, checks its revision and target conflicts, inserts people/memberships/shifts/standards, increments the restaurant revision and stores the receipt with the complete source snapshot. Any failure rolls back all of these changes. Unique constraints additionally protect concurrent conflicting inserts across scopes.

Migration 018 adds the private `reference_import_receipts` table. Earlier migrations are unchanged. The receipt contains the source snapshot, SHA-256 fingerprint of the canonical snapshot plus review revision/note, batch ID, restaurant, result and recorded time. The narrow normalized rows retain their source revisions; richer fields such as guides, provenance, station details and histories remain in the source archive for later workflow migration.

Retries of an identical batch return the original result without applying again, including after a lost response. Concurrent same-restaurant retries serialize through the restaurant lock. Changed snapshots or review context cannot reuse the batch ID. A receipt replay reports historical import completion; it does not certify that references remain unchanged after subsequent administrator actions.

Published/cancelled shift flags and standard draft/approved/retired status are retained from the fictional source. Source approval is not independently certified. No auth links, sessions, capabilities, job grants, leadership coverage, station clearances, shift-standard links or checkout profiles are granted. New shifts inherit `unreviewed` checkout classification. Restricted runtime cannot read the archive or manufacture receipts.

## Limits and next steps

This supports new fictional reference rows only. It does not update existing employees, schedules or standards, import tasks/closing history, authorize publication, deliver notifications or connect the active apps. Production ingestion needs a dedicated least-privilege importer and authorized review, protected archives/retention, explicit shared-person linking, realistic export fixtures, approved schedule/job rules, and reconciliation against Inventory's tested baseline.

The subsequent [imported closing checkpoint](IMPORTED_CLOSING_CHECKPOINT.md) adds optional, explicitly reviewed shift-standard links and a form-command/API rehearsal using imported fixtures. Historical workflow references remain pending. Production permissions and backend cutover remain separate decisions.

## Validation

Fresh fictional PostgreSQL bootstrap applied all 18 manifest-verified migrations. All 190 serial regression checks passed, including eight new import checks covering source retention, target collisions, stale scope revisions, concurrent replay, full rollback and runtime denial. Strict adapter type validation and original-form preview build passed. No real employee data or hosted service was used.
