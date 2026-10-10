# Ordinary station handoff checkpoint

Follow-up: [Shift-linked task checkpoint and checkout guard map](LINKED_SHIFT_TASK_CHECKPOINT.md) implements the first non-Dishwasher linked-task slice. Linked handoffs, dedicated Dishwasher cycles and full manager checkout remain excluded.

October 8, 2026. Isolated candidate only; no active application or hosted database cutover.

## Workflow

Append-only migration 005_station_handoffs.sql adds kind handoff, an incoming restaurant-membership reference and acceptance phase. Database constraints require a different incoming employee for every handoff, forbid an incoming reference on other kinds and allow acceptance only for handoffs. Migrations 001–004 remain unchanged.

Creation requires the manager's tasks.manage authority over both the outgoing and incoming departments. Both employees must be active operational members of the same restaurant and cannot be Dishwasher. Explicit location.manage can widen a manager's department coverage; a title or operations.store alone does not. Reassignment preserves the incoming link and cannot name that incoming employee as the responsible outgoing employee.

The state sequence mirrors the current ordinary-task source:

1. Outgoing employee reports ready from open/correction.
2. Authorized manager, different from the outgoing employee, verifies and moves the handoff to acceptance.
3. Only the named incoming employee may accept or dispute at acceptance.
4. Accept closes the handoff. Dispute returns it to correction; outgoing employee must submit ready and receive independent verification again.

The outgoing employee remains the owner in this ordinary handoff model, including after acceptance. This does not implement the different ownership-transfer behavior of overnight manager handoffs or unfinished shift checkout receipts. The manager who verifies may also be the incoming employee if they are different from the outgoing employee; that matches the current source, and the browser fixture exercises it.

Incoming employees can read the handoff in scoped detail/list routes. Each incoming response and relevant receipt replay rechecks actor membership, named incoming identity and current Dishwasher restriction. Manager responses still require manager authority; incoming visibility does not grant manager or outgoing actions. Acceptance notifies incoming at the verification step; dispute returns notification intent to outgoing. Notifications remain a transactionally recorded outbox, not proof of external delivery.

The durable queue remains restricted to outgoing ready submissions. Incoming accept/dispute and manager commands require connection in this preview. Real outage page loading and durable manager/incoming retry recovery are still separate work.

## Verification

- Full suite: 57 passed, zero failed/skipped: 8 original task, 12 auth/queue, 12 capability, 12 issue/reassignment, 13 station handoff checks.
- Handoff cases include acceptance/dispute sequences, role/phase limits, incoming eligibility, creator scope over both departments, read/list visibility, reassignment restrictions, duplicate receipts, changed-payload conflicts, notification recipients, concurrent acceptance/dispute, eligibility changes/revocation and rollback when acceptance notification recording fails.
- Signed JWT HTTP coverage validates incoming reads and responses through server-resolved identity.
- Existing ordinary-task tests exposed a nullable-incoming-field read-access defect during development. The corrected functions use explicit null-safe identity comparisons; unrelated reads and former-assignee queued submissions are denied in the passing full suite. No change was deployed outside the fictional databases.
- Strict isolated TypeScript checking and preview production bundle passed.
- The separate fresh test database, initialized through migrations 001–004, applied 005 and completed a seven-event dispute/correction/reverification/acceptance workflow. The verification script runs after 005; it is not a complete bootstrap command.
- Browser testing used the unchanged FollowForm/FollowDetail components. “Browser station handoff verification” was assigned to fictional employee with fictional manager incoming; ready → verify → dispute → ready → verify → accept produced closed phase and seven history entries. Database record: a35423a2-5307-42aa-b191-204af3cb6e1e, revision 7.

Evidence: runtime/handoff-results.txt, runtime/fresh-handoff-migration-results.txt, runtime/station-handoff-pass.jpg. The preview still uses a fixed fictional directory and generic manager-action status wording; production UI should refresh capabilities and give action-specific feedback. No mobile, hosted Supabase, live identity/session lifecycle or full employee archive-visibility parity is established here.

## Remaining work and next section

Map shift-linked task and checkout guards from Companion before adding those candidate workflows: active published shifts, matching employee/department, due within shift, delegated closing authority, independent checks, separate manager checkout, incoming unfinished-work source links and dishwasher cycle completeness. Do not reuse this ordinary handoff as a shortcut for those flows.

Still open: overnight manager handoffs, prep-production/food integration, multiple-job identity model, production permission administration, final audit mapping, Node/Worker deployment, real Supabase session provisioning/revocation, shared-device queue privacy and recovery, and stable retries for manager/incoming forms. Reconcile Inventory's ready baseline before any integration merge.

All changes stay under ignored work/postgres-candidate. Companion source, Inventory checkout, hosted Supabase and Git history remain unchanged. No commit, push or merge occurred. The local browser test server and PostgreSQL server were stopped after evidence collection.
