# Git workflow for Companion and Inventory integration

The Companion repository keeps reviewed source on `main`. PostgreSQL preparation uses focused `codex/` branches from accepted main at `1c536d1` (PR36). PR28 was squash-merged at `0f1aa31`; PR29 was separately approved and squash-merged at `a344421`, with 457/457 post-merge tests and CI passing. Inventory's merge is complete and its baseline is undergoing testing. Integration remains separate until the user confirms its tested baseline commit. Pushing saves versioned source remotely. Merging updates a shared baseline. Deployment and database application require a separate, explicit step.

## Routine development

1. Start each focused change from the current reviewed baseline on a `codex/` branch. Keep concurrent work in separate checkouts when necessary. Refresh remote refs before choosing the baseline.
2. Make focused commits at completed checkpoints. Include source, ordered migrations, tests and documentation. Exclude credentials, local databases, dependencies, compiled files, tokens and runtime evidence containing private data. Review the staged diff before every push; this repository is public.
3. Push after each tested checkpoint and maintain a draft pull request during work. Attach the PR to its working chat. A push does not authorize a merge or deployment.
4. Keep the PR description current: problem, resulting behavior, validation and remaining limitations. Resolve conflicts on the feature branch and rerun affected checks.
5. Mark the PR ready only after scoped tests, build, type validation and empty-database migration checks pass. Require a PR and successful checks on `main`. Review the actual final diff before merging.
6. Prefer squash merges for focused feature PRs. Do not force-push shared branches. Create the next feature branch from the updated `main` after a squash merge.

## Candidate package

PR26 database coordination was accepted by squash merge at `14e9193`; PR27 authentication/offline recovery was accepted at `2193afc`, with 426 post-merge tests passing. PR28 adds person-level cross-location conflicts and whole-store roster-review regression coverage, with 439 tests and exact-head CI passing; PR28 was accepted by squash merge at `0f1aa31`. PR29 accepted the scheduling policies and corrections at `a344421`, with 457/457 post-merge tests and CI passing. PR30 store configuration was separately approved and squash-merged at `1428e84` from reviewed head `56cd02b`, whose exact-head CI passed 496/496 cases. New readiness work starts from the current accepted main and remains a draft until separately approved. Keep dependent drafts based on their dependency until accepted, then merge updated main normally and retarget. Do not treat a dependent branch as an accepted baseline.

PR31 candidate form configuration adoption normally incorporated accepted PR30 main, was separately approved and squash-merged at `79f3bf9` from reviewed head `287ceb2`. Merged-main CI passed 519/519 tests. Weekly publication UI preparation starts from this accepted baseline on `codex/companion-weekly-publication-ui`, remains isolated and requires its own draft PR review and merge approval.

`development/postgres-candidate` is the tracked, isolated migration source. It is not imported by the running application. The `work/` folder remains ignored for private working files; the earlier local candidate is historical evidence, not the source for new changes. Do not develop competing copies. Candidate runtime data is always ignored.

The initial foundation PR contains the accumulated, interdependent candidate migrations. Subsequent changes should use smaller PRs around individual workflows or contracts. Keep migration numbers and order stable once shared; add corrective migrations instead of rewriting shared/applied migration history. Candidate migrations are not automatically adopted into Inventory's deployment manifest.

The `candidate-validation` GitHub check installs an empty fictional PostgreSQL database, applies all ordered candidate migrations, runs regression tests, checks adapter types and builds original-form previews. It does not deploy anything. Local test results and historical browser checks are documented separately from GitHub CI results.

## Candidate UI source gate

The required `candidate-validation` check runs the source-copy gate during candidate test preparation and preview builds. `ui-source-baseline.json` fingerprints only the three copied shared components (`schedule-board`, `shift-editor`, `dish-checkouts`) plus the body of `dishCheckoutCycleStatus` from `app/shared/domain.ts`. Unrelated domain changes do not require renewing that fingerprint.

