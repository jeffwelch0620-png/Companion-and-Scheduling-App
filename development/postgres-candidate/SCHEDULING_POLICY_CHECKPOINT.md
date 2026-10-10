# Scheduling policy decisions and completed-shift protection

This dependent candidate package starts from draft PR28 head `a045dca`, not accepted main. PR28 is still unmerged. The active Companion, Inventory and hosted services remain separate.

## Confirmed operating choices

The user selected these policies on 2026-10-10:

- Eligible schedule publishers may assign themselves dated leadership. Assignment still requires current publisher scope and the target's existing leadership capability; it grants no new membership permissions.
- Authorized managers may edit active shifts with a required reason. Existing scope, dated leadership, revision, job, station, linked-task/closing, conflict and independent-check protections still apply. A job title alone never authorizes a change.
- A manager may approve a department-changing swap. Replacement consent and current approval authority for both original and replacement departments remain required. The target must remain eligible for the selected job, station and linked work. Ordinary coverage retains its existing same-department and pre-start restrictions.

These permissions already existed in the candidate. New focused tests preserve them instead of adding broader authority. Editing a started draft also requires a nonempty reason recorded in its draft event.

## Completed-shift boundary

Corrective migration 038 uses explicit definitions to block new edits and cancellation when the stored shift end is at or before current server time. It covers published changes, existing draft edits/cancellation and time-off review that would cancel an ended draft. It checks time after acquiring coordination and record locks. An ended shift cannot be made editable by supplying a new future end. The adapter returns the sanitized HTTP 409 `shift_ended` conflict.

Swap eligibility also rejects ended shifts. Approval that begins earlier but waits past the end still meets the final write cutoff. Active swap approval remains permitted with replacement consent and a manager reason. Existing coverage checks already reject started shifts.

Previously applied, identical requests can return their original receipt after the shift ends, with current authorization rechecked; they perform no new mutation. Changed payloads, revoked permissions and new requests still fail. Checkout and closing confirmation may legitimately finish after scheduled end and retain their own workflow gates.

This is a cutoff for changing an existing schedule record. New historical references and initial historical publication retain their existing candidate behavior. Published migrations 001–037 are not rewritten. A production correction command for ended shifts is not implemented: future corrections require a separately reviewed design that preserves the original record, reason, authority and audit trail. Privileged fictional fixture writes and schema-owner imports are not that production endpoint.

## Validation and handoff

Local validation on 2026-10-10 passed in fresh fictional loopback database `companion_candidate_policy4`: migrations 001–038, generated function snapshot comparison before fixtures, all 445 serial checks (437 prior checks plus eight policy cases), strict candidate types, original-form preview build and readiness inventory. The build retains the existing runtime logo-path warning; no new live browser exercise was performed. Published migrations 001–037 and their manifest entries remain byte-for-byte unchanged; 038 uses LF with a verified hash. Existing migration-037 upgrade tests are explicitly pinned to 037 so appending 038 does not accidentally change the earlier test's subject. GitHub CI must be verified separately against this draft's exact head.

This draft depends on PR28. Review and merge PR28 separately first, then merge updated main normally into this branch and retarget its PR to main; do not force-push. Retest the resulting head before acceptance. Neither draft PR authorizes a hosted database application, deployment or Inventory port. Remaining scheduling work includes UI adoption, copying/attendance, source completeness and production identity; completed-record correction is now an explicit remaining contract.

## Approved pre-merge corrections

The user accepted A1–A4 and B1–B4 on 2026-10-10. The dependent branch incorporates PR28's corrective migration 039 normally, without force-pushing. Migration 040 uses explicit reviewed definitions and preserves all published SQL and hashes.

Approved leave now follows the canonical person across memberships. Draft saves, publication, published edits, coverage/swap eligibility and weekly staffing review use the private person-wide conflict helper. Availability stays local. Weekly planning tokens include relevant cross-store leave snapshots without returning leave details to other stores. Leave writers coordinate every affected store with NOWAIT; 40001 means retry the entire transaction with the same intent/request ID and no external side effects. Tests cover scheduling/approval races, commit and rollback.

A leave approval flags cross-store overlapping shifts without cancelling them or returning their IDs to the approving store. Flags retain the shift revision, before snapshot and pending review status in private tables, plus generic manager notification intents. Authorized local schedule reads expose only local pending review reasons, without foreign leave identifiers/notes; employee reads do not gain these flags. Actual notification delivery and the correction/resolution UI remain separate.

Started draft/published edits cannot move the original start later or set an end before current server time. Earlier starts still require an authorized manager and the existing audit reason. Invalid active intervals return sanitized HTTP 409 active_shift_time_conflict. Ordinary ended-shift mutation remains blocked. Coverage and swap command paths map ended conditions consistently to shift_ended, including a swap approval that waited on a lock past the end.

After-the-fact leave approval preserves ended draft or published shift rows, revisions and history; it records pending review flags instead of cancellation. Identical requests replay their result with current authorization. Current local published/linked shift cancellation is still held by its existing protections. Active unlinked local draft cancellation retains exact impact selection and audit reasons. A no-show is not automatically approved leave or evidence of hours worked; attendance and audited correction commands remain open.

Ended unpublished drafts are excluded from live draft reads and weekly selection and cannot be newly published. Published history remains visible. Flags never rewrite historical worked time. No general receipt-before-authorization rewrite was made; current authorization remains required before replay.

Remaining optional B5 items are publisher/owner awareness for leadership self-assignment and an original-department staffing-gap warning for department-changing swaps. Existing consent and both-department approval policies remain unchanged. Configurable job/department labels and timezone, remaining lower-priority audits, shared-authz identity port, notification delivery, attendance/corrections and scheduling UI adoption remain on the readiness list.

Inventory is now merged and undergoing baseline testing. Its exact tested commit is required before the separate integration port; no Inventory or hosted changes were made. Both PRs remain draft. Merge approval for 28 must precede updating this branch from main, retargeting, retesting and obtaining separate approval for 29.

Follow-up validation on 2026-10-10 passed in fresh fictional loopback database `companion_candidate_followup29d`: ordered migrations 001–040, generated snapshot comparison, all 457/457 serial tests, strict candidate types, original-form preview build and readiness inventory. Ten additional follow-up cases cover policy, privacy, transaction races and upgrade equivalence; PR28 adds two other cases. Targeted final validation passed 46/46. Earlier publication fixtures were adjusted to assert the newly approved expired-draft cutoff; privileged historical fixtures still test existing published history. Published 001–038 files/hashes and 039 remain unchanged; 040 and the snapshot use LF. The existing runtime logo-path build warning remains; no live browser exercise, deployment, hosted application or Inventory port was performed. GitHub CI must be checked against the pushed head.
