const cron = require('node-cron');
const logger = require('../utils/logger');
const PasswordResetModel = require('../models/passwordResetModel');

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

    logger.info('[CRON] scheduled: password-reset purge (03:15 UTC daily)');
  }
};

module.exports = CronService;
