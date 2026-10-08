CREATE TABLE `food_history` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`location_id` text NOT NULL,
	`record_id` text NOT NULL,
	`revision` integer NOT NULL,
	`actor_id` text NOT NULL,
	`at` text NOT NULL,
	`event` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`record_id`) REFERENCES `food_records`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE UNIQUE INDEX `food_history_revision` ON `food_history` (`record_id`,`revision`);
--> statement-breakpoint
CREATE INDEX `food_history_page` ON `food_history` (`location_id`,`record_id`,`sequence`);
--> statement-breakpoint
CREATE TABLE `food_receipts` (
	`location_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`request_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`result` text NOT NULL,
	PRIMARY KEY(`location_id`, `actor_id`, `request_id`),
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE TABLE `food_records` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`kind` text NOT NULL,
	`dataset` text NOT NULL,
	`source_restaurant_id` text NOT NULL,
	`source_key` text NOT NULL,
	`title` text NOT NULL,
	`storage_area` text DEFAULT '' NOT NULL,
	`owner_id` text NOT NULL,
	`area` text NOT NULL,
	`revision` integer NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE UNIQUE INDEX `food_source_key` ON `food_records` (`location_id`,`dataset`,`kind`,`source_key`);
--> statement-breakpoint
CREATE INDEX `food_page` ON `food_records` (`location_id`,`dataset`,`kind`,`id`);
--> statement-breakpoint
CREATE TABLE `food_sources` (
	`location_id` text NOT NULL,
	`dataset` text NOT NULL,
	`source_restaurant_id` text NOT NULL,
	PRIMARY KEY(`location_id`, `dataset`),
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE TABLE `food_state` (
	`location_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`last_command` text,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
-- Preserve existing local food definitions. Legacy records remain as recovery copies;
-- the daily workspace excludes them and its food write path is disabled.
INSERT INTO food_records(id,location_id,kind,dataset,source_restaurant_id,source_key,title,storage_area,owner_id,area,revision,data,updated_at)
SELECT id,location_id,kind,json_extract(data,'$.source.dataset'),json_extract(data,'$.source.sourceRestaurantId'),
 CASE kind WHEN 'fooditem' THEN json_extract(data,'$.controlNumber') ELSE json_extract(data,'$.sourceId') END,
 json_extract(data,'$.title'),coalesce(json_extract(data,'$.storageArea'),''),owner_id,area,revision,
 CASE kind WHEN 'fooditem' THEN json_set(data,'$.history',json('[]'),'$.countHistory',json('[]'),'$.definitionHistory',json('[]')) ELSE json_set(data,'$.history',json('[]')) END,updated_at
FROM records WHERE kind IN ('fooditem','foodrecipe') AND archived_at IS NULL;
--> statement-breakpoint
INSERT INTO food_history(location_id,record_id,revision,actor_id,at,event)
SELECT location_id,id,revision,owner_id,updated_at,json_object('action','legacy-migration','history',json(coalesce(json_extract(data,'$.history'),'[]')),'legacy',json_object('countHistory',json(coalesce(json_extract(data,'$.countHistory'),'[]')),'definitionHistory',json(coalesce(json_extract(data,'$.definitionHistory'),'[]'))))
FROM records WHERE kind IN ('fooditem','foodrecipe') AND archived_at IS NULL;
--> statement-breakpoint
INSERT INTO food_sources(location_id,dataset,source_restaurant_id) SELECT DISTINCT location_id,dataset,source_restaurant_id FROM food_records;
--> statement-breakpoint
INSERT INTO food_state(location_id) SELECT DISTINCT location_id FROM food_records;
--> statement-breakpoint
CREATE INDEX records_daily_page ON records(location_id,updated_at DESC) WHERE archived_at IS NULL AND kind NOT IN ('fooditem','foodrecipe');
