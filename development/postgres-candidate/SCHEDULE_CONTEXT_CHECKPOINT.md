# Scheduling roster, eligibility and availability reads

Candidate migration 020 adds private scheduling eligibility and availability reference tables plus the paged `list_schedule_context` read function. The isolated HTTP handler exposes:

- `GET /api/operations/{restaurant}/schedule-roster`
- `GET /api/operations/{restaurant}/schedule-availability`

Both use optional UUID `after` and integer `limit` from 1 to 100 (default 50). They return authorized `items`, `nextCursor`, `workspaceRevision`, restaurant `timezone` and `coverage: 'schedule-context-references-only'`. UUID ordering and filtering happen before the page limit. These endpoints are separate from the active D1 workspace route and are not a complete scheduling workspace. Page sequences are not frozen snapshots; clients must refresh after revision changes.

## Roster and eligibility

The roster follows the source workspace's same-restaurant member inclusion rule: `active OR scheduleOnly`. This includes a retained inactive schedule-only row, as the source does. It is display eligibility, not proof that the employee may sign in or receive operational tasks. A valid reader must be active, auth-linked and not schedule-only.

Roster rows include membership ID, restaurant, name, department, position, active/schedule-only flags, `qualifications` and `scheduleJobs`. They deliberately omit emails, person/auth identifiers and capability grants and are a scheduling projection, not the full Member/Workspace authority object. Existing restaurant-wide member visibility is retained; department grants control availability records rather than this roster list.

`schedule_eligibility` records explicitly distinguish source `qualification` from `schedule-job`. Active rows populate the corresponding source arrays so the original `canScheduleJob` predicate remains usable. A job title alone does not establish eligibility, and inactive eligibility rows do not appear. These records do not create auth links, sessions, capabilities, station clearances or certification. The older candidate `job_assignments` proposal is not silently treated as reviewed scheduling eligibility. Production ingestion and final membership/multi-job modeling remain pending.

## Availability references

Availability items retain record ID, membership owner, restaurant/department, revision, updated instant and the original data object: dates, weekdays, minute boundaries, travel buffers, exception dates, kind, review status and decision. Source `visible` rules apply: owners see their own records in all statuses; scoped schedule managers see all statuses; scoped publishers see approved records. `schedule.change`, `people.manage` or `location.manage` alone do not widen these reads. Revoked grants and mismatched scopes are checked on later requests.

These are fictional reference rows, not an availability writer. The table checks basic reference identity/revision/status consistency; full source date/minute/replacement validation belongs in the future command/import layer. No save, review, supersession, overlap checking or schedule mutation is implemented in this slice. Restricted runtime cannot directly read or write either reference table.

## Validation and next step

Five new tests cover original roster inclusion, original job eligibility evaluation, availability visibility parity across eight grant profiles and twelve owner/department/status records, filtered pagination, preservation of buffers/exceptions, revocation, cross-scope denial, schedule-only denial, runtime table protection and session-resolved HTTP validation. These are source-policy and database/API tests, not a browser usability check or production import.

Fresh fictional bootstrap applied all 20 manifest-verified migrations. All 205 serial regression checks, strict adapter types, original-form preview build and source coverage inventory passed. Migrations 001–019 remain unchanged. This focused branch is stacked on the schedule shift read draft PR.

Next: controlled draft/edit and availability commands, preserving source validation and independent review. Add approved source ingestion for eligibility/availability before real use. Full scheduling still needs date-range reads, leadership, requests, coverage, staffing, attendance, publication/copy/import and complete form/workspace adoption. Inventory integration and hosted changes remain held.
