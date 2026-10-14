# Reviewed source ingestion and scheduling completeness - design review

Design accepted in PR51 alongside [shared identity/access](SHARED_EMPLOYEE_IDENTITY_ACCESS_DESIGN.md), from PR50 main `ce1d3a7`. Source inspection and existing fictional evidence establish preparation boundaries. No exporter, live connector, import command, migration or completeness certification is added here.

## What exists and what is missing

| Existing source | Evidence and limitation |
| --- | --- |
| [Reference mapping](REFERENCE_MAPPING_CHECKPOINT.md), `reference-mapping.mjs` | Explicit legacy-to-UUID member/shift/standard mapping, source revisions and supported-shape checks. `Shift.data.personId` currently means a membership ID. It is not canonical human identity, an exporter or access review. |
| [Reference import](REFERENCE_IMPORT_CHECKPOINT.md), `reference-import.mjs` | Fictional opted-in atomic new-reference ingestion with retained full source archive, conflict/replay checks. Existing-reference updates and real exports require separate reconciliation. |
| [Schedule reconciliation](SCHEDULE_RECONCILIATION_CHECKPOINT.md), `schedule-reconciliation.mjs` | Fictional complete roster/job/time-off proposal and exact target reconciliation with an evidence-linked review gate. Current target members must already match; no people, login or authority provisioning. A caller's completeness boolean is not proof of a complete source export. |
| Original `app/shared/toast-roster.ts`, `hotschedules-import.ts` and schedule-transfer code | Roster data and name-based schedule CSV representations exist. They require explicit provider/store mapping, complete pagination and current review; a display name cannot identify a canonical person. No live provider fetch is performed here. |
| Candidate 039 / 045 / 046 and current snapshot | Relevant roster changes invalidate input review, semantic no-ops preserve it, and source input/schedule planning revisions are separate. Preserve those contracts when importing. |

The initial implementation recommendation is a bounded reviewed file/snapshot path with fictional or deliberately authorized sanitized fixtures. Direct scheduled Toast/HotSchedules synchronization comes later. Current app databases/fixtures and Inventory's source schema must not be mistaken for a complete production employee export. There is no need to copy unused historical tables to make an empty Companion deployment compatible, but existing Inventory facts and actors must be preserved.

## Source ownership and conflict rules

| Data | Authority and import rule |
| --- | --- |
| Person identity and login binding | Shared verified person repository and a separate identity review. Provider IDs/names/email are matching aids only; unresolved identity blocks affected review. No automatic merge, login invitation or account rebind. |
| Membership/employment and access | Shared approved membership and access workflows. External roster may propose employment/job changes; it cannot activate sign-in, grant capabilities, owner/admin status or access to another store. |
| Jobs and department | Provider/store-specific reviewed mappings to configured canonical keys. Different labels or reused external job IDs do not justify global mapping. Proposed eligibility must preserve already-booked work or route conflicts to explicit resolution. |
| Qualifications / station clearances | Reviewed source and provenance appropriate to that evidence. A Toast job or shift assignment is not training completion. Existing fictional eligibility import does not certify the entire training workflow. |
| Time off | Approved canonical leave applies person-wide across stores, as already selected. Preserve source provenance, exact dates/status/revision and minimum cross-store facts. Imported approval requires reviewed authority/provenance; it is not a forged employee submission or new manager decision. |
| Availability | Store-specific, as already selected. Include exact periods, state, source timezone and review provenance. Proposed new ingestion needs its own handling of existing target requests. |
| Shifts and standards | One declared source owner per field/scope, explicit IDs and links. Draft/published/cancelled/released state and station/standard revision are retained. Existing published/linked/completed records require reconciliation, not replacement or hidden deletion. |
| Inventory facts | Inventory's canonical catalog, quantities, stock/accounting and food commands. This ingestion slice must not write a second catalog, infer stock from tasks or convert attendance to labor hours. |

If both a provider and the shared application can change the same field, define its owner and conflict policy before enabling synchronization. An import cannot overwrite a newer application change using an old export merely because the source has a newer timestamp. Cross-store mapping uses the selected multi-store membership model while still resolving a single human.

## Proposed complete snapshot envelope

The exact serialized format is implementation work. Review the following required evidence before defining a parser or digest:

