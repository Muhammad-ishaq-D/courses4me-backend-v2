const crypto = require('crypto');
const db = require('../config/db');

const REFERENCE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// camelCase (API) -> snake_case (column). Only these keys can ever be written.
const COLUMNS = {
  bookingReference: 'booking_reference',
  userId: 'user_id',
  courseId: 'course_id',
  courseType: 'course_type',
  packageName: 'package_name',
  additionalInfo: 'additional_info',
  totalAmount: 'total_amount',
  currency: 'currency',
  paymentMethod: 'payment_method',
  paymentStatus: 'payment_status',
  stripeSessionId: 'stripe_session_id',
  paymentIntentId: 'payment_intent_id',
  status: 'status',
  lifecycleStatus: 'lifecycle_status',
  originalEndDate: 'original_end_date',
  progress: 'progress',
  legacyId: 'legacy_id'
};

const SELECT = `
  id, booking_reference, user_id, course_id, course_type, package_name,
  session_location_name, session_branch_name, session_schedule_id, session_schedule_source,
  session_start_date, session_end_date, session_time, session_price,
  customer_first_name, customer_last_name, customer_email, customer_phone, customer_dob,
  billing_postcode, billing_line1, billing_line2, billing_city,
  option_easy_apply, additional_info, total_amount, currency, payment_method, payment_status,
  stripe_session_id, payment_intent_id, status, lifecycle_status, original_end_date, progress,
  refund_status, refund_reason, refund_requested_at, refund_processed_at, refund_admin_notes,
  refund_id, refund_proof_url,
  pending_reschedule_start_date, pending_reschedule_end_date, pending_reschedule_reason,
  pending_reschedule_status, pending_reschedule_created_at,
  booking_date, created_at, updated_at`;

const emptyToNull = (v) => (v === '' || v === undefined ? null : v);
const toBool = (v) => (v === true || v === 'true' || v === 1 || v === '1' ? 1 : 0);
const toNumberOrNull = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/**
 * Instants are stored as UTC DATETIME. A value read back as
 * 'YYYY-MM-DD HH:MM:SS' carries no zone, so it is read as UTC — parsing it as
 * local time would move the instant every time a row is copied.
 */
const toSqlDateTime = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(v)) {
    return v.replace('T', ' ');
  }
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 19).replace('T', ' ');
};

/** GL-XXXXXX, the format customers quote to support. */
function generateReference() {
  let ref = 'GL-';
  for (let i = 0; i < 6; i++) ref += REFERENCE_CHARS[crypto.randomInt(0, REFERENCE_CHARS.length)];
  return ref;
}

