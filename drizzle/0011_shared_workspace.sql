CREATE TABLE `employee_login_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);

--> statement-breakpoint
CREATE TABLE `employee_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`auth_user_id` text NOT NULL,
	`member_id` text NOT NULL,
	`member_revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE INDEX `employee_sessions_expiry` ON `employee_sessions` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `employee_setup_codes` (
	`member_id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`member_revision` integer NOT NULL,
	`issued_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`session_hash` text,
	FOREIGN KEY (`member_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issued_by`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
CREATE UNIQUE INDEX `employee_setup_code_hash` ON `employee_setup_codes` (`code_hash`);
--> statement-breakpoint
DROP INDEX `membership_identity`;
--> statement-breakpoint
ALTER TABLE `memberships` ADD `schedule_only` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `memberships` ADD `schedule_jobs` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `membership_identity` ON `memberships` (`email`,`location_id`) WHERE "memberships"."email" <> '';
--> statement-breakpoint
ALTER TABLE `locations` ADD `week_starts_on` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `schedule_imports` ADD `transferred_at` text;