# Person scheduling and roster review safeguards

Accepted baseline: Companion main `2193afc` (PR27), with 426 passing candidate checks. This focused package remains isolated preparation; it does not enable the active Companion, touch Inventory or apply a hosted migration.

## Person scheduling

Corrective migration 037 adds a private booking projection for every non-cancelled shift reference, including drafts, published shifts, imports and released history. The projection uses the canonical candidate person behind each location membership. Its PostgreSQL GiST exclusion constraint prevents overlapping half-open timestamp ranges for the same person across locations. Adjacent shifts remain valid; equal display names never merge identities. Cancelled shifts free their booking, while released shifts still describe time actually occupied.

A source-row trigger checks person-level conflicts before writes and returns the existing sanitized `shift_overlap` conflict. The exclusion constraint remains the final guard when competing uncommitted writes are invisible to that check. Projection insertion catches exclusion violations and returns the same conflict without revealing another store, membership or record. The source shift, booking, revision, history, outbox intent and receipt still share the caller's transaction. Independent locations do not acquire each other's store locks; simultaneous exclusion checks can wait for the competing transaction to finish. Multi-record privileged transactions must be bounded and retry whole transactions on serialization or deadlock errors, preserving IDs and avoiding external side effects.

The private projection preserves the source shift composite type and JSON/permit hashes used by closing transfers. Its composite membership/person foreign key propagates identity corrections atomically and rejects corrections that would produce overlapping bookings. This is not a new identity-merge endpoint. Trusted writers must use source shift/membership writes rather than editing the projection, and candidate runtime cannot inspect or mutate it or call its private helpers.

Coverage volunteer eligibility uses the same person-level conflict check. A later change or race still meets the source trigger and database constraint when approved responsibility is written. Existing same-location checks, approvals, permissions, linked-work protections and receipt reauthorization are preserved.

The migration requires the trusted `btree_gist` extension. Fresh-database and accepted-baseline upgrade checks must verify extension permissions under the non-superuser schema owner. Backfill rejects existing overlapping active references and rolls the migration back; it never cancels, removes or silently reconciles existing shifts. Hosted extension/schema ownership and an Inventory integration port remain separate validation tasks. The shared-database port must use these explicit reviewed definitions and reconcile its own canonical person IDs.

## Whole-store roster review

Inspection confirmed migration 024 already invalidates the entire store's scheduling review for every membership or schedule-eligibility insert, update and delete, including no-op writes. Transfers invalidate both old and new stores. It clears completeness, review time and evidence linkage; a missing review remains incomplete by default. No duplicate or broader trigger was added.

New regression cases exercise all these write paths using fictional full reconciliation evidence, plus failed-write rollback, unaffected locations and draft/publication rejection until a new review. Replaying an earlier reconciliation receipt does not restore revoked completeness. A new complete fictional review can restore scheduling. Permissions, dated leadership and training clearance remain separate contracts; this package does not turn capability changes or legacy job-assignment records into scheduling eligibility. Production roster writers must adopt the reviewed membership/eligibility contract.

## Validation and remaining work

Local validation on 2026-10-10 passed in fresh fictional loopback database `companion_candidate_safeguards3`: ordered migrations 001–037, generated function snapshot comparison before fixtures, all 437 serial regression checks (426 existing plus 11 safeguards cases), strict candidate types, original-form preview build and readiness inventory. Accepted-baseline upgrade and existing-overlap rollback cases are included in the 437 checks. Previously invalid overlapping read/linked-task fixtures now use distinct people or non-overlapping periods; the publication regression checks rejection at source insertion rather than creating an invalid overlap. Published migrations 001–036 and their manifest entries remain byte-for-byte unchanged; migration 037 uses LF and its recorded hash matches.

The preview build retains its existing runtime logo-path warning; no new live browser exercise was performed for this database-only package. The inventory check still reports active backend cutover not ready. GitHub CI results belong to the draft PR's exact tested head and must be verified separately; these local results do not establish hosted or Inventory readiness.

Next operating decisions remain leadership self-assignment, started/ended shift edits and department-changing swaps. Configurable operating labels/timezones, remaining scheduling UI, copying/attendance, production identity, offline scheduling/prep, notification delivery, hosted recovery and Inventory integration are outside this package. Draft PR acceptance, database application and deployment require separate decisions.

## Approved pre-merge follow-up

Migration 039 changes the review invalidation policy: unchanged membership and eligibility writes preserve completeness, review time and evidence linkage. Real changes to membership person/location/department/position/active/schedule-only, or eligibility member/job/source/active, invalidate review. Inserts, deletes and old/new-store transfers remain covered. Full nightly-sync-style no-op writes now have positive scheduling regression coverage.

The person conflict helper queries the private GiST-indexed booking projection. Insert preflight remains unconditional; update preflight runs only for changed member/time/cancellation values. A transactional throwing probe verifies publication-only updates skip the overlap helper and changed periods still call it. The exclusion constraint and atomic projection maintenance remain the final concurrency guard. Migration-037 upgrade tests are explicitly pinned to 037.

For the eventual shared-database port use explicit definitions and `CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions`. Inspect the installed extension schema first: IF NOT EXISTS does not relocate an existing extension. Reconcile operator resolution, schema permissions and canonical identity before adopting the constraint. Published migration 037 is unchanged. Migration 038 is reserved by the dependent PR29, so this branch appends 039 after 037; the combined branch orders 037, 038, 039.

Inventory's merge is complete and its baseline is undergoing testing, per the user. Do not port or apply anything there until its tested commit is supplied. Both Companion PRs remain draft and need explicit merge approval.

Follow-up validation passed on 2026-10-10 in fresh fictional loopback database `companion_candidate_followup28b`: 439/439 serial tests, fresh migration application (001–037 then 039), generated snapshot comparison, strict candidate types, preview build and readiness inventory. The existing logo-path build warning remains. No live browser exercise, hosted application or Inventory integration was performed. Exact-head CI is reported with the PR checkpoint.
