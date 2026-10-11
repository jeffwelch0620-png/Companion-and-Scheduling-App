# Companion PostgreSQL migration readiness

Accepted Companion preparation baseline: PR36, separately approved and squash-merged at `1c536d1`, including corrective migration 049. PR35 was previously accepted at `382fa92`. Earlier source snapshot/checklist entries below retain their historical evidence. PR37 published editing and PR38 closing transfers remain unmerged drafts; their preparation is not part of accepted main. The complete Companion app is **not ready for PostgreSQL backend cutover**. Inventory integration remains held until its tested baseline is confirmed. No hosted migration or deployment is authorized by this checklist.

The source inventory contains **39 WorkRecord kinds, 35 declared SQLite tables and 28 API route files**. These are scope counts, not a completion percentage. Several services and workflows live outside WorkRecord; one kind can have many commands. Candidate workflow tests do not prove migration of the original D1 service or all screen reads.

The working architecture remains one hosted PostgreSQL/Supabase primary shared by employee and ownership interfaces, with a local recovery/reporting copy to be designed and verified. No unrestricted dual-write mirror is implemented. During outages, employee task/prep submissions are intended to queue for later submission; ordering and stock posting wait. Prep queue support remains an implementation gap, not a completed promise.

Run `node development/postgres-candidate/readiness-inventory.mjs` from the repository root to refresh the inventory. It reads TypeScript syntax without executing application code and checks that every current DataMap kind has exactly one coverage classification. New, removed or duplicate kind classifications require review. The inventory does not verify that a status is correct; status changes require supporting implementation evidence.

## Workflow coverage

| Area | Source kinds | Current candidate coverage | Remaining work |
| --- | --- | --- | --- |
| Employee operations | task, close, handoff | Tested candidate commands, reads, independent checks, receipt/audit/outbox atomicity; task and closing readiness queue; imported closing rehearsal | Original full workspace/service adoption, realistic fixtures, actual notification delivery, production identity |
| Reference inputs | shift, standard, leadership | New shift/standard import with archived source and explicit links; scoped dated leadership assignment/edit/revocation; separate release tested | Real source completeness, existing-reference reconciliation, standard authoring/review and production identity |
| Scheduling | request, availability, coverage, staffing, attendance | Candidate draft/edit, station assignment, availability/time-off review, coverage/swap consent, staffing, individual/weekly publication and published changes; request, draft/day/week/personal, publication, coverage and leadership UI preparation accepted | Accept/reconcile pending published-edit and closing-transfer drafts; copy/import completeness, attendance and ended correction implementation, batch editor adoption and production service/identity |
| Training | development, goal, station, proficiency, achievement, learningcase | Candidate station setup, manual goal/correction issuance and independent review, publication learning proposals; manual clearances remain fixtures | Standard provenance/authoring, proficiency assessments, evidence-based clearance, achievements and complete development/learning history |
| Management | managerlog, meeting, shiftentry, shiftcheckin | Not migrated | Management logs, meetings/actions, shift notes/check-in, employee/manager visibility |
| Communication | message, feedback, recognition, staffidea | Not migrated | Recipient visibility, read/reply state, private feedback, review and recognition rules |
| People lifecycle | opening, hirechecklist, hirehandoff, promotion | Not migrated | Hiring approvals, archive/rehire, promotions and impacts on session/access revisions |
| Safety/service | equipment, maintenance, servicecontact, compliance, incident | Not migrated | Filed history, successors, cost reporting, scoped contacts, incident confidentiality |
| Guest/commercial | guestreview, catering | Not migrated | Guest review authorization, catering workflow and export/report parity |
| Food/ordering | fooditem, foodrecipe, order | Not migrated | Canonical Inventory IDs, recipe units, prep definitions/counts/plans, order review, invoice/catalog/transfer contracts |

The candidate outbox is evidence that a message was queued transactionally; it is not a working delivery service. An archived source record preserves evidence but is not a migrated operational workflow. The current readiness queue covers selected task/closing commands; **food prep counts/plans are not yet supported offline**.

## Services outside the workflow-kind list

