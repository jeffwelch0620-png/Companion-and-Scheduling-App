ALTER TABLE `memberships` ADD `auth_user_id` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `membership_auth_identity` ON `memberships` (`auth_user_id`,`location_id`);