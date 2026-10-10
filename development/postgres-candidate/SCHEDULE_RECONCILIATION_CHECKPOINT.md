# Schedule input reconciliation checkpoint

Candidate-only preparation on time-off baseline `c32b661`. Migration 024 and `schedule-reconciliation.mjs` add a read-only proposal review and an explicitly opted-in fictional loopback rehearsal. No live export, production ingestion, Inventory merge, authentication/access grant or deployment is included.

## Review and application

Supply one restaurant/timezone, explicit declarations of complete roster and time-off coverage, every existing target membership (including inactive and schedule-only members), explicit source IDs/revisions and target membership/person UUIDs, qualifications and schedule jobs, and all mapped time-off records. An explicitly reviewed empty time-off set is valid. The validator withholds the entire proposal on unresolved owners, duplicate identities/jobs/requests, missing completeness declarations, invalid periods/status/revisions or other invalid inputs.

The rehearsal locks the restaurant first and requires the expected workspace revision. Roster identity, person name, department, position, active and schedule-only state must match existing target members exactly; it does not create/link people or change their membership/access. Qualifications and schedule jobs populate only explicit scheduling eligibility. Existing target requests must be included with exactly matching owner, department, instants, status, revision, note and decision. No request is overwritten or deleted. New reviewed time-off references retain source state/details/revision; complete source metadata remains archived. Cross-store target ID collisions fail.

Before application, every existing noncancelled shift must retain an eligible member/job and must not conflict with proposed approved time off. Reconciliation does not cancel shifts or reinterpret permissions. Job replacement, new time-off references, complete source archive, final target time-off archive, hash/review receipt, workspace revision and evidence-linked completeness gate commit together. A failure rolls everything back. Concurrent identical batches apply once; changed payloads cannot reuse a batch. A historical receipt replay returns its historical result and never restores an invalidated gate.

## Maintaining completeness

Membership or job-reference changes invalidate completeness and clear the active evidence link. Unreviewed time-off writes invalidate it at transaction commit. Candidate time-off commands preserve completeness by writing exact request audit snapshots; reviewed reference inserts preserve it through the final target archive attached to the active reconciliation receipt. These trigger checks run with fixed schema-owner privileges, have a fixed search path and grant no direct execution to runtime. Runtime cannot write references, receipts or gates.

Administrative writers must still coordinate by locking the restaurant first. These guards do not establish safety for arbitrary superuser writes, disabled triggers or production restore procedures. Existing fixture-only direct certification remains available to privileged test setup for historical tests; production adoption must remove that shortcut and choose the authorized ingestion/reviewer role. `sourceRevision` and completeness are reviewed export assertions, not verification against a live source database. A missing source row cannot be detected merely because a caller declares a list complete.

Imported pending requests are references, not a newly sent employee submission: this rehearsal creates no request audit/notification workflow and delivers no messages. Roster mismatches and richer source request types require a separate linking/reconciliation decision, rather than overwriting current target state. This contract covers time off and job eligibility; availability ingestion, stations, swaps, publication, complete workspace/history and source export tooling remain pending.

## Validation and next step

Local validation passed: fresh 24-migration bootstrap, all 250 serial candidate tests, strict adapter types, original-form preview build and coverage inventory. Nine new checks cover complete empty/imported sets, eligibility and time-off enforcement, invalid/duplicate proposals, target drift, omitted/conflicting existing requests, concurrent batch/replay behavior, administrative invalidation versus audited commands, existing-shift conflicts, transactional rollback and runtime isolation. Historical draft fixture tests explicitly recertify after deliberate administrative changes so they continue to test their intended job/time-off rules. GitHub validation is reported separately on the draft PR.

M06 remains open. Next: station scheduling reference/configuration and employee assignment eligibility, then publication and protected shift-change/cancellation workflows. Full original-form and hosted adoption remain separate. This is inspectable local review evidence, not confirmation that real data has been reconciled.
