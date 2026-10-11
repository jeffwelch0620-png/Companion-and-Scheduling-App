# Dated leadership screen preparation

Preparation starts from accepted Companion main `2d8d3cc` (PR33, 587/587 merged-main CI checks). The isolated scheduling preview adds a leadership board, assignment/editor, current details, revocation and reviewed reactivation. This package remains separate from the active backend, hosted services and Inventory integration.

## Existing policy and scoped choices

Eligible schedule publishers may assign themselves. Assignment requires current `schedule.publish` authority for the proposed department; editing requires authority for both the original and proposed departments. Targets must be active, sign-in-enabled memberships in the same store, with existing `schedule.change` or `close.confirm` permission and either the selected department or existing location-management scope. Job titles, schedule management alone and location management alone do not establish assignment authority. Dated responsibility never writes membership capabilities, schedule eligibility or training clearance.

Corrective 048 introduces a private target predicate shared by `leadership_command` and the viewer's scoped choices. The predicate preserves the command's existing eligibility rule. The viewer returns only department-scoped eligible ids/names to authorized publishers; coworker capability arrays remain hidden. Scoped leadership reads add authoritative `canEdit` and `canRevoke` flags. Record visibility, runtime entry-point grants, scope locking, receipt replay authorization and before/after audit behavior are preserved. All earlier migrations remain immutable.

The board shows only scoped returned references. Malformed leadership details have a generic review notice and no actions. Forms consume server choices and action flags, then commands independently recheck current identity, scope and eligibility. An unavailable projection hides assignment choices instead of guessing from roster titles or local capability arrays.

## Periods, editing and recovery

The form uses the configured store timezone with separate start/end dates. Midnight crossings are explicit. The limit is 24 actual elapsed hours, including DST transitions. Nonexistent local times are refused; repeated hours require a first/second-occurrence selection. Existing ambiguous boundaries select their original occurrence. An unchanged imported boundary retains its original seconds/milliseconds.

Creation, editing, revocation and reactivation require a fresh reason. Revoke additionally requires acknowledgement of its operational effect. Revocation removes this reference from current dated-authority checks without completing work, releasing shifts or resolving handoffs; other overlapping references remain valid. Reactivation reviews and resubmits the current period/eligible target with the exact revoked revision. Past-period leadership changes follow the existing command policy; this screen does not introduce worked-time or completed-shift corrections. Those remain separate audited designs.

All submissions use the existing frozen scheduling envelope, original request id, record id and exact revision. A lost response/5xx keeps editing, navigation, actor switching and reload disabled until the original request can be retried. Known 4xx refusals clear uncertain state and reload current records. This is online, in-page recovery; leadership is not added to the employee task offline queue. Reload persistence of uncertain leadership submissions remains a later device-recovery item.

Events and assignment notification intents are stored atomically by the existing command. This screen shows current assignment details and the latest reason; event-history browsing, additional publisher/owner awareness for self-assignment and notification delivery remain separate work. Candidate notification intents are not evidence of delivered notifications.

## Validation and next step

Fresh fictional bootstrap through all 48 migrations and generated snapshot comparison passed. The full serial suite passed 604/604 tests, with zero failures/skips; 17 new UI/client/authenticated API checks cover scoped choices, self-assignment, coworker capability privacy, edits/revoke/reactivation, current permissions, DST boundaries, exact versions, uncertainty/replay and private helper/audit denial. Strict backend/UI types, source-copy gate, preview build and readiness inventory passed. Published migrations 001–047 are unchanged byte-for-byte and all manifest hashes use LF bytes.

All three fictional preview seeds passed. The loopback browser rehearsal verified self-assignment, a reasoned target/period edit, confirmed revocation, reviewed reactivation and an assigned manager's read-only detail view without publisher controls. Runtime fixtures and screenshot evidence remain ignored. Exact-head CI is recorded in the draft PR description; these checks do not establish hosted or real-store pilot readiness.

M06 remains partial. Next preparation: other published-shift editing UI, followed by attendance/completed-record correction design, copying/batch editing and reviewed source completeness. Shared authz, copied-component retirement, actual notification delivery and Inventory integration from its confirmed tested baseline remain open. This draft does not authorize a merge, hosted migration application or deployment.
