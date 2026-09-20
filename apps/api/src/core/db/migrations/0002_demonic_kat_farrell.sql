CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`dm_id` text NOT NULL,
	`name` text NOT NULL,
	`system` text NOT NULL,
	`join_code` text NOT NULL,
	`join_open` integer DEFAULT true NOT NULL,
	`bytes_used` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`dm_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaigns_join_code_unique` ON `campaigns` (`join_code`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`campaign_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`display_name` text NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`campaign_id`, `user_id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
