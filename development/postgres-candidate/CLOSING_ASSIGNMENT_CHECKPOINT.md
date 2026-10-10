# Closing Assignment Checkpoint

October 9, 2026. Isolated PostgreSQL candidate; no Inventory merge or hosted deployment.

## Completed behavior

Migration 007 and the candidate adapter now accept `close.assign`. Each assignment captures the approved closing standard, its revision, criteria, verification mode and station identity. Later standard edits do not rewrite that snapshot.

An eligible task manager can assign work on a draft or published, active, unreleased shift. The assigned employee must have the required station clearance, and an active station-guide link must connect the standard to the shift. Draft assignments do not enqueue employee notifications.

The closing manager must differ from the employee, hold the confirmation capability, and have leadership coverage at the due time or explicit location authority. Senior verification requires a third eligible person distinct from both employee and manager. Due times must fall within the shift. Duplicate active station zones are rejected.

Assignment, history, stable retry receipt, scope revision and notification intent commit together. Identical retries return the same result; changed payloads conflict. Revoked creator permissions deny replay. Scoped detail reads permit assigned participants and eligible task managers, while unrelated employees are denied. The restricted runtime cannot directly edit close records.

Pending assignments block shift cancellation, release and structural changes. Assignment itself never releases a shift. Publishing a draft shift is still permitted; notification delivery on later publication remains unimplemented.

## Validation

- All 82 candidate regression checks passed, with zero failures or skipped checks. Evidence: `runtime/closing-regression-results.txt`.
- All 13 closing-assignment checks passed on the separately provisioned fresh-schema database after migrations 001–007 and fictional fixtures. Evidence: `runtime/closing-fresh-results.txt`.
- The candidate adapter and HTTP handler passed strict TypeScript compilation.
- Checks include independent reviewers, invalid due times, missing capabilities, revoked replay, snapshot retention, draft shifts, duplicate zones, nullable verifier read isolation, pending-shift guards and forced notification failure rollback.

The closing HTTP test injects a trusted verified-session stub and exercises database session resolution and authorization. Signed-token verification is covered by the existing authentication regression suite. This checkpoint does not establish closing-form browser behavior, Supabase authentication compatibility or production readiness.

The fresh database needed the narrowly scoped execution grant for `resolve_identity`, which is deliberately revoked from PUBLIC by migration 002. The test-only role setup is recorded in `runtime/closing-http-role-setup.sql`. Hosted role provisioning must be reviewed separately; do not grant general table access to solve this.

## Boundaries and next section

Standards, station clearances, guide links, leadership coverage and shifts are fictional reference projections. Their authoritative ingestion and mapping to the existing Companion records remain pending. No production qualification or schedule administration endpoints have been added.

The next section is closing execution: employee submission with all required criteria, independent senior verification where required, correction/resubmission, and final manager confirmation. Each command needs current authorization, revision conflict handling, atomic history and reliable retries. Final shift release must also check remaining task and specialty workflow requirements.

Closing reassignment, cancellation commands, correction helpers, attention flags, complete checkout, Dishwasher cycles, overnight manager handoffs and prep/stock posting remain pending. Closing commands are not yet added to the offline queue or original-form preview. Unsupported transitions are rejected.

All deliverables remain in the ignored local candidate directory. No tracked app code, dependency files, Inventory files, commits, pushes, merges or hosted resources changed. These local files are not yet backed up in GitHub. The local PostgreSQL cluster contains fictional records only and is stopped after validation.
