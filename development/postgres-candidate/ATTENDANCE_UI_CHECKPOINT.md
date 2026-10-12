# Manager attendance forms preparation

This candidate UI branch depends on unmerged PR40 backend head `d44fff2`. Accepted main remains PR39 `11a6931`. This slice adds no SQL: migrations 001–053, manifest and generated function snapshot match PR40 byte for byte. Keep this draft based on PR40's branch until its separate approval; then normally merge accepted main, retarget, retest and seek separate UI merge approval. No rebase, force-push, hosted application, active backend or Inventory change is authorized.

## Manager workflow

The isolated scheduling preview offers Attendance history only for server-projected `attendanceAreas`. Published shift details offer record attendance from `attendanceActions.canRecord`, including ended/released published shifts. Cancelled shifts preserve existing attendance in history. Five commands cover recording, correcting facts, voiding a mistake, individual review and reopening review. These commands do not implement completed-shift planned-detail corrections or retrospective leave flag resolution.

The candidate forms reuse the original `AttendanceFactFields` and `AttendanceFactsView` widgets. Current server action flags control correction/review/reopen/void; titles, scheduling authority and client-inferred manager roles do not grant access. Required facts, reasons and explicit unknown choices preserve the original workflow. Contact guidance is informational. Original member, shift and department remain distinct from any later reassignment, and current names are shown separately from the labelled name at time of entry/review.

Reported-time forms use the shift's saved timezone. Unchanged corrections preserve exact seconds/milliseconds and the original first/second occurrence. Ordinary prefills do not choose a repeated hour. Date/time changes clear an old occurrence selection; ambiguous hours require an explicit choice and missing hours are refused.

## Complete private reads

Attendance is kept out of the general scheduling workspace and employee reads. Range/detail controllers keep data in memory only and are reset by actor/scope/revision changes. Stale loads cannot repopulate an unmounted/changed controller. Private loading failure clears results rather than retaining stale notes, actions or totals.

The range loader drains bounded UUID pages, checks cursor progress/duplicates, range dates, record shape, viewer identity/permissions and a consistent workspace revision, then rechecks the viewer. Concurrent writes retry the whole range up to three times; more than 100 cursor pages requires a shorter range rather than displaying truncated totals. Malformed individual entries are held with no actions; valid entries remain available, but pattern totals are withheld until the whole range is valid. Counts exclude voided entries and count distinct original shifts once. They are not attendance rates, hours worked, pay, disciplinary points or emergency determinations.

Detail loading drains every ascending event page under the exact attendance revision, checks the before/after chain and original snapshot, rereads the record and viewer, then enables controls. No partial history is presented as complete. The collapsible history shows current/historical actors, original snapshots, before/after facts and reasons. Session/permission revocation stops loading without revealing additional pages.

## Submission and device behavior

The shared scheduling sender freezes the original command/request id and revision. A network/server failure keeps that exact command for in-page retry; malformed success responses also remain uncertain. A valid receipt/replay confirms the same action/result revision. Definitive conflict/access/validation responses clear the pending command and require fresh review. While uncertain, the preview disables other submissions and actor changes and offers Retry original submission. Attendance does not enter the employee task offline queue.

Durable attendance recovery across browser reload remains deferred: keep the page open for an uncertain command; after closing/reloading it, check current attendance and history before creating another entry. No private attendance cache, browser-storage payload or production device/sign-in adoption is added here.

## Evidence and adoption

Fresh fictional loopback PostgreSQL 17 applies 001–053 with unchanged snapshot. Local rendered/client and HTTP integration tests check all five actions, paging/counts, revocation, malformed records, original identity/current names, DST and frozen retry confirmations. Strict candidate types, original preview build and source-copy gate are checked before push; exact-head CI counts and browser evidence are reported in the draft PR.

During shared UI adoption, fold these candidate forms/loaders into the original `app/team/attendance.tsx` and related manager review flow, preserve server-projected authorization and bounded history, then remove `ui-attendance.tsx` and candidate-only adapters when the unified implementation is validated. Reuse the original fact widgets; do not add them to the three-copy source-hash gate. Existing copied-component retirement stays tracked separately.

Completed-record corrections/approval, retrospective flag resolution, copying/batch edits, source completeness, shared authz, notification delivery and Inventory integration remain open. This fictional browser preview is not production adoption or whole-app PostgreSQL readiness.

Browser rehearsal on the built fictional preview verified manager recording, correcting and reviewing, complete three-event history after reload, unchanged original shift details and no attendance controls/notes after switching to the employee. The final view was visually inspected and saved locally under work/attendance-ui-preview.png; runtime evidence is ignored and not published. No phone/tablet or production browser acceptance is claimed.
