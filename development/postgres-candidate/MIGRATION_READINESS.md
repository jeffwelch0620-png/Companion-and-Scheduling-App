# Companion PostgreSQL migration readiness

Current summary refreshed for consolidation from Companion checkpoint `545200d` (schedule board and draft editor). The isolated candidate is suitable for a reviewed Git baseline merge and continued development. The complete Companion app is **not ready for PostgreSQL backend cutover**. Inventory integration remains held until its current merge has a tested baseline. No hosted migration or deployment is authorized by this checklist. Historical progress entries below preserve their checkpoint-specific evidence.

The source inventory contains **39 WorkRecord kinds, 35 declared SQLite tables and 28 API route files**. These are scope counts, not a completion percentage. Several services and workflows live outside WorkRecord; one kind can have many commands. Candidate workflow tests do not prove migration of the original D1 service or all screen reads.

The working architecture remains one hosted PostgreSQL/Supabase primary shared by employee and ownership interfaces, with a local recovery/reporting copy to be designed and verified. No unrestricted dual-write mirror is implemented. During outages, employee task/prep submissions are intended to queue for later submission; ordering and stock posting wait. Prep queue support remains an implementation gap, not a completed promise.

Run `node development/postgres-candidate/readiness-inventory.mjs` from the repository root to refresh the inventory. It reads TypeScript syntax without executing application code and checks that every current DataMap kind has exactly one coverage classification. New, removed or duplicate kind classifications require review. The inventory does not verify that a status is correct; status changes require supporting implementation evidence.

## Workflow coverage

| Area | Source kinds | Current candidate coverage | Remaining work |
| --- | --- | --- | --- |
| Employee operations | task, close, handoff | Tested candidate commands, reads, independent checks, receipt/audit/outbox atomicity; task and closing readiness queue; imported closing rehearsal | Original full workspace/service adoption, realistic fixtures, actual notification delivery, production identity |
| Reference inputs | shift, standard, leadership | New shift/standard import with archived source and explicit links; scoped dated leadership assignment/edit/revocation; separate release tested | Real source completeness, existing-reference reconciliation, standard authoring/review and production identity |
| Scheduling | request, availability, coverage, staffing, attendance | Candidate draft/edit, station assignment, availability/time-off review, coverage/swap consent, staffing, individual/weekly publication and published changes; request UI and individual draft/day/week/personal board tested | Remaining publication/coverage/leadership UI, copy/import completeness, attendance, batch editor adoption and production service/identity |
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
| M01 | Reproducible isolated candidate and Git safeguards | Candidate complete: fresh install, versioned hashes, regression/types/build CI; draft PRs remain unmerged |
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

1. Consolidate the tested candidate into a reviewed Companion Git baseline; see `CANDIDATE_MERGE_REVIEW.md`. Git acceptance does not enable the candidate in either running application.
2. Complete remaining scheduling screens and workflows: weekly publication/coverage/leadership/batch editing, copy/attendance and reviewed source ingestion completeness. Existing candidate commands are already tested; preserve timezone/DST, exact approvals and linked-work protections during UI adoption.
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
