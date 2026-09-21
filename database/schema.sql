-- Courses4Me database schema (structure only) — migration BASELINE.
--
-- Executed once, on an empty database, by
-- database/migrations/00000000000000_baseline.js. On a database that already
-- has the `users` table the baseline is recorded as applied and skipped.
--
-- Every schema change after this point is a timestamped knex migration in
-- database/migrations/ (npm run migrate:make <name>). Do NOT add tables here.
--
-- Conventions
--   * snake_case columns; API responses are mapped to camelCase in the models.
--   * Instants are DATETIME in UTC (driver + session time_zone are UTC).
--   * `created_at` / `updated_at` on every table, maintained by MySQL.
--
-- Tables: users, user_devices, user_activity_logs, password_resets

SET FOREIGN_KEY_CHECKS = 0;

-- --------------------------------------------------------------------------
-- users — customers, editors and admins share one table (role column)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(150) NOT NULL,
  `email` VARCHAR(190) NOT NULL,
  -- NULL for social-only accounts (Google / Facebook) that never set a password
  `password_hash` VARCHAR(255) DEFAULT NULL,
  `google_id` VARCHAR(64) DEFAULT NULL,
  `facebook_id` VARCHAR(64) DEFAULT NULL,
  `phone` VARCHAR(30) DEFAULT NULL,
  `dob` DATE DEFAULT NULL,
  `billing_postcode` VARCHAR(20) DEFAULT NULL,
  `billing_line1` VARCHAR(255) DEFAULT NULL,
  `billing_line2` VARCHAR(255) DEFAULT NULL,
  `billing_city` VARCHAR(100) DEFAULT NULL,
  `role` ENUM('admin','editor','customer') NOT NULL DEFAULT 'customer',
  `job_title` VARCHAR(150) DEFAULT NULL,
  `bio` TEXT DEFAULT NULL,
  `profile_image` VARCHAR(500) DEFAULT NULL,
  -- Bumped on password change/reset; a JWT whose tokenVersion differs is rejected
  `token_version` INT UNSIGNED NOT NULL DEFAULT 0,
  `status` ENUM('active','inactive','suspended','blocked','pending verification') NOT NULL DEFAULT 'active',
  `status_reason` VARCHAR(500) DEFAULT NULL,
  `last_login_at` DATETIME DEFAULT NULL,
  `last_active_at` DATETIME DEFAULT NULL,
  -- Record id in the previous system; used only by the data import
  `legacy_id` CHAR(24) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`),
  UNIQUE KEY `uq_users_google_id` (`google_id`),
  UNIQUE KEY `uq_users_facebook_id` (`facebook_id`),
  UNIQUE KEY `uq_users_legacy_id` (`legacy_id`),
  KEY `idx_users_role_status` (`role`, `status`),
  KEY `idx_users_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------------------
-- user_devices — devices an admin/editor has logged in from. A login from an
-- unknown fingerprint (user-agent + IP) raises an admin alert. The app keeps
-- at most 20 rows per user.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_devices` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `fingerprint` CHAR(64) NOT NULL,
  `user_agent` VARCHAR(500) DEFAULT NULL,
  `ip` VARCHAR(45) DEFAULT NULL,
  `first_seen_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_devices_user_fingerprint` (`user_id`, `fingerprint`),
  CONSTRAINT `fk_user_devices_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------------------
-- user_activity_logs — account timeline shown in the admin panel (login,
-- registration, status change, password change/reset, profile update,
-- history cleared).
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_activity_logs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `action` VARCHAR(100) NOT NULL,
  `details` TEXT DEFAULT NULL,
  `reason` VARCHAR(500) DEFAULT NULL,
  `admin_name` VARCHAR(150) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_activity_user_created` (`user_id`, `created_at`),
  CONSTRAINT `fk_user_activity_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------------------
-- password_resets — one row per reset request. Admin flow: OTP -> reset
-- token. Portal flow: the emailed link carries the reset token directly
-- (otp_* columns pre-consumed). Only HMAC-SHA256 hashes are stored, never the
-- OTP or token itself. Rows older than 24h are purged by the daily cron.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `password_resets` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `otp_hash` CHAR(64) NOT NULL,
  `otp_expires_at` DATETIME NOT NULL,
  `attempts` INT UNSIGNED NOT NULL DEFAULT 0,
  `last_sent_at` DATETIME NOT NULL,
  `otp_consumed_at` DATETIME DEFAULT NULL,
  `reset_token_hash` CHAR(64) DEFAULT NULL,
  `reset_token_expires_at` DATETIME DEFAULT NULL,
  `reset_token_consumed_at` DATETIME DEFAULT NULL,
  `request_ip` VARCHAR(45) DEFAULT NULL,
  `user_agent` VARCHAR(500) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_password_resets_user` (`user_id`),
  KEY `idx_password_resets_otp_hash` (`otp_hash`),
  KEY `idx_password_resets_token_hash` (`reset_token_hash`),
  KEY `idx_password_resets_otp_expires` (`otp_expires_at`),
  CONSTRAINT `fk_password_resets_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
