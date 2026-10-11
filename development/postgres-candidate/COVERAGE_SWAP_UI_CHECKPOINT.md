# Coverage and named replacement screen preparation

PR33 normally incorporates accepted Companion main `e0479d1` (PR34, tested head `078946e`). The refreshed coverage package targets main and remains a draft for separate review and merge approval. Candidate preparation remains separate from the active backend, Inventory and hosted services.

## Consent and independent decisions

The isolated scheduling preview adds a coverage/replacement board, owner request forms and complete server-captured offer details. Coverage offers support explicit volunteering, volunteer withdrawal, owner withdrawal and independent approval of an actual volunteer. Named replacement requests use the existing swap contract: one shift changes employee; this is not a reciprocal exchange of two shifts. The named employee can accept or decline. Acceptance leaves ownership unchanged, and approval is unavailable until that consent has been recorded.

The forms display captured times, closing criteria, due dates and guide versions before consent and review. Private notes, volunteer identities and history follow the server's scoped projection; the client does not reconstruct hidden records or load a coworker's entire schedule. Invalidated/changed offers require a fresh request and consent. Finished offers are historical evidence, not proof of current shift responsibility.

Approval requires a nonempty reason, explicit duty/time confirmation, independent reviewer identity and current published-change authority. A reviewer without store-wide authority needs active dated leadership covering the whole shift and appropriate department scope. Named replacements in a different configured department require a separate manager confirmation and a warning to review original-department staffing. Current eligibility, person conflicts, availability, approved leave, complete inputs, station clearance and linked closing protections remain authoritative database checks. Roster job matches are suggestions, not clearance. No role, eligibility or policy grants are added.

Coverage creation and volunteering stop when a shift starts. The existing swap path can cover an active, unended shift without altering its times; the server enforces its reasoned published-change and ended-shift policies. Imported-reference transfers remain held by the existing shared change path. Named-request owner withdrawal is not an existing command and is not invented by this UI.

## Complete reads and recovery

The coherent scheduling workspace now includes every scoped coverage, swap and leadership page, bracketed by unchanged viewer/revision checks. A failed page, malformed offer snapshot, changed permissions or stalled pagination rejects the entire workspace. Original availability/time-off screens receive only their own request kinds. Leadership records support approval scope; leadership assignment UI remains a later slice.

All new actions use the existing frozen command envelope, exact offer/shift revisions and request ID. A lost response or 5xx retains the original submission and freezes editing, reload, navigation and actor switching. Retry sends the same payload and checks the server receipt. Known 4xx refusals clear uncertain state and reload current records before another reviewed decision. This is online, in-page recovery only; scheduling consent is not stored in the employee task offline queue.

## Schema and review boundary

Existing granted read/command contracts are sufficient. Published migrations 001-046, `migrations.json`, the generated function snapshot, backend commands and the three-component source-copy gate are unchanged. The new focused component is not a copied shared component. Future application adoption must connect this slice to the shared identity/workspace contracts alongside the existing copied-component retirement plan.

## Evidence

- Fresh fictional loopback database bootstrap through 044 and generated function snapshot verification.
- 27 focused checks: 13 new client/render/recovery cases, four new authenticated API workflows and ten existing schedule-client checks.
- Local full serial regression passed 555/555 checks on a fresh fictional database. Final rendered/client checks passed 23/23 after minor historical-message/error refinements. Strict backend/UI types, source-copy gate, preview build and workflow inventory passed. Exact-head CI is recorded in the draft PR; CI is validation, not deployment.
- Fictional browser rehearsal: owner coverage offer, coworker privacy/volunteering and independent approval; named cross-department request, participant acceptance and separately confirmed manager approval. Browser fixture shifts have no closing duties; authenticated API tests separately exercise captured closing duties and ownership transfer.

M06 remains partial. Next UI slices: dated leadership assignment, other published-shift edits and attendance/audited corrections, followed by copying/batch editing and reviewed source ingestion. Shared-authz identity, actual notification delivery (including department-gap awareness), production provisioning/device recovery and the tested Inventory baseline/port remain open. No merge or deployment is included.

## Refresh after accepted PR34

The normal main merge preserves all published migration bytes, the accepted schema snapshot, separate scheduling/source-input counters and tab-scoped publication recovery. Coverage, swap and leadership pages retain the global workspace consistency check, while the loaded workspace also carries both publication counters. Fresh fictional loopback bootstrap through all 46 migrations and schema comparison passed. The combined local serial suite passed 575/575 tests (zero failures/skips). Strict backend/UI types, source-copy gate, preview build, readiness classification and all three preview seeds passed. Refreshed browser smoke checks passed: employee published-shift replacement form and named coworker choices; publisher selected-draft review loaded current closing/staffing details alongside coverage navigation. These refresh checks did not submit new commands; the full suite includes the transactional coverage/consent/approval tests. Exact-head CI follows the tested push. Historical evidence above describes the original PR33 head.