- Identity and administration: the original employee-login, setup, access and shared-store services use D1 sessions/setup codes, browser identity links, membership revisions, owner-seat/restaurant access and administrator requests. Candidate signed JWT/session tests do not replace these onboarding, recovery and lifecycle workflows.
- Workspace and history: `app/shared/service.ts` binds to D1 prepare/batch. The running `/api/workspace` route passes Cloudflare `env.DB`. Complete scoped workspace pagination, former employees, recovered standards and history must be reconciled with the candidate before switching the route.
- External integrations: Toast roster/auth cache, day/schedule imports, HotSchedules and schedule transfer need reviewed identities, retry/lease behavior, encrypted secret handling and compatible import review. No external service has been tested through the PostgreSQL candidate.
- AI and reporting: private conversations, turn receipts, archives, usage limits, retrieval, food advisor, reminders and owner reports remain on D1. Shared database access must preserve visibility and usage accounting. Database hosting choice does not itself alter model token charges; no new pricing assumptions were made here.
- Food data and prep: dedicated food tables hold datasets, versions, source keys, histories, invoice files, transfer routes and prep workflow events. These cannot be replaced by a generic task row or a second independent Inventory catalog.

## Working checklist

| ID | Milestone | Status and acceptance evidence |
| --- | --- | --- |
| M01 | Reproducible isolated candidate and Git safeguards | Accepted preparation baseline: PR32 merged at 1b95d8e, 538/538 merged-main CI checks passed; further changes use focused draft PRs |
| M02 | Core employee task/closing/handoff/checkout behavior | Candidate complete for documented slice; production adoption still pending |
| M03 | Explicit employee/schedule/standard mappings | Candidate complete for narrow new-reference input; no automatic identity or capability inference |
| M04 | Atomic new-reference import and linked closing rehearsal | Candidate complete with fictional inputs; existing-reference updates and real export fixtures pending |
| M05 | Canonical employee identity and access lifecycle | Open: decide person/membership/job model, owner/commissary scope, separate access review, session revision/revocation and recovery |
| M06 | Full scheduling and leadership service | Partial candidate complete: scoped reads, writes, conflicts/DST/linked-work guards and selected UI; open for remaining UI, copying, attendance, source completeness and production service adoption |
| M07 | Standards and training workflows | Partial candidate complete: station setup and manual goals/review; open for standard provenance/authoring/history, proficiency and evidence-based clearances |
| M08 | Remaining workspace workflows and services | Open: migrate or explicitly defer each area without silently dropping visible records or commands |
| M09 | Inventory food/prep/order contracts | Held for tested Inventory baseline: canonical catalog/unit/recipe IDs, writer ownership, reporting and audit contracts |
| M10 | Production offline and device behavior | Open: identity/cache retention, shared-tablet logout cleanup, eviction/recovery, conflict resolution, queue age, phone/tablet checks and prep queue |
| M11 | Hosted platform and recovery | Open: Supabase identity/RLS plus backend enforcement, secrets, delivery worker, backup/restore rehearsal, local recovery/reporting copy and observation |
| M12 | Integration and rollout | Held: exact Inventory baseline, reviewed cross-repository port, shared migration ownership/manifest, full workflow acceptance and explicit rollout decision |

No production data currently needs preservation. Empty-database development permits schema changes, but it does not remove workflow and authorization requirements. Historical source-data import should be added only where needed for fixtures or a later real source; copying unused legacy tables is not a prerequisite for compatibility.

## Implementation order

1. Baseline consolidation, coordination, authentication/offline recovery, scheduling safeguards/policies, store configuration, publication/coverage and leadership UI preparation are accepted through PR36 at `1c536d1`. Git acceptance does not enable the candidate in either running application.
2. Review the pending PR37 published-edit and dependent PR38 closing-transfer drafts. Port existing manager attendance first under the [attendance/correction design](ATTENDANCE_CORRECTION_DESIGN.md); settle correction authority/approval before implementing ended-shift corrections. Complete batch editing, copying and reviewed source ingestion. Preserve timezone/DST, exact approvals and linked-work protections during UI adoption.
3. Complete canonical employee identity/access and standards/training workflows. Keep sign-in provisioning, scheduling eligibility, dated leadership responsibility and training clearance separate.
4. Reconcile complete workspace/history and supporting modules. Keep each module enabled only after its PostgreSQL read/write/visibility path is complete; any staged deferral must be explicit to the user before cutover.
5. Once Inventory is ready, reconcile canonical food/prep/order contracts and schema ownership. Implement employee prep submission and offline delivery with Inventory remaining the owner of stock/order posting.
6. Validate actual hosted authentication, device behavior, notification delivery and restore/recovery. Then review the integration branch and rollout checklist. Git merge, database application and deployment are distinct decisions.

