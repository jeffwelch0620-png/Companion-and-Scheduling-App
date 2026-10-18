# Isolated PostgreSQL migration candidate

Tracked source for review and preparation. The running Companion still uses its existing backend; Inventory and hosted Supabase are unchanged. This is a fictional development candidate, not a production migration bundle. Use this directory for new candidate changes; the earlier ignored `work/postgres-candidate` copy is retained only as historical local evidence.

## Reproduce checks

Requirements: Node.js 24+, npm, a disposable PostgreSQL 17 server bound to loopback, and `psql` on PATH. Install root dependencies and the isolated candidate dependencies:

```sh
npm ci --ignore-scripts
npm ci --prefix development/postgres-candidate --ignore-scripts
```

Set these environment variables in your shell:

| Variable | Value |
| --- | --- |
| CANDIDATE_PG_PORT | 55461 by default; your loopback PostgreSQL port |
| CANDIDATE_TEST_DATABASE | A new name starting `companion_candidate_`, such as `companion_candidate_review1` |
| CANDIDATE_BOOTSTRAP_USER | Local test superuser, normally `postgres` |
| CANDIDATE_ALLOW_BOOTSTRAP | `fictional-local-only` |
| CANDIDATE_PSQL | Optional absolute path to `psql` if absent from PATH |

Only use an isolated disposable server with local trust authentication for these fictional tests. Test roles are fixed: schema owner, restricted runtime and privileged test setup role. Bootstrap creates roles if absent and refuses an existing database; it does not delete or reset databases. Choose a new database name for another complete validation. No passwords or production connection strings belong in the repository.

```sh
npm run bootstrap --prefix development/postgres-candidate
npm run schema:check --prefix development/postgres-candidate
npm test --prefix development/postgres-candidate
npm run check:types --prefix development/postgres-candidate
npm run build:preview --prefix development/postgres-candidate
```

Bootstrap verifies the versioned hash manifest and applies 001–063 in order, inserts fictional base actors after 001 so later capability conversion can run, and creates fictional sessions after migration. Migration 037 requires PostgreSQL's trusted btree_gist extension for person booking exclusion. All candidate connection helpers use the selected database/port. Tests run serially because rollback checks create temporary failure triggers. The core concurrency tests use independent Node/PostgreSQL bridge processes; Python and machine-specific library paths are no longer required.

The GitHub `candidate-validation` gate performs this sequence when candidate dependencies change, and reports a successful intentional skip for unrelated changes. Its dependency detection includes application, database, package/configuration, shared UI and build inputs. Validation uses a fresh disposable PostgreSQL service. Passing candidate checks does not prove the complete application is migrated or deployed.

## Optional original-form preview

The scheduling and checkout previews use isolated configuration-aware candidate derivatives. See [UI configuration checkpoint](UI_CONFIGURATION_CHECKPOINT.md) for scope, source drift checks and remaining shared-form work. Other previews retain their original forms. Custom fictional store mappings do not provision real stores.

After bootstrap and preview build, run:

```sh
npm run preview:seed --prefix development/postgres-candidate
npm run preview:serve --prefix development/postgres-candidate
```

Open `http://127.0.0.1:6610/schedule-forms`, `/checkout-forms`, `/overnight-forms` or `/forms` locally. The scheduling screen covers day/week/personal reads, individual drafts, availability/time-off requests, reviewed weekly publication and coverage/named replacement consent with independent approval. Dated leadership assignment/edit/revocation and reactivation are included. Published shift edits, protected reason-only changes and explicit covering-shift cancellation are included. See [closing-transfer review](CLOSING_TRANSFER_UI_CHECKPOINT.md). Private manager attendance forms/history are included in the dependent [attendance UI preparation](ATTENDANCE_UI_CHECKPOINT.md). Private completed-shift correction forms are accepted in PR43; retrospective leave-review forms are accepted in PR44, and bounded copy/batch forms are draft preparation. Run seed once per fresh database; it refuses the existing fictional scheduling restaurant. The server binds only to loopback and issues short-lived, locally signed fictional tokens. Never deploy this fixture-token server. Stop it with Ctrl+C. Runtime fixture JSON, generated reference modules and preview build output stay ignored. Run browser checks after regression tests to avoid competing fictional business dates.

## Completed planned-shift correction preparation

