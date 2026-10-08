CREATE TABLE `administrator_requests` (
	`member_id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`member_revision` integer NOT NULL,
	`requested_auth_user_id` text,
	`browser_subject` text,
	`verified_email` text,
	`created_at` text NOT NULL,
	`verified_at` text,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action
);