## Evidence and limits

The previous imported-closing checkpoint passed 196 candidate checks, fresh application of all 18 migrations, strict adapter type validation, original-form preview build and both GitHub validation runs. This readiness review adds source inspection and classification checking; it does not add runtime coverage to the remaining modules. Earlier browser outage evidence remains limited to the fictional preview documented in `CHECKOUT_OFFLINE_UI_CHECKPOINT.md`.

The new inventory check passed against the current source, all 18 migration hashes verified unchanged, and local strict adapter types/preview build passed. CI now runs the classification drift check before its existing fresh-database/regression sequence.

Subsequent progress: [migration 019 and schedule shift reads](SCHEDULE_READ_CHECKPOINT.md) implement a paged shift-reference endpoint with source visibility parity. M06 remains open for roster/job eligibility, availability, remaining scheduling reads and all schedule writes. The preceding inventory/check counts describe this readiness review's baseline, not the later scheduling checkpoint.

Further progress: [migration 020 and schedule context reads](SCHEDULE_CONTEXT_CHECKPOINT.md) add roster/explicit eligibility and availability reference reads. M06 remains open for their production ingestion, writes, remaining scheduling workflows and complete workspace/form adoption.

[Migration 021 and availability commands](AVAILABILITY_COMMAND_CHECKPOINT.md) add save, independent review, projected shift-conflict checks and atomic replacement/audit/receipt behavior. M06 remains open; draft/edit shift writes are next. Source-level availability coverage is now classified as a candidate workflow, not production adoption.

[Migration 022 and schedule drafts](SCHEDULE_DRAFT_CHECKPOINT.md) add station-free draft save/edit, explicit job/scope checks, overlap/time-off/availability checks and atomic audit/receipts. Time-off completeness is an explicit fixture-only gate; imported, published and linked shifts remain protected. M06 remains open. Employee time-off request save/review and source reconciliation are next, followed by station and publication workflows.

[Migration 023 and time-off requests](TIME_OFF_CHECKPOINT.md) add employee submission, independent review, scoped/paged reads and atomic cancellation of exactly reviewed unlinked candidate drafts. Published, linked and reference-only cancellation stays blocked. Source completeness is not auto-certified; reviewed reference reconciliation is next. Request-kind coverage is partial (time off only); swap/consent, other scheduling workflows and full UI adoption remain pending. M06 remains open.

[Migration 024 and schedule reconciliation](SCHEDULE_RECONCILIATION_CHECKPOINT.md) add complete scoped roster/job/time-off proposal review, atomic fictional application with evidence-linked completeness and invalidation for administrative input changes. Existing requests are never overwritten; missing source rows still require a trustworthy reviewed export. Real ingestion/identity decisions, stations, publication and complete UI adoption remain pending. M06 remains open.

[Migration 025 and station scheduling](STATION_SCHEDULING_CHECKPOINT.md) add scoped station scheduling references, current employee/job eligibility checks, station-aware draft saves and preserved station metadata in reads/audit. Station configuration editing, source guide/goals/reviewer requirements, publication and complete training/UI adoption remain pending. M06 remains open.

[Migration 026 and station setup](STATION_SETUP_CHECKPOINT.md) add scoped definition/setup editing, complete guide/member/job/goal/reviewer validation, proficiency-definition versioning and atomic history/receipts. Learning goal issuance/review, proficiency assessment, complete source ingestion and publication/UI adoption remain pending. M06 remains open.

