# Dishwasher Cycle Assignment Checkpoint

October 9, 2026. Isolated local PostgreSQL candidate. No active application changes, Inventory merge, commit, push or hosted deployment.

## Completed first slice

Migration 011 adds `task.dish-cycle`: one AM checkout and two PM checkouts for three distinct active BOH dishwashers with sign-in access at the same restaurant. Cycles are unique per restaurant business date. The explicitly supplied calendar date is preserved separately from the due timestamp; business dates are not inferred from UTC dates.

Normalized cycle and participant rows connect the three ordinary task records without granting generic task execution authority. Assignment commits all three tasks, participant links, responsible-employee audit events, notification intents, workspace revision and stable receipt atomically. Identical concurrent retries apply once; changed payloads and duplicate date assignments conflict. Failures leave no partial cycle.

The specialty operations policy follows the source: an eligible BOH task manager, location administrator, or manager with both task-management and store-operations grants may assign and inspect cycles. Role titles alone do not grant authority. This policy is distinct from ordinary-task management; it does not widen permissions for unrelated ordinary work. Dishwasher actors cannot assign cycles even when they hold management grants.

Scoped cycle reads return all three checkouts to an authorized operations manager. Participants receive their own checkout plus the ordered participant IDs already present in source cycle metadata. Unrelated employees are denied; revoked management authority denies inspection and receipt replay.

Until specialty transitions are migrated, generic task transition and reassignment commands are blocked for these dedicated checkout tasks. The earlier command function is internal and its runtime execution grant is revoked, preventing a bypass. Reads explicitly report `executionSupported: false`. Dishwasher shift release remains blocked by migration 010.

## Validation

- All 132 candidate regression checks passed, with zero failed or skipped. Evidence: `runtime/dish-cycle-regression-results.txt`.
- All 10 cycle-assignment checks passed on the separate schema after the final migration 011. Evidence: `runtime/dish-cycle-fresh-results.txt`.
- Strict TypeScript compilation passed for the candidate adapter and HTTP handler.
- Tests cover cycle shape, personal reads, operations capabilities, member eligibility/sign-in, invalid dates, duplicate dates, concurrent retry, revoked permissions, generic-command bypass prevention, direct table restrictions, HTTP dispatch and full notification-failure rollback.

The new assignment event initially omitted the responsible-employee field required by migration 004. This was corrected in migration 011 and the local function before final validation; the separate schema installed the corrected migration directly.

HTTP tests use a trusted verified-session stub followed by real PostgreSQL session resolution and authorization. Signed-token verification remains covered by the authentication regression suite. No Dishwasher original-form browser, remote-device or hosted Supabase validation has occurred.

## Remaining work

Next: migrate AM unfinished-work passing, explicit incoming PM acceptance, correction/readiness and independent operations-manager verification. PM checkout must wait for that employee's incoming work to be closed; AM release must wait for current-owner acceptance without incorrectly waiting for every PM task to finish. Complete cycle shape and missing/invalid handoff links must be checked from authoritative rows.

This checkpoint does not implement those transitions, handoff receipts, Dishwasher shift release or overnight manager handoffs. Shift association and restaurant-timezone/business-date mapping still need authoritative production ingestion. Cycle reads do not yet provide full task history. Commands are not enabled in the offline queue or original-form preview.

The candidate cycle title is limited to 180 characters to leave room for its AM/PM prefix under the current 200-character task constraint. The source form accepts 200 characters; this compatibility difference must be reconciled before UI cutover. No source UI was changed.

Files remain ignored and local and are not backed up to GitHub by this checkpoint. Runtime data and machine-specific fixtures must be excluded from future reviewed integration. The local cluster contains fictional data only and is stopped after validation.
