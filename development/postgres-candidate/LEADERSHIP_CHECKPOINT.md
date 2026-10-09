# Dated leadership assignment and revocation

Isolated preparation from coverage-consent baseline `720ead7`. Additive migration 033 preserves migrations 001–032 and adds `leadership.assign`, `leadership.revoke` and scoped `/schedule-leadership` reads. No active Companion cutover, Inventory merge, hosted database application or deployment is included.

## Assignment rules

A current schedule publisher can assign, edit, revoke or reactivate leadership within their department authority. An edit requires publisher authority over both the original and proposed departments. The selected employee must be active, able to sign in and at this restaurant; they must belong to the assignment department or already have location-management authority. They must already hold active `schedule.change` or `close.confirm` permission. Assignment never writes membership permissions or clearance.

Periods must use real calendar instants, have a positive duration and span no more than 24 elapsed hours. DST transitions use actual elapsed time. Explicit notes and exact revisions are required. Existing overlapping assignments remain allowed, matching the source; revoking one does not remove another valid assignment. Imported references receive initial candidate revision metadata without losing their original member, department, period or active flag. Those defaults do not certify original source history or creation time.

Published-change and closing checks continue to read current active leadership and current capabilities. A schedule-change leader needs coverage of the complete shift period; a closing-only leader gains no schedule-change permission. Revocation blocks subsequent dated actions while preserving unfinished closing responsibility. It does not release shifts, complete work, cancel offers or resolve handoffs.

## Scoped reads and reliability

Owners and scoped schedule publishers/managers/task managers can read assignments. Other employees can see active assignments in their department when their own published, uncancelled shift overlaps the period, matching the source visibility rule. Filtering precedes cursor pagination. Read timestamps use canonical UTC millisecond strings so original source comparisons behave correctly at equal start/end boundaries.

Restaurant-first locking, trusted active identity and current capability checks protect commands. Replays recheck current authority, including the original department of an edited assignment. Exact revisions prevent stale changes. Before/after audit snapshots, assignment notification intents, scope revisions and request receipts commit together; late notification failure rolls back the assignment. Revocation follows the source's audit-only notification behavior. Runtime cannot write references, history or notification tables directly.

Notification delivery, real source ingestion and production identity decisions remain pending. Dated assignments do not infer authority from a job title. Existing closing, overnight and weekly review paths remain separate and use current references.

## Validation and next step

Local validation passed: fresh application of all 33 migrations, all 372 serial candidate checks, strict adapter types, original-form preview build and coverage inventory. Fourteen focused checks cover source authority parity at exact read boundaries, capability preservation, publisher and target scope, DST/duration/calendar constraints, current published and closing authority, revocation, overlapping references, private scoped paging, retries/revoked replay, late rollback and authenticated HTTP/raw-write protection.

Next: isolated scheduling workspace/form adoption, with schedule copying, attendance and remaining source-completeness contracts tracked separately. M06 remains open. Inventory integration waits for its tested baseline.
