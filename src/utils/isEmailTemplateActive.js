const db = require('../config/db');
const tableExists = require('./tableExists');
const logger = require('./logger');

/**
 * Checks whether a Settings > Email Templates entry is active.
 *
 * Fails open (true) if the settings table is not available, no settings row
 * exists, or the key isn't recognised, so email delivery isn't silently
 * broken by missing configuration.
 *
 * Reads settings.email_templates, a JSON array of
 * { key, title, description, isActive }.
 */
const isEmailTemplateActive = async (key) => {
  try {
    if (!(await tableExists('settings'))) return true;
    const rows = await db.query('SELECT email_templates FROM settings ORDER BY id ASC LIMIT 1');
    const raw = rows[0] && rows[0].email_templates;
    const templates = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const template = Array.isArray(templates) ? templates.find(t => t.key === key) : null;
    return template ? template.isActive !== false : true;
  } catch (error) {
    logger.error(`isEmailTemplateActive error (${key}):`, error.message);
    return true;
  }
};

module.exports = isEmailTemplateActive;