The accepted [correction backend checkpoint](COMPLETED_SHIFT_CORRECTION_CHECKPOINT.md) and [correction UI checkpoint](CORRECTION_UI_CHECKPOINT.md) preserve ended sources while providing explicit correction permission, effective planned summaries, own-person independent approval and atomic ownership notices. PR42/43 are accepted through main `3022ff6`, with 766/766 merged-main CI tests and published migrations 001–057. The private fictional ownership bridge must be replaced before shared adoption; notification delivery remains separate. [Retrospective leave review](RETROSPECTIVE_TIME_OFF_CHECKPOINT.md) is accepted in PR44 at `2ff7c27` with 791/791 merged-main CI tests, including corrective 058 and private forms. It does not adopt the active backend or Inventory.

## Scope and evidence

See [migration readiness and remaining workflow coverage](MIGRATION_READINESS.md) for the current checklist and implementation order. The source inventory/classification check runs with `node development/postgres-candidate/readiness-inventory.mjs` from the repository root. Tested candidate slices do not establish whole-app PostgreSQL readiness.

The [attendance and completed shift correction design](ATTENDANCE_CORRECTION_DESIGN.md) records the accepted manager workflow and historical correction policy; correction authority includes GM/ownership and explicitly designated department managers; independent approval is required only for the author's own shift. The owner selected manager-only attendance visibility initially. The design is a policy reference; separate accepted candidate checkpoints implement attendance backend/forms and completed-shift corrections. Retrospective flag review is accepted in PR44 with corrective 058.

Historical checkpoint descriptions below record the scope and outstanding items at their original checkpoint. Use the current readiness checklist and accepted-baseline note for today's remaining work.

The [schedule shift read checkpoint](SCHEDULE_READ_CHECKPOINT.md) adds paged reference reads with original shift visibility parity. [Roster/job eligibility and availability references](SCHEDULE_CONTEXT_CHECKPOINT.md) add the next scoped read slice. Production ingestion, complete schedule workspace adoption and remaining scheduling writes are pending.

[Availability save and independent review](AVAILABILITY_COMMAND_CHECKPOINT.md) implement the first scheduling command slice with revision checks, conflict detection, history and atomic notification intents. Schedule draft/edit commands remain next.

The [employee, schedule and standard mapping review](REFERENCE_MAPPING_CHECKPOINT.md) adds a read-only validator for explicit source-to-candidate IDs and revisions. The [transactional fictional import](REFERENCE_IMPORT_CHECKPOINT.md) adds target conflicts, complete source archiving, atomic new-reference writes and retry receipts in the candidate only. [Explicit shift-standard links and the imported closing rehearsal](IMPORTED_CLOSING_CHECKPOINT.md) verify a closing through signed sessions, the original form-command adapter and PostgreSQL while preserving independent checks and separate release. Production identity/access decisions, existing-reference reconciliation and authorized ingestion remain pending.

Candidate workflows cover ordinary tasks, issues/reassignment, station handoffs, linked shift work, closing assignments/checks/correction help, separate checkout release, Dishwasher cycles/acceptance and overnight responsibility. [Employee checkout queue support](CHECKOUT_OFFLINE_CHECKPOINT.md) adds tested closing and Dishwasher readiness delivery. The [offline screen checkpoint](CHECKOUT_OFFLINE_UI_CHECKPOINT.md) records actual browser outage/reload/reconnect checks in the isolated preview, using cached shell/assignments and pending status. Incoming acceptance, manager checks, shift release, overnight responsibility commands and actual notification delivery remain outside this offline slice. Production identity/cache policy and application cutover remain pending.

Historical checkpoint documents were copied from the local preparation work. Their test counts and browser observations describe those checkpoints, not a fresh GitHub run. Runtime evidence referenced by them remains local and is excluded from Git. The latest historical workflow checkpoint is [Closing and Dishwasher UI](CHECKOUT_UI_CHECKPOINT.md). Production employee/schedule ingestion, remaining Companion modules, real hosted authentication, Inventory contracts and deployment remain pending.

Follow [the repository Git workflow](../../docs/GIT_WORKFLOW.md). Shared migration files are versioned; add corrective migrations after publication instead of editing shared/applied history. Final adoption into Inventory requires one canonical deployment manifest and a reviewed integration branch from its tested baseline.

