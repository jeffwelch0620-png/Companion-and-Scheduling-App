# Consolidation baseline review

Source snapshot: `545200d`, comprising the work recorded in draft PRs 1–24. Target baseline: remote Companion `main` at `01de083`. Consolidation branch: `codex/companion-candidate-consolidation`. The original dependency stack remains preserved and unmerged.

## Review scope

- Exact snapshot transfer into a fresh branch from `main`, without retaining the old dependency chain as branch ancestry. The original consolidation matched candidate code, all 34 published migration files/hashes and supporting workflow files at the source checkpoint. Subsequent audit corrections are described below; the published 001–034 migration bytes/hashes remain unchanged. Changes to readiness/merge documentation describe the current consolidation state.
- Original changed-path review confirmed no application/backend/public source or root dependency changes. Audit corrections add one Tailwind source exclusion in `app/globals.css` and the root lint exclusion, with no backend or root dependency changes. The supporting TypeScript change only excludes candidate and ignored working files. Candidate previews import source components, but the active application imports no candidate package.
- Test bootstrap is explicitly opted in, bound to loopback and restricted to fictional candidate database names. It refuses an existing database and performs no reset/drop. Migrations run through the private schema-owner role; runtime uses restricted command/read grants, parameterized calls, JWT/session resolution and transaction rollback. Regression tests exercise current authorization, raw table denial, independent review and audit/receipt/outbox atomicity.
- The validation workflow has read-only repository permissions, a pinned PostgreSQL test container, fresh serial tests and types/build steps; it contains no deployment or hosted migration step. Runtime/session fixtures, dependencies, generated modules, databases, logs and screenshots are excluded from the public snapshot.
- `main` protection was read back: required PR, strict `candidate-validation`, conversation resolution, blocked force pushes/deletion, and zero required external approvals for the sole-owner workflow. These settings were not changed.

This is a scoped candidate baseline review supported by regression evidence, not a claim of complete production security review or whole-app migration. Final human acceptance remains open. The source equality statement and 386-check result below describe the original `a637ee2` checkpoint, not the audit-corrected head.

Local validation on this consolidation branch: fresh fictional loopback database `companion_candidate_consolidation1` applied all 34 migrations, and all 386 serial checks passed. Strict adapter types, preview build and source coverage inventory passed. Snapshot comparison verified all executable/supporting files match `545200d` and all migration bytes/hashes are preserved. Eighty-two SECURITY DEFINER declarations across the published migrations use fixed `pg_catalog` search paths. Active TypeScript compiler options/includes remain unchanged; only candidate/work exclusions differ. Public staged-file review excludes secrets and runtime material. This is source/fixture evidence; earlier browser rehearsals remain the evidence for the byte-identical preview code, and no new production or device validation is claimed.

## Remaining before the Companion candidate Git merge

1. Local validation is complete. Confirm the consolidation PR's GitHub checks on its exact head commit before merge; the PR is the current authority for those results.
2. Review the actual consolidation PR against the current `main`, resolve comments/findings and confirm its head/base have not changed. Any code change requires affected checks again.
3. Obtain explicit user approval for that concrete PR, then mark ready and squash-merge under the repository workflow. No merge is authorized by preparation alone.

After an approved merge, verify the resulting `main` and required checks, record the accepted commit, and close superseded PRs with links to the replacement. These are post-merge housekeeping steps, not permission to deploy.

## Remaining before Inventory integration and live adoption

- Record Inventory's finished tested baseline, then create a separate integration branch there.
- Agree canonical employee/person/membership IDs, restaurant scope, permission lifecycle, onboarding/recovery and real hosted authentication.
- Reconcile schema/table ownership and one deployment manifest, including canonical Inventory item/unit/recipe/prep/order IDs and one authorized stock/order writer.
- Finish or explicitly defer remaining scheduling UI/copy/attendance, standard/training/proficiency and other Companion service/module workflows. Preserve visible data and permission rules for every accepted module.
- Implement employee food-prep submission and its offline queue; verify task/closing recovery, shared-device cleanup and phone/tablet behavior. Ordering and stock posting wait for connectivity.
- Implement actual notification delivery, hosted enforcement/secret management, reporting/AI accounting, local recovery/reporting-copy design and tested backup/restore.
- Run end-to-end acceptance against the integrated branch, including real-source completeness and shared data, then approve rollout/database application separately.

There is no existing production data to migrate. This reduces data-preservation work but does not remove workflow, identity or device acceptance requirements. A candidate Git merge can precede these integration/adoption items.

## Audit correction follow-up

See [PR 25 audit correction checkpoint](AUDIT_CORRECTION_CHECKPOINT.md) for the corrective 035 migration, regression coverage, runtime grants, conditional CI and lint/style isolation. Original snapshot/test statements above remain historical; final corrected-source checks are recorded here after validation.

Corrected-source local validation: `companion_candidate_audit35b` applied 001–035 and passed all **391** serial tests (0 failures); a separate migration-only database verified privileges without fixture grants. Strict candidate types including the PostgreSQL driver, source coverage inventory, preview build and root `build:local` passed. Root lint completed with **23 errors and 192 warnings**; all error-bearing source files are unchanged from `origin/main`, and the lint rules are unchanged apart from candidate exclusion. The candidate preview is confirmed ignored by root ESLint. These are existing application lint findings, not a clean lint pass; active application fixes remain outside this candidate checkpoint. GitHub status on the pushed head remains the authority for CI.
