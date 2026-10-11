# Publication review follow-up

PR32 was approved and squash-merged at `1b95d8e83e06fbccacc34a2be7dc5150acdaaea9`. Its tree matches reviewed head `d092dca`; merged-main CI passed 538/538 checks. This corrective package starts from that accepted preparation baseline. PR33 coverage/replacement UI remains a separate dependent draft. Inventory, the active D1 backend and hosted services are outside this change.

## Scheduling freshness

Corrective migration 045 adds a private `scope_coordination.schedule_revision`. Relevant changes advance it in the same transaction as the input write. Weekly source evidence explicitly records that revision; neither reads nor publication renew it. Pre-045 evidence defaults to -1 and cannot certify the new contract. Privileged fictional producers have been updated to record both the historical workspace revision and the scheduling revision.

Tracked inputs include shifts/drafts, person-wide time off, store availability, staffing, closing assignments/cancellation, standards and shift-standard links, stations/setup/jobs/members, station clearances, dated leadership, input completeness, relevant roster/job fields, capabilities and store configuration. Membership/job no-op rules preserve migration 039's contract. Closing answers, ordinary phase/progress, timestamps and revision increments alone are excluded from the closing projection. Restaurant global-revision increments are excluded from its configuration projection. Daily tasks, checkout readiness and goal practice do not advance scheduling freshness.

The planning token hashes the store, week, selected IDs and scheduling revision, rather than whole mutable operational rows. Selected shift and closing revisions are still checked exactly by publication, and every existing authority, station, leave, overlap and closing check remains enforced. This token now depends on trigger coverage: the shared-database port must explicitly reproduce the relevant-write contract and test each shared writer. Do not copy candidate trigger assumptions into shared authz or bypass invalidation using disabled triggers/TRUNCATE imports.

The NOWAIT retry contract also applies when a runtime command encounters an affected peer store already held by another command. Direct callers retry the entire transaction with the same command/receipt ID; HTTP retains its existing temporary 503 response, and the scheduling client retains the frozen original for retry. The concurrency regression retries only `40001`, then requires exactly one committed shift/receipt and a final `shift_overlap` refusal for the other intent. It does not accept a permanent transient error as a successful outcome.

Person-wide leave, booking and relevant membership changes advance every affected store's counter. Fanout acquires sorted existing coordination scopes using NOWAIT; `40001` requires retrying the **whole transaction**, preserving the existing coordination contract. A failed or rolled-back batch also rolls back counter changes. Cross-store commands now wait on affected-store coordination before overlap preflight: the same `shift_overlap` refusal can occur there rather than in the exclusion trigger. Separate concurrent probes verify runtime winner/rollback behavior and the underlying exclusion constraint's invisible-write arbitration. Session creation and sign-in activity do not invalidate scheduling evidence; current authorization is still checked on every read/command/replay. The global workspace revision remains available for all existing general reads and commands. The earlier individual-publication `publication_reviews` contract remains separate from weekly source attestation and needs its own reviewed port during adoption.

## Batched reads and minimized data

`weekly_review` returns each selected draft's closing duties/issues, overlapping copied staffing status and source-review status, plus complete approved staffing display metadata and gaps, from one STABLE SQL snapshot. Selection remains limited to 100, scoped to the restaurant-local week and current publisher. The client makes three requests: a batch review, a freshness recheck and the current viewer. No per-draft HTTP loop or staffing pagination remains. A mismatched scheduling revision, token, draft identity/revision, viewer permission or configuration rejects the whole review.

Both individual publication reads and the batch expose only standard title, version and position plus standard ID/revision. Full criteria, verification settings and source snapshots remain private to their existing authorized workflows. The rich database checks still use those values internally.

## Recovery after reload

Before sending publication, the preview stores a tab-scoped marker containing only location, actor membership and receipt ID. Network/5xx uncertainty retains it; success or a definite 4xx clears it. Reload reconstructs a warning for that actor/location: check currently published shifts before reviewing or submitting again. Acknowledgment clears the marker. Other actors/locations do not see it.

The marker is not an offline command queue and cannot replay a request by itself. Exact in-page retry retains the original frozen envelope and receipt ID. No automatic replay or new submission is initiated on reload. If browser session storage is unavailable, only the in-page recovery remains; production device policy and durable authorized receipt lookup remain open.

## Validation and remaining work

Validate all 45 migrations on a new fictional loopback database, regenerate/check the function snapshot, run the serial full suite, candidate types, preview build and source classification. Behavioral checks cover daily activity versus scheduling changes, no-op roster sync, person-wide effects, NOWAIT retry/rollback, exact closing reassignment, 100-draft batching, authorization/minimization and actor-scoped reload markers. Record final counts and exact-head CI in the PR after validation.

This follow-up stays a draft pending independent review and separate merge approval. After acceptance, incorporate accepted main normally into PR33, retarget, re-test and seek its separate approval. Leadership/published-change/correction/attendance UI, trustworthy source ingestion, shared authz, notifications and integration from Inventory's confirmed tested baseline remain open.
