-- UNAPPROVED DESIGN FIXTURE ONLY. Not in drizzle; not a deployed migration.
-- Explicit mapping data must come from approved source review, never names.
CREATE TABLE draft_food_batches (
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL, product_revision INTEGER NOT NULL CHECK(product_revision>0),
 owner_restaurant_id TEXT NOT NULL, production_location_id TEXT NOT NULL,
 unit TEXT NOT NULL, batch_revision INTEGER NOT NULL CHECK(batch_revision>0)
);
--> statement-breakpoint
CREATE TABLE draft_food_receipt_mappings (
 id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0), approved INTEGER NOT NULL CHECK(approved IN(0,1)),
 batch_id TEXT NOT NULL REFERENCES draft_food_batches(id),
 consuming_restaurant_id TEXT NOT NULL, source_location_id TEXT NOT NULL, destination_location_id TEXT NOT NULL,
 CHECK(source_location_id<>destination_location_id)
);
--> statement-breakpoint
CREATE TABLE draft_food_balances (
 batch_id TEXT NOT NULL REFERENCES draft_food_batches(id), location_id TEXT NOT NULL,
 quantity REAL NOT NULL CHECK(quantity>=0), revision INTEGER NOT NULL CHECK(revision>=0),
 PRIMARY KEY(batch_id,location_id)
);
--> statement-breakpoint
CREATE TABLE draft_food_receipts (
 id TEXT PRIMARY KEY, destination_location_id TEXT NOT NULL, actor_id TEXT NOT NULL, request_id TEXT NOT NULL,
 fingerprint TEXT NOT NULL, data TEXT NOT NULL,
 UNIQUE(destination_location_id,actor_id,request_id)
);
--> statement-breakpoint
CREATE TABLE draft_food_movements (
 receipt_id TEXT NOT NULL REFERENCES draft_food_receipts(id), leg TEXT NOT NULL CHECK(leg IN('source','destination')),
 batch_id TEXT NOT NULL REFERENCES draft_food_batches(id), location_id TEXT NOT NULL,
 quantity_delta REAL NOT NULL CHECK(quantity_delta<>0),
 PRIMARY KEY(receipt_id,leg),
 CHECK((leg='source' AND quantity_delta<0) OR (leg='destination' AND quantity_delta>0))
);
--> statement-breakpoint
-- A failing CHECK aborts the whole D1 batch instead of silently accepting a
-- zero-row UPDATE. Guard row is removed within the successful transaction.
CREATE TABLE draft_food_receipt_guards (id TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok=1));
--> statement-breakpoint
CREATE TABLE draft_food_receipt_heads (
 receipt_id TEXT PRIMARY KEY REFERENCES draft_food_receipts(id), revision INTEGER NOT NULL CHECK(revision>0),
 effective_quantity REAL NOT NULL CHECK(effective_quantity>=0)
);
--> statement-breakpoint
CREATE TABLE draft_food_corrections (
 id TEXT PRIMARY KEY, receipt_id TEXT NOT NULL REFERENCES draft_food_receipts(id), actor_id TEXT NOT NULL, request_id TEXT NOT NULL,
 expected_revision INTEGER NOT NULL, fingerprint TEXT NOT NULL, data TEXT NOT NULL,
 UNIQUE(receipt_id,actor_id,request_id), UNIQUE(receipt_id,expected_revision)
);
--> statement-breakpoint
CREATE TABLE draft_food_correction_movements (
 correction_id TEXT NOT NULL REFERENCES draft_food_corrections(id), leg TEXT NOT NULL CHECK(leg IN('source','destination')),
 batch_id TEXT NOT NULL REFERENCES draft_food_batches(id), location_id TEXT NOT NULL, quantity_delta REAL NOT NULL CHECK(quantity_delta<>0),
 PRIMARY KEY(correction_id,leg)
);
--> statement-breakpoint
CREATE TRIGGER draft_receipts_no_update BEFORE UPDATE ON draft_food_receipts BEGIN SELECT RAISE(ABORT,'immutable receipt'); END;
--> statement-breakpoint
CREATE TRIGGER draft_receipts_no_delete BEFORE DELETE ON draft_food_receipts BEGIN SELECT RAISE(ABORT,'immutable receipt'); END;
--> statement-breakpoint
CREATE TRIGGER draft_movements_no_update BEFORE UPDATE ON draft_food_movements BEGIN SELECT RAISE(ABORT,'immutable movement'); END;
--> statement-breakpoint
CREATE TRIGGER draft_movements_no_delete BEFORE DELETE ON draft_food_movements BEGIN SELECT RAISE(ABORT,'immutable movement'); END;
--> statement-breakpoint
CREATE TRIGGER draft_corrections_no_update BEFORE UPDATE ON draft_food_corrections BEGIN SELECT RAISE(ABORT,'immutable correction'); END;
--> statement-breakpoint
CREATE TRIGGER draft_corrections_no_delete BEFORE DELETE ON draft_food_corrections BEGIN SELECT RAISE(ABORT,'immutable correction'); END;
--> statement-breakpoint
CREATE TRIGGER draft_correction_movements_no_update BEFORE UPDATE ON draft_food_correction_movements BEGIN SELECT RAISE(ABORT,'immutable movement'); END;
--> statement-breakpoint
CREATE TRIGGER draft_correction_movements_no_delete BEFORE DELETE ON draft_food_correction_movements BEGIN SELECT RAISE(ABORT,'immutable movement'); END;
