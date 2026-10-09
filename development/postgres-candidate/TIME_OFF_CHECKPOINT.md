# Time-off request checkpoint

Isolated candidate preparation on schedule-draft baseline `bd591ef`. Migration 023 adds employee `request.create` for time off, independent `request.review`, and paged `GET /api/operations/{scope}/schedule-requests` reads. The running Companion, Inventory and hosted services remain separate. No merge or deployment is included.

## Source behavior and supported slice

The original request command creates an employee-owned pending request, requires a different scoped schedule reviewer, and permits a positive period of at most 1,440 elapsed hours (60 days). Review requires explicit `schedule.manage`, matching department or additional `location.manage`, a different reviewer and a current pending revision. Matching titles do not grant permission. Schedule-only or inactive actors cannot submit or review.

Source time-off approval cancels overlapping noncancelled shifts; it does not simply reject all overlap. The candidate preserves that behavior for command-created, unpublished, unreleased drafts without tasks, closes or standard links. Approval requires an explicit `affectedShifts` list of exact IDs and revisions, including an empty list when nothing is affected. Missing, extra, duplicate or stale impact conflicts. Decline leaves all shifts unchanged.

Published, released, imported/reference-only or linked shifts block approval with `time_off_cancellation_not_migrated`. Their publication authority, closing transfer, replacement responsibility and cancellation notification paths require later migration. A blocked approval remains pending and cancels nothing. Swap/consent and recurring availability requests are separate workflows; the time-off endpoint does not accept those types or caller-specified ownership/status. The source provides create/review here; request editing, withdrawal and reopening are not introduced by this slice.

The request, allowed shift cancellations, shift audit entries, request audit snapshot, workspace revision, receipt and notification outbox rows commit together. Identical retries apply once; changed payloads conflict. Replay rechecks actor identity and review scope. Restaurant-first locking serializes draft writes and approvals: a concurrently added shift either causes a stale impact conflict or is blocked by approved time off. Administrative reference writers must follow the same coordination contract.

## Reads and privacy

The endpoint returns time-off records only, with `coverage: time-off-only`; it is not the complete request/workspace service. Visibility follows source rules: own requests, scoped schedule managers/change managers, and approved requests for scoped publishers. Private note/decision fields are exposed only with scoped `schedule.change`, matching the source workspace projection, including its redaction for employee and schedule-manage-only viewers. Scoped review managers receive current affected-shift IDs/revisions for an explicit approval snapshot. Pagination and sessions use the existing candidate contracts. Raw request, event and outbox tables remain inaccessible to runtime.

## Readiness and remaining work

Submitting/reviewing requests does not certify `schedule_input_reviews.time_off_complete`. Its default remains blocked for schedule draft saves until trusted fictional setup reviews a complete reference set. Production needs a reviewed source reconciliation/completeness mechanism for legacy requests, roster/jobs and associated schedules; this checkpoint does not create an administrative shortcut. Audit/notification rows are persistence proof, not delivered notifications. Complete schedule forms, browser UI adoption, real auth, offline requests, notification delivery, station workflows and publishing remain pending.

## Validation

Local validation passed: fresh application of all 23 migrations; all 241 serial candidate tests; strict adapter types; original-form preview build and classification inventory. Twelve new tests cover independent review/scope, current impact, draft cancellation, protected shifts, decline, concurrent review/retries and draft/approval, privacy/paging, revoked access, invalid inputs, atomic rollback and HTTP sessions. GitHub validation is reported separately on the draft PR. Browser request-form validation remains pending.

Next: review and implement a guarded time-off/roster/job reference reconciliation contract, replacing fixture-only completeness with inspectable evidence. Published shift cancellation and station assignment remain separate later checkpoints. M06 remains open and Inventory integration remains held.
