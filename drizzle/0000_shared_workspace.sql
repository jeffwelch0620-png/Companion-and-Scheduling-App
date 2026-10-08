CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`record_id` text NOT NULL,
	`at` text NOT NULL,
	`revision` integer NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE INDEX `audit_location` ON `audit_events` (`location_id`,`at`);
--> statement-breakpoint
CREATE TABLE `command_receipts` (
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
CREATE TABLE `locations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`timezone` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`last_command` text
);

--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`location_id` text NOT NULL,
	`name` text NOT NULL,
	`area` text NOT NULL,
	`position` text NOT NULL,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`qualifications` text DEFAULT '[]' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE UNIQUE INDEX `membership_identity` ON `memberships` (`email`,`location_id`);
--> statement-breakpoint
CREATE TABLE `records` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`area` text NOT NULL,
	`revision` integer NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE INDEX `records_location` ON `records` (`location_id`,`kind`);