[Schedule draft checkpoint](SCHEDULE_DRAFT_CHECKPOINT.md) adds station-free draft create/edit with job, scope, overlap, approved availability and time-off checks. A fixture-only time-off completeness gate blocks unreviewed inputs. Time-off request workflows, station assignment, publication and full schedule UI adoption remain pending.

[Time-off checkpoint](TIME_OFF_CHECKPOINT.md) adds employee requests, independent manager review, scoped reads and atomic cancellation of exactly reviewed unlinked candidate drafts. Published/linked shift cancellation and source completeness reconciliation remain pending.

[Schedule reconciliation checkpoint](SCHEDULE_RECONCILIATION_CHECKPOINT.md) adds complete roster/job/time-off review and atomic fictional application with archived evidence and invalidation on administrative changes. Live export completeness, production ingestion, station workflows and publication remain pending.

[Station scheduling checkpoint](STATION_SCHEDULING_CHECKPOINT.md) adds scoped scheduling references and station-aware drafts with job/member/Dish checks. Station configuration, guide/goals/reviewer workflows, publication and training/UI adoption remain pending.

[Station setup checkpoint](STATION_SETUP_CHECKPOINT.md) adds scoped definition/setup editing with scale, threshold, guide, goal and reviewer validation. Employee learning goal issuance/review, proficiency assessment, source ingestion and publication remain pending.

[Employee goals checkpoint](EMPLOYEE_GOALS_CHECKPOINT.md) adds manual development goals and required corrections with employee practice, named independent reviewer outcomes, scoped reads and atomic notification intents. Automatic job learning and published-station issuance remain pending; no clearance is granted by goal completion.

[Individual publication checkpoint](SCHEDULE_PUBLICATION_CHECKPOINT.md) adds reviewed unlinked draft publication and durable station learning-goal proposals. Full staffing/closing review, weekly batch publication and production evidence application remain held; fictional tests cannot certify a real source export.

[Staffing and closing publication review](PUBLICATION_REVIEW_CHECKPOINT.md) adds draft/approve/retire staffing workflows, current publication blockers and valid closing publication with aligned shift revisions. Weekly staffing-gap review/batch publication and production source certification remain pending.

[Weekly review and publication](WEEKLY_PUBLICATION_CHECKPOINT.md) adds selected-draft staffing gaps, current review tokens, exact closing selections and atomic batch publication with explicit remaining-gap plans. Complete source evidence, published-shift changes and weekly UI adoption remain pending.

[Published schedule changes](PUBLISHED_SCHEDULE_CHECKPOINT.md) add scoped edits/cancellation, exact closing transfer selections, reset submission state and atomic audit/notification intents. Coverage consent/swaps, full scheduling UI adoption and production source reconciliation remain pending.

[Coverage and swap consent](SCHEDULE_CONSENT_CHECKPOINT.md) add explicit volunteering/acceptance, independent approval, current duty snapshots, atomic invalidation and private scoped reads. Existing time-off commands remain separate. Scheduling UI adoption, dated leadership writes, source reconciliation and notification delivery remain pending.

[Dated leadership](LEADERSHIP_CHECKPOINT.md) adds publisher-controlled assignment/edit/revocation, current capability checks and source-scoped reads with stable UTC timestamps. Assignment grants no membership permissions. Scheduling UI adoption, copying/attendance, source ingestion and notification delivery remain pending.

[Scheduling request UI](SCHEDULE_REQUEST_UI_CHECKPOINT.md) connects existing availability/time-off forms and independent review to scoped candidate data with current viewer permissions, complete pagination and in-memory uncertain-delivery retries. Full schedule-board adoption and durable scheduling recovery remain pending.

[Schedule board and draft editor](SCHEDULE_BOARD_UI_CHECKPOINT.md) add day/week/personal views and individual station-aware draft create/edit. [Candidate merge review](CANDIDATE_MERGE_REVIEW.md) records the controlled baseline consolidation gate; this is separate from Inventory integration or backend adoption.

[Consolidation baseline review](CONSOLIDATION_REVIEW_CHECKPOINT.md) records the snapshot/base, isolated scope review, fresh validation and remaining Companion Git merge versus Inventory integration gates.

[Database coordination](DATABASE_COORDINATION_CHECKPOINT.md) separates private Companion write locks from shared location records and adds snapshot-based, non-locking reads. The accepted preparation baseline is PR 25 at `4a15a70`; this corrective checkpoint is developed on `codex/companion-database-coordination`, separate from Inventory and hosted adoption.

