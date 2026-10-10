# Companion forms and permission checkpoint

Follow-up: [Ordinary-task capability permission checkpoint](CAPABILITY_PERMISSION_CHECKPOINT.md) replaces the prototype manager flag for the ordinary-task slice. The matrix below records the state before that extension; special workflows and production identity/administration remain open.

Date: October 8, 2026. Isolated development evidence; no production cutover.

## What now works

The candidate preview imports Companion's existing FollowForm and FollowDetail directly from app/team/followthrough-forms.tsx, plus its workspace.css. Those source files were not edited or replaced. Vite bundles them into development/postgres-candidate/runtime/forms-dist. The preview surrounds the original components with a fictional actor selector, candidate HTTP sender and queue status display. This is a task-focused preview, not the complete Companion /team shell.

The forms send the existing task.create/task.transition vocabulary. The adapter attaches a request ID and expected record revision; authenticated PostgreSQL routes resolve the actor. Fictional membership IDs come from a fixed local fixture, not a production employee directory. The preview fetches all pages of scoped task reads. It does not treat a pending device submission as completed server work.

The browser observed this sequence:

1. Fictional manager assigns “Forms migration verification” to fictional employee with the original form.
2. Employee selects the task and reports ready while delayed submission is enabled.
3. IndexedDB shows pending with zero attempts, while the server task remains open.
4. Page reload resets the fictional actor selector to manager; manager sees no employee queue. Selecting employee reveals the retained pending submission.
5. Reconnect submits it; queue shows applied with one attempt and server task becomes verification.
6. Manager records an independent check through the original detail form. Task closes, displaying assigned/ready/verify history.

Database verification: task 16949c95-9e75-4c3e-86dc-320ec0711d49, phase closed, revision 3, three events, exactly one ready event. An attempted operational issue was visibly rejected by the preview before submission; no “Unsupported workflow probe” task exists. This prevents silent conversion of excluded workflow types into ordinary tasks.

The 18 existing PostgreSQL/auth/queue checks were rerun after adding the preview: 18 passed, zero failed/skipped. The preview production bundle built successfully. Browser evidence uses a simulated delayed sender; it does not establish a full offline app, network-disconnected page loading, mobile persistence or real Supabase login.

Evidence:

- Screenshot: runtime/forms-workflow-pass.jpg
- Regression output: runtime/forms-regression-results.txt
- Build entry: build-forms-preview.mjs
- UI adapter: forms-preview.jsx
- Fictional server: browser-harness-server.mjs, /forms at loopback port 6610

## Permission reconciliation from current Companion source

These are observed current application rules, not new authorization decisions. The shared permissions design PDF remains a proposal to discuss.

| Workflow/rule | Existing Companion behavior | Candidate coverage / required work |
|---|---|---|
| Restaurant and active membership | Member lookup uses active restaurant workspace; records have restaurant identity | Candidate checks active membership and verified subject in selected restaurant. Production directory and identity provisioning remain open. |
| Ordinary assignment | tasks.manage in employee's department; location.manage widens that capability's department scope; Dishwasher cannot assign | Prototype has same-department can_manage_tasks only. Replace the boolean with explicit capability/scope mapping before cutover; preserve actor job restriction. |
| Responsible employee | Active employee at restaurant; schedule-only people excluded from form; ordinary work may target Dishwasher | Fictional preview uses two active BOH members only. Schedule-only and job restrictions are not encoded in candidate schema. |
| Employee ready | Assigned employee, phase open/correction; dishwasher has additional allowed-step limits | Candidate enforces assignee and phase for ordinary tasks. Job-specific rules and special checkout checks still need migration. |
| Ordinary fix | Authorized task manager; task not closed | Candidate checks same-department manager and nonclosed phase. Broader capability scopes still need mapping. |
| Independent verification | Authorized task manager; verification phase; verifier different from responsible employee | Candidate implements these checks for ordinary same-department work; self-verification regression passes. |
| Whole-store operations | operationsManager requires explicit capabilities; tasks.manage + operations.store can cover FOH/BOH; not independent commissary membership | Not represented by one can_manage_tasks flag. Do not grant access by “GM” title alone or widen ordinary-task access merely from operations.store. |
| Shift-linked tasks | Active published matching shift; due during shift; canManageClosing authorization; verification is separate from manager shift checkout | Excluded. Candidate rejects shiftId; no shift data is fabricated in preview. |
| Dishwasher checkout/incoming work | Department/store operations reviewer; linked cycle, coverage, incoming receipt and remaining work guards | Excluded. Preserve source links and cycle checks in a separate migration slice. |
| Station handoffs | Different eligible incoming employee; independent verify moves to acceptance; incoming accepts/disputes | Excluded. Candidate rejects kind handoff and unsupported transition steps. |
| Operational issues | Existing task kind issue | Excluded from this ordinary-task slice; preview refuses it explicitly. |
| Reassignment | Task manager, eligible same-department target, not closed; restrictions for linked shifts and dishwasher cycles; reset phase open and retain history | Excluded; preview sender rejects task.reassign. Current source detail can expose this control to manager, with a clear unsupported-workflow message if attempted. |
| Membership/capability revocation | Application permission model must be enforced on each action | Candidate checks membership and manager rights on new commands and relevant receipt replays. Production capability lifecycle is not connected. |
| Multiple restaurants/jobs | User decision and final shared identity model pending | Keep stable person/membership separation; do not collapse identities by name or adopt one job forever from this fixture. |

Source references: app/shared/types.ts manages; app/shared/domain.ts task.create, task.transition, task.reassign; app/shared/operations.ts operationsManager; app/shared/closing-access.ts canManageClosing; app/team/followthrough-forms.tsx eligibility and buttons.

## Cutover boundaries and next work

The working candidate remains Node plus node-postgres. Companion remains a Cloudflare Worker with D1. This preview proves the component/HTTP contract against Node; it does not prove that node-postgres can be imported into the deployed Worker. Decide and test a service boundary before deployment. If a separate service is chosen, production requests need same-origin routing or explicit origin handling, proper hosting secrets/pooling and authenticated session provisioning. None are configured here.

Recommended next isolated slice: design explicit capability and scope grants against the current Companion rules above, then validate same-department, whole-store, cross-restaurant, dishwasher and revocation cases. Do not migrate all tasks using can_manage_tasks as the final policy. After ordinary-task permission parity, add reassignment and issue workflow; keep handoffs and shift/dishwasher checkout as separate slices with their existing guards.

Before active UI adoption, handle uncertain assignment/manager submissions with stable retry IDs, prevent duplicate form clicks, preserve or explicitly recover unsent form drafts, add useful review/rejected queue recovery and shared-device logout handling, and test responsive layout on actual phones/tablets. The existing employee ready queue has durable request IDs, but the preview's ordinary assignment/manager sender is still a test adapter and does not retain uncertain responses across reloads.

Inventory's active merge, food service contracts and audit contracts must be refreshed when its baseline is ready. No Inventory checkout, hosted Supabase, production data, source migration history, Git commit or Git push was changed by this checkpoint. Test services were stopped after validation.

Unchanged source SHA-256:

- app/team/followthrough-forms.tsx: BF54BD22064FB0ABC362CDB589CDACF9E2E3A59655F2906736866785C67445A6
- app/team/workspace.css: E3D896A3D2CCF8F537BF693C7C041F603B2CE6A898798E6E6F608723C377D399
