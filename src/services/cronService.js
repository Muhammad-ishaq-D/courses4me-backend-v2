const cron = require('node-cron');
const logger = require('../utils/logger');
const PasswordResetModel = require('../models/passwordResetModel');
const { expirePendingBookings, PAYMENT_WINDOW_MINUTES } = require('./bookingExpiryService');
const { sendWeeklyReport } = require('./weeklyReportService');

/**
 * Scheduled jobs. Each module registers its jobs here. Times are UTC (the
 * process does not set TZ).
 */
const CronService = {
  init() {
    if (process.env.DISABLE_CRON === 'true') {
      logger.info('[CRON] disabled by DISABLE_CRON');
      return;
    }

    // Auth: purge password-reset requests older than 24h
    cron.schedule('15 3 * * *', async () => {
      try {
        const removed = await PasswordResetModel.purgeExpired(1);
        if (removed) logger.info(`[CRON] purged ${removed} expired password reset request(s)`);
      } catch (err) {
        logger.error('[CRON] password reset purge failed:', err.message);
      }
    });

    // Bookings: cancel the ones whose payment window has closed
    cron.schedule('* * * * *', async () => {
      try {
        await expirePendingBookings();
      } catch (err) {
        logger.error('[CRON] booking expiry failed:', err.message);
      }
    });

    // Reports: the weekly summary for the admins, Monday morning
    cron.schedule('0 8 * * 1', async () => {
      try {
        await sendWeeklyReport();
      } catch (err) {
        logger.error('[CRON] weekly report failed:', err.message);
      }
    });

    logger.info('[CRON] scheduled: password-reset purge (03:15 UTC daily), booking expiry (every minute, ' + PAYMENT_WINDOW_MINUTES + ' minute window), weekly report (Mondays 08:00 UTC)');
  }
};

module.exports = CronService;
