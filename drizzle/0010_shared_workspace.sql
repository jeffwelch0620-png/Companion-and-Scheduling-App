CREATE TABLE `schedule_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`week_start` text NOT NULL,
	`source_hash` text NOT NULL,
	`data` text NOT NULL,
	`imported_at` text NOT NULL,
	`imported_by` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`imported_by`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE UNIQUE INDEX `schedule_import_source` ON `schedule_imports` (`location_id`,`week_start`,`source_hash`);