- Envelope version, batch/request UUID, source system and tenant/provider namespace, organization, explicit canonical store mapping and purpose (roster/jobs, leave, availability, shifts or standards).
- Capture/export time, explicit timezone and date window for date-bound records, source schema/version, normalized semantic digest plus original file/content hash, and the source cursor/watermark or export identifier.
- An enumeration manifest: which entity families, statuses, departments, stores and dates are included, plus complete pagination/end markers, source counts and omissions/errors. It must include inactive/schedule-only roster records where that scope requires them. Explicitly reviewed empty coverage is valid; an absent file/list is not empty coverage.
- Per-record source ID, revision or content fingerprint when the provider lacks a reliable revision, source status, exact canonical target mapping and expected target revision. Do not manufacture a source revision from page position, capture time or human name.
- Mapping revisions, relevant person/membership/job revisions and an expected input revision for each affected store; selected/dependent target keys for record reconciliation. These are separate from the source's revision and global workspace counter.
- Source authority/provenance for approved states and standard guides, criteria, revision, issuer and reviewed links; archive unsupported details rather than silently stripping them and claiming full migration.
- Reviewing actor's verified person/session/scope, explicit acknowledgement, reason and the exact reviewed envelope/digest. Secrets, provider tokens, passwords, PIN hashes and credential exports must be excluded from the archive and public repository.

Provider pagination can return internally inconsistent pages. A completed cursor sequence alone does not prove a single snapshot. Use the provider's consistency/version mechanism if available; otherwise reread/reconcile relevant source versions and present the limitation for review. A transport error, truncated CSV, missing department, duplicate external key or mixed watermark leaves coverage incomplete. Never promote an incomplete file to a complete reconciliation just to open scheduling.

## Review and application

1. Capture the intended source scope without changing the canonical store. Preserve original IDs/content and a sanitized provenance record under restricted storage. Real employee exports are not repository fixtures.
2. Validate envelope, mappings, counts, scope coverage, timezones/DST and supported types. Classify every row as new, unchanged, changed, omitted, unsupported or conflicting. Same name, email or title is not an identity mapping.
3. Review person/store/job mappings separately. Proposed new identities/memberships go through the approved identity workflow, leaving sign-in/grants unprovisioned until their independent access review. Link the resulting mapping revision back to this import review.
4. Compare exact target source keys/revisions and relevant store input context. Retain current records, source links and history. Omission from a roster is a review finding, not an automatic termination/deletion. Changed departments, jobs, active/schedule-only state or person binding must assess current shifts, station eligibility, person-wide leave/bookings and responsibilities.
5. Present a bounded complete plan and issue summary. The initial recommendation is all-or-nothing per declared completeness scope: a failure leaves that scope's evidence gate incomplete, with no partial writes advertised as complete. This is distinct from the owner's partial-save policy for schedule copy/batch commands.
6. Bind the review to a recomputed digest of exact normalized source content, mappings, selected/dependent target revisions, source coverage and affected-store input context. No signing secret or stored review token is necessary. Receipt persistence is for application/replay, not making stale reviews valid. Time thresholds and relevant authority/context changes require a new review.
7. In one authorized SQL transaction, acquire complete sorted coordination scopes using the shared access design, recheck current actor authority and relevant versions, then check the immutable batch receipt. An identical replay returns its historical outcome after current authorization; changed content under the same ID conflicts. Replay must not restore completeness that later writes invalidated.
8. Apply the accepted reference/eligibility reconciliation; append source/mapping/decision audit and the full result receipt; capture final target evidence; update completeness only when the entire declared scope is proven. Conflicts, late audit/outbox failure and any 40001 roll back all application effects. Preserve both input and planning revision semantics; unchanged nightly-style imports do not unnecessarily close scheduling.
9. Commit before delivery/external effects. A lost acknowledgement retains the same batch ID and allows status/replay. Retry 40001 as a whole transaction with bounded backoff. Do not repeat the provider fetch or send invitations inside the retryable SQL callback.

The new shared importer must use explicit current function definitions and parity checks. Older fixture modules are evidence, not a wholesale shared-schema import adapter. In particular, migration 024's original roster/time-off shape is insufficient for current person-wide leave, configured departments and managed-provider sessions without reviewed changes.

## Completeness and revision fences

Keep coverage evidence by canonical store, entity family, reviewed time window and immutable applied batch. A roster-complete declaration and a leave-complete declaration answer different questions; publication must require the applicable evidence for its week, including person-wide leave from other approved memberships. Restrict cross-store review to minimal approved leave facts and authorized conflict summaries, not other stores' employee details.

The current candidate has a store-wide input-review gate. The first shared adapter must preserve that conservative coverage or explicitly introduce windowed gates with command/read parity tests. Do not silently claim per-week completeness from a store boolean, or replace the existing gate with a source timestamp. Store-wide invalidation is acceptable until narrower evidence and all consumers are reviewed.

