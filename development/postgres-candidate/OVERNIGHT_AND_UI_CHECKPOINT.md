# Overnight Issues and Original-Form UI Checkpoint

October 9, 2026. Two sections completed in the isolated local candidate. No active app edits, Inventory merge, hosted changes, commit or push.

## 1. Overnight responsibility and related checkout transfer

Migration 015 implements the source's distinct overnight-issue workflow: `handoff.create` and `handoff.transition`. Active closing/opening leadership references and scoped task-management grants are required. Opening leadership must follow closing leadership. The closing manager must explicitly confirm safe deferral. Urgent issues require an authorized escalation recipient and commit notification intent for that recipient.

The closing manager retains responsibility while the issue is offered or disputed. Acceptance transfers responsibility to the named opening manager without resolving the issue. The responsible manager may subsequently record resolution. Clarified offers and cancellation preserve the source phase rules.

Recovery of accepted unresolved work requires a different authorized replacement with current or upcoming leadership. The recovering manager remains responsible until replacement acceptance. Priority and the original condition remain unchanged. Urgent recovery also requires escalation coverage. Inactive assignments, revoked authority, stale revisions and changed retry payloads are rejected. Issue state, history, receipt, workspace revision and notification intent commit atomically.

Migration 014 separately completes shift-linked task handoffs. Independent verification leads to acceptance; accepting changes the performer and reopens the task. The original shift link and department remain, and the outgoing employee retains read access. Incoming work must then be completed and independently verified before the original shift can be released. Reviewed overnight-manager profiles use those same pending-work gates; unreviewed profiles remain blocked. These transfers are distinct from overnight issue deferrals and are tested separately from the overnight browser flow.

Earlier handoff constraints were updated narrowly to permit a shift-linked transfer's current owner to match its incoming recipient only when an outgoing owner and receipt are recorded. Client-supplied receipt metadata remains prohibited. Earlier parser tests were updated where linked handoffs are now supported.

## 2. Original-form UI adapter and browser verification

`overnight-preview.jsx` imports the existing `FollowForm` and `FollowDetail` unchanged. It supplies fictional leadership/member projections and connects their native command vocabulary to the candidate HTTP adapter. The preview uses individual short-lived, locally signed fixture tokens verified by the real JWT handler and database session resolution.

The actual browser completed: offered → disputed → clarified offer → accepted → recovery offer → replacement accepted → resolved. The original detail form showed the responsible manager changing only on acceptance, and its expanded history retained all seven steps. The original condition remained visible after recovery and resolution.

Screenshot: `runtime/overnight-ui-pass.png`. Build command: `node development/postgres-candidate/build-forms-preview.mjs`. The local preview route is `/overnight-forms` on the isolated loopback harness when that harness and candidate PostgreSQL are running. They are stopped after validation; the screenshot is a retained result, not a running service.

## Validation

- All 156 automated regression checks passed, with zero failed or skipped. Evidence: `runtime/overnight-regression-results.txt`.
- All 10 new overnight/linked-transfer checks passed on the separate schema after migrations 014–015. Evidence: `runtime/overnight-fresh-results.txt`.
- Candidate adapter and HTTP handler passed strict TypeScript compilation; the Vite preview build passed.
- Checks cover safe deferral, leadership ordering, named receivers, dispute/offer/cancel, escalation, recovery, expiration, revoked replay, concurrent retries, stale revisions, notification rollback and linked-transfer checkout gates.
- Browser evidence validates the complete routine overnight issue/recovery path with signed fixture tokens. Urgent escalation and cancellation were verified in database tests, not this browser run.

## Remaining limits and next work

The original app remains unchanged. This is an isolated preview, not a production UI cutover or Inventory integration. Closing and Dishwasher original-form browser flows, full shift reads, and their remaining projection metadata/history still need wiring and verification. Offline queue support is not enabled for overnight/closing/Dishwasher commands; notification delivery remains separate from committed intent.

Leadership, membership and schedule inputs are fictional projections. Authoritative ingestion, shared employee identifiers, permission administration, hosted Supabase roles/authentication, remote-device behavior and production deployment remain pending. The fixture token endpoint is deliberately a loopback test harness and must never be deployed as authentication.

All files remain ignored and local; no GitHub backup was created. Runtime data, fixture identities and machine-specific files must be excluded from reviewed integration. Next planned work is the original closing/Dishwasher forms adapter and browser workflow checks, followed by Inventory baseline reconciliation when that merge is ready. Stop here after these two sections.