function toColumns(data) {
  const out = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (value === undefined) continue;
    const col = COLUMNS[key];
    if (col) out[col] = emptyToNull(value);
  }
  if (out.total_amount !== undefined) out.total_amount = toNumberOrNull(out.total_amount);
  if (out.original_end_date !== undefined) out.original_end_date = toSqlDateTime(out.original_end_date);

  if (data.session && typeof data.session === 'object') {
    const s = data.session;
    if (s.locationName !== undefined) out.session_location_name = emptyToNull(s.locationName);
    if (s.branchName !== undefined) out.session_branch_name = emptyToNull(s.branchName);
    if (s.scheduleId !== undefined) out.session_schedule_id = toNumberOrNull(s.scheduleId);
    if (s.scheduleSource !== undefined) out.session_schedule_source = emptyToNull(s.scheduleSource);
    if (s.startDate !== undefined) out.session_start_date = toSqlDateTime(s.startDate);
    if (s.endDate !== undefined) out.session_end_date = toSqlDateTime(s.endDate);
    if (s.time !== undefined) out.session_time = emptyToNull(s.time);
    if (s.price !== undefined) out.session_price = toNumberOrNull(s.price);
  }
  if (data.customerDetails && typeof data.customerDetails === 'object') {
    const c = data.customerDetails;
    if (c.firstName !== undefined) out.customer_first_name = c.firstName;
    if (c.lastName !== undefined) out.customer_last_name = c.lastName;
    if (c.email !== undefined) out.customer_email = String(c.email).trim();
    if (c.phone !== undefined) out.customer_phone = c.phone;
    if (c.dob !== undefined) out.customer_dob = emptyToNull(c.dob);
  }
  if (data.billingAddress && typeof data.billingAddress === 'object') {
    const b = data.billingAddress;
    if (b.postcode !== undefined) out.billing_postcode = emptyToNull(b.postcode);
    if (b.line1 !== undefined) out.billing_line1 = emptyToNull(b.line1);
    if (b.line2 !== undefined) out.billing_line2 = emptyToNull(b.line2);
    if (b.city !== undefined) out.billing_city = emptyToNull(b.city);
  }
  if (data.options && typeof data.options === 'object' && data.options.easyApply !== undefined) {
    out.option_easy_apply = toBool(data.options.easyApply);
  }
  if (data.refundRequest && typeof data.refundRequest === 'object') {
    const r = data.refundRequest;
    if (r.status !== undefined) out.refund_status = r.status;
    if (r.reason !== undefined) out.refund_reason = emptyToNull(r.reason);
    if (r.requestedAt !== undefined) out.refund_requested_at = toSqlDateTime(r.requestedAt);
    if (r.processedAt !== undefined) out.refund_processed_at = toSqlDateTime(r.processedAt);
    if (r.adminNotes !== undefined) out.refund_admin_notes = emptyToNull(r.adminNotes);
    if (r.refundId !== undefined) out.refund_id = emptyToNull(r.refundId);
    if (r.proofUrl !== undefined) out.refund_proof_url = emptyToNull(r.proofUrl);
  }
  if (data.pendingReschedule !== undefined) {
    const p = data.pendingReschedule;
    if (p === null) {
      out.pending_reschedule_start_date = null;
      out.pending_reschedule_end_date = null;
      out.pending_reschedule_reason = null;
      out.pending_reschedule_status = null;
      out.pending_reschedule_created_at = null;
    } else {
      out.pending_reschedule_start_date = toSqlDateTime(p.newStartDate);
      out.pending_reschedule_end_date = toSqlDateTime(p.newEndDate);
      out.pending_reschedule_reason = emptyToNull(p.reason);
      out.pending_reschedule_status = p.status || 'Awaiting Payment';
      out.pending_reschedule_created_at = toSqlDateTime(p.createdAt || new Date());
    }
  }
  return out;
}

/**
 * Row -> API shape. Nested blocks match what the apps read today; `_id` is the
 * string alias (the admin table slices a short reference out of it).
 */
