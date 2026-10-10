# Git workflow for Companion and Inventory integration

The Companion repository keeps reviewed source on `main`. PostgreSQL preparation is developed on focused `codex/` branches, from the accepted PR27 baseline at `2193afc`. The current corrective package is `codex/companion-scheduling-safeguards`. Inventory's merge is complete and its baseline is undergoing testing. Integration remains separate until the user supplies its tested baseline commit. Pushing saves versioned source remotely. Merging updates a shared baseline. Deployment and database application require a separate, explicit step.

## Routine development

1. Start each focused change from the current reviewed baseline on a `codex/` branch. Keep concurrent work in separate checkouts when necessary. Refresh remote refs before choosing the baseline.
2. Make focused commits at completed checkpoints. Include source, ordered migrations, tests and documentation. Exclude credentials, local databases, dependencies, compiled files, tokens and runtime evidence containing private data. Review the staged diff before every push; this repository is public.
3. Push after each tested checkpoint and maintain a draft pull request during work. Attach the PR to its working chat. A push does not authorize a merge or deployment.
4. Keep the PR description current: problem, resulting behavior, validation and remaining limitations. Resolve conflicts on the feature branch and rerun affected checks.
5. Mark the PR ready only after scoped tests, build, type validation and empty-database migration checks pass. Require a PR and successful checks on `main`. Review the actual final diff before merging.
6. Prefer squash merges for focused feature PRs. Do not force-push shared branches. Create the next feature branch from the updated `main` after a squash merge.

## Candidate package

PR26 database coordination was accepted by squash merge at `14e9193`; PR27 authentication/offline recovery was accepted at `2193afc`, with 426 post-merge tests passing. The authorized next package is isolated on `codex/companion-scheduling-safeguards`: person-level cross-location conflicts and whole-store roster-review regression coverage. Its draft PR targets main and requires separate concrete merge approval. For future dependent PRs, keep the draft based on its dependency until that dependency is accepted, then merge updated main normally and retarget. Do not treat a dependent branch as an accepted baseline.

`development/postgres-candidate` is the tracked, isolated migration source. It is not imported by the running application. The `work/` folder remains ignored for private working files; the earlier local candidate is historical evidence, not the source for new changes. Do not develop competing copies. Candidate runtime data is always ignored.

The initial foundation PR contains the accumulated, interdependent candidate migrations. Subsequent changes should use smaller PRs around individual workflows or contracts. Keep migration numbers and order stable once shared; add corrective migrations instead of rewriting shared/applied migration history. Candidate migrations are not automatically adopted into Inventory's deployment manifest.

The `candidate-validation` GitHub check installs an empty fictional PostgreSQL database, applies all ordered candidate migrations, runs regression tests, checks adapter types and builds original-form previews. It does not deploy anything. Local test results and historical browser checks are documented separately from GitHub CI results.

## Inventory handoff and merge

When Inventory's existing merge is complete, record its tested commit and create an integration branch in that repository from that exact baseline. Bring in selected, reviewed Companion components in stages: shared identity and permissions, employee operational workflows, then Inventory prep/food service connections. Preserve canonical Inventory catalogs and stock writers. Reconcile schema ownership and use one reviewed deployment manifest.

Cross-repository work is a reviewed port of selected components and contracts, not a whole-repository merge. Test shared workflows in the integration branch before merging. Changes to hosted Supabase, production database migrations and rollout remain separate from Git merges. Tag accepted release/cutover commits and document the tested recovery path.

## Main branch controls

Require pull requests, successful `candidate-validation` checks and resolution of review conversations; block force pushes and branch deletion. Avoid requiring an approval the sole repository owner cannot supply on their own PR; use human final review and add a required independent approver when another reviewer is available. Enable these controls once the candidate check is available. Merge approval must be given for the concrete reviewed PR; deployment and hosted database application require separate approval.
