ALTER TABLE `session` ADD `operation_slug` text;--> statement-breakpoint
CREATE INDEX `session_operation_idx` ON `session` (`operation_slug`);