function toPublic(row, extras = {}) {
  if (!row) return null;
  const booking = {
    id: row.id,
    _id: String(row.id),
    bookingReference: row.booking_reference,
    user: extras.user !== undefined ? extras.user : String(row.user_id),
    course: extras.course !== undefined ? extras.course : String(row.course_id),
    courseModel: row.course_type,
    packageName: row.package_name,
    session: {
      locationName: row.session_location_name,
      branchName: row.session_branch_name,
      scheduleId: row.session_schedule_id === null ? null : String(row.session_schedule_id),
      scheduleSource: row.session_schedule_source,
      startDate: row.session_start_date,
      endDate: row.session_end_date,
      time: row.session_time,
      price: row.session_price
    },
    customerDetails: {
      firstName: row.customer_first_name,
      lastName: row.customer_last_name,
      email: row.customer_email,
      phone: row.customer_phone,
      dob: row.customer_dob
    },
    billingAddress: {
      postcode: row.billing_postcode,
      line1: row.billing_line1,
      line2: row.billing_line2,
      city: row.billing_city
    },
    options: { easyApply: !!row.option_easy_apply },
    additionalInfo: row.additional_info,
    totalAmount: row.total_amount,
    currency: row.currency,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    stripeSessionId: row.stripe_session_id,
    paymentIntentId: row.payment_intent_id,
    status: row.status,
    lifecycleStatus: row.lifecycle_status,
    originalEndDate: row.original_end_date,
    progress: row.progress,
    refundRequest: {
      status: row.refund_status,
      reason: row.refund_reason,
      requestedAt: row.refund_requested_at,
      processedAt: row.refund_processed_at,
      adminNotes: row.refund_admin_notes,
      refundId: row.refund_id,
      proofUrl: row.refund_proof_url
    },
    extensionHistory: extras.extensionHistory || [],
    rescheduleHistory: extras.rescheduleHistory || [],
    attendance: extras.attendance || [],
    certificates: extras.certificates || [],
    bookingDate: row.booking_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  // The block stays absent until a reschedule is actually awaiting payment.
  if (row.pending_reschedule_start_date) {
    booking.pendingReschedule = {
      newStartDate: row.pending_reschedule_start_date,
      newEndDate: row.pending_reschedule_end_date,
      reason: row.pending_reschedule_reason,
      status: row.pending_reschedule_status,
      createdAt: row.pending_reschedule_created_at
    };
  }
  return booking;
}

const BookingModel = {
  toPublic,
  generateReference,
  toSqlDateTime,

  async findById(id, conn = db) {
    const rows = await conn.query(`SELECT ${SELECT} FROM bookings WHERE id = ? LIMIT 1`, [id]);
    return rows[0] || null;
  },
  async findByReference(reference) {
    const rows = await db.query(`SELECT ${SELECT} FROM bookings WHERE booking_reference = ? LIMIT 1`, [reference]);
    return rows[0] || null;
  },
  async findByUser(userId) {
    return db.query(`SELECT ${SELECT} FROM bookings WHERE user_id = ? ORDER BY created_at DESC, id DESC`, [userId]);
  },
  async findByUserAndCourse(userId, courseId) {
    return db.query(
      `SELECT ${SELECT} FROM bookings WHERE user_id = ? AND course_id = ? ORDER BY created_at DESC, id DESC`,
      [userId, courseId]
    );
  },
  /** An active (pending or paid) booking of this course by this user. */
  async findActiveForUserCourse(userId, courseId) {
    const rows = await db.query(
      `SELECT ${SELECT} FROM bookings WHERE user_id = ? AND course_id = ? AND status IN ('PENDING','PAID') LIMIT 1`,
      [userId, courseId]
    );
    return rows[0] || null;
  },

  /** Admin list with the status / payment / date filters of the bookings page. */
  async findAll({ status, paymentStatus, refundRequested, fromDate, toDate } = {}) {
    const where = [];
    const params = [];
    if (status) { where.push('status = ?'); params.push(status); }
    if (refundRequested) { where.push("refund_status = 'Requested'"); }
    else if (paymentStatus) { where.push('payment_status = ?'); params.push(paymentStatus); }
    if (fromDate) { where.push('created_at >= ?'); params.push(toSqlDateTime(fromDate)); }
    if (toDate) {
      // Whole of the `to` day; the validator hands over a Date, so take its UTC calendar day
      const day = toDate instanceof Date ? toDate.toISOString().slice(0, 10) : String(toDate).slice(0, 10);
      where.push('created_at <= ?');
      params.push(`${day} 23:59:59`);
    }
    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    return db.query(`SELECT ${SELECT} FROM bookings${whereSql} ORDER BY created_at DESC, id DESC`, params);
  },

  /** Bookings whose payment window has passed (the expiry job). */
  async findExpiredPending(minutes) {
    return db.query(
      `SELECT ${SELECT} FROM bookings WHERE status = 'PENDING' AND created_at < UTC_TIMESTAMP() - INTERVAL ? MINUTE`,
      [minutes]
    );
  },

  /** Totals per user for the customers table: { [userId]: { bookingCount, totalSpent } } */
  async statsByUser(userIds) {
    const map = {};
    if (!userIds.length) return map;
    const rows = await db.query(
      `SELECT user_id, COUNT(*) AS bookings, COALESCE(SUM(CASE WHEN payment_status = 'Paid' THEN total_amount ELSE 0 END), 0) AS spent
         FROM bookings WHERE user_id IN (?) GROUP BY user_id`,
      [userIds]
    );
    for (const r of rows) map[r.user_id] = { bookingCount: Number(r.bookings), totalSpent: Number(r.spent) };
    return map;
  },

  async countForUser(userId) {
    const [{ total }] = await db.query('SELECT COUNT(*) AS total FROM bookings WHERE user_id = ?', [userId]);
    return Number(total);
  },

  /**
   * Inserts the booking, retrying on the (very unlikely) duplicate reference.
   * Runs on `conn` so it can join the caller's transaction.
   */
  async create(data, conn = db) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const cols = { booking_reference: generateReference(), ...toColumns(data) };
      const keys = Object.keys(cols);
      try {
        const result = await conn.query(
          `INSERT INTO bookings (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
          Object.values(cols)
        );
        return result.insertId;
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY' && /uq_bookings_reference/.test(err.message)) continue;
        throw err;
      }
    }
    throw new Error('Could not allocate a unique booking reference');
  },

  async update(id, data, conn = db) {
    const cols = toColumns(data);
    const keys = Object.keys(cols);
    if (!keys.length) return false;
    const result = await conn.query(
      `UPDATE bookings SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
      [...Object.values(cols), id]
    );
    return result.affectedRows > 0;
  },

  async delete(id) {
    const result = await db.query('DELETE FROM bookings WHERE id = ?', [id]);
    return result.affectedRows > 0;
  },
  async deleteForUsers(userIds) {
    if (!userIds.length) return 0;
    const result = await db.query('DELETE FROM bookings WHERE user_id IN (?)', [userIds]);
    return result.affectedRows;
  },

  // ── history and child rows ───────────────────────────────────────────────
  async addExtension(bookingId, { previousEndDate, newEndDate, reason }, conn = db) {
    await conn.query(
      'INSERT INTO booking_extension_history (booking_id, previous_end_date, new_end_date, reason) VALUES (?, ?, ?, ?)',
      [bookingId, toSqlDateTime(previousEndDate), toSqlDateTime(newEndDate), emptyToNull(reason)]
    );
  },
  async addReschedule(bookingId, { previousStartDate, newStartDate, previousEndDate, newEndDate, reason }, conn = db) {
    await conn.query(
      `INSERT INTO booking_reschedule_history
         (booking_id, previous_start_date, new_start_date, previous_end_date, new_end_date, reason)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [bookingId, toSqlDateTime(previousStartDate), toSqlDateTime(newStartDate), toSqlDateTime(previousEndDate), toSqlDateTime(newEndDate), emptyToNull(reason)]
    );
  },
  async countReschedules(bookingId) {
    const [{ total }] = await db.query('SELECT COUNT(*) AS total FROM booking_reschedule_history WHERE booking_id = ?', [bookingId]);
    return Number(total);
  },

  /** History, attendance and certificates for one or many bookings. */
  async childrenFor(bookingIds) {
    const map = {};
    if (!bookingIds.length) return map;
    for (const id of bookingIds) map[id] = { extensionHistory: [], rescheduleHistory: [], attendance: [], certificates: [] };

    const [extensions, reschedules, attendance, certificates] = await Promise.all([
      db.query('SELECT id, booking_id, previous_end_date, new_end_date, reason, created_at FROM booking_extension_history WHERE booking_id IN (?) ORDER BY id', [bookingIds]),
      db.query('SELECT id, booking_id, previous_start_date, new_start_date, previous_end_date, new_end_date, reason, created_at FROM booking_reschedule_history WHERE booking_id IN (?) ORDER BY id', [bookingIds]),
      db.query('SELECT id, booking_id, date, status FROM booking_attendance WHERE booking_id IN (?) ORDER BY date, id', [bookingIds]),
      db.query('SELECT id, booking_id, name, url, issued_at FROM booking_certificates WHERE booking_id IN (?) ORDER BY id', [bookingIds])
    ]);

    for (const r of extensions) {
      map[r.booking_id].extensionHistory.push({ _id: String(r.id), previousEndDate: r.previous_end_date, newEndDate: r.new_end_date, reason: r.reason, updatedAt: r.created_at });
    }
    for (const r of reschedules) {
      map[r.booking_id].rescheduleHistory.push({ _id: String(r.id), previousStartDate: r.previous_start_date, newStartDate: r.new_start_date, previousEndDate: r.previous_end_date, newEndDate: r.new_end_date, reason: r.reason, updatedAt: r.created_at });
    }
    for (const r of attendance) {
      map[r.booking_id].attendance.push({ _id: String(r.id), date: r.date, status: r.status });
    }
    for (const r of certificates) {
      map[r.booking_id].certificates.push({ _id: String(r.id), name: r.name, url: r.url, issuedAt: r.issued_at });
    }
    return map;
  }
};

module.exports = BookingModel;
