CREATE TABLE `monitored_domains` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`registrable_domain` varchar(253) NOT NULL,
	`expires_at` date,
	`expires_at_source` enum('RDAP','MANUAL','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
	`rdap_expires_at` date,
	`manual_expires_at` date,
	`manual_expires_at_set_at` timestamp,
	`last_lookup_at` timestamp,
	`last_lookup_error` text,
	`sent_thresholds` json NOT NULL DEFAULT ('[]'),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `monitored_domains_id` PRIMARY KEY(`id`),
	CONSTRAINT `monitored_domains_registrable_unique` UNIQUE(`registrable_domain`)
);
