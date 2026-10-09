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

Bootstrap verifies the versioned hash manifest and applies 001–019 in order, inserts fictional base actors after 001 so later capability conversion can run, and creates fictional sessions after migration. All candidate connection helpers use the selected database/port. Tests run serially because rollback checks create temporary failure triggers. The core concurrency tests use independent Node/PostgreSQL bridge processes; Python and machine-specific library paths are no longer required.

The GitHub `candidate-validation` workflow performs this sequence on a fresh disposable PostgreSQL service. Passing candidate checks does not prove the complete application is migrated or deployed.

## Optional original-form preview

After bootstrap and preview build, run:

```sh
npm run preview:seed --prefix development/postgres-candidate
npm run preview:serve --prefix development/postgres-candidate
```

Open `http://127.0.0.1:6610/checkout-forms`, `/overnight-forms` or `/forms` locally. The server binds only to loopback and issues short-lived, locally signed fictional tokens. Never deploy this fixture-token server. Stop it with Ctrl+C. Runtime fixture JSON, generated reference modules and preview build output stay ignored. Run browser checks after regression tests to avoid competing fictional business dates.

## Scope and evidence

See [migration readiness and remaining workflow coverage](MIGRATION_READINESS.md) for the current checklist and implementation order. The source inventory/classification check runs with `node development/postgres-candidate/readiness-inventory.mjs` from the repository root. Tested candidate slices do not establish whole-app PostgreSQL readiness.

The [schedule shift read checkpoint](SCHEDULE_READ_CHECKPOINT.md) adds paged reference reads with original shift visibility parity. Full roster/job eligibility, availability and scheduling writes remain pending.

The [employee, schedule and standard mapping review](REFERENCE_MAPPING_CHECKPOINT.md) adds a read-only validator for explicit source-to-candidate IDs and revisions. The [transactional fictional import](REFERENCE_IMPORT_CHECKPOINT.md) adds target conflicts, complete source archiving, atomic new-reference writes and retry receipts in the candidate only. [Explicit shift-standard links and the imported closing rehearsal](IMPORTED_CLOSING_CHECKPOINT.md) verify a closing through signed sessions, the original form-command adapter and PostgreSQL while preserving independent checks and separate release. Production identity/access decisions, existing-reference reconciliation and authorized ingestion remain pending.

Candidate workflows cover ordinary tasks, issues/reassignment, station handoffs, linked shift work, closing assignments/checks/correction help, separate checkout release, Dishwasher cycles/acceptance and overnight responsibility. [Employee checkout queue support](CHECKOUT_OFFLINE_CHECKPOINT.md) adds tested closing and Dishwasher readiness delivery. The [offline screen checkpoint](CHECKOUT_OFFLINE_UI_CHECKPOINT.md) records actual browser outage/reload/reconnect checks in the isolated preview, using cached shell/assignments and pending status. Incoming acceptance, manager checks, shift release, overnight responsibility commands and actual notification delivery remain outside this offline slice. Production identity/cache policy and application cutover remain pending.

Historical checkpoint documents were copied from the local preparation work. Their test counts and browser observations describe those checkpoints, not a fresh GitHub run. Runtime evidence referenced by them remains local and is excluded from Git. The latest historical workflow checkpoint is [Closing and Dishwasher UI](CHECKOUT_UI_CHECKPOINT.md). Production employee/schedule ingestion, remaining Companion modules, real hosted authentication, Inventory contracts and deployment remain pending.

Follow [the repository Git workflow](../../docs/GIT_WORKFLOW.md). Shared migration files are versioned; add corrective migrations after publication instead of editing shared/applied history. Final adoption into Inventory requires one canonical deployment manifest and a reviewed integration branch from its tested baseline.
