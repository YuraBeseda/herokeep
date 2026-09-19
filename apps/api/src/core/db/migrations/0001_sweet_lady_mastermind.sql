ALTER TABLE `sessions` ADD `id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_id_unique` ON `sessions` (`id`);