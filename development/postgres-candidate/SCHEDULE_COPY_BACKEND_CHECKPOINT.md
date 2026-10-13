# Reviewed schedule copy backend preparation

Isolated draft from accepted PR46 main `e8d2c022ec2e025e0efb92ea69ed42517582b5e2`, whose [merged-main CI](https://github.com/jeffwelch0620-png/Companion-and-Scheduling-App/actions/runs/38339285288) passed 792/792. The owner selected P01–P09 in the [copy/batch design](SCHEDULE_COPY_BATCH_DESIGN.md) and authorized the next isolated preparation slice. This checkpoint implements **copy only**; batch replacement writes and forms remain separate. It does not change the active D1 backend, Inventory or hosted services, and requires its own review and merge approval.

## Contract

- POST `/copy-review` accepts one store's `sourceWeek`, later `targetWeek` on the same weekday within 52 weeks, 1–100 selected shifts and up to 100 staffing needs. Each selection has an exact source ID/revision and optional separate `startOccurrence`/`endOccurrence` (`earlier` or `later`). The complete bounded selection includes source/destination times, current source revision and staffing title/minimum; no silent truncation or hidden per-draft HTTP loop.
- `shift.copy-week` saves the reviewed selection with `reviewToken`, `confirmed: true`, a required reason and a frozen request ID. The backend recomputes a canonical digest, with no signing secret, stored review state or expiry. A changed relevant context refuses the whole stale review before writes. This is context equality, not a grant of authority or certification of real source completeness.
- An active nonschedule-only, noncheckout actor needs current `schedule.manage`; `location.manage` widens department scope but does not substitute for scheduling permission. The command and receipt replay recheck current authority. An inaccessible source gives an unavailable row without its department, duties or private identity facts.
- Shifts keep their currently eligible employee/job and station. Station eligibility is checked with the accepted helper; an invalid station produces `station_needs_individual_review`, without clearing it. Source drafts or published shifts may be copied; sources stay untouched. New shifts are unpublished, unreleased drafts with fresh IDs, current station metadata and one draft audit event.
- Copy **does not create closing assignments**. The review shows the authorized source's omitted closing count; closing answers, phases, private notes, reviewers, attendance, corrections, consent, offers, leadership authority and receipts are not copied. Managers assign closing duties separately before publication. No employee draft notices or learning-goal completion are created.
- Approved staffing needs may independently copy as new unapproved drafts, preserving the existing requirement for an active/schedule-only member in that department. A rejected shift cannot reject otherwise valid staffing, and rejected staffing cannot reject an independent valid shift. Staffing approval, staffing gap review and weekly publication remain their existing separate workflows; this package does not promise coverage or add a new gap calculator.

Copies use the stored scheduling definition; attendance and completed-correction ledgers are not read as templates. No worked hours or effective reporting correction is imported into a new draft.

## Partial outcomes and replay

Every selected row returns `saved` (new ID/revision) or `rejected` (safe issues). The response identifies the logical batch with `recordId = requestId` and `revision = 1`; that ID represents its durable receipt, not a new WorkRecord kind. Counts, workspace/scheduling/input revisions and the complete outcome list are validated by the adapter.

Individual checks preserve current eligibility, source revision/week, configured station rules, positive duration up to 24 elapsed hours, future destination starts, availability, person-wide approved leave and active-copy duplication. Existing bookings are checked with the canonical GiST/person helper, across stores, without returning foreign booking or private leave identifiers.

Copy creates rows with no old destination slots to restore. Both sides of a conflicting pair of individually eligible proposed slots are permanent rejections, including when one also has an external booking conflict. Outcomes and conflict source IDs are sorted and independent of input order. The accepted design's A→B→C and failed swap rejection propagation concern **batch replacements** and remain requirements for that later slice; this package does not claim to implement or test replacement closure.

The valid subset, provenance, draft/staffing audit events, bookings, revision changes and one complete request receipt commit in one transaction. Expected row rejections leave their records untouched. Any database, audit or receipt failure rolls back the whole attempted transaction. An all-rejected submission records its result without advancing the workspace/scheduling revisions. Same-ID replay returns the original saved/rejected outcomes and does not try rejected rows again; changed payloads conflict. Revised rejected rows require a new reviewed request.

Private `schedule_copy_origins` keeps kind, source ID/revision, fixed source key, original/destination weeks, captured timezone, actor, request and target ID. Active duplicate checks use the stable source ID/week, not its mutable revision. Cancelled shift copies and retired staffing copies permit recopy, while retaining old provenance and audit evidence. Same-store coordination serializes concurrent copy writers; raw privileged writes must honor the shared coordination contract during adoption.

## Time and concurrency

Local calendar dates and overnight date offsets move in the store's configured timezone, preserving wall-clock time. Destination offset discovery handles repeated hours and half-hour/date-line offsets. Nonexistent times are refused; newly repeated start and end fields require their own occurrence choices. A fall-back copy that exceeds 24 elapsed hours is refused. UTC elapsed-week arithmetic is not used.

Before review revalidation/writes, the command takes its store coordination lock and sorted NOWAIT locks for existing memberships of selected authorized people. Person-wide booking/leave inputs therefore remain coordinated through commit. A held peer scope raises retryable `40001` and writes nothing. The existing exclusion constraint remains the final overlap guard.

As required by the design, this first implementation preserves store-wide publication freshness: successful copy shift writes advance `schedule_revision`, invalidating older weekly planning tokens even for another week. Staffing input writes also follow the accepted `input_revision`/source re-attestation contract. Rollback and all-rejected results preserve planning tokens; receipt replay advances nothing. Week-scoped publication freshness remains deferred.

This PR folds in the tracked coordination message because it touches `task-http`/`schedule-screen-client`: only SQLSTATE `40001` plus exact `scope_coordination_retry` maps to HTTP 503 `coordination_retry`, with "Another store is updating these records. Retry the original submission." The existing sender retains the frozen request. Actual outages and unrelated serialization errors remain `service_unavailable`. Copy forms are not enabled in that sender yet; copy HTTP/receipt behavior is tested directly.

## Migration and validation evidence

Corrective `059_schedule_copy_backend.sql` follows immutable published 001–058. Its manifest entry and fresh PostgreSQL 17 function snapshot are regenerated; the snapshot adds only `copy_selection`, `copy_local_instant`, `copy_actor`, `copy_plan`, `read_schedule_copy_review` and `copy_schedule_week`. Runtime gets only the two reviewed entry points; raw provenance and private helpers remain inaccessible. Explicit function definitions are used, not apply-time regex patches.

Fresh fictional PostgreSQL 17 application through 059, manifest/snapshot verification and the final serial local suite passed **812/812**, zero failures/skips. This includes **20 new copy checks** plus existing scheduling, identity/coordination, closing, queue, attendance and correction regressions. An earlier focused checkpoint passed 28/28 before the final three copy cases were added. Strict backend/UI types, coverage inventory and the original-form preview build passed. Exact-head CI evidence is recorded on the draft PR after completion.

Copy checks cover partial saves and staffing independence/department guards, replay/concurrency, active duplicates and cancellation/recopy, relevant versus global revision freshness, foreign leave/bookings privacy, paired proposal rejection, retained stations, DST/overnight/duration (including reversed occurrences), bounded selections and a complete 100-real-source copy under the normal runtime transaction budget, receipt-failure rollback, cross-store retry, real outages and publication token invalidation. These checks validate candidate preparation, not hosted behavior, new copy forms or whole-app PostgreSQL readiness.

## Next slice and adoption limits

Review and accept this copy backend before adding batch draft replacement writes with the selected greatest-fixed-point/dependency rules. Then prepare the copy/batch forms and actual fictional browser checks. Reconcile candidate forms into the original components and retire copies/adapters during shared adoption.

Production source completeness and ingestion, shared identity/authz/current owner resolution, actual notification delivery, durable schedule recovery and the exact tested Inventory baseline remain open. A Git merge does not apply migrations or deploy the candidate. Actual timekeeping, commissary labor allocation, attendance self-action policy changes, fresh closing-copy support and published batch edits are outside this package.
