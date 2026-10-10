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
