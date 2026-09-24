/**
 * Platform settings and in-app notifications.
 *
 * settings       a single row holding the admin Settings page. The three
 *                blocks are JSON because their shape is decided by the page,
 *                not by the database: `general` is free-form site details,
 *                `notifications` a map of alert toggles, `email_templates` an
 *                ordered list of { key, title, description, isActive }.
 * notifications  the bell menu of the admin panel: one row per admin per
 *                event.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('settings'))) {
    await knex.raw(`
      CREATE TABLE settings (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        general LONGTEXT DEFAULT NULL CHECK (general IS NULL OR JSON_VALID(general)),
        notifications LONGTEXT DEFAULT NULL CHECK (notifications IS NULL OR JSON_VALID(notifications)),
        email_templates LONGTEXT DEFAULT NULL CHECK (email_templates IS NULL OR JSON_VALID(email_templates)),
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  if (!(await knex.schema.hasTable('notifications'))) {
    await knex.raw(`
      CREATE TABLE notifications (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id INT UNSIGNED NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        type ENUM('booking','user','payment','system') NOT NULL DEFAULT 'system',
        is_read TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_notifications_user_created (user_id, created_at),
        KEY idx_notifications_user_unread (user_id, is_read),
        CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
};

exports.down = async function (knex) {
  await knex.raw('DROP TABLE IF EXISTS notifications');
  await knex.raw('DROP TABLE IF EXISTS settings');
};
