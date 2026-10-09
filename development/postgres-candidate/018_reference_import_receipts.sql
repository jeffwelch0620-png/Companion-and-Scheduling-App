-- Fictional local rehearsal only. No runtime ingestion permission is granted.
BEGIN;
CREATE TABLE candidate_operations.reference_import_receipts(
 batch_id uuid PRIMARY KEY,
 restaurant_id text NOT NULL REFERENCES candidate_identity.restaurants(id),
 source_hash text NOT NULL CHECK(source_hash ~ '^[0-9a-f]{64}$'),
 source_snapshot jsonb NOT NULL CHECK(jsonb_typeof(source_snapshot)='object'),
 review_note text NOT NULL CHECK(length(btrim(review_note)) BETWEEN 1 AND 2000),
 expected_scope_revision integer NOT NULL CHECK(expected_scope_revision>=0),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON candidate_operations.reference_import_receipts FROM PUBLIC, candidate_runtime;
COMMIT;