[Migration 027 and employee goals](EMPLOYEE_GOALS_CHECKPOINT.md) add manual goal/correction assignment, named independent review, approved-instruction version checks and scoped participant reads. Automatic learning, station issuance, proficiency, browser adoption and notification delivery remain pending. M06 remains open.

[Migration 028 and individual publication](SCHEDULE_PUBLICATION_CHECKPOINT.md) add reviewed unlinked draft publication, current eligibility checks and station learning proposals with persistent deduplication. Privileged fictional review evidence is required; full staffing/closing publication, batch publication, production evidence and UI adoption remain pending. M06 remains open.

[Migration 029 publication review](PUBLICATION_REVIEW_CHECKPOINT.md) adds staffing workflows and source-aligned closing checks, with atomic closing linkage on publication. Weekly gaps/exceptions, batch publication and production source evidence remain pending. M06 stays open.

[Migration 030 weekly review/publication](WEEKLY_PUBLICATION_CHECKPOINT.md) adds selected-only planned staffing gaps, current review tokens, gap plans and atomic batch publication. Privileged fictional scope evidence remains required. Published-shift changes, source reconciliation and UI adoption remain pending. M06 stays open.

[Migration 031 published schedule changes](PUBLISHED_SCHEDULE_CHECKPOINT.md) adds reviewed published edits, scoped cancellation and exact closing responsibility transfers. Current authority, linked work and completed closing protection remain enforced. Coverage requests/consent/swaps, source reconciliation and UI adoption remain pending. M06 stays open.

[Migration 032 coverage and swap consent](SCHEDULE_CONSENT_CHECKPOINT.md) adds owner offers, confirmed volunteers, named replacement acceptance, independent approval and atomic invalidation of stale consent. Scoped private reads and shared closing-transfer protections are tested in the candidate. Leadership assignment, source ingestion and complete scheduling UI adoption remain pending. M06 stays open.

[Migration 033 dated leadership](LEADERSHIP_CHECKPOINT.md) adds assignment/edit/revocation and source-aligned scoped reads. Existing permissions remain separate from dated responsibility, and current closing/published-change checks observe revocation. Complete scheduling workspace/form adoption and remaining copying/attendance/source contracts are pending. M06 stays open.

[Migration 034 and scheduling request UI](SCHEDULE_REQUEST_UI_CHECKPOINT.md) connect original availability/time-off request forms and independent review to current viewer permissions and complete scoped reads. Fresh migration/regression validation passed 384 checks; fictional browser submission/approval and other-department privacy were verified. Full shift editor/board, weekly publication, coverage/leadership screens, durable scheduling recovery and source completeness remain pending. M06 stays open.

[Schedule board and individual draft UI](SCHEDULE_BOARD_UI_CHECKPOINT.md) add original day/week/personal views, paged station context and exact-revision individual draft create/edit. Fresh validation passed 386 checks with all 34 migration hashes preserved; fictional browser creation/editing, published-only employee visibility and week/day navigation passed. The [candidate merge review gate](CANDIDATE_MERGE_REVIEW.md) recommends a reviewed consolidation baseline before further stack growth. Weekly publication, remaining screens, copying/attendance and production contracts remain pending. M06 stays open.

## Consolidation audit correction

PR 25 now includes corrective migration 035 and passes 391 fresh-database checks locally. See [audit correction checkpoint](AUDIT_CORRECTION_CHECKPOINT.md) for the four pre-merge fixes, CI dependency gate, strict driver checking and existing root lint limitation. Production identity, remaining workflow UI, offline prep, notifications/recovery and Inventory integration remain open.

## Database coordination checkpoint

Corrective migration 036 and HTTP read transactions address the first post-merge reliability package. See [database coordination checkpoint](DATABASE_COORDINATION_CHECKPOINT.md) for per-location write coordination, retryable policy changes, consistent read snapshots and evidence. Authentication/offline error recovery is the next separate package; schema/workflow policy decisions and Inventory integration remain open.

[Authentication/offline recovery checkpoint](AUTH_OFFLINE_RECOVERY_CHECKPOINT.md) adds candidate session/service error classification and saved-intent review/retry/discard with scoped device cleanup. PR26 and PR27 are accepted on main at `2193afc`. M05/M10/M11 remain open: real authentication lifecycle, shared-device security/retention, prep delivery and hosted recovery are not completed by fictional candidate checks.

