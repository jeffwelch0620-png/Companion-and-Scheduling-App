# Operational issues and reassignment checkpoint

Follow-up: [Ordinary station handoff checkpoint](STATION_HANDOFF_CHECKPOINT.md) completes the ordinary handoff slice proposed below. Linked checkout and overnight manager handoffs remain separate.

October 8, 2026. Isolated candidate extension; no active application cutover.

## Implemented slice

Append-only migration 004_issues_reassignment.sql adds issue alongside task as the stored workflow kind. Both use open/correction/verification/closed phases and independent manager verification. Existing task records become kind task. Handoff and checkout metadata remain unsupported and are rejected by the API adapter; this is not a replacement for every existing task workflow.

task.reassign now validates manager authority, restaurant, the current record revision and nonclosed phase. The target must be active, have operational access and remain in the original department. Issues cannot be assigned or reassigned to Dishwasher; ordinary tasks can. Capability grants do not override the existing Dishwasher restriction on manager actions.

Reassignment keeps title, definition, due time and kind, sets the responsible employee to the target, resets remaining work to open and increments the revision. Immutable history records the reason plus structured previousOwnerId and ownerId. New event assignee columns are backed by membership/restaurant foreign keys. Existing event assignees are backfilled from the task before any candidate reassignment existed. These columns record restaurant-membership identities, not global person IDs.

The original Companion history note format also includes previous/new membership IDs. The unchanged detail component currently displays those IDs in the reassignment note. A readable name presentation should be addressed before production adoption while preserving stable audit identities.

Both former and new responsible employees receive notification intent; same-person reassignment follows existing source behavior and produces one recipient entry. Task, history, scope revision, receipt and notifications commit atomically. A deliberately failed notification insert rolled the entire reassignment back.

Replayed manager commands recheck current authority. Former responsible employees cannot read the task or replay their old ready command after responsibility changes. A delayed unsent ready command from a former assignee is held as blocked; a stale version for someone still eligible is held for review. Nothing silently transfers that queued evidence to the replacement employee.

The adapter and isolated preview support issue creation and task.reassign. The existing FollowForm/FollowDetail source remains unchanged. Manager assignment/reassignment/checks still require a connection in the preview. Only employee ready submissions use the durable queue. The fixture display directory is not a production identity/permission refresh implementation.

## Validation

- All four candidate test files: 43 passed, zero failed/skipped (11 auth/queue, 12 capability, 12 issue/reassignment, 8 original task checks).
- New cases include correction/resubmission for issues, eligibility restrictions, same-department reassignment, rejected foreign/inactive/schedule-only targets, former-assignee denial, stale/closed task rejection, replay/payload conflicts, notification recipients, concurrent ready versus reassignment, device queue ownership changes and full rollback on notification recording failure.
- Signed JWT HTTP tests exercise issue assignment/reassignment and scoped reads through the route handler with server-resolved identity.
- Strict isolated TypeScript check and preview production bundle passed.
- Fresh test database previously initialized with 001/fixture/002/003 independently applied 004 and completed issue assignment → reassignment → ready → verification, with four history events.
- Browser test using the original forms created “Browser issue reassignment verification” for the fictional manager, reassigned it to fictional employee, submitted ready as employee and independently verified as manager. Server record ea07aba7-9fc4-4ecb-96e0-566d57318648 is kind issue, phase closed, revision 4. Browser history displays assigned/reassigned/ready/verify.

Evidence: runtime/issue-results.txt, runtime/issue-parser-results.txt, runtime/fresh-issue-migration-results.txt, runtime/issue-reassignment-pass.jpg. The parser-specific follow-up checks strict scalar kind validation. No actual mobile, real outage, external notification delivery or hosted Supabase evidence is claimed.

## Remaining boundaries

Handoff acceptance/dispute, shift-linked closing work, dishwasher cycles, delegated closing checks and prep-production integration remain excluded. Node/Worker deployment, real Supabase session and directory lifecycle, permission administration, multiple jobs, production audit alignment, shared-device queue privacy/recovery and durable retry handling for manager forms remain open.

The new SQL is candidate migration input only. Inventory's active merge and its changing food/audit contracts remain untouched. Files are retained under ignored work/postgres-candidate; no Git commit, push or merge occurred. The loopback browser test server and PostgreSQL server were stopped after validation.

## Next section

Migrate ordinary station handoff creation, independent verification, incoming acceptance/dispute and the associated responsibility/read permissions. Preserve the distinction between these ordinary handoffs, overnight manager handoffs and linked shift/dishwasher checkout work. Keep the special checkout workflows excluded until their source/cycle/shift guards are migrated explicitly.
