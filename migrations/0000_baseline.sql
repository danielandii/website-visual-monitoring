CREATE TABLE IF NOT EXISTS `app_settings` (
	`key` varchar(100) NOT NULL,
	`value` text NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `app_settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `monitored_urls` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(191) NOT NULL,
	`url` text NOT NULL,
	`normalized_url` text NOT NULL,
	`normalized_url_hash` char(64) NOT NULL,
	`enabled` boolean NOT NULL DEFAULT true,
	`next_check_at` timestamp NOT NULL DEFAULT (now()),
	`check_claimed_at` timestamp,
	`check_claimed_by` varchar(191),
	`latest_status` enum('UNKNOWN','OK','FAILING','BLOCKED') NOT NULL DEFAULT 'UNKNOWN',
	`latest_failure_category` enum('DOWN','BLANK','ERROR_PAGE','VISUAL_BROKEN'),
	`latest_summary` text,
	`latest_signals` json,
	`latest_http_status` int,
	`latest_final_url` text,
	`latest_duration_ms` int,
	`latest_checked_at` timestamp,
	`latest_ai_classification` varchar(64),
	`latest_ai_confidence` int,
	`latest_block_type` enum('CAPTCHA','BOT_CHALLENGE','ACCESS_DENIED','RATE_LIMITED'),
	`latest_block_provider` varchar(64),
	`latest_block_evidence` json,
	`failure_started_at` timestamp,
	`failure_episode_category` enum('DOWN','BLANK','ERROR_PAGE','VISUAL_BROKEN'),
	`alert_sent_at` timestamp,
	`recovered_at` timestamp,
	`block_started_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `monitored_urls_id` PRIMARY KEY(`id`),
	CONSTRAINT `monitored_urls_normalized_hash_unique` UNIQUE(`normalized_url_hash`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `users` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`username` varchar(191) NOT NULL,
	`name` varchar(191) NOT NULL,
	`email` varchar(191),
	`password_hash` varchar(255) NOT NULL,
	`role` enum('ADMIN','VIEWER') NOT NULL DEFAULT 'VIEWER',
	`last_sign_in_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_username_unique` UNIQUE(`username`)
);
