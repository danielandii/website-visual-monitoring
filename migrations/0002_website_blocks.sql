ALTER TABLE `monitored_urls`
  MODIFY COLUMN `latest_status` enum('UNKNOWN','OK','FAILING','BLOCKED') NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN `latest_block_type` enum('CAPTCHA','BOT_CHALLENGE','ACCESS_DENIED','RATE_LIMITED') NULL AFTER `latest_ai_confidence`,
  ADD COLUMN `latest_block_provider` varchar(64) NULL AFTER `latest_block_type`,
  ADD COLUMN `latest_block_evidence` json NULL AFTER `latest_block_provider`,
  ADD COLUMN `failure_episode_category` enum('DOWN','BLANK','ERROR_PAGE','VISUAL_BROKEN') NULL AFTER `failure_started_at`,
  ADD COLUMN `block_started_at` timestamp NULL AFTER `recovered_at`;

UPDATE `monitored_urls`
SET `failure_episode_category` = `latest_failure_category`
WHERE `failure_started_at` IS NOT NULL
  AND `latest_failure_category` IS NOT NULL
  AND `latest_failure_category` <> 'BLOCKED';

-- Website Blocks are no longer Failures. Old BLOCKED rows carry no provider
-- headers and may include bare 403s, so reclassify them on the next check.
UPDATE `monitored_urls`
SET `latest_status` = 'UNKNOWN',
    `latest_failure_category` = NULL,
    `failure_started_at` = NULL,
    `failure_episode_category` = NULL,
    `alert_sent_at` = NULL,
    `next_check_at` = UTC_TIMESTAMP()
WHERE `latest_failure_category` = 'BLOCKED';

ALTER TABLE `monitored_urls`
  MODIFY COLUMN `latest_failure_category` enum('DOWN','BLANK','ERROR_PAGE','VISUAL_BROKEN') NULL;
