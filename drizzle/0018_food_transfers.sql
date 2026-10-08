CREATE TABLE `food_transfer_events` (
	`transfer_id` text NOT NULL,
	`revision` integer NOT NULL,
	`event` text NOT NULL,
	PRIMARY KEY(`transfer_id`, `revision`),
	FOREIGN KEY (`transfer_id`) REFERENCES `food_transfers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `food_transfer_routes` (
	`source_id` text NOT NULL,
	`destination_id` text NOT NULL,
	`dataset` text NOT NULL,
	`active` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`source_id`, `destination_id`, `dataset`),
	FOREIGN KEY (`source_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destination_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `food_transfers` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`source_id` text NOT NULL,
	`destination_id` text NOT NULL,
	`dataset` text NOT NULL,
	`reference_key` text NOT NULL,
	`revision` integer NOT NULL,
	`status` text NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destination_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_transfer_id` ON `food_transfers` (`id`);--> statement-breakpoint
CREATE INDEX `food_transfer_source` ON `food_transfers` (`source_id`,`dataset`,`sequence`);--> statement-breakpoint
CREATE INDEX `food_transfer_destination` ON `food_transfers` (`destination_id`,`dataset`,`sequence`);--> statement-breakpoint
CREATE INDEX `food_transfer_reference` ON `food_transfers` (`source_id`,`dataset`,`reference_key`);