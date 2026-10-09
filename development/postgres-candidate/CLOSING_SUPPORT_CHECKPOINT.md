# Closing Support Checkpoint

October 9, 2026. Isolated PostgreSQL candidate. No active Companion changes, Inventory merge, commit, push or hosted deployment.

## Completed behavior

Migration 009 adds supported manager-attention reasons (`repeated`, `serious`, `unresolved`) to a checker's correction command, plus `close.acknowledge` and `close.correction.assign`. The generated migration extends migration 008 without editing earlier migration files. Its source is `build-closing-support.mjs` and `closing-support-functions.sql`.

A flagged correction requires acknowledgment by the assigned, currently authorized closing manager with leadership coverage or location authority. Acknowledgment records a response and next step; it does not complete correction or the physical checks. Final confirmation is blocked while a flag remains unacknowledged. A newly raised flag resets acknowledgment. Unsupported reasons and flags on other transition steps are rejected.

Only the assigned closing manager with both task-management and confirmation capabilities may assign correction help, while the close is in correction on an active published shift. The original approved standard revision must still match. Helpers must be active operational members of the same restaurant and department, have current station clearance, and differ from both named checkers. Dishwasher and schedule-only members are excluded.

The original employee remains responsible as owner. The helper becomes the person allowed to submit correction work; the original employee cannot submit while a different helper is assigned. Station clearance is rechecked on submission. Verification and final confirmation remain independent.

Replacing a helper removes their assignment-based detail access and submission authority. Both old and new helpers receive notification intent, with duplicate recipients removed. Returning helper work for another correction ends the helper assignment, clears current answers, and restores the original employee as performer. Previous submissions, helper assignments and flags remain in history details. Helpers receive notification intent through subsequent checks and completion.

State, history, scope revision, stable receipt and notification intent commit atomically. Identical concurrent retries apply once; changed payloads and stale revisions conflict. Receipt replay rechecks manager authority and leadership coverage. Runtime roles still lack direct table-write access.

## Validation

- All 108 regression checks passed, with zero failed or skipped. Evidence: `runtime/closing-support-regression-results.txt`.
- All 12 support checks passed on the separately provisioned schema with migrations 001–009 and the final transition-function refresh. Evidence: `runtime/closing-support-fresh-results.txt`.
- Strict TypeScript compilation passed for the candidate adapter and HTTP handler.
- Checks cover acknowledgment gates, newly raised flags, helper independence and clearance, capability/leadership revocation, helper replacement, repeated correction, notification recipients, stable replay, stale revisions and forced notification-failure rollback.

HTTP tests inject a trusted verified-session stub and then use real database session resolution and authorization. Existing authentication regression tests cover signed-token verification. This is backend evidence; original-form browser behavior and hosted Supabase compatibility are not yet established.

## Remaining boundaries

Full shift release, closing reassignment/cancellation, Dishwasher cycles, overnight manager handoffs, production reference ingestion and prep/stock posting remain pending. Closing commands are not yet enabled in the offline queue or candidate original-form preview. Standards, clearances, guide links, shifts and leadership coverage are fictional projections.

Next: review and implement the final shift-release command and its complete task/specialty gates, without equating a closed station assignment with permission to release the employee's shift.

All files remain ignored and local, with no GitHub backup from this checkpoint. Runtime data and machine-specific test setup must be excluded from any future reviewed integration. The local PostgreSQL cluster contains fictional data only and is stopped after validation.