[Authentication and offline recovery](AUTH_OFFLINE_RECOVERY_CHECKPOINT.md) distinguishes login-required sessions, denied permissions and temporary services, and adds explicit retained-intent retry/discard and employee device-data cleanup to the isolated previews. PR26 and PR27 are accepted on main at `2193afc`, with 426 post-merge candidate checks passing. Production sign-in/out and shared-device policy, food prep queues and Inventory integration remain open. Set `CANDIDATE_PREVIEW_PORT` for a separate loopback preview; it defaults to 6610.

[Person scheduling and roster review safeguards](SCHEDULING_SAFEGUARDS_CHECKPOINT.md) adds migration 037's private cross-location person booking exclusion and coverage eligibility check, plus expanded regression coverage of the existing whole-store membership/eligibility invalidation contract. PR28 was accepted by squash merge at `0f1aa31` from reviewed head `72214f2`, with 439 checks and CI passing. PR29 was subsequently approved and accepted at `a344421`, with 457/457 post-merge checks and CI passing.

[Confirmed scheduling policies](SCHEDULING_POLICY_CHECKPOINT.md) preserves eligible publisher self-assignment, manager edits of active shifts with reasons and manager-approved department-changing swaps. The dependent package adds migration 038's cutoff and corrective 040's person-wide leave, active-time limits, retrospective review flags and expired-draft exclusion. PR29 is accepted on main at `a344421`, with 457/457 post-merge checks and CI passing. Production corrections to ended records and remaining UI adoption stay open.

[Explicit store configuration](STORE_CONFIGURATION_CHECKPOINT.md) adds corrective 041 and follow-ups 042–043: required store timezone and operational mappings, configuration-driven candidate policy helpers, guarded provisioning changes and scoped configuration in scheduling reads. Department removal and timezone changes require explicit reconciliation when records depend on them; checkout memberships use the exact primary title. Reviewed timezone and whitespace contracts are shared with the candidate UI. Existing published migrations remain unchanged. Original D1 services and shared forms still need explicit configuration adoption during the reviewed backend/UI port.

PR30 store configuration and corrective safeguards (041–043) were separately approved and accepted at main `1428e84`, from reviewed head `56cd02b` with 496/496 exact-head CI cases passing. PR31 configuration-aware UI preparation was separately approved and accepted at `79f3bf9`, with 519/519 merged-main CI checks passing. See [the UI configuration checkpoint](UI_CONFIGURATION_CHECKPOINT.md) for refresh validation and remaining adoption work.

[Weekly publication UI preparation](WEEKLY_PUBLICATION_UI_CHECKPOINT.md) adds selected-draft review, server-calculated staffing gaps, exact closing selections and online publication recovery. The current branch adds read support in 044; real source certification, shared UI adoption and production integration remain separate.

[Publication review follow-up](PUBLICATION_REVIEW_FOLLOWUP_CHECKPOINT.md) records accepted PR32, scheduling-scoped freshness, a bounded batched read, minimized standard metadata and a tab-scoped uncertain-publication warning. This corrective package remains separate from coverage UI approval, shared identity and hosted adoption.

[Coverage and named replacement UI](COVERAGE_SWAP_UI_CHECKPOINT.md) connects scoped offers, captured duties, explicit consent, independent approval and department-change review. PR33 has normally incorporated accepted PR34 main `e0479d1` and remains a draft for separate approval.

[Published shift UI preparation](PUBLISHED_SHIFT_UI_CHECKPOINT.md) connects existing published edits and protected cancellation to server-projected controls, required reasons, before/after review and frozen receipt retries. PR36 is accepted at `1c536d1` with 614/614 merged-main CI tests. The new slice remains a draft with separate merge approval; hosted application and Inventory integration remain open.

Current accepted candidate main is PR60 main `33fc059`, from amended V3 comparison head `067a202`, with 1040/1040 [exact-head CI tests](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/38995739373). Published migrations 001–063 are immutable. Copy/batch backends, bounded forms, read-only source preview, normalization/target-read design and preview carry-overs are accepted isolated preparation. The candidate is not enabled in either running app. Shared identity, source completeness, copied-component retirement, notification delivery, notice-recipient correction access and the tested Inventory baseline remain open.