Relevant membership, identity binding, job, leave and availability changes stale the appropriate input evidence and review digest. Shift planning changes advance schedule revision; input changes advance the input and planning counters as currently tested. Attendance, task-ready, dish checkout and goal practice must not become unrelated source-review conflicts. Access fences are checked separately; global workspace revision remains metadata, not an all-purpose gate.

A new mapping to a different person can change conflicts in every associated store. Lock/review all affected scopes and check existing bookings before applying. No automatic person merge, historical actor reassignment or cascading deletion is in this import design. Leave withdrawal, missing leave and resolution reopening need their separately selected cancellation/audit policy; they cannot be inferred from source absence.

## Decisions before importer implementation

| ID | Decision | Current recommendation / status |
| --- | --- | --- |
| S01 | First source and format, plus who may certify completeness | Reviewed snapshot files first **selected by owner after PR51 acceptance**. Live connectors follow later. Who may certify completeness/import and their explicit capabilities remain **pending owner selection**; no `location.manage` shortcut. |
| S02 | Field ownership and how external changes reconcile newer canonical edits | Canonical identity/access always shared; jobs/leave/availability/shift ownership explicitly assigned per source/scope. **Pending source selection and owner review.** |
| S03 | Import failure semantics | Atomic per declared completeness scope **selected by owner after PR51 acceptance**. No partial completeness; bounded parts join only after every part is verified. Schedule copy/batch partial saves remain selected. |
| S04 | Missing/inactive source employee, withdrawn leave or removed job | Show a review finding; no automatic archive, deletion, consent or leave cancellation. **Pending detailed reconciliation policy.** |
| S05 | Source coverage bounds, file size/row limits, retention and reviewer visibility | Specify from actual authorized source exports and platform limits, not arbitrary implementation defaults. **Pending real sanitized fixture and owner review.** |

No live export is needed to accept this design. A real importer, however, cannot be accepted solely with synthetic completeness booleans. Choose a source, obtain a deliberately authorized sanitized representative export and document its coverage guarantees first.

## Required acceptance scenarios

| Scenario | Required outcome |
| --- | --- |
| Same human has two store memberships; same provider ID appears in different source tenants/stores | Explicit namespaces map correctly; grants and store reads stay scoped; person-wide overlap/approved leave remains enforced. |
| Two employees share a name/email; an unknown legacy member or repeated CSV name appears | No automatic account merge; unresolved rows block the declared completeness scope. |
| Roster snapshot repeats unchanged values, including nightly full writes | No membership/eligibility semantic change, no needless input-review invalidation, stable replay outcome. |
| Source is empty with verified complete coverage versus absent/truncated/failed source | Only the explicitly reviewed complete empty set is admissible; incomplete evidence keeps publication held. |
| Provider pages change watermark, omit inactive rows or change after review | Refuse/review again; no partial target application or false coverage claim. |
| Approved leave at another store affects an existing shift | Person-wide guard and minimal privacy projection; affected store coordination and retry leave no partial flags/receipts. |
| Changed person/job/department/active state affects current or linked work | Refuse implicit reassignment/deletion; expose authorized resolution obligations and keep original records/history. |
| Target, mapping, grant or relevant input version changes after review | Reject before new effects; revoked actors cannot retrieve private results by replay. |
| Unrelated task/dish/attendance work occurs between review and application | Relevant digests/counters remain valid; no global-workspace conflict substituted for source freshness. |
| Identical concurrent batch, changed payload under the same ID, late failure or lost response | One complete result; changed-payload conflict; complete rollback on failure; original-batch status/replay on uncertainty. |
| An import includes a title, owner flag, role template, PIN or source approval with unknown provenance | No capability/login grant and no credential archive; reject unsupported authority evidence. |
| Legacy actor is a shared PIN/name rather than verified person | Preserve its original attribution label and verification state; do not backfill a guessed human or change Inventory financial facts. |

## Delivery sequence and holds

First review this contract and the shared identity decisions. Next implement a read-only normalized mapping/coverage preview using fictional snapshots and one representative authorized sanitized format; it changes neither access nor scheduling completeness. Then add the separately reviewed coordinated application path and evidence gates, followed by real-source connector automation only when its source guarantees, scope and secrets are configured.

Repository docs/fictional tests, real source ingestion, shared database application and Inventory integration are distinct milestones. No current source archive, retired table, person record or migration receipt is deleted by this design.

## First read-only implementation

The owner authorized the [normalized-file mapping preview](SOURCE_MAPPING_PREVIEW_CHECKPOINT.md). Version 1 supports bounded roster/job and time-off snapshots, explicit UUID aliases, supplied target revisions and internally checked coverage declarations. It never certifies completeness or supplies an application command. A sanitized representative real export/normalizer, current authorized target reader, remaining source policies and coordinated application remain separate.
