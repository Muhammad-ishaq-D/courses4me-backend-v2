const db = require('../config/db');

/**
 * password_resets — one row per reset request; only HMAC hashes are stored.
 *
 * The consume* functions are single conditional UPDATEs, so an OTP or reset
 * token can be used exactly once even under concurrent requests.
 */
const PasswordResetModel = {
  async create({
    userId, otpHash, otpExpiresAt, otpConsumedAt = null,
    resetTokenHash = null, resetTokenExpiresAt = null,
    requestIp = null, userAgent = null
  }) {
    const result = await db.query(
      `INSERT INTO password_resets
         (user_id, otp_hash, otp_expires_at, otp_consumed_at, reset_token_hash, reset_token_expires_at,
          last_sent_at, request_ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), ?, ?)`,
      [userId, otpHash, otpExpiresAt, otpConsumedAt, resetTokenHash, resetTokenExpiresAt, requestIp, userAgent]
    );
    return result.insertId;
  },

  async deleteById(id) {
    await db.query('DELETE FROM password_resets WHERE id = ?', [id]);
  },

  /** Requests created for the user in the last `minutes` (per-account throttle). */
  async countRecentForUser(userId, minutes) {
    const [{ total }] = await db.query(
      'SELECT COUNT(*) AS total FROM password_resets WHERE user_id = ? AND last_sent_at > UTC_TIMESTAMP() - INTERVAL ? MINUTE',
      [userId, minutes]
    );
    return Number(total);
  },

  /** Invalidate every request for the user that still has a live OTP. */
  async invalidateOpenOtps(userId) {
    await db.query(
      'UPDATE password_resets SET otp_consumed_at = UTC_TIMESTAMP() WHERE user_id = ? AND otp_consumed_at IS NULL',
      [userId]
    );
  },

  /** Invalidate every request for the user that still has a live reset token. */
  async invalidateOpenResetTokens(userId) {
    await db.query(
      'UPDATE password_resets SET reset_token_consumed_at = UTC_TIMESTAMP() WHERE user_id = ? AND reset_token_hash IS NOT NULL AND reset_token_consumed_at IS NULL',
      [userId]
    );
  },

  /**
   * Find the live request matching an OTP hash and count the attempt.
   * Returns the row (joined with the user's role) or null.
   */
  async findLiveByOtpHash(otpHash) {
    const rows = await db.query(
      `SELECT pr.id, pr.user_id, pr.attempts, u.role AS user_role
         FROM password_resets pr
         JOIN users u ON u.id = pr.user_id
        WHERE pr.otp_hash = ? AND pr.otp_consumed_at IS NULL AND pr.otp_expires_at > UTC_TIMESTAMP()
        LIMIT 1`,
      [otpHash]
    );
    return rows[0] || null;
  },

  async incrementAttempts(id) {
    await db.query('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?', [id]);
  },

  /**
   * Atomically consume the OTP and attach a reset token. Returns true when this
   * call won the race (the OTP was still unconsumed).
   */
  async consumeOtpAndIssueToken(id, resetTokenHash, resetTokenExpiresAt) {
    const result = await db.query(
      `UPDATE password_resets
          SET otp_consumed_at = UTC_TIMESTAMP(), reset_token_hash = ?, reset_token_expires_at = ?
        WHERE id = ? AND otp_consumed_at IS NULL AND otp_expires_at > UTC_TIMESTAMP()`,
      [resetTokenHash, resetTokenExpiresAt, id]
    );
    return result.affectedRows > 0;
  },

  /** Live (unconsumed, unexpired) request for a reset-token hash, with the user's role. */
  async findLiveByResetTokenHash(resetTokenHash) {
    const rows = await db.query(
      `SELECT pr.id, pr.user_id, u.role AS user_role
         FROM password_resets pr JOIN users u ON u.id = pr.user_id
        WHERE pr.reset_token_hash = ? AND pr.reset_token_consumed_at IS NULL AND pr.reset_token_expires_at > UTC_TIMESTAMP()
        LIMIT 1`,
      [resetTokenHash]
    );
    return rows[0] || null;
  },

  /**
   * Atomically consume a reset token by row id. Returns true when this call
   * won the race (the token was still live).
   */
  async consumeResetToken(id) {
    const result = await db.query(
      `UPDATE password_resets
          SET reset_token_consumed_at = UTC_TIMESTAMP()
        WHERE id = ? AND reset_token_consumed_at IS NULL AND reset_token_expires_at > UTC_TIMESTAMP()`,
      [id]
    );
    return result.affectedRows > 0;
  },

  /** Purge requests whose OTP expired more than `days` ago (cron). */
  async purgeExpired(days = 1) {
    const result = await db.query(
      'DELETE FROM password_resets WHERE otp_expires_at < UTC_TIMESTAMP() - INTERVAL ? DAY',
      [days]
    );
    return result.affectedRows;
  }
};

module.exports = PasswordResetModel;
