# Ordinary-task capability permission checkpoint

Follow-up implemented: [Operational issues and reassignment](ISSUES_REASSIGNMENT_CHECKPOINT.md). The next-slice recommendation below records this checkpoint's prior state.

October 8, 2026. Isolated candidate only. This advances the ordinary-task portion of the previous forms checkpoint; it does not establish complete Companion permission parity.

## Change

Append-only migration 003_capability_permissions.sql replaces can_manage_tasks with explicit membership_capabilities rows. Existing fictional manager flags become tasks.manage grants, then the flag is removed. No location or operations capability is inferred from a title. Existing migrations 001 and 002 remain unchanged.

The candidate task_manager policy follows Companion's manages rule for eligible staff: tasks.manage is required, with either matching department or explicit location.manage. operations.store does not widen ordinary-task authority. Dishwasher cannot assign, correct or verify even if accidentally granted those capabilities; they can submit their own ordinary work as ready. Independent verification still requires a different person.

The candidate now checks this policy in assignment, manager transitions, scoped task details/lists, managerial receipt replays and review notification recipients. It checks the stored task department when replaying a manager receipt, so revoking location-wide access blocks replay of a cross-department command. Restaurant boundaries remain separate from department scope.

Candidate memberships add position and schedule_only. The task form already excludes schedule-only assignees. The candidate additionally denies task operations/reads for schedule-only identities as a conservative boundary; this is not proof of parity for every existing sign-in or read route. Production identity/session provisioning must reconcile that boundary explicitly. position is used for the existing Dishwasher restriction only; it never grants permissions. The fixture's single position and department do not resolve the proposed multiple-job identity model.

The SQL generator build-permission-migration.mjs extracts existing function bodies, verifies expected transformation fragments and writes a standalone reviewable 003 migration. It is a candidate assembly tool, not a runtime migration runner. Runtime role still has no direct capability-table access or authority to call the internal policy helper.

## Evidence

- Original PostgreSQL/auth/queue suite: 18 passed, zero failed/skipped after migration.
- New capability suite: 12 passed, zero failed/skipped; includes 18 capability/department combinations compared directly with Companion's imported manages function.
- Positive and negative cases cover explicit location-wide grants, GM title without grants, location.manage without tasks.manage, operations.store restrictions, other departments/restaurants, dishwasher behavior, schedule-only identities, reads/list filtering, grant revocation and saved receipt replay, notification recipients and direct runtime privilege denial.
- Two database connections verify that an attempted downgrade of a grant used by an uncommitted operation waits on its row lock. Once the authorized transaction commits, revocation succeeds and replay is denied.
- Fresh database companion_candidate_fresh_003 independently applies 001, fictional seed, 002 and 003 under candidate_schema_owner, checks initial department scope, and verifies removal of the legacy flag. No real data exists in this database.

Evidence files: runtime/permission-regression-results.txt, runtime/capability-results.txt, runtime/fresh-permission-migration-results.txt. Tests use real loopback PostgreSQL and candidate_runtime for application operations. The capability tests supply trusted fictional identities directly; the separate 18-check suite covers JWT/session verification. No new browser or mobile evidence is claimed for this backend-only change.

## Boundaries still held

- No production grant-management endpoint exists. Future administration must lock the restaurant first and coordinate membership/grant changes consistently. The tested row lock protects existing grants through the authorized commit; it is not a completed administrator workflow.
- The preview still uses fixed fictional display members/capabilities. It does not fetch a production identity directory or dynamically reconcile UI controls after a grant change. Server denial is authoritative; a production UI needs capability refresh and useful error handling.
- Full ordinary-task behavior is not migrated: issue type and reassignment remain next. Handoff acceptance, shift-linked closing, dishwasher cycles, delegation and checkout guards remain separate work.
- operations.store is retained as an explicit grant but is not yet implemented for the special closing/operations workflows. location.manage widening mirrors current ordinary-task source; shared owner/GM policy still requires the final agreed model.
- Node/Cloudflare deployment boundary, real Supabase identity/session lifecycle, production audit mapping, shared-device queue handling and multiple restaurant/job decisions remain open.
- New files stay in ignored work/postgres-candidate. No active Companion source, Inventory checkout, hosted Supabase, Git commit, push or merge changed. Both candidate databases remain local fictional test artifacts; the test PostgreSQL server was stopped after validation.

## Next isolated slice

Implement ordinary operational issues and task reassignment using the existing source restrictions. Reassignment must preserve history, reset remaining work to open, check both original and target department authority, reject closed work, and retain version/idempotent receipt checks. Keep handoffs and checkout-linked work excluded until their separate guards are migrated. Refresh Inventory's ready baseline before deciding any merge or shared food-schema adoption.
