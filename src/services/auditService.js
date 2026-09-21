const AuditLogModel = require('../models/auditLogModel');
const logger = require('../utils/logger');
const { clientIp } = require('./tokenService');

/**
 * Security audit trail. Every entry is also written to the application log.
 *
 * Rules: never pass passwords, OTPs, reset tokens or JWTs in `details`.
 * Writing the row is best-effort — an audit failure must never fail the
 * request that triggered it.
 */
const ACTIONS = {
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGIN_LOCKED: 'LOGIN_LOCKED',
  LOGIN_BLOCKED: 'LOGIN_BLOCKED',
  ADMIN_NEW_DEVICE: 'ADMIN_NEW_DEVICE',
  REGISTER: 'REGISTER',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  PASSWORD_RESET_REQUESTED: 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_THROTTLED: 'PASSWORD_RESET_THROTTLED',
  PASSWORD_RESET_DELIVERY_FAILED: 'PASSWORD_RESET_DELIVERY_FAILED',
  OTP_VERIFY_FAILED: 'OTP_VERIFY_FAILED',
  OTP_VERIFY_SUCCESS: 'OTP_VERIFY_SUCCESS',
  OTP_TOO_MANY_ATTEMPTS: 'OTP_TOO_MANY_ATTEMPTS',
  RESET_TOKEN_REJECTED: 'RESET_TOKEN_REJECTED',
  PASSWORD_RESET_COMPLETED: 'PASSWORD_RESET_COMPLETED',
  USER_STATUS_CHANGED: 'USER_STATUS_CHANGED',
  USER_HISTORY_CLEARED: 'USER_HISTORY_CLEARED'
};

/**
 * @param {import('express').Request} req  source of ip / user-agent / request id
 * @param {object} entry { action, userId?, actorId?, success?, details? }
 */
function record(req, { action, userId = null, actorId = null, success = true, details = null }) {
  const ipAddress = req ? clientIp(req) : null;
  const userAgent = req ? (req.headers['user-agent'] || '').slice(0, 500) || null : null;
  const requestId = req ? req.id || null : null;

  logger.info(`[Audit] ${action} ${success ? 'ok' : 'FAIL'} user=${userId ?? '-'} actor=${actorId ?? '-'} ip=${ipAddress ?? '-'}${details ? ` — ${details}` : ''}`);

  return AuditLogModel.create({ userId, actorId, action, success, details, ipAddress, userAgent, requestId })
    .catch((err) => logger.warn('[Audit] write failed:', err.message));
}

module.exports = { record, ACTIONS };
