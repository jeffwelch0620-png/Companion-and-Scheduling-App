-- Server-managed personal identity grants; no app role can write this table.
CREATE TABLE restaurant_access (
 auth_user_id TEXT PRIMARY KEY NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('restaurant','jay','rudd','commissary')),
 home_location_id TEXT NOT NULL REFERENCES locations(id),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 CHECK(kind<>'commissary' OR home_location_id='comm')
);
--> statement-breakpoint
CREATE UNIQUE INDEX restaurant_access_owner_seat ON restaurant_access(kind) WHERE kind IN ('jay','rudd');