The accepted copy backend exposes POST `/api/operations/<store>/copy-review` and `shift.copy-week` through the authenticated candidate command endpoint. Reviews are bounded and partial outcomes use one replayable receipt. Copy form preparation is accepted in PR49 and exposed only in the isolated fictional preview. Source completeness, shared identity and deployment remain separate.

The accepted PR48 batch backend exposes authenticated POST `/api/operations/<store>/batch-review` and `shift.save-batch`. Its reviewed 1–100 future draft selection uses server-resolved `startLocal`/`endLocal`, partial results and dependency rejection propagation; original IDs, retained stations, audit history and immediate person-booking exclusion are preserved. Backend acceptance did not enable forms; separately accepted PR49 now provides them in the fictional candidate preview. Active backend adoption remains separate. See [the checkpoint](SCHEDULE_BATCH_BACKEND_CHECKPOINT.md) for scope and validation.

## Bounded copying and batch draft forms

PR48 backend preparation is accepted at `c1b6ec9` with 851/851 merged-main CI tests and published 001–062. The accepted [copy/batch form checkpoint](COPY_BATCH_UI_CHECKPOINT.md) documents the isolated slice: use the fictional scheduling preview’s Copy schedule week or Edit draft group controls as an authorized scheduling manager. These new forms use server reviews and complete partial receipts; they never invoke the active original copy/batch implementation or its all-or-nothing/closing-copy rules. Copy/batch form preparation was owner-approved and accepted in PR49 at `fbcc15f`; shared adoption remains separate. Both baseline gates run during test preparation and preview builds. PR49 review follow-up adds corrective 063 for indexed date/status and actor/request-scoped staffing reads, inputRevision fencing and missing-source refresh. Published 001–062 remain unchanged. Hosted application and Inventory adoption remain separate.

## Shared employee identity/access and source ingestion design

PR51 accepted the [identity/access design](SHARED_EMPLOYEE_IDENTITY_ACCESS_DESIGN.md) and [source-ingestion design](SOURCE_INGESTION_DESIGN.md) at `1323c9e`, with 884/884 [merged-main CI tests](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/38503508302). They record owner-selected organization-wide ownership/admin control, approved multi-store membership and personal-sign-in-first policies; distinguish legacy identity models and source completeness; and list choices required before implementation. No shared accounts, real source import, hosted services or Inventory integration are enabled.

## Read-only source mapping preview

PR52's [preview checkpoint](SOURCE_MAPPING_PREVIEW_CHECKPOINT.md) is accepted at `65f23e6` with 905/905 merged-main CI. Run the candidate-only normalized-file CLI: `npm run source:preview --prefix development/postgres-candidate -- source-preview.example.json`. The example is fictional, including one person at two stores; it should report two new and one unchanged record. All reports have `canApply:false`, `completenessCertified:false` and `accessProvisioned:false`. No database connection, app route, live provider fetch or application command is added.

## Source normalization and authorized target reads (accepted PR53 design)

The accepted [adapter contract](SOURCE_NORMALIZATION_TARGET_READ_DESIGN.md) documents raw-format/coverage evidence, source fingerprint versioning, private minimal target reads and consistent input/access fences. The owner selected owners/enabled admin plus explicitly designated store reviewers, and explicit reconciliation of missing source records while retaining current targets. This grants no capability and implements no adapter or read route. A representative authorized sanitized export and remaining source/identity policies are still needed. PR53 was separately approved and accepted at `aa9557b`.

PR53 review specifies a committed read-only repeatable-read target followed by a separate current access/session check, exact proposed V2 fingerprint canonicalization and the owner-selected local-calendar-day leave/owner-admin-only reviewer designation rules. [Readiness](MIGRATION_READINESS.md) tracks the PR52 preview carry-overs as the first normalizer work. Operator preview reports stay private and are never committed or attached to PRs; only synthetic input fixtures and aggregate validation evidence belong here.

## First normalizer preparation (accepted PR54)

The [preparation checkpoint](SOURCE_NORMALIZER_PREPARATION_CHECKPOINT.md) implements preview issue severity, `review_required`/exit 3, row-level source cancelled/withdrawn policy holds and explicit blocked-member leave dependencies. PR54 was separately approved and accepted at `fd3dc3c`; its eight new checks and V1 behavior remain intact. The owner selected reviewed Toast employee/job snapshots as the first raw-file source family; actual schema/version, sanitized representative input and coverage evidence are still needed. This preparation adds no SQL, raw normalizer, source certification, target route or access grant.

