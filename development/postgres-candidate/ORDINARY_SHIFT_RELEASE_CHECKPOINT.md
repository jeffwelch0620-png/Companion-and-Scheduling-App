# Ordinary Shift Release Checkpoint

October 9, 2026. Isolated PostgreSQL candidate. No active application changes, Inventory merge, commit, push or hosted deployment.

## Implemented scope

Migration 010 adds `shift.release` for explicitly reviewed ordinary checkout. Existing shift references default to `unreviewed` and cannot be released through this command. Dishwasher and overnight-manager profiles remain blocked. Even an ordinary profile cannot authorize a Dishwasher shift. Profile classification is a trusted reference-ingestion responsibility; clients cannot set it. Actual production classification and complete requirement ingestion remain pending.

An eligible independent manager needs the closing-confirmation capability plus leadership coverage at the shift's end or explicit location authority. This follows the source release rule: it checks current department/location authority and leadership coverage rather than requiring the actor to be the named manager of every individual station close. A privileged employee still cannot release their own shift.

The shift must be published, active, unreleased, at the expected revision, and assigned to an active operational employee. All noncancelled linked closing assignments must be closed, and every linked task or issue must be independently completed. A closed assignment with an unacknowledged attention flag also blocks release. Checks inspect actual database rows; browser-supplied completion counts are rejected. Unlinked duties and work on another shift do not block this shift.

Release is separate from station confirmation. It records a release timestamp, shift revision, actor/note event, workspace revision, stable receipt and employee notification intent in one transaction. It does not alter scheduled start/end times or any timekeeping record. Notification delivery remains separate work.

Restaurant-first locking serializes release with task/closing creation. If new linked work commits first, release is blocked; if release commits first, new work is rejected. Concurrent identical release retries commit once. Changed payloads and stale revisions conflict; revoked manager permissions deny replay. Notification failure rolls back the entire release.

## Validation

- All 122 regression checks passed with zero failed or skipped. Evidence: `runtime/shift-release-regression-results.txt`.
- All 14 shift-release checks passed on the separately provisioned candidate schema after migration 010. Evidence: `runtime/shift-release-fresh-results.txt`.
- Strict TypeScript compilation passed for the candidate command adapter and HTTP handler.
- Tests cover pending station phases, linked tasks/issues, unrelated work, self-release despite grants, leadership-end coverage, location authority, specialty exclusion, stale/repeated release, stable retry, rollback, HTTP dispatch and concurrent work creation.

HTTP tests inject a trusted verified-session stub and then exercise database session resolution. Existing authentication regression tests cover signed-token verification. This checkpoint establishes local backend behavior; original-form browser release, remote devices and hosted Supabase have not been validated.

## Remaining work

This is not complete checkout coverage. Dedicated Dishwasher checkout cycles, AM/PM handoff acceptance, overnight manager handoffs and their authoritative business-date rules still need migration and verification before their profiles can be enabled. Other production workflow requirements must be mapped before any real shift is marked ordinary.

Closing reassignment/cancellation, production reference ingestion, shift detail/read integration and original-form release UI remain pending. Closing/release commands are not enabled in the offline queue. Ordering and stock posting remain outside these generic task commands.

Next: migrate the dedicated Dishwasher checkout and handoff rules, preserving AM acceptance versus PM completion requirements. Leave release blocked for that profile until all checks are present.

All files remain ignored and local and are not backed up in GitHub by this checkpoint. Runtime data and machine-specific fixtures must be excluded from future reviewed integration. The local test cluster contains fictional data only and is stopped after validation.
