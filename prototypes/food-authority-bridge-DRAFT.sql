-- ISOLATED mechanics fixture, not receiving policy or installed mapping.
CREATE TABLE prototype_food_receipt_bindings (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, mapping_id TEXT NOT NULL,
 source_location_id TEXT NOT NULL, destination_location_id TEXT NOT NULL, destination_store_id TEXT NOT NULL,
 requesting_person_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), active INTEGER NOT NULL CHECK(active IN(0,1))
);
