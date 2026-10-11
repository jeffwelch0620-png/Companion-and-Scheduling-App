# Closing-transfer cancellation screen preparation

Dependent candidate preparation from PR37 head `c27cca1`. PR37 remains unmerged and based on accepted PR36 main `1c536d1`. This package adds corrective 051, a manifest entry and regenerated function snapshot. Published migrations 001–050 are preserved. The active Companion, hosted databases and Inventory remain separate.

## Reviewed cancellation

Published shift detail offers **Review cancellation and covering shifts** when unfinished closings require transfer. A single signed read request loads every unfinished assignment and its eligible published covering shifts from one repeatable-read, read-only snapshot. It binds the review to the actor, store, original shift version and workspace version. Closed/cancelled assignments are excluded. Pending linked tasks hold cancellation and suppress choices. Imported, ended, cancelled or released source shifts remain protected.

The manager explicitly chooses one covering shift per unfinished assignment, enters a reason and confirms cancellation and renewed physical readiness. Nothing is preselected. The review shows guide title/version/job, zone, due time, current employee and receiving employee/shift times in the configured timezone. Missing eligible coverage holds submission. More than 100 unfinished assignments refuse the read; each assignment shows at most 100 eligible shifts, with an explicit truncation notice.

`closing_transfer_issue` is a private predicate shared by this read and `change_schedule`. It checks original/covering store and department, published covering availability, due-time coverage, current dated change authority, employee/checkout-role eligibility, station clearance, active guide links, zone conflicts and independent/current guide reviewers. It also checks the prospective publication conditions and the target's existing closing work. Existing permissions are preserved. The replacement write definition is explicit; migration 051 performs no runtime regex rewriting.

Only guide ids/title/version/position and operational assignment/choice fields are returned. Full standards, criteria, answers, helpers, correction state and coworker capability arrays are omitted. Malformed, foreign or version-inconsistent reviews fail closed. UI choices do not grant authority.

## Command and recovery

Submission includes the original shift version and exact closing/covering versions. The existing coordinated command independently validates the complete selection and current eligibility, locks source/closing/covering records and performs all transfers and cancellation in one transaction. A failure in a later transfer rolls back earlier transfers, audit entries, notification intents and receipts.

Transferred unfinished work reopens; old readiness answers, helper assignment and correction state are cleared. The receiving employee must inspect the physical work and submit readiness again. Completed closing history stays on the original shift. Notification intents are recorded atomically; external delivery remains pending.

The existing sender freezes the full command, transfer choices and request id during an uncertain response. Original receipt replay does not create duplicate events/intents. A known refusal clears that pending request and requires current review. Scheduling cancellation requires a connection and remains outside the employee offline queue. Durable recovery after a page reload remains a later workflow; keep the page open while an outcome is uncertain.

## Validation and acceptance

Fresh PostgreSQL 17 bootstrap and generated snapshot comparison pass. Focused transfer and existing published-schedule regressions pass. Nineteen additional API/UI cases cover scoped reads, minimal projection, eligibility/authority changes, source/closing/covering version conflicts, task holds, completed-history preservation, atomic rollback, read coordination, bounded review, malformed choices, explicit confirmation and frozen replay. The final fresh serial run passed 648/648 cases, including these 19 new cases. Strict backend/UI types, source-copy gates, preview build, migration hashes, pre/post-regression snapshot comparison and readiness inventory passed. Browser rehearsal verified required selections/reason/confirmation, saved cancellation disappearing from the board, receiving-shift responsibility, reopened physical readiness in PostgreSQL and employee access without manager controls. Fictional screenshots and fixture session JSON remain ignored. Exact-head CI is recorded on the draft PR.

Acceptance order: review and separately approve PR37 first. Merge accepted main into this dependent branch normally, retarget it to main, re-test the resulting head and wait for separate merge approval. Do not force-push or treat the dependency as accepted main. No database application, deployment or Inventory integration is authorized by candidate acceptance.

## Remaining work

- Attendance and audited completed-record corrections, including retrospective absence flags.
- Copying/batch editing, real source ingestion and completeness, shared identity/authz and notification delivery.
- Retirement of copied candidate components during shared/PostgreSQL UI adoption.
- Optional leadership notification/badge/history polish.
- Inventory integration from its confirmed tested baseline commit.

## Pre-merge review follow-up

PR37's DST follow-up is incorporated by a normal branch merge. Published 050 and 051 and their manifest hashes are unchanged. Corrective 052 changes published_shift_actions and list_schedule_shifts: viewers without schedule.change bypass per-shift action reads; viewers without published-change authority receive false actions, zero closing count, false linked/completed flags, empty edit areas and authority. Authorized editor metadata remains available.

Cancellation reviews accept a valid workspace revision at least as new as the loaded workspace, while still binding the exact source shift revision and unfinished closing count. Commands bind exact source, closing and covering revisions and recheck current policy under coordination. Unrelated store activity must not force a reload. A transfer updates the closing revision and global workspace revision; it does not increment the receiving shift revision. Shared adoption should consider an index on shift_references(restaurant_id,department,starts_at,ends_at) WHERE published AND NOT cancelled, validated against its actual query plan and write workload.

Eligibility parity regressions cover changed instructions, unavailable managers/verifiers, position/station mismatch and zone conflicts: each hides the option and refuses a submitted transfer. Each listed option is also exercised independently with unchanged reviewed versions. Notification delivery, durable reload recovery and shared adoption remain separate.

Follow-up validation: the full serial local suite passed 660/660 with fresh 001–052 migrations and a matching post-regression snapshot. The final per-row capability cache refinement and strict parity error assertions then passed 47/47 focused checks on another freshly bootstrapped 001–052 database, with matching pre/post snapshots. Strict backend/UI types, rendered UI checks, preview build and readiness inventory passed. Exact final-head full GitHub counts are recorded in the PR description. All 001–051 bytes/hashes remain unchanged; only 052 adds a manifest entry. This evidence remains fictional candidate preparation.
