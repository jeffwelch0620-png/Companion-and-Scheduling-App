CREATE TABLE `access_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`target_id` text NOT NULL,
	`action` text NOT NULL,
	`before` text,
	`after` text NOT NULL,
	`note` text NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE INDEX `access_changes_location` ON `access_changes` (`location_id`,`at`);
--> statement-breakpoint
CREATE TABLE `access_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`restaurant_guid` text NOT NULL,
	`employee_id` text NOT NULL,
	`source_at` text NOT NULL,
	`source` text NOT NULL,
	`data` text NOT NULL,
	`status` text NOT NULL,
	`member_id` text,
	`revision` integer NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE UNIQUE INDEX `access_review_source` ON `access_reviews` (`location_id`,`restaurant_guid`,`employee_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_review_member` ON `access_reviews` (`location_id`,`member_id`);