## Person scheduling and roster review safeguards

[Migration 037 and scheduling safeguards](SCHEDULING_SAFEGUARDS_CHECKPOINT.md) adds person-level conflict checks across location memberships with a private database exclusion constraint, transactional booking maintenance and coverage eligibility. Expanded tests verify the existing whole-store roster invalidation contract, including old/new stores, publication blocking, stale receipt replay and renewed fictional review. M06 remains partial; these safeguards do not settle leadership self-assignment, started/ended shift edits or department-changing swaps, or finish scheduling UI/service adoption.

## Confirmed scheduling policies

The user selected eligible publisher self-assignment, authorized manager edits of active shifts with required reasons and manager-approved department changes during swaps. [The dependent policy checkpoint](SCHEDULING_POLICY_CHECKPOINT.md) preserves those permissions and adds migration 038's ended-shift cutoff, including draft edits/cancellation and time-off-driven cancellations. This historical checkpoint was based on PR28's tested draft head; both PR28 and PR29 are now accepted. M06 remains partial: a separately audited completed-record correction workflow, remaining scheduling UI, copying/attendance and production source adoption are open.

## Approved scheduling follow-up and next gates (2026-10-10)

Corrective 039 preserves unchanged roster sync review and narrows overlap preflight. Corrective 040 implements person-wide approved leave, store-local availability, restricted active time edits, retrospective leave flags, consistent ended-shift errors and expired-draft exclusion. See SCHEDULING_POLICY_CHECKPOINT.md for exact boundaries and validation.

Keep open: original-department staffing warnings; configuration adoption in the original shared UI and production provisioning; case-by-case receipt replay audit with current authorization; prior low-priority audit items; shared-authz identity port; attended/worked-time correction and flag-resolution UI; full scheduling UI and notification delivery. Inventory's merged baseline is undergoing testing and has not been accepted for integration here. Obtain its tested commit before a separate port. PR28/29 are now accepted following separate sequential approvals.

PR28 was accepted on 2026-10-10 at main `0f1aa31`. PR29 incorporated accepted main normally, was separately approved and accepted at `a344421`, with 457/457 post-merge checks and CI passing. Inventory integration still waits for the tested Inventory commit.

## Explicit store configuration preparation (041–043)

Candidate policy definitions now read per-store operational departments and checkout job mappings, with an explicit validated timezone required for new stores. 041 preserves existing candidate mappings once without installing provisioning defaults. Relevant configuration changes advance the workspace revision and invalidate reviewed schedule inputs; role reinterpretation under existing people/history is held for a separate explicit migration. 042–043 additionally guard in-use departments/timezones, canonical primary checkout memberships and portable configuration values. See [configuration checkpoint](STORE_CONFIGURATION_CHECKPOINT.md). Full original UI/service adoption, real provisioning and shared-authz identity remain open.

[Candidate UI configuration adoption](UI_CONFIGURATION_CHECKPOINT.md) prepares mapped station choices, schedule department order/time displays and independent employee checkout forms in a separate dependent draft. Actual candidate components have rendered regressions and dedicated type checking; source hashes guard drift from their shared-form baselines. Original D1/shared forms, remaining scheduling workflows and the Inventory port are still open. PR30 and PR31 are accepted at `1428e84` and `79f3bf9` respectively.

- [ ] **Retire copied UI during shared/PostgreSQL adoption:** fold the configuration changes into the original `app/team/schedule-board.tsx`, `shift-editor.tsx`, `dish-checkouts.tsx` and `app/shared/domain.ts`; test the unified forms; delete the corresponding copied `ui-*` components/projection, `ui-source-baseline.json`, the baseline checker/tests and their build hooks. Keep the gate until that reviewed adoption is complete.

## Weekly publication screen preparation (044)

