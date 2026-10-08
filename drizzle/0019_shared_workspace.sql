CREATE TABLE `invoice_files` (
	`location_id` text NOT NULL,
	`dataset` text NOT NULL,
	`sha256` text NOT NULL,
	`file_name` text NOT NULL,
	`byte_length` integer NOT NULL,
	`row_count` integer NOT NULL,
	`csv` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	PRIMARY KEY(`location_id`, `dataset`, `sha256`),
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action
);