## V2 per-family coverage (accepted PR55)

The [family checkpoint](SOURCE_FAMILY_COVERAGE_CHECKPOINT.md) adds explicit available/complete versus unavailable source families, independent per-family claims/status and the owner-confirmed untracked inactive historical leave review rule. V1 is unchanged. Run `npm run source:preview --prefix development/postgres-candidate -- source-preview-v2.example.json` for one unchanged roster member with source/target leave unavailable. The input is fictional normalized data, not a Toast export. Integer revisions and informational digests remain; provider fingerprints and the Toast raw normalizer follow after the owner supplies the reviewed sample/schema/coverage evidence. PR55 was separately owner-approved and accepted at `648b844`; merged-main CI passed 934/934. This accepted preparation adds no SQL or access/certification/application.

PR55 review refinements require exact per-member/window absence for untracked inactive leave, report stale leave-only parent aliases explicitly and reject V2 inputs with no available family across any scope (exit 1). Mixed unavailable scopes and complete empty families remain distinct; V1 is unchanged. See [the family checkpoint](SOURCE_FAMILY_COVERAGE_CHECKPOINT.md). These refinements add no SQL and were accepted in PR55 after separate owner approval. The raw Toast normalizer/fingerprint work still awaits the owner-supplied sanitized sample and schema/coverage evidence.

PR55 was owner-approved and squash-merged at `648b844a6f0b75b38c972d973e3903c42a22317a` from `e622ffbaf441b952b0df44ed0945146aadb55892`; [merged-main CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/38601345319) passed 934/934 with fresh migrations/snapshot, strict types and previews. The next docs-only [fingerprint/provenance design](SOURCE_FINGERPRINT_PROVENANCE_DESIGN.md) on `codex/companion-source-fingerprint-design` requires its own draft review and separate merge approval. It proposes typed source versions without changing V1/V2, records the sample-intake requirements and adds no SQL or implementation. Raw Toast parsing still requires the authorized sanitized sample and reviewed profile/coverage evidence. No hosted, active Companion or Inventory adoption is authorized.

The owner has supplied a private Toast roster CSV; [the sample profile review](TOAST_ROSTER_PROFILE_REVIEW.md) records its structural evidence without employer/employee values or actual employment counts. Active-only filtering is owner-confirmed. The owner selected reviewed job-to-department mappings and explicit primary-job choices; the inactive/all-employee export and actual mapping/supplement evidence remain pending. Keep the original/inspection results ignored, create only wholly fictional public fixtures and hold parser/typed-version implementation for the contract/profile review. PR56 remains draft and requires separate merge approval. No database, grant, active Companion or Inventory change follows from sample receipt.

October 16 owner clarification supersedes the earlier inactive-export prerequisite: start with the [reviewed active-only population](ACTIVE_ONLY_ROSTER_START_DESIGN.md) and exclude archived history. Prepare a private manager mapping workbook from the supplied active roster; do not unarchive people, invent records, falsify V1/V2 coverage flags or automatically deactivate omitted members. PR56 records the new scope for review; no SQL or importer is added and separate merge approval remains required.

## Accepted PR56 and next Toast preparation

PR56 was owner-approved and squash-merged at `5e2f48356f7ed781c48a90c08f2ce87aec2da99a` from amended head `95c65789db937fdcfec733876d864db1dd6789ac`; [exact-head CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/38956780603) passed 934/934, fresh migrations/snapshot, strict types and previews. The provider-only fingerprint/supplement/job-pair/custody amendments are accepted design. The next [read-only Toast normalizer checkpoint](TOAST_ROSTER_NORMALIZER_CHECKPOINT.md) is isolated preparation on `codex/companion-toast-roster-normalizer`, with its own draft PR and separate merge approval. It creates an intermediate artifact, not supported V3 preview input or a real import. Manager mappings, source semantics, current active-scope evidence, shared authz/target reads and certification remain open. No SQL, hosted services, active Companion or Inventory change is included.

## Accepted PR57 and next V3 bridge contract

