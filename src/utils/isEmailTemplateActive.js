const SettingsModel = require('../models/settingsModel');
const logger = require('./logger');

/**
 * Checks whether a Settings > Email Templates entry is active.
 *
 * Fails open (true) when no settings row exists yet or the key is not one of
 * the configured templates, so email delivery is never silently switched off
 * by missing configuration.
 */
const isEmailTemplateActive = async (key) => {
  try {
    const settings = await SettingsModel.find();
    if (!settings) return true;

    const templates = SettingsModel.toPublic(settings).emailTemplates;
    const template = Array.isArray(templates) ? templates.find(t => t.key === key) : null;
    return template ? template.isActive !== false : true;
  } catch (error) {
    logger.error(`isEmailTemplateActive error (${key}):`, error.message);
    return true;
  }
};

module.exports = isEmailTemplateActive;
