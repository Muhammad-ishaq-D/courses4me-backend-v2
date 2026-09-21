const db = require('../config/db');

/**
 * Per-account login lockout, independent of the per-IP rate limiter.
 * After LOGIN_MAX_ATTEMPTS consecutive wrong passwords the account is locked
 * for LOGIN_LOCK_MINUTES. A successful login resets the counter.
 */
const MAX_ATTEMPTS = Math.max(1, parseInt(process.env.LOGIN_MAX_ATTEMPTS, 10) || 5);
const LOCK_MINUTES = Math.max(1, parseInt(process.env.LOGIN_LOCK_MINUTES, 10) || 15);

/** Minutes left on an active lock, or 0 when the account is not locked. */
function minutesLocked(user) {
  if (!user.locked_until) return 0;
  const remainingMs = new Date(user.locked_until).getTime() - Date.now();
  return remainingMs > 0 ? Math.ceil(remainingMs / 60000) : 0;
}

/**
 * Records a failed attempt. Returns { locked: boolean, attemptsLeft: number }.
 * The lock is applied in the same statement that reaches the threshold.
 */
async function recordFailure(user) {
  const attempts = (user.failed_login_attempts || 0) + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await db.query(
      'UPDATE users SET failed_login_attempts = ?, locked_until = UTC_TIMESTAMP() + INTERVAL ? MINUTE WHERE id = ?',
      [attempts, LOCK_MINUTES, user.id]
    );
    return { locked: true, attemptsLeft: 0 };
  }
  await db.query('UPDATE users SET failed_login_attempts = ? WHERE id = ?', [attempts, user.id]);
  return { locked: false, attemptsLeft: MAX_ATTEMPTS - attempts };
}

async function recordSuccess(user) {
  if (!user.failed_login_attempts && !user.locked_until) return;
  await db.query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?', [user.id]);
}

module.exports = { minutesLocked, recordFailure, recordSuccess, MAX_ATTEMPTS, LOCK_MINUTES };
