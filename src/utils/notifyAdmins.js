const db = require('../config/db');
const tableExists = require('./tableExists');
const logger = require('./logger');

/**
 * Creates an in-app notification for every admin/editor, honouring the
 * Settings > Notifications toggles so admins can opt out of a category.
 *
 * Fails open: if no settings row exists yet, or settingKey is omitted, the
 * notification is sent. Never throws — a failed alert must not break the
 * request that triggered it.
 *
 * Until the `notifications` table exists the alert is logged and skipped.
 * Columns used: notifications(user_id, title, message, type, is_read),
 * settings(notifications JSON).
 */
const notifyAdmins = async ({ settingKey, title, message, type = 'system' }) => {
  try {
    if (!(await tableExists('notifications'))) {
      logger.debug(`[notifyAdmins] notifications table not available — skipped "${title}"`);
      return;
    }

    if (settingKey && (await tableExists('settings'))) {
      const rows = await db.query('SELECT notifications FROM settings ORDER BY id ASC LIMIT 1');
      const prefs = rows[0] && rows[0].notifications;
      const parsed = typeof prefs === 'string' ? JSON.parse(prefs) : prefs;
      if (parsed && parsed[settingKey] === false) return;
    }

    const admins = await db.query("SELECT id FROM users WHERE role IN ('admin','editor')");
    if (!admins.length) return;

    const values = admins.map(() => '(?, ?, ?, ?, 0)').join(', ');
    const params = admins.flatMap(a => [a.id, title, message, type]);
    await db.query(`INSERT INTO notifications (user_id, title, message, type, is_read) VALUES ${values}`, params);
  } catch (error) {
    logger.error(`notifyAdmins error (${title}):`, error.message);
  }
};

module.exports = notifyAdmins;
