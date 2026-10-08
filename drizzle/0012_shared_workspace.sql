CREATE TABLE `browser_identity_links` (
	`subject_id` text PRIMARY KEY NOT NULL,
	`principal_id` text NOT NULL,
	`linked_at` integer NOT NULL
);

--> statement-breakpoint
CREATE UNIQUE INDEX `browser_identity_principal` ON `browser_identity_links` (`principal_id`);