const db = require('../config/db');
const NotificationModel = require('../models/notificationModel');
const SettingsModel = require('../models/settingsModel');
const logger = require('./logger');

/**
 * Creates an in-app notification for every admin and editor, honouring the
 * Settings > Notifications toggles so admins can opt out of a category.
 *
 * Fails open: when no settings row exists yet, or `settingKey` is omitted, the
 * notification is sent. Never throws — a failed alert must not break the
 * request that triggered it.
 */
const notifyAdmins = async ({ settingKey, title, message, type = 'system' }) => {
  try {
    if (settingKey) {
      const settings = await SettingsModel.find();
      const prefs = settings ? SettingsModel.toPublic(settings).notifications : null;
      if (prefs && prefs[settingKey] === false) return;
    }

    const admins = await db.query("SELECT id FROM users WHERE role IN ('admin','editor')");
    if (!admins.length) return;

    await NotificationModel.createForUsers(admins.map(a => a.id), { title, message, type });
  } catch (error) {
    logger.error(`notifyAdmins error (${title}):`, error.message);
  }
};

module.exports = notifyAdmins;
