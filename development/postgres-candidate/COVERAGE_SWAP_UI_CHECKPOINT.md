# Coverage and named replacement screen preparation

PR33 normally incorporates accepted Companion main `e0479d1` (PR34, tested head `078946e`). The refreshed coverage package targets main and remains a draft for separate review and merge approval. Candidate preparation remains separate from the active backend, Inventory and hosted services.

## Consent and independent decisions

The isolated scheduling preview adds a coverage/replacement board, owner request forms and complete server-captured offer details. Coverage offers support explicit volunteering, volunteer withdrawal, owner withdrawal and independent approval of an actual volunteer. Named replacement requests use the existing swap contract: one shift changes employee; this is not a reciprocal exchange of two shifts. The named employee can accept or decline. Acceptance leaves ownership unchanged, and approval is unavailable until that consent has been recorded.

The forms display captured times, closing criteria, due dates and guide versions before consent and review. Private notes, volunteer identities and history follow the server's scoped projection; the client does not reconstruct hidden records or load a coworker's entire schedule. Invalidated/changed offers require a fresh request and consent. Finished offers are historical evidence, not proof of current shift responsibility.

Approval requires a nonempty reason, explicit duty/time confirmation, independent reviewer identity and current published-change authority. A reviewer without store-wide authority needs active dated leadership covering the whole shift and appropriate department scope. Named replacements in a different configured department require a separate manager confirmation and a warning to review original-department staffing. Current eligibility, person conflicts, availability, approved leave, complete inputs, station clearance and linked closing protections remain authoritative database checks. Roster job matches are suggestions, not clearance. No role, eligibility or policy grants are added.

Coverage creation and volunteering stop when a shift starts. The existing swap path can cover an active, unended shift without altering its times; the server enforces its reasoned published-change and ended-shift policies. Imported-reference transfers remain held by the existing shared change path. Named-request owner withdrawal is not an existing command and is not invented by this UI.

## Complete reads and recovery

The coherent scheduling workspace includes every scoped coverage, swap and leadership page, bracketed by unchanged viewer/revision checks. A failed page, changed permissions or stalled pagination rejects the entire workspace. The reviewed follow-up below isolates malformed offers while preserving valid records. Original availability/time-off screens receive only their own request kinds. Leadership records support approval scope; leadership assignment UI remains a later slice.

All new actions use the existing frozen command envelope, exact offer/shift revisions and request ID. A lost response or 5xx retains the original submission and freezes editing, reload, navigation and actor switching. Retry sends the same payload and checks the server receipt. Known 4xx refusals clear uncertain state and reload current records before another reviewed decision. This is online, in-page recovery only; scheduling consent is not stored in the employee task offline queue.

## Schema and review boundary

The original UI slice used existing granted read/command contracts. The reviewed follow-up adds corrective 047 for server action flags and recorded department acknowledgement, with an updated manifest and generated snapshot. Published migrations 001-046 and the three-component source-copy gate remain unchanged. The new focused component is not a copied shared component. Future application adoption must connect this slice to the shared identity/workspace contracts alongside the existing copied-component retirement plan.

## Evidence

- Fresh fictional loopback database bootstrap through 044 and generated function snapshot verification.
- 27 focused checks: 13 new client/render/recovery cases, four new authenticated API workflows and ten existing schedule-client checks.
- Local full serial regression passed 555/555 checks on a fresh fictional database. Final rendered/client checks passed 23/23 after minor historical-message/error refinements. Strict backend/UI types, source-copy gate, preview build and workflow inventory passed. Exact-head CI is recorded in the draft PR; CI is validation, not deployment.
- Fictional browser rehearsal: owner coverage offer, coworker privacy/volunteering and independent approval; named cross-department request, participant acceptance and separately confirmed manager approval. Browser fixture shifts have no closing duties; authenticated API tests separately exercise captured closing duties and ownership transfer.

M06 remains partial. Next UI slices: dated leadership assignment, other published-shift edits and attendance/audited corrections, followed by copying/batch editing and reviewed source ingestion. Shared-authz identity, actual notification delivery (including department-gap awareness), production provisioning/device recovery and the tested Inventory baseline/port remain open. No merge or deployment is included.

## Refresh after accepted PR34

The normal main merge preserves all published migration bytes, the accepted schema snapshot, separate scheduling/source-input counters and tab-scoped publication recovery. Coverage, swap and leadership pages retain the global workspace consistency check, while the loaded workspace also carries both publication counters. Fresh fictional loopback bootstrap through all 46 migrations and schema comparison passed. The combined local serial suite passed 575/575 tests (zero failures/skips). Strict backend/UI types, source-copy gate, preview build, readiness classification and all three preview seeds passed. Refreshed browser smoke checks passed: employee published-shift replacement form and named coworker choices; publisher selected-draft review loaded current closing/staffing details alongside coverage navigation. These refresh checks did not submit new commands; the full suite includes the transactional coverage/consent/approval tests. Exact-head CI follows the tested push. Historical evidence above describes the original PR33 head.

## PR33 reviewed follow-up (047)

Malformed offers are isolated per record. The loader omits them from actionable records, retains only a generic notice count, and keeps coherent shifts/drafts and valid offers. Board/detail rendering also validates per offer and shows a review notice with no record actions or malformed private content. Authentication, failed pages, stuck cursors and revision/permission drift still reject the whole workspace.

Corrective 047 adds a private server action projection using the same offer-status, replacement-eligibility and published-change helpers as commands. Reads return volunteer, withdrawal, consent, approval, independent review/decline and department-change flags plus permitted approval target ids and replacement department. The client consumes these flags; it no longer reconstructs approval authority from capabilities, leadership or its clock. Flags describe the current read snapshot, not a promise that a later command will succeed. Commands recheck their original policies under scope coordination, including changed permissions, eligibility, ended shifts and receipt replay. No new runtime helper grants are added.

Cross-department swap approval now requires a boolean `departmentConfirmed: true` in the command. The adapter preserves it, SQL requires it for a changed department, and the offer event records the acknowledgement and original/destination departments atomically. Same-department approvals and manager declines retain their existing contract. Historical receipts remain replayable under the existing current-authority checks; prior events are not retroactively certified.

Named replacement remains available alongside an open coverage offer, with an explicit local acknowledgement and explanation that approval resolves competing offers. This local acknowledgement is not added to the server payload. Server invalidation and the original employee's responsibility until approval remain unchanged.

All published migrations 001–046 are preserved byte-for-byte. Only 047 is new; manifest and generated snapshot include it. The package remains draft and separate from hosted application, active backend adoption and Inventory. Exact-head CI is recorded in the PR description.

Fresh fictional bootstrap through 047 and generated snapshot comparison passed. The full serial suite passed 587/587 tests, with zero failures/skips; 12 new regressions cover isolated malformed offers, server actions, current authority, acknowledgements, replay and private helper/audit denial. Strict backend/UI types, source-copy gate, preview build and readiness inventory passed.

The loopback browser rehearsal passed: an owner opened coverage, acknowledged that offer before requesting a named cross-department replacement, the participant consented, and an independent publisher confirmed the department change and approved it. The SQL event recorded `departmentConfirmed`, `fromDepartment` and `toDepartment`. A privileged fictional malformed-duty fixture then produced only the generic inert notice while valid offers, the transferred published shift and a selectable draft remained accessible. No malformed private note was displayed. All three preview seeds passed. These are fictional preparation checks, not hosted or pilot evidence.
