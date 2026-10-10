# Companion candidate merge review gate

The isolated candidate is far enough along to begin controlled merge preparation. This means saving reviewed preparation into the Companion repository's shared baseline, not switching either running app to PostgreSQL or merging Companion into Inventory.

## Current evidence

On October 9, 2026, remote `main` is `01de083`. PRs 1–23 are open drafts in a dependency chain; PR 1 targets `main`, and each later PR targets the preceding candidate branch. PR 1 reports mergeable and both of its candidate checks passed. The latest request-screen checkpoint `959836f` passed both GitHub validations and 384 fresh-database checks. The next board checkpoint adds candidate-only UI work and requires its own fresh checks. No final whole-diff review or merge has occurred.

The original consolidation did not modify application source under `app/`. The audit correction adds only a Tailwind source exclusion in `app/globals.css` and a root lint exclusion; active application behavior/backend wiring remain unchanged. Changes outside the candidate are its validation workflow, lint/style source exclusions, repository instructions/documentation and TypeScript exclusions that keep candidate/runtime files out of the active application typecheck. The current cumulative diff still needs final human review; passing candidate checks does not certify production identity, ingestion, notification delivery or complete module adoption.

Consolidation preparation: source snapshot `545200d` passed 386 checks and both GitHub validations in PR 24. Branch `codex/companion-candidate-consolidation` starts from `main` at `01de083` and copies that complete snapshot with refreshed readiness documentation. PRs 1–24 remain open drafts; none were retargeted, merged or closed. Live branch controls require PRs, strict `candidate-validation`, resolved conversations, and block force pushes/deletion; required reviewer count is zero for the sole-owner workflow. Final merge still requires the user's decision on the consolidation PR after its own validation.

## Recommended sequence for the existing stack

1. Finish and save the current tested board checkpoint. Freeze the exact source commit for the candidate baseline review.
2. Refresh `main` and inspect the complete cumulative diff against its exact current commit. Check published migration hashes/order, runtime privilege boundaries, public-file exclusions, candidate isolation and documented limitations.
3. Prepare a fresh consolidation branch from that exact `main`, containing the reviewed final candidate snapshot and only the already-approved supporting workflow/documentation changes. Open one replacement draft PR to `main`, linking the dependent checkpoint PRs. This avoids pretending the old stack can simply be retargeted after squash merges; their original ancestry would remain behind the squash commit.
4. Rerun the empty-database migration suite, serial regressions, adapter types and previews on the actual consolidation branch. Confirm required GitHub checks and branch controls. Review the final diff and resolve review concerns before marking it ready.
5. Present the tested consolidation commit and PR for the user's merge decision. A request to continue migration preparation or to report merge readiness does not authorize merging. Do not close old PRs, apply hosted migrations or deploy as part of this preparation.
6. Once explicitly approved, squash-merge the reviewed consolidation PR. Verify `main` and its checks, record the accepted checkpoint, and then close superseded draft PRs with links to the accepted replacement. Future focused PRs start from the updated `main`; never force-push the existing shared branches.

An alternative is sequential squash merges with a fresh branch/cherry-pick of each dependent checkpoint from the newly merged `main`, fresh checks and replacement PRs. Do not merge later PRs into their predecessor branches and assume that updates `main`. The consolidation approach is recommended for this already-large, interdependent preparation stack.

## Separate Inventory integration gate

Inventory must first provide its completed, tested merge commit. Then create an integration branch there from that exact baseline, reconcile employee identity/permissions and schema ownership, and port selected reviewed workflows in stages. Preserve canonical Inventory catalogs and stock writers. Use one reviewed database deployment manifest. Shared hosted authentication, source completeness, offline recovery and accepted module scope must be verified before cutover. Companion candidate Git merges can begin before this Inventory gate is met; cross-app integration, hosted database application and deployment cannot.
