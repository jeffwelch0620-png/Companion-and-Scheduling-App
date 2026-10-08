CREATE TABLE `companion_conversations` (
	`location_id` text NOT NULL,
	`member_id` text NOT NULL,
	`id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`membership_revision` integer NOT NULL,
	`pending_request` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`last_started` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`location_id`, `member_id`),
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE TABLE `companion_limits` (
	`location_id` text NOT NULL,
	`member_id` text NOT NULL,
	`hour` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`location_id`, `member_id`),
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE TABLE `companion_turns` (
	`location_id` text NOT NULL,
	`member_id` text NOT NULL,
	`request_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`question` text NOT NULL,
	`answer` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`sources` text DEFAULT '[]' NOT NULL,
	`scope` text DEFAULT '[]' NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`at` text NOT NULL,
	PRIMARY KEY(`location_id`, `member_id`, `request_id`),
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE INDEX `companion_turn_conversation` ON `companion_turns` (`location_id`,`member_id`,`conversation_id`,`at`);