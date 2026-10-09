# Schedule draft checkpoint

Candidate-only preparation on the availability-command baseline `4a62f5b`. Migration 022 adds station-free draft creation and editing through the existing `shift.save` command shape and authenticated command endpoint. The active Companion backend, Inventory and hosted services remain separate. No merge or deployment is included.

## Implemented contract

- A verified active, non-schedule-only actor needs explicit `schedule.manage` for the destination department. Editing also checks the current department; `location.manage` widens department scope but does not replace scheduling permission.
- The destination employee must belong to the same restaurant and be active or schedule-only. The selected job must have an active qualification or schedule-job reference; a matching title or station clearance is insufficient.
- Explicit-zone instants must describe a positive period of at most 24 elapsed hours. Overlap is checked against every noncancelled shift, including drafts and released shifts, matching the original assignment check. Adjacent periods are allowed.
- Approved time off and approved availability block conflicting periods. Availability uses the existing minute, buffer, local timezone, DST and exception rules.
- New drafts remain unpublished. Edits require the current revision and a command-created, unpublished, noncancelled, unreleased draft. Imported/reference-only shifts and drafts linked to tasks, closes or standard links are blocked. The candidate does not yet inherit or reschedule linked work as the source application can.
- Each save atomically writes the shift, audit snapshot/change note, workspace revision and request receipt. Identical concurrent retries apply once; changed payloads conflict. Replay rechecks actor identity and scheduling scope. Drafts do not notify employees; publication and delivery remain pending.

## Deliberate readiness gate

`schedule_input_reviews.time_off_complete` defaults to false or absent. Draft writes return `schedule_inputs_incomplete` until trusted fictional fixture setup explicitly marks the restaurant's time-off reference set complete, including a deliberately reviewed empty set. Runtime cannot certify this or modify raw time-off references. This is a candidate test gate, not a production import or approval procedure.

`time_off_references` supports approved/pending/declined intervals only. The source request workflow, employee submissions, independent approvals, edits/cancellation, swaps and source reconciliation still need migration. Production readiness must replace fixture certification with a reviewed ingestion/workflow contract. Administrative reference/eligibility/roster writers must lock the restaurant first, and invalidate/reconcile completeness when inputs change; arbitrary privileged SQL is outside the candidate's concurrency guarantee.

Explicit station assignments return `station_assignment_not_migrated`. Empty/null station input is accepted as no station; station configuration, membership and training checks remain pending. Candidate shift reads still identify their coverage as `shift-references-only`; full workspace/history and original schedule form adoption are not complete. Command and HTTP tests are not browser UI proof.

## Validation

Local validation passed: fresh application of all 22 migrations and manifest verification; all 229 serial candidate checks; strict adapter types; original-form preview build; source coverage inventory. Thirteen focused draft checks cover draft reads/audit, old/new department scope, explicit jobs and schedule-only members, completeness gating, time off/availability, concurrent overlaps/retries, concurrent approval/save, linked work, published/released/reference protection, invalid/station inputs, transactional rollback and scoped HTTP sessions. GitHub validation is reported separately on the draft PR.

## Next slice

Implement employee time-off request save and independent manager review, including conflict checks against existing shifts and coordinated cancellation/replacement. Then replace fixture-only time-off completeness with a reviewed source/reconciliation path. Station scheduling and publication remain separate later checkpoints. M06 remains open; Inventory integration remains held.