PR57 was owner-approved and squash-merged at `5744a5d5312292f78ecfc9d1099d197eaaa7a13f` from reviewed head `f34feb3a6b24be4bfa11ebd8e3fec603030e654a`; [exact-head CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/38969803678) passed 963/963, fresh migrations/snapshot, strict types and previews. The accepted normalizer keeps empty-job employees unresolved, fingerprints separate name components under transform v2, and preserves original-byte BOM hashes. The next [V3 bridge contract](SOURCE_V3_PREVIEW_BRIDGE_DESIGN.md) defines scoped manager-supplement choices, duplicate refusal/reorder stability and typed alias/target review boundaries before wiring. It is a docs-only draft on `codex/companion-source-v3-preview-bridge`, not implemented V3 support, and requires separate merge approval. Published 001–063, manifest and snapshot are unchanged. Real mappings/scope evidence, shared target reads/authz, certification and Inventory/hosted adoption remain separate.

## Accepted PR58 and manager supplement preparation

PR58 was owner-approved and squash-merged at `88a4911d80478e8ac4a6a72c95b1621ec4a75989` from amended head `6bad27aa186a6a45ebaafdb18901cf898e9d951e`; [exact-head CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/38978910449) passed 963/963 with fresh migrations/snapshot, types and previews. The accepted contract binds supplements to population revision/effectiveDate and specifies primary-job departments, distinct target configuration findings and cross-department review. The first [manager supplement code checkpoint](MANAGER_SUPPLEMENT_CHECKPOINT.md) implements pure validation/canonicalization and selection findings on `codex/companion-manager-supplement-validation`. It remains a draft requiring separate merge approval. V3 preview/provenance/alias wiring, current authorized target reads, real mappings and all application/certification remain later work. Published 001–063, manifest and snapshot are unchanged; hosted services, active Companion and Inventory remain separate.

## Accepted PR59 and V3 comparison preparation

PR59 was owner-approved and squash-merged at e3154a51c678140cfc8ab89f557746ebf6780e63 from reviewed head 975a44d64bbd6f1fb6ea2353ef5cc94627ed7078; [exact-head CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/38984206058) passed 1005/1005. [Merged-main CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/38985547207) also passed 1005/1005 after the merge. The accepted supplement includes reviewed token semantics, stale description acknowledgement and full-roster V3 requirements. The next [V3 comparison checkpoint](SOURCE_V3_COMPARISON_CHECKPOINT.md) adds shared preparation recomputation and a pure typed source/alias comparison on codex/companion-source-v3-comparison. It remains a draft for separate merge approval; the bounded V3 CLI, authorized target reads, real mappings and application remain later work. Published 001–063, manifest and snapshot are unchanged. Hosted services, active Companion and Inventory remain separate.

## Accepted PR60 and bounded V3 CLI preparation

PR60 was owner-approved and squash-merged at 33fc059f822e50319eef29483e8752be7e4ba748 from reviewed head 067a2022e8dc1f4a295401382fe515fb2f4ef8f9; [exact-head CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/38995739373) passed 1040/1040. [Merged-main CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/38996743438) also passed 1040/1040. Its preparation recomputation, typed V3 comparison, blocked archived-membership reactivation and case-insensitive duplicate refusal are accepted isolated preparation. The next [bounded V3 CLI checkpoint](SOURCE_V3_CLI_CHECKPOINT.md) adds explicit local-file input, minimized default summaries, an opt-in private report and strict refusal/exit behavior on codex/companion-source-v3-cli. This remains a draft requiring separate merge approval. V1/V2 CLI behavior, published 001–063, manifest and snapshot are unchanged. Real mapping capture, authorized target/session reads, source certification/application, hosted services, active Companion and Inventory adoption remain separate.

## Accepted PR61 and source-reviewer access design

PR61 was owner-approved and squash-merged at `02037e732fbf97864f8c45ff6af29fd2f8b5fc8b` from reviewed head `faa6282f191c488c2f5e735ccbe33ae7961d145e`; [exact-head CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/39079734467) passed 1064/1064. [PR61 merged-main CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/39081149015) also passed 1064/1064. Its bounded V3 CLI, TypeError-only fixed error coverage and all-platform Windows device-basename refusal are accepted isolated preparation. V1/V2 behavior, published 001–063, migrations.json and schema-snapshot.sql remain unchanged.

