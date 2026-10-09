# Companion PostgreSQL migration readiness

Reviewed against Companion source at `f6440f6` (imported-closing checkpoint). The isolated candidate is suitable for continued development and review. The complete Companion app is **not ready for PostgreSQL backend cutover**. Inventory integration remains held until its current merge has a tested baseline. No hosted migration or deployment is authorized by this checklist.

The source inventory contains **39 WorkRecord kinds, 35 declared SQLite tables and 28 API route files**. These are scope counts, not a completion percentage. Several services and workflows live outside WorkRecord; one kind can have many commands. Candidate workflow tests do not prove migration of the original D1 service or all screen reads.

The working architecture remains one hosted PostgreSQL/Supabase primary shared by employee and ownership interfaces, with a local recovery/reporting copy to be designed and verified. No unrestricted dual-write mirror is implemented. During outages, employee task/prep submissions are intended to queue for later submission; ordering and stock posting wait. Prep queue support remains an implementation gap, not a completed promise.

Run `node development/postgres-candidate/readiness-inventory.mjs` from the repository root to refresh the inventory. It reads TypeScript syntax without executing application code and checks that every current DataMap kind has exactly one coverage classification. New, removed or duplicate kind classifications require review. The inventory does not verify that a status is correct; status changes require supporting implementation evidence.

## Workflow coverage

| Area | Source kinds | Current candidate coverage | Remaining work |
| --- | --- | --- | --- |
| Employee operations | task, close, handoff | Tested candidate commands, reads, independent checks, receipt/audit/outbox atomicity; task and closing readiness queue; imported closing rehearsal | Original full workspace/service adoption, realistic fixtures, actual notification delivery, production identity |
| Reference inputs | shift, standard, leadership | New shift/standard import with archived source and explicit links; leadership references are fictional setup only; separate release is tested | Full schedule and standard authoring/review, leadership ingestion/authorization, updates to existing references |
| Scheduling | request, availability, coverage, staffing, attendance | Not migrated | Requests/swaps, availability, coverage volunteering, staffing, attendance review, week copy/publish/import parity |
| Training | development, goal, station, proficiency, achievement, learningcase | Not migrated; manual candidate clearances are not the source training workflow | Assessment, discussion/approval, source/version evidence, station setup, clearance derivation, achievements and learning history |
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
| M06 | Full scheduling and leadership service | Open: source command/read inventory, schedule-only rules, imports, edits, publication, conflicts, DST and linked-work guards |
| M07 | Standards and training workflows | Open: preserve approval, provenance/guide/history, version replacement, independent reviewers and evidence-based clearances |
| M08 | Remaining workspace workflows and services | Open: migrate or explicitly defer each area without silently dropping visible records or commands |
| M09 | Inventory food/prep/order contracts | Held for tested Inventory baseline: canonical catalog/unit/recipe IDs, writer ownership, reporting and audit contracts |
| M10 | Production offline and device behavior | Open: identity/cache retention, shared-tablet logout cleanup, eviction/recovery, conflict resolution, queue age, phone/tablet checks and prep queue |
| M11 | Hosted platform and recovery | Open: Supabase identity/RLS plus backend enforcement, secrets, delivery worker, backup/restore rehearsal, local recovery/reporting copy and observation |
| M12 | Integration and rollout | Held: exact Inventory baseline, reviewed cross-repository port, shared migration ownership/manifest, full workflow acceptance and explicit rollout decision |

No production data currently needs preservation. Empty-database development permits schema changes, but it does not remove workflow and authorization requirements. Historical source-data import should be added only where needed for fixtures or a later real source; copying unused legacy tables is not a prerequisite for compatibility.

## Implementation order

1. Inventory the scheduling commands and reads, then define a PostgreSQL schedule read contract against existing forms. Preserve schedule-only employees and job eligibility without treating them as sign-in permission or training clearance. This is the next independent candidate step; shared identity decisions remain explicit open items.
2. Implement scheduling writes in focused slices: draft/edit and availability, request/coverage workflows, then publish/copy/import. Test timezone/DST, stale revisions, exact approval rules and protection of work already linked to a shift.
3. Replace fictional leadership/clearance setup with reviewed standard/training and employee-access workflows. Keep sign-in provisioning and scheduling eligibility separate.
4. Reconcile complete workspace/history and supporting modules. Keep each module enabled only after its PostgreSQL read/write/visibility path is complete; any staged deferral must be explicit to the user before cutover.
5. Once Inventory is ready, reconcile canonical food/prep/order contracts and schema ownership. Implement employee prep submission and offline delivery with Inventory remaining the owner of stock/order posting.
6. Validate actual hosted authentication, device behavior, notification delivery and restore/recovery. Then review the integration branch and rollout checklist. Git merge, database application and deployment are distinct decisions.

## Evidence and limits

The previous imported-closing checkpoint passed 196 candidate checks, fresh application of all 18 migrations, strict adapter type validation, original-form preview build and both GitHub validation runs. This readiness review adds source inspection and classification checking; it does not add runtime coverage to the remaining modules. Earlier browser outage evidence remains limited to the fictional preview documented in `CHECKOUT_OFFLINE_UI_CHECKPOINT.md`.

The new inventory check passed against the current source, all 18 migration hashes verified unchanged, and local strict adapter types/preview build passed. CI now runs the classification drift check before its existing fresh-database/regression sequence.

Subsequent progress: [migration 019 and schedule shift reads](SCHEDULE_READ_CHECKPOINT.md) implement a paged shift-reference endpoint with source visibility parity. M06 remains open for roster/job eligibility, availability, remaining scheduling reads and all schedule writes. The preceding inventory/check counts describe this readiness review's baseline, not the later scheduling checkpoint.
