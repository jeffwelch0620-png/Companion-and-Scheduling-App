# Companion migration workflow

Read `docs/GIT_WORKFLOW.md` and `development/postgres-candidate/README.md` before migration preparation work.

- Make new PostgreSQL candidate changes in the tracked `development/postgres-candidate` package. The ignored `work/postgres-candidate` copy is historical local evidence; do not develop both copies.
- Keep the active Companion backend, Inventory checkout and hosted services separate from candidate preparation unless the user authorizes their integration.
- Use focused `codex/` branches and commits. For authorized migration work, push tested checkpoints and maintain a draft pull request; attach created PRs to the working chat. Follow the Git workflow for review and merges.
- Preserve published migration order and content. Add corrective migrations and update `migrations.json` for new files. Keep LF line endings so hashes are portable.
- Verify fresh-database migrations, relevant regression checks, candidate types and previews. Run tests serially against fictional loopback databases; never point test setup at production.
- This repository is public. Review staged files before pushing; exclude credentials, runtime databases, fixture session JSON, dependencies and compiled output.
- A push or draft PR does not authorize merging, hosted database application or deployment. Hold Inventory integration until its tested baseline is available.
