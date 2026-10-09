# Published schedule changes and closing responsibility transfers

Isolated preparation from weekly-publication baseline `2265579`. Additive migration 031 preserves migrations 001–030 and adds published `shift.save` and scoped `shift.cancel`. The active Companion, Inventory and hosted services remain separate. No merge or deployment is included.

## Schedule changes

Published edits require current `schedule.change` authority plus location management or dated leadership covering both the original and proposed shift periods. Publication permission alone is insufficient. Owner/job/station eligibility, overlapping shifts, approved availability/time off and complete reviewed scheduling inputs are rechecked. Published status is retained; an explicit reason and exact revision are required. Imported reference shifts remain protected until reconciliation. Draft saves retain the existing draft command rules.

Structural changes cannot move linked checkout tasks, even completed tasks. Note-only published edits align their shift revision. Completed closing work blocks changes to employee, department, job or shift times. Unfinished closing work can remain linked only when the new employee has independent current clearance, the due time fits and the guide/reviewer checks pass. Changes to these structural fields reset closing work to open, clear answers and correction helper state, retain attention and require a new submission. Station changes remain protected when closing or other linked station references exist. Station learning proposals use persistent template receipts and never grant clearance.

## Cancellation and covering work

Command-created draft cancellation requires scheduling management; published cancellation requires published-change authority. Released/cancelled shifts cannot be changed. A note is required for both paths. Any unfinished linked checkout task blocks cancellation.

Every unfinished closing assignment requires an explicit covering shift selection with the exact closing and covering-shift revisions. Extra, missing and duplicate selections fail. Covering shifts must fit department and due time, be available and be published when the original shift is published. Current permission on the covering period, employee clearance, independent reviewers, active guide linkage and an unoccupied closing zone are required. The candidate additionally rechecks the covering shift's complete closing publication blockers. Completed closings remain on their original assignment.

Closing transfers reset prior submission state and notify the new employee, manager and prior correction helper. Cancellation never silently deletes unfinished responsibility. Retained historical guide links and station learning goals are not cancelled by this workflow.

## Reliability and boundaries

Restaurant-first locking, request receipts and exact revisions serialize changes. Audit snapshots retain before/after shifts. Replay rechecks current authority, including the original published period and selected covering periods. Closing events, learning goals, owner notification intents, shift changes, scope revision and receipts commit together. Notification delivery remains pending.

Raw structural closing protection remains in place. A private transaction permit matches the complete old/new shift row, is usable only in its creating transaction and is removed before commit. Runtime cannot write permits, raw audit tables or notification tables. Tests use only fictional loopback databases and privileged fictional review evidence.

## Validation and next step

Local validation passed: fresh application of all 31 migrations, all 338 serial candidate checks, strict adapter types, original-form preview build and coverage inventory. Fifteen focused checks cover published edits, dated authority, revisions/replay, linked tasks, station learning, closing reset/completed protection, exact cancellation selections, guide/clearance rejection, reference protection, late failure rollback, HTTP sessions and private permit denial. Preview builds do not establish browser adoption of scheduling forms.

Next: scheduling coverage requests, employee consent and shift-swap rules. Complete scheduling UI adoption, source ingestion and production identity contracts remain pending. M06 remains open; Inventory integration waits for its tested baseline.
