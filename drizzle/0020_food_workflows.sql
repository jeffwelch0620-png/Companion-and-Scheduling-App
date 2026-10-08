-- Local JMAX integration of Jeff's prep workflow. No catalog or purchasing copy.
CREATE TABLE food_workflows (
 id TEXT PRIMARY KEY NOT NULL,
 location_id TEXT NOT NULL REFERENCES locations(id),
 dataset TEXT NOT NULL CHECK(dataset IN ('demo','operating')),
 kind TEXT NOT NULL CHECK(kind IN ('definition','count','plan')),
 natural_key TEXT NOT NULL,
 revision INTEGER NOT NULL,
 status TEXT NOT NULL,
 data TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(location_id,dataset,kind,natural_key)
);
--> statement-breakpoint
CREATE INDEX food_workflow_page ON food_workflows(location_id,dataset,kind,updated_at DESC);
--> statement-breakpoint
CREATE TABLE food_workflow_events (
 workflow_id TEXT NOT NULL REFERENCES food_workflows(id),
 revision INTEGER NOT NULL,
 event TEXT NOT NULL,
 PRIMARY KEY(workflow_id,revision)
);
