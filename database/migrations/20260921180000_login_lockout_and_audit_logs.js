/**
 * Account hardening.
 *
 * users.failed_login_attempts / users.locked_until — per-account login
 * lockout: LOGIN_MAX_ATTEMPTS wrong passwords lock the account until
 * locked_until (src/services/loginLockoutService.js).
 *
 * audit_logs — security-relevant events (logins, lockouts, password resets,
 * status changes) with user, actor, IP, user-agent and request id. Never
 * contains passwords, OTPs, tokens or JWTs. user_id has no FK so the trail
 * survives a deleted account (src/services/auditService.js).
 */

async function hasColumn(knex, table, column) {
  const [rows] = await knex.raw(
    'SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1',
    [table, column]
  );
  return rows.length > 0;
}

exports.up = async function (knex) {
  if (!(await hasColumn(knex, 'users', 'failed_login_attempts'))) {
    await knex.raw('ALTER TABLE users ADD COLUMN failed_login_attempts INT UNSIGNED NOT NULL DEFAULT 0 AFTER last_active_at');
  }
  if (!(await hasColumn(knex, 'users', 'locked_until'))) {
    await knex.raw('ALTER TABLE users ADD COLUMN locked_until DATETIME DEFAULT NULL AFTER failed_login_attempts');
  }

  if (!(await knex.schema.hasTable('audit_logs'))) {
    await knex.raw(`
      CREATE TABLE audit_logs (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id INT UNSIGNED DEFAULT NULL,
        actor_id INT UNSIGNED DEFAULT NULL,
        action VARCHAR(60) NOT NULL,
        success TINYINT(1) NOT NULL DEFAULT 1,
        details VARCHAR(500) DEFAULT NULL,
        ip_address VARCHAR(45) DEFAULT NULL,
        user_agent VARCHAR(500) DEFAULT NULL,
        request_id CHAR(36) DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_audit_user_created (user_id, created_at),
        KEY idx_audit_action_created (action, created_at),
        KEY idx_audit_ip_created (ip_address, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
};

exports.down = async function (knex) {
  await knex.raw('DROP TABLE IF EXISTS audit_logs');
  if (await hasColumn(knex, 'users', 'locked_until')) {
    await knex.raw('ALTER TABLE users DROP COLUMN locked_until');
  }
  if (await hasColumn(knex, 'users', 'failed_login_attempts')) {
    await knex.raw('ALTER TABLE users DROP COLUMN failed_login_attempts');
  }
};
