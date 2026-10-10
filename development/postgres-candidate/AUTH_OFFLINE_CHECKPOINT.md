# Authenticated Tasks and Offline Queue Checkpoint

October 8, 2026. Isolated candidate only. No active Companion UI, Inventory source, Inventory database, hosted Supabase resource, commits, pushes or merges were changed.

## Implemented in the candidate

The TypeScript task adapter now has a Node PostgreSQL driver, authenticated Request/Response route handler, scoped detail/list operations, and a browser IndexedDB queue. Candidate-only dependencies are pinned in the local package and lock file under the ignored work directory; the application's dependency files are untouched.

Signed access tokens are verified with jose against a trusted issuer and audience. The verifier allows ES256/RS256, requires subject, expiry, issue time and session ID, and rejects anonymous and non-authenticated-role tokens. The Supabase verifier factory uses the project's configured HTTPS public signing-key endpoint. Tests use generated fictional signing keys; no real Supabase keys or tokens were obtained.

The route resolves membership from the verified subject and restaurant, not a browser-supplied membership ID. A candidate session registry and current membership are checked inside the database transaction. Scope/session/membership locks remain held through the operation. Disabling a candidate session or membership denies access even when a fictional JWT is otherwise cryptographically valid.

The task route accepts existing task.create/task.transition fields. List reads are scoped and paginated with bounded page size; detail reads return the candidate task shape and ordered history. Pages are live reads, not a snapshot across multiple requests. Changing records while paging can affect the next page.

The IndexedDB queue supports only an employee ready submission for an existing ordinary task. The exact immutable command and request ID are retained. Tokens are obtained for sending and are never persisted by the queue. Queue entries are separated by subject and restaurant, with an atomic delivery lease to coordinate simultaneous flushers.

Queue states distinguish pending, sending, applied, needs_auth, blocked, needs_review and rejected. Temporary/ambiguous failures retain the request for retry. Changed records or aged entries require review. Disabled access is blocked. A valid server response is required before marking applied.

The caller supplies the maximum queue age. The harness uses 24 hours only as a fictional test policy; Jeff has not selected a production retention limit. Storage eviction, cleared browser data and private-browsing behavior still need product handling.

## Validation

All 18 automated checks passed with zero failures or skips in 10.20 seconds. They include the original eight database/adapter cases plus ten authenticated-route/queue cases. Database operations use actual PostgreSQL and an ordinary non-superuser LOGIN role. Automated IndexedDB semantics use fake-indexeddb.

Additional authenticated checks cover invalid signatures, wrong issuer/audience, expired JWTs, anonymous/service tokens, unregistered sessions, revoked sessions, server-resolved actors, scoped reads and pagination.

Queue checks cover storage-instance reopen, subject isolation, no token persistence, lost-response replay, stale queued data, revocation while offline, renewed login, concurrent flushers, aged entries and unsupported commands.

Strict isolated TypeScript compilation passed for the driver and route handler. The complete active Companion build/test suite was not rerun; its tracked code and dependency files are unchanged.

## Real browser verification

A separate fictional loopback page at port 6610 used the same authenticated route handler and candidate PostgreSQL database. Through the in-app browser, the following sequence was observed:

1. Create a fictional task and save its ready command in real browser IndexedDB without submitting ready.
2. Reload the page; the same pending request ID remains with zero delivery attempts.
3. Submit ready, commit on the server, and simulate loss of the response.
4. Reload again; the same request remains pending with delivery_uncertain.
5. Reconnect; the original receipt is replayed, the task is in verification, and its history contains exactly one ready event.

Observed request ID: cad150b9-39f3-47d4-a657-4b0298f23765. Fictional task ID: 03abd8ad-2275-41be-9def-9effd7f8a423.

The test simulated a lost transport response after commit; it did not toggle the browser's network adapter. It proves browser reload persistence and end-to-end replay for this one flow. It does not establish mobile OS persistence, service-worker/PWA behavior or shared-tablet logout isolation.

[Browser evidence](<runtime/browser-queue-pass.jpg>)

[Automated results](<runtime/auth-queue-results.txt>)

## Production boundaries still open

- The candidate runtime is Node. Companion currently runs on a Cloudflare Worker. A hosted Node service called by Companion is one possible boundary; importing this driver into the existing Worker has not been validated.
- The candidate session registry is fixture-provisioned. Real Supabase session registration, expiry, logout/revocation and identity provisioning need an explicit integration contract. JWT verification alone does not provide immediate remote logout detection.
- The candidate can_manage_tasks flag is not the complete employee/GM/owner/delegation model. Reconcile the existing capability and job-specific behavior before replacing an application route.
- Multiple restaurant/job relationships remain proposed. The candidate demonstrates one job/department per fictional membership without granting access by job title.
- Current app route envelopes, error adapters, task-list UI state and pagination must be integrated and browser-tested.
- The generic sender must acquire credentials for the queued subject and must stop on account changes. Shared-tablet queue visibility and logout policy remain unresolved; production use should not expose another person's retained entries.
- Storage retention and quota/eviction recovery need visible user handling. Blocked/review/rejected entries currently remain retained for a future review interface; they are not automatically edited or deleted.
- No external notification worker, hosted RLS/Data API exposure, ordering, stock posting or prep-production integration is implemented by this slice.
- The core operation protects receipt/event consistency, but its audit payload is a candidate and has not been reconciled with Inventory's final audit contract.

## Next checkpoint

Follow-up completed for the ordinary-task form slice: see [Forms and permission checkpoint](FORMS_PERMISSION_CHECKPOINT.md). The original components now run against the candidate transport in an isolated preview; the permission matrix identifies the remaining cutover gaps. This does not adopt the candidate's simplified manager policy.

Adapt the existing ordinary-task forms and read model to a selectable candidate transport in an isolated preview, preserving the D1 baseline for comparison. Reconcile the full permission matrix and worker/service deployment boundary before active UI cutover. Keep food integration and Inventory merges held until its ready baseline is refreshed.

The new schema files are candidate inputs, not adopted production migrations. No SQL was applied to Inventory or Supabase. The standalone browser harness and PostgreSQL test server are stopped after evidence collection.

## Implementation references

- [Supabase token verification](https://supabase.com/docs/guides/auth/jwts)
- [jose library](https://github.com/panva/jose)
- [PostgreSQL driver transactions](https://node-postgres.com/features/transactions)
