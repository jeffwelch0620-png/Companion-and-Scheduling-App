ALTER TABLE `records` ADD `archived_at` text;
--> statement-breakpoint
ALTER TABLE `records` ADD `archived_by` text;
--> statement-breakpoint
CREATE INDEX `records_history` ON `records` (`location_id`,`archived_at`,`id`);