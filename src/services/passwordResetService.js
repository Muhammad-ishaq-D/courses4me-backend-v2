const crypto = require('crypto');
const UserModel = require('../models/userModel');
const PasswordResetModel = require('../models/passwordResetModel');
const sendEmail = require('../utils/sendEmail');
const isEmailTemplateActive = require('../utils/isEmailTemplateActive');
const logger = require('../utils/logger');
const audit = require('./auditService');
const { clientIp } = require('./tokenService');

const OTP_TTL_MS = 10 * 60 * 1000;          // OTP valid for 10 minutes
const RESET_TOKEN_TTL_MS = 10 * 60 * 1000;  // reset token valid for 10 minutes
const MAX_OTP_ATTEMPTS = 15;
// Per-account cap on forgot-password emails; beyond it the generic success
// message is still returned but nothing is sent.
const MAX_REQUESTS_PER_HOUR = Math.max(1, parseInt(process.env.RESET_MAX_PER_HOUR, 10) || 3);

const ADMIN_ROLES = ['admin', 'editor'];
const isAdminRole = (role) => ADMIN_ROLES.includes(role);

// Only HMAC-SHA256 digests of OTPs / reset tokens are ever stored or logged.
const hashSecret = (value) => crypto.createHmac('sha256', process.env.OTP_SECRET).update(String(value)).digest('hex');

const requestMeta = (req) => ({
  requestIp: clientIp(req),
  userAgent: (req.headers['user-agent'] || 'unknown').slice(0, 500)
});

const emailFrame = (inner) => `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
    ${inner}
    <p style="color: #777; font-size: 14px; margin-top: 30px;">If you didn't request this, you can safely ignore this email.</p>
  </div>`;

/**
 * Delivery runs in the background so the HTTP response time is the same
 * whether or not the email exists (no timing-based account enumeration).
 * On failure the request row is removed so the code/link can never be used.
 */
function deliverInBackground(req, user, resetId, mail) {
  sendEmail(mail)
    .then(() => audit.record(req, { action: audit.ACTIONS.PASSWORD_RESET_REQUESTED, userId: user.id }))
    .catch(async (err) => {
      logger.error(`[PasswordReset] delivery failed for user ${user.id}: ${err.message}`);
      await PasswordResetModel.deleteById(resetId).catch(() => {});
      audit.record(req, { action: audit.ACTIONS.PASSWORD_RESET_DELIVERY_FAILED, userId: user.id, success: false, details: err.message.slice(0, 200) });
    });
}

async function throttled(req, user) {
  const recent = await PasswordResetModel.countRecentForUser(user.id, 60);
  if (recent < MAX_REQUESTS_PER_HOUR) return false;
  audit.record(req, { action: audit.ACTIONS.PASSWORD_RESET_THROTTLED, userId: user.id, success: false, details: `${recent} requests in the last hour` });
  return true;
}

/**
 * Admin flow, step 1: create a request row and email a 6-digit OTP.
 * Any previous live OTP for the user is invalidated first.
 */
async function issueOtp(user, req) {
  if (await throttled(req, user)) return;

  const otp = crypto.randomInt(100000, 1000000).toString();
  await PasswordResetModel.invalidateOpenOtps(user.id);
  const id = await PasswordResetModel.create({
    userId: user.id,
    otpHash: hashSecret(otp),
    otpExpiresAt: new Date(Date.now() + OTP_TTL_MS),
    ...requestMeta(req)
  });

  deliverInBackground(req, user, id, {
    email: user.email,
    subject: 'Password Reset Request',
    message: `You are receiving this email because you (or someone else) has requested a password reset.\n\nYour verification code is: ${otp}\n\nThis code will expire in 10 minutes. If you didn't request this, you can safely ignore this email.`,
    html: emailFrame(`
      <h3 style="color: #333;">Password Reset Request</h3>
      <p style="color: #555; font-size: 16px;">Use the verification code below to reset your password.</p>
      <div style="text-align: center; margin: 30px 0;">
        <span style="display: inline-block; background-color: #F8510C; color: white; padding: 16px 32px; border-radius: 8px; font-weight: bold; font-size: 28px; letter-spacing: 8px;">${otp}</span>
      </div>
      <p style="color: #777; font-size: 14px;">This code will expire in 10 minutes.</p>`)
  });
}

/**
 * Admin flow, step 2: verify the OTP once and hand back a single-use reset
 * token. Returns the token string or null (generic failure).
 */
