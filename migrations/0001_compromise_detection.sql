ALTER TABLE `monitored_urls` ADD `latest_compromise_result` enum('NOT_CHECKED','CLEAN','SUSPICIOUS','HACKED') DEFAULT 'NOT_CHECKED' NOT NULL;--> statement-breakpoint
ALTER TABLE `monitored_urls` ADD `latest_compromise_findings` json;--> statement-breakpoint
ALTER TABLE `monitored_urls` ADD `known_script_sources` json;--> statement-breakpoint
ALTER TABLE `monitored_urls` ADD `compromise_started_at` timestamp;--> statement-breakpoint
ALTER TABLE `monitored_urls` ADD `compromise_last_seen_at` timestamp;--> statement-breakpoint
ALTER TABLE `monitored_urls` ADD `compromise_evidence` json;--> statement-breakpoint
ALTER TABLE `monitored_urls` ADD `compromise_alert_sent_at` timestamp;