const nodemailer = require('nodemailer');
const logger = require('./logger');

const isProduction = () => process.env.NODE_ENV === 'production';
const smtpConfigured = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_EMAIL && process.env.SMTP_PASSWORD);

let transporterPromise = null;

/**
 * One transporter per process. Real SMTP when configured; outside production
 * an Ethereal test inbox is used instead and the preview URL is logged.
 * In production a missing SMTP configuration is an error — OTPs and reset
 * links must never be routed to a public test inbox.
 */
function getTransporter() {
  if (transporterPromise) return transporterPromise;

  if (smtpConfigured()) {
    const port = Number(process.env.SMTP_PORT);
    transporterPromise = Promise.resolve(nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_EMAIL, pass: process.env.SMTP_PASSWORD },
      pool: true,
      maxConnections: 3
    }));
  } else if (isProduction()) {
    return Promise.reject(new Error('SMTP is not configured (SMTP_HOST, SMTP_PORT, SMTP_EMAIL, SMTP_PASSWORD are required in production)'));
  } else {
    transporterPromise = nodemailer.createTestAccount().then((account) => {
      logger.warn('[Email] SMTP not configured — using an Ethereal test inbox; messages are NOT delivered');
      return nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: { user: account.user, pass: account.pass }
      });
    });
  }
  return transporterPromise;
}

/**
 * @param {{ email: string, subject: string, message: string, html?: string }} options
 */
const sendEmail = async (options) => {
  const transporter = await getTransporter();

  const info = await transporter.sendMail({
    from: `${process.env.FROM_NAME || 'Courses4Me'} <${process.env.FROM_EMAIL || 'noreply@courses4me.co.uk'}>`,
    to: options.email,
    subject: options.subject,
    text: options.message,
    html: options.html
  });

  logger.info(`[Email] sent "${options.subject}" (${info.messageId})`);
  if (!smtpConfigured()) {
    logger.info(`[Email] preview: ${nodemailer.getTestMessageUrl(info)}`);
  }
  return info;
};

module.exports = sendEmail;
