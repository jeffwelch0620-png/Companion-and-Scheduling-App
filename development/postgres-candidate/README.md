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
npm test --prefix development/postgres-candidate
npm run check:types --prefix development/postgres-candidate
npm run build:preview --prefix development/postgres-candidate
```

Bootstrap verifies the versioned hash manifest and applies 001–034 in order, inserts fictional base actors after 001 so later capability conversion can run, and creates fictional sessions after migration. All candidate connection helpers use the selected database/port. Tests run serially because rollback checks create temporary failure triggers. The core concurrency tests use independent Node/PostgreSQL bridge processes; Python and machine-specific library paths are no longer required.

The GitHub `candidate-validation` workflow performs this sequence on a fresh disposable PostgreSQL service. Passing candidate checks does not prove the complete application is migrated or deployed.

## Optional original-form preview

After bootstrap and preview build, run:

```sh
npm run preview:seed --prefix development/postgres-candidate
npm run preview:serve --prefix development/postgres-candidate
```

Open `http://127.0.0.1:6610/schedule-forms`, `/checkout-forms`, `/overnight-forms` or `/forms` locally. The scheduling screen covers day/week/personal reads, individual drafts and availability/time-off requests; publication, copying, coverage, leadership and attendance controls remain pending. Run seed once per fresh database; it refuses the existing fictional scheduling restaurant. The server binds only to loopback and issues short-lived, locally signed fictional tokens. Never deploy this fixture-token server. Stop it with Ctrl+C. Runtime fixture JSON, generated reference modules and preview build output stay ignored. Run browser checks after regression tests to avoid competing fictional business dates.

## Scope and evidence

See [migration readiness and remaining workflow coverage](MIGRATION_READINESS.md) for the current checklist and implementation order. The source inventory/classification check runs with `node development/postgres-candidate/readiness-inventory.mjs` from the repository root. Tested candidate slices do not establish whole-app PostgreSQL readiness.

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
