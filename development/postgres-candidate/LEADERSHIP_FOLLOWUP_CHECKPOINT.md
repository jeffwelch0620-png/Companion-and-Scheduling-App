# Leadership visibility and checkout-role eligibility (049)

Preparation starts from accepted Companion main `382fa92` (PR35; 604/604 merged-main CI tests). Corrective 049 uses explicit function definitions. Published migrations 001–048 remain unchanged. This is isolated candidate preparation on `codex/companion-leadership-followup`, requiring its own draft PR review and separate merge approval.

## Self-assignment provenance and awareness

`list_schedule_leadership` returns a required boolean `selfAssigned`, computed from the actor of the latest `leadership.assign` event (creation, edit or reactivation) compared with the current assigned membership. Revocation does not rewrite that provenance. Imported references without assignment events return false. Board and detail screens display a Self-assigned badge from this server projection; malformed flags fail closed for that reference. The viewer's identity is not used to infer the badge.

On self-assignment or a self-edited/reactivated assignment, the existing target notification intent is retained. Additional intents go to other active, non-schedule-only memberships in the same store with current `schedule.publish` authority for the assignment's department. A publisher from another department qualifies only through existing `location.manage` scope. Inactive memberships, inactive capabilities, unrelated departments and other stores are excluded. The actor/target is excluded from the additional recipients. The existing `(leadership_id, revision, recipient_id)` key and command receipt path ensure one intent per recipient per event, including retries. No capabilities or training clearances are added. Assignment by another publisher retains the original target-only notification behavior.

All reference, event, receipt, revision and outbox writes remain atomic. A failure on a later publisher intent rolls back the whole command. These are queued notification intents, not proof of delivered messages; the actual delivery worker remains open.

## Configured checkout-role boundary and existing records

The private `leadership_target_allowed` predicate excludes `is_dish_position(p_restaurant, m.position)` using the configured canonical checkout position. Both viewer choices and assignment commands consume this same predicate. Checkout-position memberships with `schedule.change` or `close.confirm` are excluded; attempts return `leader_capability_required`.

049 performs no backfill, deletion or revocation of existing leadership references. Existing leaders' records and dated authority remain intact. New assignments, edits and reactivation enforce current target eligibility. A publisher may still revoke an existing checkout-role assignment or edit it to another eligible target.

The command deliberately retains its existing authorization and target checks before receipt lookup. Replaying a previously accepted assignment after its target becomes ineligible returns the current authorization refusal without another mutation. The client clears known refusals and reloads current records; it must inspect the existing assignment before submitting a revised command. A global receipt-first authorization redesign remains separate work.

## Remaining work

Optional event-history browsing remains deferred. When adopted, expose only action, actor, time and reason to department-authorized publishers, with bounded history reads and without internal event payloads. Other published-shift editing UI, attendance/audited completed-record corrections, copying/batch editing, source completeness, shared authz, copied-component retirement, notification delivery and Inventory integration from its confirmed tested baseline remain open.

## Validation

Fresh fictional bootstrap through all 49 migrations and generated snapshot comparison passed. Focused leadership checks passed 41/41; a separate fresh-database full serial suite passed 614/614 with zero failures/skips. Ten new API/UI checks cover badge provenance, publisher notification scoping and exactly-once replay, rollback on a later recipient failure, configured checkout eligibility, retained existing references and current-eligibility replay refusal. Strict backend/UI types, the source-copy gate, preview builds and readiness inventory passed. Published 001–048 manifest hashes and LF bytes remain unchanged.

All three fictional preview seeds passed. Browser rehearsal confirmed the badge on both the self-assigned board and detail, then its absence after a publisher reassigned the record to another eligible leader. The rendered badge screenshot and runtime fixtures remain ignored. Exact-head GitHub CI is recorded in the draft PR description. These checks validate the candidate, not a hosted or real-store rollout. No active backend, hosted service, deployment or Inventory change is included.
