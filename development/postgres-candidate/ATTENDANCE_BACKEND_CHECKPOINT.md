# Attendance backend preparation (053)

This isolated candidate starts from accepted PR39 main `11a6931`. PR39 records the owner-selected correction permission for GM/ownership and designated department managers, independent approval for the author's own shift, and manager-only initial attendance visibility. This slice implements existing manager attendance only; it does not grant completed-shift correction permission or implement its ledger/approval workflow. Neither the active backend nor Inventory nor hosted services adopt this code.

## Stored facts and history

Corrective 053 adds private `attendance_entries` and append-only runtime-protected `attendance_events`. It preserves the original member/person, department, published shift revision, planned period/job and store timezone. Current employee and actor names resolve from candidate identity at read time; retained names are separately labelled `name at time of entry`. Shared adoption must use the shared employee repository.

Commands are `attendance.record`, `attendance.correct`, `attendance.void`, `attendance.review` and `attendance.reopen`. A recorded type is unique per original person/shift/store; correction checks the same uniqueness. Recorded entries carry explicit contact/coverage/emergency unknowns. Correcting reopens review, voiding retains review/history, and the existing 1,000-event ceiling remains. Reported time has the existing 60-second tolerance, and a no-show cannot precede the captured scheduled start. Contact guidance remains informational. Attendance is never transformed into hours, discipline, emergency classification or completed work.

Creating requires a current published, noncancelled source revision; ended/released published shifts are eligible. Later attendance commands address the original entry and preserve its identity even after reassignment/cancellation/release. A voided entry cannot receive a new mutation; the exact original receipt may still replay after later mutations.

## Authorization and atomicity

Active nonschedule-only actors require `location.manage` or department-scoped `people.manage`. The configured checkout position is excluded even with those capabilities. Scheduling authority alone and ownership of an attendance entry do not grant access. Commands, list/detail/history and server action projections enforce this rule. Unauthorized reads do not return private notes or counts. Direct runtime table/helper access is revoked.

The command acquires `lock_scope` before authorization or record locks. Receipt lookup precedes mutable source/status/revision validation; replay still checks current original-department access and exact payload. Entry, before/after event, workspace increment and receipt commit together. Failures roll back all four. Duplicate requests and different concurrent requests are coordinated. Policy/import writers retain the whole-transaction `40001` retry contract, with the same request identity. Attendance has no new notification intent: ownership correction notices belong to the later correction workflow and delivery remains separate.

Attendance advances the global workspace revision only. It neither advances scheduling/source counters nor changes shifts, bookings, completed tasks/closes or their history/receipts. A regression reviews a week, records/reviews/corrects/voids attendance, and publishes with the original still-current planning token.

## Read contract

- `GET /attendance`: scoped UUID pagination, limit 1–100, optional paired inclusive `from`/`to` dates interpreted using each entry's captured timezone. Voided entries remain available for history.
- `GET /attendance/:id`: private current record and current server action flags, without unbounded event history.
- `GET /attendance-history/:id`: ascending revision cursor (`after` 0–1000), limit 1–100, before/after events and current/historical actor names.
- Existing schedule viewer adds `attendanceAreas`; published shift references add `attendanceActions.canRecord`, including historical published shifts already visible to people managers. No attendance notes join general employee shift reads.

Each HTTP read uses one read-only repeatable-read transaction for session, authority and data. List `rangeComplete` and history `historyComplete` mean no further page after the returned cursor, not proof that a caller loaded all prior pages. The later client must drain pages and bind the same workspace/attendance revision before claiming complete totals; restart if revisions change. Count only recorded entries and distinct original shifts for attendance patterns. This slice adds no reporting consumer.

## Validation and remaining work

Fresh fictional loopback PostgreSQL 17 migrations through 053 and generated function snapshot matching, focused serial regressions, backend/UI types and the existing preview build are checked before push. Exact-head CI results and final test counts are recorded in the draft PR. The source-copy gate remains enabled. Published 001–052 and their manifest hashes stay unchanged. Snapshot changes are the nine new attendance functions plus explicit `list_schedule_shifts` and `schedule_viewer` definitions; no runtime regex patching is used.

Attendance manager forms are next; no attendance screen/browser adoption is claimed here. Completed-record correction commands/forms, retrospective flag resolution, source completeness, shared authz, notification delivery, copied-component retirement and Inventory integration remain separate. This draft requires separate review and merge approval; no deployment or hosted database application is authorized.
