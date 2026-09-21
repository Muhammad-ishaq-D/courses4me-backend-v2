const bcrypt = require('bcryptjs');
const db = require('../config/db');

const BCRYPT_ROUNDS = 10;
const MAX_DEVICES_PER_USER = 20;

// camelCase (API) -> snake_case (column). Only these keys can ever be written.
const COLUMNS = {
  name: 'name',
  email: 'email',
  passwordHash: 'password_hash',
  googleId: 'google_id',
  facebookId: 'facebook_id',
  phone: 'phone',
  dob: 'dob',
  billingPostcode: 'billing_postcode',
  billingLine1: 'billing_line1',
  billingLine2: 'billing_line2',
  billingCity: 'billing_city',
  role: 'role',
  jobTitle: 'job_title',
  bio: 'bio',
  profileImage: 'profile_image',
  tokenVersion: 'token_version',
  status: 'status',
  statusReason: 'status_reason',
  lastLoginAt: 'last_login_at',
  lastActiveAt: 'last_active_at',
  legacyId: 'legacy_id'
};

const SELECT = `
  id, name, email, password_hash, google_id, facebook_id, phone, dob,
  billing_postcode, billing_line1, billing_line2, billing_city,
  role, job_title, bio, profile_image, token_version, status, status_reason,
  last_login_at, last_active_at, failed_login_attempts, locked_until, created_at, updated_at`;

function toColumns(data) {
  const out = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (value === undefined) continue;
    const col = COLUMNS[key];
    if (col) out[col] = value === '' ? null : value;
  }
  if (data && data.billingAddress && typeof data.billingAddress === 'object') {
    const b = data.billingAddress;
    if (b.postcode !== undefined) out.billing_postcode = b.postcode || null;
    if (b.line1 !== undefined) out.billing_line1 = b.line1 || null;
    if (b.line2 !== undefined) out.billing_line2 = b.line2 || null;
    if (b.city !== undefined) out.billing_city = b.city || null;
  }
  return out;
}

/** Row -> API shape (camelCase, `_id` alias for the frontends). Never includes the password hash. */
function toPublic(row, extras = {}) {
  if (!row) return null;
  return {
    id: row.id,
    _id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    phone: row.phone,
    dob: row.dob,
    billingAddress: {
      postcode: row.billing_postcode,
      line1: row.billing_line1,
      line2: row.billing_line2,
      city: row.billing_city
    },
    jobTitle: row.job_title,
    bio: row.bio,
    profileImage: row.profile_image,
    googleId: row.google_id,
    facebookId: row.facebook_id,
    status: row.status,
    statusReason: row.status_reason,
    tokenVersion: row.token_version,
    lastLogin: row.last_login_at || row.created_at,
    lastActive: row.last_active_at || row.created_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extras
  };
}

function activityToPublic(row) {
  return {
    id: row.id,
    action: row.action,
    details: row.details,
    reason: row.reason,
    adminName: row.admin_name,
    timestamp: row.created_at
  };
}

