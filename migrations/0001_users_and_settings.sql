CREATE TABLE `users` (
  `id` bigint unsigned AUTO_INCREMENT NOT NULL,
  `username` varchar(191) NOT NULL,
  `name` varchar(191) NOT NULL,
  `email` varchar(191),
  `password_hash` varchar(255) NOT NULL,
  `role` enum('ADMIN','VIEWER') NOT NULL DEFAULT 'VIEWER',
  `last_sign_in_at` timestamp NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `users_id` PRIMARY KEY(`id`),
  CONSTRAINT `users_username_unique` UNIQUE(`username`)
);

CREATE TABLE `app_settings` (
  `key` varchar(100) NOT NULL,
  `value` text NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `app_settings_key` PRIMARY KEY(`key`)
);
