CREATE TABLE `review_reminder_runs` (
	`location_id` text PRIMARY KEY NOT NULL,
	`checked_at` text NOT NULL,
	`scheduled_at` text,
	`delivered` integer NOT NULL,
	`issues` text NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE TABLE `review_reminders` (
	`location_id` text NOT NULL,
	`review_id` text NOT NULL,
	`stage` text NOT NULL,
	`responsible_id` text NOT NULL,
	`recipient_id` text NOT NULL,
	`milestone` integer NOT NULL,
	`original_due_date` text NOT NULL,
	`message_id` text NOT NULL,
	`at` text NOT NULL,
	PRIMARY KEY(`location_id`, `review_id`, `stage`, `responsible_id`, `recipient_id`, `milestone`),
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_id`) REFERENCES `records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipient_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`message_id`) REFERENCES `records`(`id`) ON UPDATE no action ON DELETE no action
);
