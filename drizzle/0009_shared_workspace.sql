CREATE TABLE `companion_archives` (
	`location_id` text NOT NULL,
	`member_id` text NOT NULL,
	`id` text NOT NULL,
	`membership_revision` integer NOT NULL,
	`title` text NOT NULL,
	`archived_at` text NOT NULL,
	`turn_count` integer NOT NULL,
	PRIMARY KEY(`location_id`, `member_id`, `id`),
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE INDEX `companion_archive_page` ON `companion_archives` (`location_id`,`member_id`,`archived_at`,`id`);