The next [source-reviewer access/target-read design](SOURCE_REVIEWER_ACCESS_DESIGN.md) defines the scoped designation lifecycle and current final-access fence before an endpoint. It is a docs-only draft on `codex/companion-source-reviewer-access-design`, requiring separate merge approval. The owner selected explicitly designated reviewers without store employment, designation until revocation or eligibility loss, author self-certification with explicit certification authority, and audited self-revocation of an explicit designation. Shared identity/session implementation, I06 migration/baseline confirmation, real manager mappings, certification/application and Inventory/hosted adoption remain open. M05 remains open and M06 partial.

## Accepted PR62 and fictional reviewer-policy rehearsal

PR62 was owner-approved and squash-merged at `eabfadc0ae10abe4b0011ba01b9a06b15a442ae2` from amended head `83ea0b6e1be73a83406dd3fdf336c79db9f3d1ff`; [PR CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/39089739747) and the required [branch check, attempt 4](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/39089737754/attempts/4) passed 1064/1064 before merge. Earlier branch attempts failed on image download before tests; no check was bypassed. [PR62 merged-main CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/39090764584/attempts/2) passed 1064/1064 after one image-download retry. The source-reviewer design is accepted.

The next [fictional policy rehearsal](SOURCE_REVIEWER_POLICY_REHEARSAL_CHECKPOINT.md) is isolated on `codex/companion-source-reviewer-policy-rehearsal` and requires its own draft review and separate merge approval. It evaluates supplied fictional snapshots only and is imported by no active authentication, adapter, CLI or UI. Inventory owns the future shared migration ledger, with Jeff approving changes; its exact tested baseline/catalog remains pending. No SQL, grant, provider verification, actual target read, hosted service or Inventory change is included. M05 remains open and M06 partial.

## Accepted PR63 and personal-access lifecycle design

PR63 was owner-approved and squash-merged at `a0132bd620edc11dd76f6251dfdbb44ed1910506` from amended head `676d5e0f86638346f3ae0ceee90cce760d46d711`; [PR CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/39092374431/attempts/2) and the required [branch check](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/39092371111/attempts/4) passed 1111/1111 before merge. Earlier attempts stopped before tests on PostgreSQL image download; no checks were bypassed. [PR63 merged-main CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/39093102514/attempts/2) passed 1111/1111 after one image-download retry.

The next [personal-access lifecycle design](PERSONAL_ACCESS_LIFECYCLE_DESIGN.md) is a docs-only draft on `codex/companion-personal-access-lifecycle-design`, requiring separate review and merge approval. It records owner/admin-only ordinary grant administration, distinct-existing-owner approval of owner-set changes, and preserved scheduling records with sign-in pending when personal contact is unavailable. PR64 review records explicit removal-target consent, another-owner approval for voluntary self-removal, membership-epoch grant invalidation, atomic owner approval/application and link uniqueness. Single-owner additions and contested removals remain held under A05; proposal validity duration, setup delegation, self-increase, bootstrap/recovery, sensitive-action/session limits and retention remain explicit pending choices. Inventory owns the future shared ledger with Jeff approving changes; its tested baseline/catalog remains pending. No SQL, account, grant, provider call, hosted service or Inventory change is included.

## Accepted PR64 and fictional access lifecycle rehearsal

PR64 was owner-approved and squash-merged at `6881a94c95c84e8cc888515dc000f0ae8e9f655f` from reviewed head `23387df53be35fcac4e6c2ce77de16f3cda5e18e`; [PR CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/39096951913/attempts/2) and [branch CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/39096948445/attempts/2) passed 1111/1111 before merge. The accepted design records explicit target objection versus silence, the objection hold with three or more owners, distinct-owner voluntary removal, membership-epoch grant invalidation, atomic approval/application and current link cardinality. A04–A06 and Inventory tested baseline/catalog remain pending; this merge selects no exception procedure or timing default. [PR64 merged-main CI, attempt 3](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/39097991137/attempts/3) passed 1111/1111 after two image-download retries before tests; no checks were bypassed.

The next [fictional owner-change and membership-grant rehearsal](ACCESS_LIFECYCLE_POLICY_REHEARSAL_CHECKPOINT.md) is isolated on `codex/companion-access-lifecycle-rehearsal`, with a separate draft PR and merge approval required. It tests supplied fictional final-check and consecutive employment snapshots only, performs no writes and grants no access. No runtime adapter/CLI/UI imports it. Published 001–063, manifest and snapshot remain unchanged; no SQL, hosted service, provider account or Inventory change is included. M05 remains open and M06 partial.
