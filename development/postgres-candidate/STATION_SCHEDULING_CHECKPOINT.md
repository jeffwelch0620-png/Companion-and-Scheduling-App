# Station scheduling checkpoint

Candidate-only preparation on reconciliation baseline `18ac2f6`. Migration 025 adds station scheduling references, station-aware draft saves and a scoped paged `schedule-stations` endpoint. Published migrations 001–024 are unchanged. Additive replacements preserve draft authorization/conflict/audit rules and add station metadata to shift reads and time-off cancellation audit entries. No active Companion cutover, Inventory merge, hosted application or deployment is included.

## Assignment rules

A selected station must belong to the employee's restaurant and department, be active and configured, contain the selected scheduling job, and either include the employee explicitly or permit all eligible job holders. The employee still needs an active qualification/schedule-job reference. Schedule-only employees remain schedulable under the existing roster rules; sign-in and managerial authority stay separate.

Dish-only employee titles/jobs cannot use stations. The SQL label predicate is checked against the original `canonicalJobRole`, including AM/PM variants and mixed jobs such as `Dish / Prep`. Station membership grants neither scheduling jobs nor training clearance, trainer status or application permissions.

New drafts can select a station or remain without one. On edits, omission preserves the existing station; null/empty input explicitly clears it. Current station status and eligibility are rechecked. The shift retains station ID, title and reference revision, and draft audit entries record them. The reference revision is additional candidate evidence; the original shift contract contains station ID/name. Changes to a station do not silently rewrite prior shift snapshots.

Unpublished, unreleased, command-created and unlinked draft restrictions remain. Tasks, closes and standard links protect station changes, including database-level metadata changes on linked shifts. Approved time off can cancel an otherwise eligible unlinked station draft and retains its station metadata in the cancellation audit. Published shift changes, learning-goal proposals and closing-transfer rules remain held.

## Reads and reference scope

`GET /api/operations/{scope}/schedule-stations` uses verified sessions, bounded UUID paging and explicit scoped schedule-manage/change/publish capabilities. It returns station ID/title/status, department/revision and only the scheduling portion of setup: jobs, all-job eligibility and selected member IDs. It is a scheduling-selector reference projection, not the source's broader employee station/training view. Unknown, foreign-department and archived references cannot be assigned even if a caller supplies their ID. Runtime cannot write station references or execute private eligibility helpers.

Reference setup remains privileged fictional input. This does not migrate `readStationSetup` editing, goal templates/reviewers, guide relationships, proficiency assessments, station definition/version changes or complete source ingestion. Those source fields must be reconciled rather than discarded before original station UI adoption or publication. Administrative station/eligibility writers must use restaurant-first coordination; privileged direct fixture SQL is not a production writer. Full station configuration commands and source export/import are still required.

## Validation and next step

Local validation passed: fresh 25-migration bootstrap; all 261 serial candidate checks; strict adapter types; original-form preview build and coverage inventory. Eleven new checks cover station snapshots/read/audit, preserve/clear edits, archived/unconfigured/scope/job failures, explicit/all-job membership, original source predicate parity, Dish labels, retries/revocation, linked work, atomic rollback, HTTP sessions/paging and time-off cancellation. Historical draft validation now treats an unknown station as a denied assignment. These are command/API checks, not browser validation of original station forms. GitHub validation is reported separately on the draft PR.

M06 remains open. Next: station setup/configuration commands with their source guide/member/goal/reviewer requirements, followed by publication and protected shift-change workflows. Employee training and hosted adoption remain separate migration work.
