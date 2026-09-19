CREATE TABLE `characters` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`system` text NOT NULL,
	`campaign_id` text,
	`archived_at` integer,
	`bytes_used` integer DEFAULT 0 NOT NULL,
	`event_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `characters_owner_id_idx` ON `characters` (`owner_id`);--> statement-breakpoint
CREATE TABLE `recovery_codes` (
	`user_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recovery_codes_user_id_idx` ON `recovery_codes` (`user_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`device_label` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `usage_daily` (
	`day` text NOT NULL,
	`metric` text NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`day`, `metric`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`username_folded` text NOT NULL,
	`salt` text NOT NULL,
	`verifier_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`quota_bytes_used` integer DEFAULT 0 NOT NULL,
	`flags` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_folded_unique` ON `users` (`username_folded`);