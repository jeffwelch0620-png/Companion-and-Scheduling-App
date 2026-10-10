# Shift-linked task checkpoint and checkout guard map

October 8, 2026. Isolated candidate slice. Full manager checkout is not implemented.

## Implemented

Migration 006_linked_shift_tasks.sql adds a restricted shift_references projection and links ordinary task/issue records to a shift with a captured reference revision. It does not migrate the scheduling service or create a second authoritative schedule. Only fictional fixtures populate the projection today; production identity mapping, ingestion and version management remain open.

Assignment requires active published, uncancelled, unreleased shift with matching restaurant, employee and department. Due time must fall within its inclusive start/end interval. This first slice excludes dedicated Dishwasher shifts and linked handoffs; neither is silently treated as an ordinary linked task.

Linked tasks use closing authority, mirroring canManageClosing for eligible staff. Explicit tasks.manage plus operations.store can cover FOH/BOH for linked work; it does not widen ordinary task access or independently grant commissary production access. The helper still requires the requested capability. Job titles grant nothing. Manager task verification remains independent of the responsible employee.

New linked transitions/reassignments revalidate the current shift and captured revision. Same-person reassignment can reset remaining work, but another employee cannot inherit the link. A changed reference revision returns shift_conflict for review rather than applying stale work. This revision hold is an additional conservative candidate protection; production recovery/rebinding is not implemented and must be designed with schedule integration.

A database trigger protects employee/department/position/time/restaurant changes and deletion when tasks reference a shift. While linked tasks are pending it also blocks cancellation, unpublishing and setting released_at. This is the task portion of a future checkout gate, not full checkout authorization. Unrelated issues without an explicit shift link do not enter that gate.

No candidate shift.release command or runtime table-write permission exists. Completing a linked task closes only the task; it does not set shift released_at. Privileged fixture updates used in tests prove this trigger's behavior only. They do not prove authorization of a future manager release command or completion of other closing duties.

## Source guard map

| Current Companion rule | Candidate state |
|---|---|
| task.create: active published matching shift; due within shift; closing tasks.manage authority | Implemented for non-Dishwasher linked task/issue slice. |
| canManageClosing: normal department capability or explicitly authorized operations scope | Implemented and compared against transpiled current source for eligible managers; requested capability remains required. |
| task.reassign: keep checkout work with original shift employee | Implemented; other employee rejected. Linked unfinished-work receipt is still excluded. |
| inheritCloses: prevent moving linked task ownership/period/position with schedule edits | Projection trigger protects structural changes. Actual schedule service is not connected. |
| shift cancellation: pending linked tasks must be independently completed | Task trigger gate implemented; assigned close transfer/cancellation rules remain separate. |
| shift.release: published active shift; independent close.confirm manager; location-wide authority or assigned leadership covering end | Not implemented. Parser rejects shift.release. |
| shift.release: every assigned close and final manager check complete | Not implemented; no candidate approved-standard/close-assignment workflow exists yet. |
| close.assign/transition: correct approved station standard version, eligible independent manager/verifier, leadership coverage, answers and physical checks, correction help | Not implemented; next closing-work slice must retain these rules. |
| closingStatus: explicit task links, dated Dishwasher cycles, current incoming receipt and missing/corrupt receipt guards | Ordinary explicit links implemented; Dishwasher cycle/receipt logic remains excluded. |
| Shift checkout does not rewrite recorded work time | No timekeeping writes or shift release command added. |

Source references: app/shared/domain.ts task.create, task.reassign, inheritCloses, transferCancelledCloses, close.assign, close.transition and shift.release; app/shared/closing-status.ts; app/shared/closing-access.ts; app/shared/operations.ts.

## Evidence

- Full candidate suite: 69 passed, zero failed/skipped (8 original task, 13 auth/queue, 12 capability, 12 issue/reassignment, 13 station handoff, 11 linked-shift tests).
- Closing helper compared directly with canManageClosing using current source transpiled into the candidate runtime, with 48 capability/department comparisons. This does not edit Companion's source or build runtime.
- Additional cases cover inclusive/offset-normalized due times, ineligible/mismatched/foreign shift rejection, closing versus ordinary scope, original-employee links, revision conflicts, protected schedule mutations, pending cancellation/unpublish/release, revocation and runtime write denial.
- Signed JWT HTTP test completes linked assignment, employee ready and independent verification, then confirms shift released_at remains null.
- Strict isolated TypeScript check and preview production bundle passed.
- Separate fresh test database, previously initialized through 005, applied 006 and verified pending-task cancellation denial plus task completion without shift release.
- Browser used the unchanged FollowForm/FollowDetail. Manager chose the fictional published Cook shift, employee submitted “Work ready for physical check,” and manager checked it. The original detail explicitly states “The required work is checked. Manager checkout is a separate step.”
- Browser task db8d4860-d7d0-4d67-8bcd-75fa99e4bdc0 is closed at captured shift revision 1; fixture shift 30000000-0000-0000-0000-000000000001 remains unreleased.

Evidence: runtime/shift-regression-results.txt, runtime/linked-shift-results.txt, runtime/fresh-linked-shift-results.txt, runtime/linked-shift-pass.jpg. shift-preview-fixture.sql and the preview's fixed display shift are fictional test inputs, not a live schedule read API. They must be replaced by validated identity/schedule integration before production use.

## Next section and held boundaries

Next: approved closing-standard snapshots and closing assignments, including named independent reviewers and leadership coverage. Only after their required checks exist should a manager confirmation/release command be added. Dishwasher cycles and incoming unfinished-work receipts require their own source-linked checks.

Production administration/ingestion must coordinate restaurant-first locks when changing shift/member/grant data. There is no production schedule mutation endpoint here. Real Supabase identity/session lifecycle, Node/Worker hosting boundary, shared-device queue recovery, multiple-job decisions and Inventory audit/food integration remain open.

All new work remains in ignored work/postgres-candidate. Active Companion source, Inventory checkout, hosted Supabase and Git history remain unchanged. No commit, push or merge occurred. Local browser and PostgreSQL test services were stopped after validation.
