# Scheduling request screen checkpoint

The existing Companion request list, availability/time-off forms and record review components now run against the isolated PostgreSQL candidate at `/schedule-forms`. Source application components and the active backend remain unchanged. This is the first scheduling UI slice, not adoption of the entire schedule workspace.

## Data and submission contract

- Additive migration 034 exposes the current authenticated viewer, restaurant/timezone and explicit permissions. Membership title does not grant authority. Other roster members do not receive capability disclosures; schedule-only roster entries do not acquire login access.
- The screen loads every page of scoped roster, availability, time-off and shifts. It rechecks the viewer and restaurant revision before displaying a workspace, retries changed snapshots up to three times and rejects partial/failed reads. These revisions detect candidate command changes; administrative source reconciliation and full ingestion completeness remain separate requirements.
- Forms use the existing availability save/review and time-off create/review commands. Server permission, independent review, exact revision and affected-shift guards remain authoritative. Approval can cancel only eligible unlinked candidate drafts; published/linked shifts remain blocked and the screen explains this limitation.
- Successful commands reload scoped records. Uncertain delivery retains one request ID in memory and retries the same command; changing the submission while its outcome is unknown is blocked. This is not a durable offline scheduling queue. Keep the page open to retry. Browser reload/closure loses the in-memory retry; production adoption requires retained recovery state or a receipt recovery interface.
- The local harness issues short-lived signed fictional sessions. It is loopback-only and must never be deployed. Generated session fixture JSON, builds, database files, logs and screenshots remain ignored.

## Validation

Fresh fictional database `companion_candidate_screen2`: all 34 migrations applied and all 384 serial regression checks passed. Twelve new checks cover current viewer authority, private table denial, session revocation, complete pagination, mixed snapshot rejection and uncertain delivery retry. Strict candidate adapter types, preview build and source coverage inventory passed. Migration files 001–033 are preserved.

Browser rehearsal on October 9, 2026: employee availability submission appeared pending; another-department manager could not see it; scoped manager approved it and the list read back the review. Employee time-off submission and independent manager approval with no affected shifts succeeded. Reload returned both approved records to the employee with source privacy redaction preserved. Existing Companion styles were visually checked. Screenshot evidence is local in ignored `work/postgres-candidate/runtime/schedule-request-preview.png`. Browser evidence is limited to these fictional desktop flows; automated backend checks cover stale/conflict/permission scenarios. Mobile viewport, linked-shift impact and browser connectivity failure rehearsal remain pending.

## Remaining work

M06 remains open. Next: isolated shift draft editor and schedule-board adoption with complete station/guide/reference context, then weekly review/publication and coverage/leadership screens. Copying, attendance, production source completeness/identity, notification delivery, durable scheduling recovery and hosted authentication remain separate work. No Inventory merge, active route switch, hosted database application or deployment occurred.
