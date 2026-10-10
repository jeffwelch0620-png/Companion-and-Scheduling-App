# Companion and Scheduling App

Local development and GitHub source for the JMAX Operations Companion and Scheduling app. This repository preserves the October 8, 2026 editable-source handoff and supports preparation for integration with the Inventory App.

## Source baseline

- Original archive: `JMAX-Editable-Source-2026-10-08.zip` (6,145,042 bytes).
- Archive SHA-256: `37fd1c285430aa0872180649155e495e9658beb5bc15d997b6ebc322ee150062`.
- Baseline commit: `b340d554490fdad7f48c824420927297376d94b4`.
- Baseline tag: `companion-source-2026-10-08`.
- All 868 source files matched their sizes and SHA-256 hashes in `SOURCE-MANIFEST.json` after extraction. The archive and its embedded manifest remain unchanged. The manifest describes the imported snapshot, not subsequent development edits.

The ZIP's `JMAX-Review` directory is flattened into the repository root. The original ZIP remains separately retained. Local dependencies, environment files, runtime databases and compiled output are excluded from Git. No Inventory source, operational database or hosted service was changed by this import.

## Local setup

Use Node.js 22.13 or newer. Follow [START-HERE.md](START-HERE.md) for the supplied build, selected tests and fictional preview:

```powershell
npm ci
node review.mjs build
```

The October 8 handoff directs developers to run `tests/operations-preview.mjs` with the documented environment settings. Its older `node review.mjs start` combined scheduling preview has a known restaurant-access mapping issue. Historical audit tests require separately omitted evidence packages; do not treat a broad test glob as the handoff's acceptance command.

At import, dependency installation was attempted with Node.js 24.19.0 and npm 11.17.0 but failed because DNS lookup for `registry.npmjs.org` returned `ENOTFOUND`. Receiving-machine build and runtime acceptance are therefore pending. Source integrity verification succeeded independently of dependency installation.

## Development and integration

The current workflow is documented in [Git workflow](docs/GIT_WORKFLOW.md). The isolated, tracked [PostgreSQL candidate](development/postgres-candidate/README.md) contains reviewable migrations, adapters, original-form previews and reproducible checks. It is not wired into the running application. Develop candidate changes there; retain ignored `work/` files only as local evidence. Feature branches and draft PRs provide remote source backup; merges and deployment are separate decisions.

Use `main` as the reviewed Companion baseline and focused `codex/` branches for preparation work; the current baseline is being reviewed in `codex/companion-candidate-consolidation`. Keep changes in focused commits and review them through pull requests before merging into `main`.

Inventory Build Main continues its current merge independently. Once that merge has a tested commit, create an integration branch in the Inventory repository from that exact commit and connect selected Companion components in stages. This repository supplies source and patches; it does not create a second authoritative inventory catalog or stock writer.

Preserve original record identities, restaurant and employee scope, revisions, retry receipts and history. Keep employee production reporting, manager verification and stock posting distinct. Preserve the Inventory build's Track 1 accounting boundary.

The [System Integration Plan and Guidelines](https://chatgpt.com/space/page_6ac7ad8305f48191836fed00d827da4c) is the shared preliminary merge plan. [Decisions and build status](https://chatgpt.com/space/page_6abd2330b148819189fc5f9a79583020) retains project decisions and handoffs. This source import does not deploy an app, apply migrations or enable live integrations.