async function verifyOtp(otp, req, { requireAdmin = true } = {}) {
  const record = await PasswordResetModel.findLiveByOtpHash(hashSecret(otp));
  if (!record) {
    audit.record(req, { action: audit.ACTIONS.OTP_VERIFY_FAILED, success: false, details: 'invalid or expired code' });
    return null;
  }
  await PasswordResetModel.incrementAttempts(record.id);
  if (record.attempts + 1 > MAX_OTP_ATTEMPTS) {
    audit.record(req, { action: audit.ACTIONS.OTP_TOO_MANY_ATTEMPTS, userId: record.user_id, success: false });
    return null;
  }
  if (requireAdmin && !isAdminRole(record.user_role)) {
    audit.record(req, { action: audit.ACTIONS.OTP_VERIFY_FAILED, userId: record.user_id, success: false, details: 'code belongs to a non-admin account' });
    return null;
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  const consumed = await PasswordResetModel.consumeOtpAndIssueToken(
    record.id, hashSecret(resetToken), new Date(Date.now() + RESET_TOKEN_TTL_MS)
  );
  if (!consumed) return null; // lost a race with a concurrent verify

  audit.record(req, { action: audit.ACTIONS.OTP_VERIFY_SUCCESS, userId: record.user_id });
  return resetToken;
}

/**
 * Portal flow, step 1: no OTP — the emailed link carries the reset token.
 * The otp_* columns are pre-consumed so the token is live immediately.
 */
async function issueResetLink(user, req) {
  if (await throttled(req, user)) return;

  const resetToken = crypto.randomBytes(32).toString('hex');
  await PasswordResetModel.invalidateOpenResetTokens(user.id);
  const id = await PasswordResetModel.create({
    userId: user.id,
    otpHash: hashSecret(`portal-link:${resetToken}`),
    otpExpiresAt: new Date(),
    otpConsumedAt: new Date(),
    resetTokenHash: hashSecret(resetToken),
    resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    ...requestMeta(req)
  });

  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
  deliverInBackground(req, user, id, {
    email: user.email,
    subject: 'Password Reset Request',
    message: `You are receiving this email because you (or someone else) has requested the reset of a password. Please click on the link below or paste it into your browser to complete the process: \n\n ${resetUrl}`,
    html: emailFrame(`
      <h3 style="color: #333;">Password Reset Request</h3>
      <p style="color: #555; font-size: 16px;">You requested a password reset. Please click the button below to reset your password.</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${resetUrl}" style="background-color: #F8510C; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">Reset Password</a>
      </div>
      <p style="color: #777; font-size: 14px;">This link will expire in 10 minutes.</p>
      <p style="color: #999; font-size: 12px; margin-top: 20px;">If the button above doesn't work, copy and paste this link into your browser:</p>
      <p style="color: #F8510C; font-size: 12px; word-break: break-all;">${resetUrl}</p>`)
  });
}

/**
 * Final step for both flows: consume the reset token, set the password, bump
 * tokenVersion (logs every device out) and record the activity.
 * `audience` is 'admin' or 'portal' — a token issued for one can't be used on
 * the other's endpoint. Returns true on success, false on any invalid token.
 */
async function completeReset(resetToken, newPassword, audience, req) {
  const record = await PasswordResetModel.findLiveByResetTokenHash(hashSecret(resetToken));
  if (!record) {
    audit.record(req, { action: audit.ACTIONS.RESET_TOKEN_REJECTED, success: false, details: `invalid or expired token (${audience})` });
    return false;
  }
  // Audience is checked before the token is consumed, so a token pasted into
  // the wrong app's form is refused without being burned.
  const adminRole = isAdminRole(record.user_role);
  if ((audience === 'admin' && !adminRole) || (audience === 'portal' && adminRole)) {
    audit.record(req, { action: audit.ACTIONS.RESET_TOKEN_REJECTED, userId: record.user_id, success: false, details: `token used on the wrong endpoint (${audience})` });
    return false;
  }
  if (!(await PasswordResetModel.consumeResetToken(record.id))) {
    return false; // lost a race with a concurrent reset using the same token
  }

  const hash = await UserModel.hashPassword(newPassword);
  await UserModel.setPassword(record.user_id, hash);
  await UserModel.addActivity(record.user_id, {
    action: 'Password Reset',
    details: audience === 'admin'
      ? 'Password was reset via admin reset token'
      : 'Password was reset using the portal email link'
  });
  audit.record(req, { action: audit.ACTIONS.PASSWORD_RESET_COMPLETED, userId: record.user_id });

  const user = await UserModel.findById(record.user_id);
  if (user) notifyPasswordChanged(user, req);
  return true;
}

/**
 * Tells the account owner their password changed. Sent in the background;
 * a delivery failure is logged and never affects the response.
 */
function notifyPasswordChanged(user, req) {
  const when = new Date().toUTCString();
  const ip = req ? clientIp(req) : 'unknown';
  sendEmail({
    email: user.email,
    subject: 'Your password was changed',
    message: `Hello ${user.name},\n\nThe password for your Courses4Me account was changed on ${when} (IP: ${ip}).\n\nIf this was you, no action is needed. If you did not make this change, reset your password immediately and contact support.`,
    html: emailFrame(`
      <h3 style="color: #333;">Your password was changed</h3>
      <p style="color: #555; font-size: 16px;">Hello ${user.name}, the password for your Courses4Me account was changed on <strong>${when}</strong> (IP: ${ip}).</p>
      <p style="color: #555; font-size: 15px;">If this was you, no action is needed. If you did not make this change, reset your password immediately and contact support.</p>`)
  }).catch((err) => logger.warn(`[PasswordReset] password-changed notice failed for user ${user.id}: ${err.message}`));
}

/** Shared guard: settings toggle for the password-reset email template. */
async function resetEmailsEnabled() {
  return isEmailTemplateActive('passwordReset');
}

module.exports = {
  ADMIN_ROLES,
  isAdminRole,
  hashSecret,
  issueOtp,
  verifyOtp,
  issueResetLink,
  completeReset,
  notifyPasswordChanged,
  resetEmailsEnabled,
  OTP_TTL_MS,
  RESET_TOKEN_TTL_MS,
  MAX_OTP_ATTEMPTS,
  MAX_REQUESTS_PER_HOUR
};
