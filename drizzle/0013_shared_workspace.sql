CREATE TABLE `toast_auth_cache` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`encrypted_token` text DEFAULT '' NOT NULL,
	`expires_at` integer DEFAULT 0 NOT NULL,
	`retry_at` integer DEFAULT 0 NOT NULL,
	`lease_id` text NOT NULL
);
