# Schedule board and individual draft editor

The isolated `/schedule-forms` preview now uses the original Companion day/week/personal board and individual shift editor. The request screens remain accessible from the board. No active Companion or Inventory application source changed; no database migration was added or rewritten.

## Behavior and boundaries

- Complete paged reads now include scoped station setup. Existing guide/goal IDs remain exact; legacy station setup without any saved guide/goal arrays is adapted to empty arrays for the source editor's count display. No guide contents, training clearance or publication permission is inferred.
- Week navigation filters shifts by their start date in the restaurant timezone, hides cancelled shifts and uses calendar-day arithmetic. The original board preserves personal published-only display and management day/week views. New drafts start on the selected day when that day belongs to the displayed week.
- Original shift editor retains local-clock/DST controls, scheduling job selection, station eligibility and saved overlap/availability/time-off checks. Server-side checks remain authoritative. Individual create/edit uses `shift.save`, exact existing revisions and the screen's uncertain-delivery request ID retention.
- Published, cancelled or released records cannot enter the draft command through the client. Imported and linked drafts remain protected by PostgreSQL. Published records open a read-only summary; publication, published changes, coverage, leadership, copying, attendance, closing and batch-edit controls are not enabled here. The page explicitly says attendance is not loaded; absence of a badge is not proof of attendance.
- Fictional preview fixtures include a published reference and command-created station draft for a schedule-only inactive roster member without login access. Empty fictional time-off input is explicitly marked reviewed; this never certifies a real export. Local instants use the source timezone conversion instead of a fixed DST offset.

## Validation

Fresh loopback database `companion_candidate_board1` applied all 34 unchanged migrations. All 386 serial regression checks passed; strict adapter types, preview build and source coverage inventory passed. Two new client checks cover station setup retention/legacy compatibility and draft edit envelope/phase guards. Existing database tests cover job/station/permissions, conflicts, imported/linked protection and atomic retry behavior.

Browser rehearsal on October 9, 2026: employee personal view showed only the published two-hour shift. Manager saw the published reference and schedule-only station draft; created a station-aware employee draft, edited its end from 11 PM to 10 PM, and read back the six-hour draft. Week/day navigation and empty next week were checked. Employee view after these writes continued to show only its published shift. Selecting Saturday populated Saturday in the new-draft editor. Source schedule wrapper restored the selected-day color and was visually checked. Local fictional screenshot remains ignored at `work/postgres-candidate/runtime/schedule-board-preview.png`. Mobile viewport, browser outage/recovery and publication/closing controls are not covered by this rehearsal.

## Next gate

See [candidate merge review](CANDIDATE_MERGE_REVIEW.md). Begin a reviewed Companion candidate baseline consolidation before extending the dependency stack further. Actual merging still requires the user's explicit decision on a concrete reviewed PR. Inventory integration remains held for its tested baseline and canonical shared-data contracts. M06 stays open for remaining scheduling UI workflows, copying/attendance, source completeness and production adoption.