If an application PR changes one of these sources and the gate fails, its author must review and reconcile the candidate copy with the changed original, run the relevant rendered regression/type/preview checks, and update the corresponding baseline fingerprint in the **same PR**. The required check blocks until that reconciliation is complete. Updating a hash without reconciling its copy is not a resolution. Preserve unrelated fingerprints and do not disable the gate to pass CI.

During shared/PostgreSQL UI adoption, fold the reviewed configuration changes into the original `app/team/*` components and `domain.ts`, validate the unified implementation, then delete the copied `ui-*` components/projection and their baseline file, checker and build/test hooks. Track this retirement in the migration readiness checklist.

## Inventory handoff and merge

When Inventory's existing merge is complete, record its tested commit and create an integration branch in that repository from that exact baseline. Bring in selected, reviewed Companion components in stages: shared identity and permissions, employee operational workflows, then Inventory prep/food service connections. Preserve canonical Inventory catalogs and stock writers. Reconcile schema ownership and use one reviewed deployment manifest.

Cross-repository work is a reviewed port of selected components and contracts, not a whole-repository merge. Test shared workflows in the integration branch before merging. Changes to hosted Supabase, production database migrations and rollout remain separate from Git merges. Tag accepted release/cutover commits and document the tested recovery path.

## Main branch controls

Require pull requests, successful `candidate-validation` checks and resolution of review conversations; block force pushes and branch deletion. Avoid requiring an approval the sole repository owner cannot supply on their own PR; use human final review and add a required independent approver when another reviewer is available. Enable these controls once the candidate check is available. Merge approval must be given for the concrete reviewed PR; deployment and hosted database application require separate approval.

PR32 weekly publication UI was separately approved and squash-merged at `1b95d8e` from reviewed head `d092dca`; merged-main CI passed 538/538 checks. Its publication-review corrections start from accepted main on `codex/companion-publication-review-followup` and require a new draft PR and separate merge approval. PR33 was later normally refreshed and separately accepted as recorded below.

PR34 follow-up adds corrective 046 after published 045; source attestation and scheduling planning use separate counters. PR34 was separately approved and squash-merged at `e0479d1` from tested head `078946e` (558/558 exact-head CI tests). PR33 normally incorporated that accepted main, then received separate merge approval. No force-push, hosted application or Inventory integration is authorized by this refresh.

PR33 reviewed follow-up adds corrective 047 for authoritative offer action reads and the required, audited department acknowledgement. Published 001–046 remain immutable. That preparation required separate merge approval; hosted application and Inventory changes remain separate.

PR33 was separately approved and squash-merged at `2d8d3cc` from reviewed head `75ad4e1`; merged-main CI passed 587/587 tests. Dated leadership UI preparation started from this baseline on `codex/companion-leadership-ui` and added corrective 048 for scoped server choices/actions using the existing target policy. Its subsequent acceptance is recorded below. No hosted application, deployment or Inventory integration is authorized.

PR35 dated leadership preparation was separately approved and squash-merged at `382fa92` from reviewed head `03eddd2`; merged-main CI passed 604/604 tests. Leadership visibility and checkout-role eligibility follow-up starts from that accepted baseline on `codex/companion-leadership-followup`, adds corrective 049 and remains a separate draft requiring review and merge approval. Existing published migrations, the active backend, Inventory and hosted services remain separate.

PR36 leadership follow-up was separately approved and squash-merged at `1c536d1`, including corrective 049. PR37 published editing at `c27cca1` and dependent PR38 closing transfers at `2106638` remain unmerged drafts. The attendance/correction design uses an independent documentation-only branch, `codex/companion-attendance-correction-design`, from accepted main. Later implementation must resolve pending correction policies and reconcile the accepted migration chain before choosing new numbers. A design PR does not accept those pending branches, implement attendance, or authorize Inventory/hosted changes.

The PR37–39 review follow-up preserves shared 050 and 051. PR37's client/checkpoint fixes are merged normally into PR38, where corrective 052 carries the SQL privacy fix and snapshot. Validate that combined package before accepting the merge sequence; PR37 alone does not contain the SQL correction. PR39 remains documentation-only with three pending owner policy selections. Use normal merges for stack refreshes, then retest the resulting heads; no rebase or force-push.
