# Staffing and closing publication review

Isolated preparation on individual-publication baseline `b227f48`. Additive migration 029 adds staffing workflows and closing publication validation. Migrations 001–028 remain unchanged. No active app cutover, Inventory merge, hosted migration or deployment.

## Staffing workflow

Scoped schedule managers create/edit draft staffing needs with department, position, times, required headcount (1–100), title and operating reason. Periods must be positive and at most 24 hours. Editors need access to both previous and destination departments. Approved needs cannot be silently edited; create a new draft instead. Only schedule publishers approve needs, with explicit headcount/time/source confirmation. Concurrent overlapping approvals for the same department/position serialize and one is rejected. A draft may be retired by a scoped schedule manager; retiring an approved need requires a publisher.

Staffing changes retain history, scope revisions and idempotent request receipts atomically. There are no staffing notification intents, matching the source. Copied provenance is preserved on edits but cannot be supplied through commands; source copy/import workflows remain pending. Reads use the source's schedule-planning permission scope through paged authenticated `/staffing` access.

## Publication review and closing handoff

Authenticated `/publication-review/<shift-id>` reads show current overlapping approved staffing, matching copied drafts and closing problems. Individual publication blocks those staffing cases; weekly gap calculations and exceptions must be reviewed by the future batch workflow. Candidate checks apply even if privileged fixture evidence asserts no staffing.

Closing checks revalidate the approved instruction revision, current owner/department/due time, active guide linkage and job/station matching, linked shift revision, independent closing manager permission and dated leadership (unless the manager has location authority). A two-stage closing standard retains its separate physical verifier requirement. This matches source review rules within available candidate guide references; superseding-guide ingestion remains pending.

Valid draft closing assignments can now be published together with their shift. The closing's stored shift revision advances atomically, with a new closing revision/history event so old screen commands fail safely. The employee can then submit normal physical-check readiness without a stale-shift error. Publication does not verify the closing or release the employee. Revoked participants, changed instructions or guide links block publication.

The privileged publication evidence gate remains: real source completeness/ingestion is not established. Its `no_closing` attestation must now agree with whether active closing assignments exist, and every active assignment passes backend review. Tests install only fictional evidence. Raw runtime writes/private checks remain denied. Linked tasks and guide-only links without assigned closing work stay outside this publication slice.

## Validation and next step

Local validation: fresh 29-migration bootstrap, all 313 serial candidate checks, strict adapter types, original-form preview builds and source coverage inventory. Thirteen focused checks cover staffing lifecycle/permissions/confirmation/overlap, malformed inputs, source closing-review parity, revoked reviewers, dated leadership, individual staffing blockers, valid closing publication followed by employee readiness, retries/revocation, rollback and scoped HTTP sessions. Browser adoption and notification delivery are not established by these checks. GitHub results are reported separately on the draft PR.

Next: weekly staffing-gap review and batch publication with explicit reviewed selections and permitted staffing exceptions. Complete source reconciliation, automatic learning and UI adoption remain pending; M06 and Inventory integration remain open.
