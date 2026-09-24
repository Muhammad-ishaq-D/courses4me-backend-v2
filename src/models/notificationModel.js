const db = require('../config/db');

/** The bell menu shows the most recent notifications only. */
const FEED_LIMIT = 20;

function toPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: String(row.id),
    user: String(row.user_id),
    title: row.title,
    message: row.message,
    type: row.type,
    isRead: !!row.is_read,
    createdAt: row.created_at
  };
}

const NotificationModel = {
  FEED_LIMIT,
  toPublic,

  async findById(id) {
    const rows = await db.query('SELECT id, user_id, title, message, type, is_read, created_at FROM notifications WHERE id = ? LIMIT 1', [id]);
    return rows[0] || null;
  },

  async findForUser(userId, limit = FEED_LIMIT) {
    return db.query(
      'SELECT id, user_id, title, message, type, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
      [userId, limit]
    );
  },

  async countUnread(userId) {
    const [{ total }] = await db.query('SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND is_read = 0', [userId]);
    return Number(total);
  },

  async create({ userId, title, message, type = 'system' }) {
    const result = await db.query(
      'INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)',
      [userId, title, message, type]
    );
    return result.insertId;
  },

  /** One row per recipient, written in a single statement. */
  async createForUsers(userIds, { title, message, type = 'system' }) {
    if (!userIds.length) return 0;
    const result = await db.query(
      `INSERT INTO notifications (user_id, title, message, type) VALUES ${userIds.map(() => '(?, ?, ?, ?)').join(', ')}`,
      userIds.flatMap(id => [id, title, message, type])
    );
    return result.affectedRows;
  },

  async markRead(id) {
    const result = await db.query('UPDATE notifications SET is_read = 1 WHERE id = ?', [id]);
    return result.affectedRows > 0;
  },

  async markAllRead(userId) {
    const result = await db.query('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [userId]);
    return result.affectedRows;
  }
};

module.exports = NotificationModel;
