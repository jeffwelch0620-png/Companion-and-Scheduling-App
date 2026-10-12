# Completed planned-shift correction UI preparation

This dependent candidate slice starts from PR42 backend head `7bb2beb` on `codex/companion-completed-shift-corrections`, above accepted PR41 main `c69792d`. It does not accept PR42 or adopt its backend. The UI requires its own draft review and separate merge approval after PR42 is accepted and this branch normally incorporates updated main. No migration, manifest or function snapshot changes are included; shared 001–055 stay immutable.

## Manager workflow

- Explicit `schedule.correct` capability exposes a private correction screen. Job titles and `location.manage` alone do not expose it. This is a navigation hint; existing scoped server reads and commands enforce current authority and person-level independence. Correction records never enter the employee workspace or the application's WorkRecord union.
- Managers can browse completed published shifts and the separate correction ledger. Before acting, the screen re-reads the selected source or ledger and drains its complete audit history. Current names and labelled names at time of entry appear separately.
- The form captures planned start, end, position and a required reason in the original captured timezone. The original and effective summary remain visible. A proposed own-person change stays pending with the prior effective summary; the server projects approval, rejection and withdrawal controls. A different authorized person must approve. Later rejected or withdrawn proposals preserve the last applied summary.
- These are planned details, not attendance-derived worked hours or payroll. Original shifts, work, attendance and audits remain unchanged. Ownership notice intents are recorded atomically by the backend; this UI does not deliver notifications.

## Reads, time handling and recovery

Source pagination fixes `asOf` and binds scheduling and correction counters. Ledger pagination binds the correction counter; before/after authority projections include actor, scope, correction/location capabilities, department, position and store configuration. A final source read checks counters. Ordinary global workspace writes do not restart private correction reads. Every page must advance without repeated IDs/cursors; reads are bounded. A malformed individual list entry is omitted with a review notice and no actions. A malformed selection or incomplete/discontinuous history provides no mutation controls.

Detail history binds its exact ledger revision, validates immutable origin and contiguous before/after snapshots, and checks that the final status, proposal, author and effective summary match the current record. Source/record reads and authority are checked again after history drains. Commands independently recheck current permissions, source and record versions.

Unchanged local fields preserve original seconds/milliseconds and the exact repeated-hour occurrence. Date/time edits reset the occurrence selector, so new ambiguous hours require a choice and nonexistent hours are refused. Zero-only precision beyond milliseconds can be removed without altering an instant; a source with significant sub-millisecond precision is held for explicit reconciliation because the existing command contract accepts at most milliseconds. This limitation must be resolved if such source data is ingested; the form never silently rounds it.

The shared screen sender freezes the exact request ID/payload on network failures, temporary services or malformed success receipts. In-page retry validates the returned ledger/status/effective revision. Definitive conflicts clear the uncertain request and require fresh review. These private manager commands require a connection and are not in the employee offline queue. A browser reload loses the in-memory retry; managers must check the current ledger before submitting again. Durable recovery remains a separate device-privacy decision. No correction payloads are stored in browser persistent storage.

## Evidence and remaining adoption

Local fictional PostgreSQL 17 was freshly migrated through 055 on loopback port 55462. The schema snapshot matched. Local focused regression checks passed 56/56, including 15 new UI/client/HTTP checks, current attendance forms and correction backend regressions. The HTTP checks cover applied coworker changes, lost committed responses/replay, private employee denial, own-person approval and six-event approve/reject/withdraw history. Strict candidate/UI types, preview builds and the existing narrow source-copy gate passed.

The actual isolated browser preview on port 6613 verified an own-shift end-time proposal, no self-approval control, independent approval, preserved original 12:00 end versus effective 12:30 end and two retained audit events. Switching back to an employee removed correction navigation. The screenshot is ignored local evidence in `work/correction-ui-approved.png`; no fixture sessions, database files, generated modules or images are published. CI evidence is recorded on the draft PR for its exact head.

During adoption reconcile these isolated loaders/forms into the shared manager workflow and retire the candidate adapter. Resolve shared authz/current owner recipients, notification delivery and reporting ownership first. Retrospective leave-flag resolution, copying/batch editing, source completeness and Inventory integration remain separate. Confirm Inventory's tested baseline before its integration branch. Git acceptance is not hosted application or deployment.
