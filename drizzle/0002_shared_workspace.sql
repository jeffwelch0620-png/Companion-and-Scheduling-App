CREATE TABLE `integration_attempts` (
	`location_id` text NOT NULL,
	`provider` text NOT NULL,
	`token` text NOT NULL,
	`started_at` integer NOT NULL,
	PRIMARY KEY(`location_id`, `provider`),
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE TABLE `toast_rosters` (
	`location_id` text PRIMARY KEY NOT NULL,
	`restaurant_guid` text NOT NULL,
	`data` text NOT NULL,
	`retrieved_at` text NOT NULL,
	`requested_by` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action
);