const UserModel = {
  toPublic,
  activityToPublic,

  async hashPassword(plain) {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
  },
  async verifyPassword(plain, hash) {
    if (!hash) return false;
    return bcrypt.compare(plain, hash);
  },

  // Lookups return the raw row (including password_hash); controllers call toPublic().
  async findById(id) {
    const rows = await db.query(`SELECT ${SELECT} FROM users WHERE id = ? LIMIT 1`, [id]);
    return rows[0] || null;
  },
  async findByEmail(email) {
    const rows = await db.query(`SELECT ${SELECT} FROM users WHERE email = ? LIMIT 1`, [String(email).toLowerCase().trim()]);
    return rows[0] || null;
  },
  async findByGoogleId(googleId) {
    const rows = await db.query(`SELECT ${SELECT} FROM users WHERE google_id = ? LIMIT 1`, [googleId]);
    return rows[0] || null;
  },
  async findByFacebookId(facebookId) {
    const rows = await db.query(`SELECT ${SELECT} FROM users WHERE facebook_id = ? LIMIT 1`, [facebookId]);
    return rows[0] || null;
  },
  async emailExists(email) {
    const rows = await db.query('SELECT 1 FROM users WHERE email = ? LIMIT 1', [String(email).toLowerCase().trim()]);
    return rows.length > 0;
  },

  /** Admin list with optional search / status / role filters, newest first. */
  async findAll({ search, status, role } = {}) {
    const where = [];
    const params = [];
    if (status) { where.push('status = ?'); params.push(status); }
    if (role) { where.push('role = ?'); params.push(role); }
    if (search) {
      const like = `%${search}%`;
      where.push('(name LIKE ? OR email LIKE ? OR phone LIKE ?)');
      params.push(like, like, like);
    }
    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    return db.query(`SELECT ${SELECT} FROM users${whereSql} ORDER BY created_at DESC, id DESC`, params);
  },

  async countByRole() {
    const rows = await db.query('SELECT role, COUNT(*) AS total FROM users GROUP BY role');
    const counts = { customer: 0, admin: 0, editor: 0 };
    for (const r of rows) counts[r.role] = Number(r.total);
    counts.total = counts.customer + counts.admin + counts.editor;
    return counts;
  },

  async create(data) {
    const cols = toColumns(data);
    if (cols.email) cols.email = String(cols.email).toLowerCase().trim();
    const keys = Object.keys(cols);
    const sql = `INSERT INTO users (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
    const result = await db.query(sql, Object.values(cols));
    return result.insertId;
  },

  async update(id, data) {
    const cols = toColumns(data);
    if (cols.email) cols.email = String(cols.email).toLowerCase().trim();
    const keys = Object.keys(cols);
    if (!keys.length) return false;
    const sql = `UPDATE users SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`;
    const result = await db.query(sql, [...Object.values(cols), id]);
    return result.affectedRows > 0;
  },

  async touchLogin(id) {
    await db.query('UPDATE users SET last_login_at = UTC_TIMESTAMP(), last_active_at = UTC_TIMESTAMP() WHERE id = ?', [id]);
  },

  /** Sets a new password hash and invalidates every existing JWT. */
  async setPassword(id, passwordHash) {
    const result = await db.query(
      'UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?',
      [passwordHash, id]
    );
    return result.affectedRows > 0;
  },

  // ── activity timeline ───────────────────────────────────────────────────
  async addActivity(userId, { action, details = null, reason = null, adminName = null }) {
    const result = await db.query(
      'INSERT INTO user_activity_logs (user_id, action, details, reason, admin_name) VALUES (?, ?, ?, ?, ?)',
      [userId, action, details, reason, adminName]
    );
    return result.insertId;
  },
  async getActivity(userId) {
    const rows = await db.query(
      'SELECT id, action, details, reason, admin_name, created_at FROM user_activity_logs WHERE user_id = ? ORDER BY created_at ASC, id ASC',
      [userId]
    );
    return rows.map(activityToPublic);
  },
  /** Activity for many users at once: { [userId]: [...] } */
  async getActivityForUsers(userIds) {
    const map = {};
    if (!userIds.length) return map;
    const rows = await db.query(
      'SELECT id, user_id, action, details, reason, admin_name, created_at FROM user_activity_logs WHERE user_id IN (?) ORDER BY created_at ASC, id ASC',
      [userIds]
    );
    for (const r of rows) (map[r.user_id] ||= []).push(activityToPublic(r));
    return map;
  },
  async clearActivity(userId) {
    await db.query('DELETE FROM user_activity_logs WHERE user_id = ?', [userId]);
  },

  // ── known devices ───────────────────────────────────────────────────────
  async findDevice(userId, fingerprint) {
    const rows = await db.query('SELECT id FROM user_devices WHERE user_id = ? AND fingerprint = ? LIMIT 1', [userId, fingerprint]);
    return rows[0] || null;
  },
  async addDevice(userId, { fingerprint, userAgent, ip }) {
    await db.query(
      'INSERT INTO user_devices (user_id, fingerprint, user_agent, ip) VALUES (?, ?, ?, ?)',
      [userId, fingerprint, userAgent, ip]
    );
    // Keep only the newest MAX_DEVICES_PER_USER rows
    await db.query(
      `DELETE FROM user_devices WHERE user_id = ? AND id NOT IN (
         SELECT id FROM (SELECT id FROM user_devices WHERE user_id = ? ORDER BY first_seen_at DESC, id DESC LIMIT ?) AS keep
       )`,
      [userId, userId, MAX_DEVICES_PER_USER]
    );
  }
};

module.exports = UserModel;
