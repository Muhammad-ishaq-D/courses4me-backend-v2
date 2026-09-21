const db = require('../config/db');

const AuditLogModel = {
  async create({ userId = null, actorId = null, action, success = true, details = null, ipAddress = null, userAgent = null, requestId = null }) {
    const result = await db.query(
      `INSERT INTO audit_logs (user_id, actor_id, action, success, details, ip_address, user_agent, request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, actorId, action, success ? 1 : 0, details, ipAddress, userAgent, requestId]
    );
    return result.insertId;
  }
};

module.exports = AuditLogModel;
