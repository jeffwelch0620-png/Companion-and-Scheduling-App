# Explicit store configuration preparation

This focused candidate package starts from accepted Companion main `a344421` (PR29). PR28 and PR29 were separately approved and merged; PR29's merged commit passed 457/457 tests and CI. Inventory's tested baseline is still required before the separate shared-database port. The active D1 backend, Inventory and hosted services are unchanged.

## Configuration contract

Corrective migration 041 removes the implicit restaurant timezone default. New stores must explicitly supply a PostgreSQL-recognized timezone, operational departments, the department and primary job used for checkout, and explicit checkout job aliases. Provisioning remains private to the schema owner; this package adds no employee-accessible configuration command or management permission.

`operating_departments` replaces the old FOH/BOH restriction for the existing `tasks.manage` plus `operations.store` closing scope. It does not replace department-local authorization or grant capabilities. `dish_department` and `dish_position` replace fixed checkout department/job comparisons. `dish_aliases` replaces the global English job-name recognizer in station rules. Primary-job comparisons retain their existing exact-match behavior; station aliases ignore case and repeated whitespace. Ordinary or mixed jobs do not become checkout jobs based on their spelling in another store.

The one-time 041 backfill preserves the legacy candidate's explicit FOH/BOH and Dishwasher contract for existing rows, including recognized station aliases. These values are not defaults for new stores. The shared-database port must supply independently reviewed store mappings and must not copy this fictional compatibility backfill or infer privileges from titles. Creating or renaming actual Inventory catalog records is outside this preparation.

All 34 affected function definitions are explicit complete definitions in 041, preserving scope coordination, record locks, receipt authorization, independent checks and existing shift/leave policy. There is no apply-time regex rewriting. The generated sorted function snapshot and manifest accompany the correction; published migrations 001–040 stay unchanged. The old one-argument label helper is removed. The station job constraint is replaced by its existing text-shape constraint plus a store-aware role trigger.

## Changes and history

Existing restaurant policy coordination runs before configuration validation. A writer that conflicts with an in-flight command receives `40001` and must retry its whole transaction without external side effects. Valid timezone or operational-department changes advance the workspace revision and invalidate scheduling review/evidence. Identical writes do neither. Required configuration, valid names, array shape, uniqueness and primary-job inclusion are checked on provisioning and configuration changes. Existing timezones are validated before the migration changes anything. Ordinary workspace revision writes retain validated configuration and bypass the expensive timezone enumeration.

Changing the meaning of checkout jobs/departments under existing memberships, shifts, checkout cycles or stations is rejected with `store_role_configuration_in_use`. A future explicit migration must reconcile those records and preserve historical interpretation. This package does not silently rename jobs, departments or stored UTC shift times.

Authenticated scheduling viewers receive their store's configuration with its actual timezone. The scheduling screen loader retains that location metadata. Runtime cannot directly read/write restaurant provisioning or execute the private role helpers. Other-store configuration and private identity links are not added to employee projections.

## Validation and next work

Fresh fictional loopback validation on 2026-10-10 used `companion_candidate_config5`: migrations 001–041, matching generated function snapshot, candidate types, original-form preview build and readiness inventory passed. All 468 distinct regression cases passed: the initial suite passed 465, and three existing psql-dependent cases passed 3/3 on rerun after explicitly setting the local client path. All eleven new configuration cases passed in the full run. GitHub CI must be verified separately against the final pushed head. The build retains its existing logo-path warning; no new live browser exercise was performed.

Fictional fixtures now provision explicit configuration; old migration-037 upgrade evidence remains pinned to its original schema. The PR28-to-PR29 upgrade rehearsal applies later corrections after that accepted baseline, so it cannot reintroduce old function bodies after 041.

Regression coverage includes required/invalid configuration, several timezones, custom Service/Kitchen departments and a Steward job, narrow capability boundaries, a complete three-person checkout with independent checks, store-aware station jobs, scoped viewer metadata, review invalidation/no-op preservation, guarded remapping and concurrent configuration retry. Effective function sources are checked for legacy policy literals and prohibited restaurant row write locks.

Production provisioning and the original D1/shared UI configuration adoption remain part of the reviewed backend/UI port. The current candidate scheduling reads expose configuration; original shared forms and other still-unmigrated modules retain historical job assumptions and must consume these mappings before using custom names in those interfaces. No live browser exercise or production readiness claim is made by a preview build. Remaining scheduling interfaces, attendance/corrections, notifications, shared authentication, prep offline delivery and recovery remain open.