[Weekly publication UI](WEEKLY_PUBLICATION_UI_CHECKPOINT.md) connects exact selected drafts and closing snapshots, authoritative staffing-gap review, explicit confirmations and in-page retry of uncertain original submissions. Migration 044 adds read-only closing selections and current source-attestation status without granting certification or new writes. This preparation starts from accepted PR31 main `79f3bf9` and remains a separate draft; M06 and full backend cutover stay open.

[Publication review follow-up](PUBLICATION_REVIEW_FOLLOWUP_CHECKPOINT.md) adds corrective 045. M06 remains partial: PR34 was accepted at `e0479d1` with 558/558 merged-main CI tests, addressing scheduling freshness, batched review and reload recovery; PR33 was subsequently accepted at `2d8d3cc` with 587/587 merged-main CI tests. Real source attestation, shared authz, remaining schedule interfaces and Inventory integration remain open.

Publication follow-up 046 separates source-input attestation from draft/publication planning freshness and excludes routine shift release. Real source attestation remains an explicitly authorized ingestion/review workflow; candidate reads/publication cannot certify it. Shared adoption must port the semantic projections and both counters, including person-wide input effects and planning-only booking effects. Every runtime writer/import touching the 17 coordinated input tables must handle `40001` by retrying the whole transaction with unchanged command/receipt identity; never retry just the failing statement or bypass triggers during imports. Table-wide or bulk-import behavior needs separate reconciliation coverage.

## Coverage and named replacement screen preparation

[Coverage/replacement UI](COVERAGE_SWAP_UI_CHECKPOINT.md) adds scoped offer lists, server-captured duties, explicit volunteer/named consent, independent manager approval and a separately confirmed department-change staffing warning. Frozen in-page retries preserve command receipts. Reviewed follow-up 047 adds private server action projections and required/audited department acknowledgement; no new runtime grant is added. PR33 is accepted at `2d8d3cc`; M06, shared-authz identity, notification delivery and the Inventory port remain open. Next preparation slice: dated leadership assignment UI, then other published edits and attendance/correction design.

## Dated leadership screen preparation (048)

[Leadership UI checkpoint](LEADERSHIP_UI_CHECKPOINT.md) adds scoped assignment, edit, revoke and reactivation forms. Corrective 048 supplies eligible leader choices and per-record action flags without exposing coworker capability arrays. Its private target predicate is shared with the unchanged-policy command; self-assignment by eligible publishers remains allowed. Local-time/DST validation, required reasons, exact revisions and frozen original retries protect submissions. PR35 was accepted at `382fa92` with 604/604 merged-main CI tests. The separate [leadership follow-up](LEADERSHIP_FOLLOWUP_CHECKPOINT.md) adds candidate self-assignment awareness and configured checkout-role exclusion in corrective 049. M06, other published-edit UI, attendance/audited correction design, source completeness, shared authz, notification delivery, copied-component retirement and Inventory integration remain open.

## Attendance and completed shift correction design

The [attendance and correction design](ATTENDANCE_CORRECTION_DESIGN.md) preserves existing manager-only attendance entry, correction, voiding and review as the next candidate port. A separate proposed ledger amends ended published shift details while retaining original shifts, completed work and receipts. Correction authority and independent approval are pending policy choices. Retrospective leave flags require explicit review; they never create attendance or prove worked time automatically.

This is a documentation-only branch from accepted PR36 main `1c536d1`. PR37 and dependent PR38 remain unmerged drafts; `c27cca1` and `2106638` identify their original reviewed heads. Follow-up heads and validation are recorded in the PR descriptions. No attendance/correction tables, commands or forms are added here. Reconcile accepted migration order before implementing; M06 stays partial. Shared identity, source completeness, notifications, copied-component retirement and Inventory integration remain open.

Design review follow-up: planned-hours/labor reports use the effective applied correction, never attendance-derived hours. Current employee names resolve at read time; historical snapshots are labelled name at time of entry. Ownership notices follow the shared owner model (owners plus an owner-enabled administrator). Correction authority, independent approval and employee access to their own attendance remain pending owner selections. Published-change/cancellation freshness binds relevant record revisions, so unrelated attendance activity must not invalidate a review. New implementation uses the next free migration after the accepted chain; corrective 052 is reserved for PR38 privacy preparation.
