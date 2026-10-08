# Shared commissary storage and receipt ledger — unapproved draft

This is a reviewable local prototype, not an agreed shared schema or live inventory connection. It coexists with the existing local D1 schema under `draft_food_*` table names. Its SQL is outside the normal migration directory; it is used only by an isolated Miniflare test fixture. No Jeff code or hosted database changed.

## Separate facts

| Fact | Draft field and meaning |
| --- | --- |
| Owning restaurant | Batch `owner_restaurant_id`: cost ownership remains unchanged by location transfer. |
| Consuming restaurant | Approved receipt mapping `consuming_restaurant_id`: restaurant intended to use the product. Kept distinct from owner even when approved values coincide. |
| Production location | Batch `production_location_id`: where this batch was produced; remains unchanged by receipt. |
| Current physical storage | Balance `location_id`: where the batch quantity currently resides. Source and destination are physical location identifiers, not inferred restaurant ownership. |
| Canonical product | Batch `product_id`, `product_revision`, and unit: approved shared identity, not guessed from supplier SKU or matching recipe names. |
| Batch identity | Batch `id` and `batch_revision`: a reviewed allocation identity. No production event, actual yield, shelf-life duration or use-by date is fabricated. |
| Approved route/mapping | Mapping ID/revision binds batch, consuming restaurant and exact physical source/destination. `approved=1` is required inside the transaction. |
| Actual receipt | Receipt quantity and reviewed unit, arrival time, recorded time and authorized receiving actor. Only receipt is recorded; no dispatch event. |

All test identifiers are deliberately fictional `fixture-*` values. Actual canonical IDs, location rows, authorization and mappings still require verification. The adapter takes trusted server context; it is not an authentication implementation or an exposed route.

## One local transaction

The adapter reuses the existing receipt-only preparation boundary for actual-arrival confirmation, positive quantity, actor authority, owner/product/unit/source/destination scope and revision checks. It then posts a D1 batch:

1. Transactional guard checks the approved mapping revision, batch/product/unit/owner/production identity, both batch-location balance revisions and sufficient source quantity.
2. Save the receipt with a unique destination/actor/request key and a stable action fingerprint.
3. Debit the source and credit the destination by exactly the same received quantity; advance both balance revisions.
4. Append two signed movement legs linked to the receipt and remove the temporary guard.

A guard failure aborts the transaction rather than quietly accepting a zero-row update. Failure after balance updates rolls back receipt, balances, movements and guard. Different concurrent requests using the same balance revision have one winner. An identical request returns its original committed result; changing details under that request ID conflicts. Generated receipt ID and recording time do not create a second movement on retry.

The new result explicitly says `stockPosting: draft-local-ledger`. Existing receipt-only results continue to say `not-connected`; legacy dispatch transfers, services, history and UI are untouched. Prototype location revisions are **per batch and physical location**, not verified global physical-location revisions.

## Source fit and remaining choices

Jeff’s pinned backend separates prep consuming store from `made_at` production store, and has an explicit prep-list production transaction. That establishes useful semantics and a precedent; his stock table still scopes quantity by one store and recipe/prep-item ID. This draft extends that model explicitly rather than treating that store as owner, consumer, producer and storage all at once. No claim is made that these draft tables match live Supabase.

Before production use, review canonical product/batch mapping, physical locations, owner/consumer policy, authorization, batch usability/dates and exact unit representation. Draft quantities use SQLite REAL only for the local prototype; a production ledger needs an approved precision/scaled-unit policy. Existing balances must be reconciled before introducing an opening ledger. Production, waste and supplier receipts need their own linked posting contracts and reconciliation; this prototype exposes no balance-seeding API. Database permissions are not implemented here.

## Immutable corrections and reversals

The isolated adapter now also accepts a corrected total received quantity, reason, confirmation, exact receipt-head revision and both current batch-location balance revisions. It requires explicit trusted `canCorrect` authority separately from receipt authority. Zero corrected quantity is a full reversal; positive values correct the effective receipt total. A same-quantity correction is rejected. No UI or route exposes this operation.

Original receipt and its movement legs are never edited. The adapter appends a linked correction and paired signed delta legs, then advances a separate effective-quantity/revision head. For example, correcting five gallons to three returns two to source and removes two from destination. A later reversal of three returns only the remaining three. The batch, product/unit, owner, consuming restaurant, production location and physical endpoints remain the original immutable snapshot. This changes only quantity; changing identity or unit needs a separately reviewed replacement procedure.

The transaction guard validates current batch identity/version, the exact receipt head/effective quantity and both balance revisions. An increase must be available at source; a reduction/reversal must be available at destination. If subsequent usage leaves too little destination stock, reversal is rejected rather than creating negative stock or silently borrowing another owner’s batch. A correction uses the original approved mapping snapshot; it does not infer a new route from current names or reclassify historical ownership.

Unique correction request keys plus an immutable fingerprint make retries return the original correction. Unique receipt/prior-revision keys and transactional checks reject double or concurrent stale corrections. Corrections can themselves be followed by another reasoned correction using the new head revision; reversal is a zero effective quantity, not deletion of history. A quantity correction does not imply physical goods moved back: it reconciles an incorrectly recorded receipt, so the manager must verify the corrected observation before posting.

Draft database triggers reject updates and deletions of original receipts, original movement legs, corrections and correction legs. Only balances and the derived receipt head change. Test-injected failure after balance changes rolls back every correction effect. These prototype triggers are local evidence, not deployed access controls or approved audit-retention policy.

Actual-yield capture remains a proposed production-design consideration, not a newly elicited owner requirement. This receipt prototype transfers only the explicitly received quantity and does not alter production calculation.

## Evidence

- [Pinned Jeff schema](https://github.com/jeffwelch0620-png/JayMax-Concepts-/blob/1a5e97243009a922d38596d6559c6d9be7f6b5f3/supabase/schema.sql), September 30 reference, explicitly not a migration.
- [Pinned backend](https://github.com/jeffwelch0620-png/JayMax-Concepts-/blob/1a5e97243009a922d38596d6559c6d9be7f6b5f3/backend/server.py), semantics lines 3916–3922 and transactional task completion lines 4533–4573.
- `commissary-receipt-ledger.sql`: isolated draft fixture.
- `app/shared/food-commissary-ledger-prototype.ts`: executable local adapter.
- `tests/food-commissary-ledger-prototype.test.mjs`: eight real local D1 tests applying existing migrations followed by the isolated draft; paired receipts, corrections/reversals, immutable originals, concurrent exact retries/stale conflicts, post-debit rollback, insufficient stock and unapproved/changed mappings. Five existing receipt-preparation tests are retained.

No live SQL, schema deployment, new route, frontend, external modification, push or merge.
