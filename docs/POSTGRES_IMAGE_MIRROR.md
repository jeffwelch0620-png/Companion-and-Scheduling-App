# PostgreSQL candidate image mirror

Jeff approved this mirror and the PR/main trigger policy during PR68 review. It changes CI infrastructure only, not a database or application deployment. PR68 was separately approved and merged; subsequent PRs require their own review and approval. Required check: `candidate-validation`, supplied by the pull_request event before merge and the main push event after merge. Full validation runs on both; feature pushes do not duplicate it. No conditional validation skips, retry wrappers or continue-on-error are used.

## Exact image and custody

- Upstream: `docker.io/library/postgres@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3`.
- Previous ECR reference used the same digest. The Docker Hub raw manifest was independently hashed and matched that digest before copying; no tag resolution or version substitution is involved.
- Mirror: `ghcr.io/jeffwelch0620-png/postgres@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3`.
- Discovery tag: `sha256-2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3`. CI always uses the digest, never the tag.

The [manual mirror workflow](../.github/workflows/postgres-image-mirror.yml) copies every architecture with `skopeo copy --all --preserve-digests --retry-times 0`, then hashes and compares raw source/destination manifests. Failure to preserve a digest fails the job. It does not rebuild, annotate, recompress, prune architectures or change image configuration. Upstream image/license provenance stays intact. See [Skopeo's copy contract](https://github.com/containers/skopeo/blob/main/docs/skopeo-copy.1.md).

The owner-approved first publication uses a temporary exact-branch/path push trigger because a new manual workflow cannot be dispatched before it exists on the default branch. That bootstrap trigger is removed before PR68 returns for review. Subsequent publication is manual only; it is never triggered by a PR. A workflow syntax error in the initial bootstrap was corrected before its copy job ran; it did not publish an image or run tests.

## Access

Only the mirror job has `packages: write`; it authenticates using its short-lived `GITHUB_TOKEN` via stdin and removes the runner-temporary auth file on exit. No personal token or credential is committed or printed. Publishing through the repository workflow associates the package with the repository. Maintain that association and repository Actions read access; see [GitHub's registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

The candidate validate job has `contents: read` and `packages: read`. Service credentials use `github.actor` and `secrets.GITHUB_TOKEN`, with the digest fixed in YAML. Package visibility is not silently changed. A fork without package access fails closed; do not use pull_request_target or pass privileged credentials to fork code to bypass access. Any fork/public-access policy needs separate review.

## Refresh and verification

1. Obtain owner approval for an upstream version/digest change or a new publication. Verify upstream provenance and the raw manifest's SHA-256. Keep the source fixed by digest.
2. In a reviewed PR, update the fixed digest in the mirror workflow, validation image and this document together. Preserve the full multi-architecture index and all child manifests/layers; do not convert the image format.
3. From the accepted workflow, an authorized repository maintainer manually runs **PostgreSQL pinned image mirror**. For the initial unmerged bootstrap use only the documented temporary branch trigger, then remove it. A publication failure is a failure; investigate it without adding automated retries or ignoring errors.
4. Record the successful mirror run and digest verification. Confirm package/repository read access before switching validation to a new digest. Keep older referenced digests available; do not delete them while accepted branches depend on them.
5. Require a green exact-head PR run whose service image is the GHCR digest and whose migrations, snapshot, complete regressions, types and previews all actually run. Inspect initialization logs for the GHCR pull and absence of ECR.
6. After separate owner merge approval, inspect the merged-main push run for the same full validation and GHCR-only pull. Record the merged SHA/run; this proof remains pending while the PR is draft. Do not merge to manufacture evidence before approval.

## PR68 evidence

[Mirror publication](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/39177563116) passed on bootstrap commit `6e726a6ba22c99d02e00bef475713b1b0685e02d`; the copy included all architectures and raw source/destination manifest SHA-256 and byte comparisons passed. The temporary push trigger was then removed. [Exact-head PR proof](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/39177968710) passed 1351/1351 at `aa1b439`; after separate owner approval, [merged-main push proof](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/39178690959) passed 1351/1351 at `09fa3d9a7d911789a1168d1c0db5424f45749b30`. Both completed on attempt 1 with the exact GHCR digest, no ECR reference, zero skipped tests, migrations/snapshot/types/previews passing. Published migrations 001–063, migrations.json and schema-snapshot.sql are unchanged; migration 064 is not needed.
