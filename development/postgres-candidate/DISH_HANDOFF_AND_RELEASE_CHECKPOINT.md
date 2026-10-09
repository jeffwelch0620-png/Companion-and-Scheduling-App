# Dishwasher Handoffs and Release Checkpoint

October 9, 2026. Two development sections completed in the isolated PostgreSQL candidate. No active app edits, Inventory merge, hosted changes, commit or push.

## Section 1: unfinished-work passing and PM acceptance

Migration 012 adds `task.dish-pass` and routes dedicated Dishwasher task transitions through a specialty command function. Only the AM checkout owner may pass work while their checkout is open or returned for correction. The recipient must be an active PM dishwasher in that cycle whose checkout still awaits work. The new child task, normalized source/cycle link, AM history event, notification intent and receipt commit together.

Only the current incoming owner may explicitly accept that child while it awaits work. Acceptance records the owner and timestamp, updates source history, and does not complete the task. Incoming work cannot be submitted ready before acceptance. Lost-response retries return stable results without duplicating child tasks or acceptance events. Reassignment remains unsupported for dedicated tasks and links.

Authorized operations managers can inspect the cycle and all handoffs. Each participant sees their own checkouts and incoming tasks. AM receives narrow outgoing acceptance receipts containing child ID, accepting owner and time, without seeing another employee's task detail. Full original-form read/history integration is still pending.

## Section 2: verification and Dishwasher release

Owner readiness requests an independent operations-manager check. Managers may return unfinished work for correction or verify ready work as closed. Acceptance persists through a returned correction; the employee must resubmit and obtain another independent check. Dishwashers cannot verify their own or another person's checkout even with grants.

PM checkout readiness is blocked until that employee's incoming handoff tasks are closed. It does not wait for the other PM employee's work. Structural validation requires exactly three distinct normalized participants, consistent task owners/departments/kinds, and valid source/recipient links. Missing or inconsistent rows fail closed.

Migration 013 extends separate shift release to explicitly classified Dishwasher shifts. The cycle business date comes from the shift start in the restaurant's timezone. A matching complete cycle structure and that employee's verified checkout are required. AM release additionally waits for every outgoing handoff's current-owner acceptance, without waiting for PM completion. PM release additionally waits for that employee's incoming work to be verified. Existing independent-manager authority, leadership-end coverage, linked task/close gates, revision checks, receipt and atomic release audit/notification rules remain in force. Overnight-manager and unreviewed profiles stay blocked.

Restaurant-first locks serialize passing with PM readiness, so a checkout cannot become ready at the same time as new incoming work is attached. They also serialize release with command writes. Source revisions change when work is passed or accepted; callers must refresh the source checkout before issuing a new command against it.

## Verification

- All 146 regression checks passed, zero failed or skipped. Evidence: `runtime/dish-workflow-regression-results.txt`.
- All 14 dedicated workflow checks passed on the separate candidate schema with migrations 001–013. Evidence: `runtime/dish-workflow-fresh-results.txt`.
- Strict TypeScript compilation passed for the adapter and HTTP handler.
- Checks cover pass/accept scope, required acceptance, independent verification, repeated correction, AM acceptance versus PM completion, unrelated PM independence, local-date/UTC boundaries, missing participants, tampered owners, revoked authority, concurrent retries, passing versus readiness races, and rollback of both pass and acceptance failures.

HTTP checks inject a trusted verified-session stub before real database session resolution and authorization. Signed-token verification is covered by the existing authentication suite. No original-form Dishwasher browser flow, hosted Supabase or remote-device validation is claimed.

## Remaining integration work

This remains fictional-reference backend work. Production shift classification, schedule/date mapping and complete authority ingestion must be reviewed before cutover. The candidate has no cancellation/reassignment/recovery commands for malformed cycles. The read projection does not yet provide full task history or all original UI metadata. Closing/Dishwasher commands are not enabled in the offline queue or original-form preview.

The inherited 180-character cycle title limit still needs reconciliation with the source form's 200-character input; generated unfinished-work titles are capped at the task table's 200-character limit while the full work note is retained. Notification delivery remains separate from committed notification intent.

Next planned section: overnight manager handoff rules, followed by the original-form adapter and browser workflow verification. Inventory baseline reconciliation and hosted authentication/deployment remain separate, with no merge yet.

All work is ignored and local; no GitHub backup was created. Runtime data and machine-specific fixtures must be excluded from eventual reviewed integration. The local cluster contains fictional data only and is stopped after validation.
