const db = require('../config/db');

/**
 * The Settings page is a single row. The defaults below are what a fresh
 * installation starts with, and they are also the fallback for a block that
 * has never been saved.
 */
const DEFAULTS = {
  general: {
    siteName: 'courses4me',
    siteUrl: 'https://www.courses4me.co.uk',
    supportEmail: 'support@courses4me.co.uk',
    phoneNumber: '+44 20 7123 4567',
    companyRegistration: '12345678',
    vatNumber: 'GB 123 456 789'
  },
  notifications: {
    bookingAlerts: true,
    paymentReceived: true,
    paymentAlerts: true,
    seatAvailability: true,
    userRegistration: false,
    courseReview: true,
    weeklyReport: true,
    loginAlert: true
  },
  emailTemplates: [
    { key: 'bookingConfirmation', title: 'Booking Confirmation', description: 'Sent immediately after a successful booking', isActive: true },
    { key: 'bookingReminder', title: 'Booking Reminder', description: 'Sent 48 hours before course start date', isActive: true },
    { key: 'paymentReceipt', title: 'Payment Receipt', description: 'Sent after successful payment', isActive: true },
    { key: 'bookingCancellation', title: 'Booking Cancellation', description: 'Sent when a booking is cancelled', isActive: true },
    { key: 'courseCompletion', title: 'Course Completion', description: 'Sent after course is marked complete', isActive: false },
    { key: 'passwordReset', title: 'Password Reset', description: 'Triggered by customer password reset request', isActive: true }
  ]
};

/** JSON columns come back as a string on some drivers and parsed on others. */
const parseJson = (value, fallback) => {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (e) {
    return fallback;
  }
};

function toPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: String(row.id),
    general: parseJson(row.general, DEFAULTS.general),
    notifications: parseJson(row.notifications, DEFAULTS.notifications),
    emailTemplates: parseJson(row.email_templates, DEFAULTS.emailTemplates),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const SettingsModel = {
  DEFAULTS,
  toPublic,

  async find() {
    const rows = await db.query('SELECT id, general, notifications, email_templates, created_at, updated_at FROM settings ORDER BY id ASC LIMIT 1');
    return rows[0] || null;
  },

  /** The settings row, created with the defaults the first time it is read. */
  async findOrCreate() {
    const existing = await SettingsModel.find();
    if (existing) return existing;

    await db.query(
      'INSERT INTO settings (general, notifications, email_templates) VALUES (?, ?, ?)',
      [JSON.stringify(DEFAULTS.general), JSON.stringify(DEFAULTS.notifications), JSON.stringify(DEFAULTS.emailTemplates)]
    );
    return SettingsModel.find();
  },

  /** Replaces only the blocks present in the payload. */
  async update(id, { general, notifications, emailTemplates }) {
    const cols = {};
    if (general !== undefined) cols.general = JSON.stringify(general);
    if (notifications !== undefined) cols.notifications = JSON.stringify(notifications);
    if (emailTemplates !== undefined) cols.email_templates = JSON.stringify(emailTemplates);

    const keys = Object.keys(cols);
    if (!keys.length) return false;
    const result = await db.query(
      `UPDATE settings SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
      [...Object.values(cols), id]
    );
    return result.affectedRows > 0;
  }
};

module.exports = SettingsModel;
