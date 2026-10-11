# Published shift editing screen preparation

Isolated candidate preparation from accepted PR36 main `1c536d1`. Corrective 050 adds a private read projection and explicitly replaces the existing scoped shift list. Published migrations 001–049, write commands and runtime grants are unchanged. This package does not adopt the candidate into the active Companion, apply hosted migrations or integrate Inventory.

## Editing and authority

Published shift detail now offers an employee/job/time/station editor with required reason and a before/after confirmation. Times use the configured store timezone, including explicit repeated-hour choices, missing-hour rejection and preservation of unchanged seconds. A started shift cannot move its start later or its end before now. The server uses its own clock after locking; an ended shift requires the separately audited correction workflow.

`list_schedule_shifts` returns `publishedActions` from private `published_shift_actions`. Controls require the same existing `published_change_allowed` predicate as commands, command-created provenance and an active, unended published record. Imported, cancelled and released references remain protected. Candidate destination departments use current change permission and management or dated-leadership availability; they are choices for review, not a grant for a proposed period. The unchanged command independently checks both original and proposed periods, job/station eligibility, input completeness, conflicts, leave, availability and linked closing readiness.

Linked checkout tasks or completed closing work restrict the form to a reason-only submission. The form preserves employee/job/times and omits an unchanged protected station so its saved metadata remains intact. Linked guide/closing work holds station selection. Unfinished closings display a warning: structural edits reset submitted readiness and require the new employee to submit again; commands retain independent guide, clearance, reviewer and due-time checks.

## Cancellation and recovery

The screen supports reasoned, explicitly confirmed cancellation when no pending task or unfinished closing transfer is required. Completed closing history stays attached. Cancellation with unfinished closings is deliberately held for a separate covering-shift review UI; the existing backend transfer contract remains available and protected. There is no automatic reassignment or silent removal of responsibility.

Exact shift revisions and frozen request IDs use the existing screen sender. Network/503 uncertainty disables other submissions and supports original receipt replay. Known refusals clear the uncertain request and reload current data. These manager changes require a connection; they are outside the employee offline queue. Post-reload recovery for these edits remains a follow-up; the existing publication recovery marker covers weekly publication only.

Malformed published action projections fail closed for that detail. Other schedule reads and existing coverage/consent flows remain available. No coworker capability arrays, closing answers or event payloads are added to the shift list.

Pre-merge follow-up: ordinary timestamp prefills leave occurrence blank; ambiguous originals retain their exact occurrence and seconds. Changing a date/time clears its prior occurrence choice. Published 050 remains immutable under the shared-migration convention. Corrective 052 on dependent PR38 will return only false actions, zero counts, false linked/completed flags, empty edit areas and `authority` for viewers without published-change authority. Until that correction is accepted, 050 still exposes linked-work flags/counts to non-editors; PR37 alone does not resolve this privacy finding. Validate the combined corrected PR38 package before accepting the merge sequence or using this projection outside fictional preparation.

## Validation

Fresh fictional bootstrap through all 50 migrations and snapshot comparison passed. Forty focused checks passed; the full serial run passed all 628 behavioral cases. Its remaining manifest assertion was updated from 49 to 50 and passed separately; final UI/manifest regressions passed 9/9. Strict backend/UI types, source-copy gates, preview builds and readiness inventory passed. Published 001–049 bytes and hashes remain unchanged. Fifteen new API/UI cases cover server-projected controls, dated/revoked authority, protected linked work, local-time/DST validation, active-time limits, exact versions, audited cancellation and original receipt replay. Final fresh full-suite GitHub results are recorded on the PR. Notification intents and fictional browser checks do not establish actual message delivery or real-store readiness.

Browser rehearsal passed on a separate loopback preview: imported protection, retained proposed station/time/reason after revising, a saved published time/station change visible on the board, employee-only access without manager controls, and confirmed cancellation disappearing from the current schedule. Fictional runtime fixtures and screenshots remain ignored.

## Remaining tasks

- Explicit covering-shift cancellation UI with current closing/covering revisions and independent eligibility review.
- Attendance, audited completed-record corrections and retrospective flag resolution.
- Copying and batch editing, source completeness/ingestion, shared identity/authz and notification delivery.
- Retirement of candidate UI copies during the reviewed shared/PostgreSQL port.
- Inventory integration from its confirmed tested baseline commit.
- Optional leadership polish: suppress peer self-assignment intents for note-only changes while retaining creation/reactivation and material changes (including a new self-assigned member); show revoked badge wording; add bounded publisher-only history. PR36 is accepted; these are later follow-ups, not part of 050.

Follow-up local validation: fresh PostgreSQL 17.11 bootstrap through unchanged 050 and snapshot comparison; 32/32 serial published-schedule, published-screen, UI and manifest checks; strict backend/UI types and preview build passed. New ordinary-to-fold and both unchanged ambiguous-original cases pass. Exact follow-up head and full CI counts are maintained in the PR description.
