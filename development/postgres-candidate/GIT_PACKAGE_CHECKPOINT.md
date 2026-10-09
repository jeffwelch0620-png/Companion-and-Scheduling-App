# Tracked candidate packaging checkpoint

October 9, 2026. The isolated PostgreSQL preparation source is now packaged for versioned review under `development/postgres-candidate`. This supersedes historical statements that the candidate exists only in ignored local work. No application backend cutover, Inventory merge or hosted database change is included.

The package retains migrations 001–016 and adds 017 to explicitly grant runtime execution of authenticated identity resolution and task listing. Those grants had previously been supplied outside the ordered migration files. The fresh-install check exposed the omission; the additive migration makes it reproducible without changing earlier workflow migrations.

Bootstrap opts into a fictional loopback server, creates a new candidate database, verifies the ordered SHA-256 migration manifest and applies all 17 migrations. It refuses an existing database. The restricted runtime role has no superuser or RLS-bypass capability. Privileged setup is confined to fictional test infrastructure, not a production configuration.

All tests, fixture utilities and previews use the selected candidate database/port. Independent-session core tests now use Node/PostgreSQL JSON-lines transport instead of a machine-specific Python executable and library path. Generated closing-reference modules are rebuilt from the original Companion source. Candidate TypeScript is excluded from the active app's project compilation and receives its own strict check.

Validation of this tracked package: 163 checks passed with zero failures or skips against a newly created empty database after all migrations; strict adapter/HTTP types passed; Vite built all three original-form preview entries. A separate manifest check is included. Historical browser results remain documented in their checkpoints; browser workflows were not repeated solely for this packaging change. GitHub CI reproduces fresh migration, regression, type and preview-build checks; inspect the current PR checks for its result.

Public-source review excludes runtime databases, fixture identity/session JSON, generated build output, dependencies, local paths and credentials. The previous ignored working candidate and private runtime evidence remain local. Future candidate edits belong in this tracked package, not the historical copy.

Repository workflow: [Git workflow](../../docs/GIT_WORKFLOW.md). The candidate is pushed on its own branch and reviewed in a draft PR; merging and deploying remain separate. Shared identity/reference ingestion, additional offline workflows, remaining Companion modules and Inventory reconciliation are still pending.
