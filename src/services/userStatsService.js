const db = require('../config/db');
const logger = require('../utils/logger');

/**
 * Booking statistics shown on the admin Users table
 * (totalBookings / bookingCount, totalSpent, completedCourses, attendanceStatus).
 *
 * A booking counts for a customer when it is linked by id or was made as a
 * guest with the same email address.
 */
const EMPTY = { totalBookings: 0, bookingCount: 0, totalSpent: 0, completedCourses: 0, attendanceStatus: 'New' };

async function bookingStatsFor(users) {
  const stats = {};
  for (const u of users) stats[u.id] = { ...EMPTY };
  if (!users.length) return stats;

  try {
    const ids = users.map(u => u.id);
    const emails = users.map(u => String(u.email).toLowerCase());

    const rows = await db.query(
      `SELECT b.id, b.user_id, LOWER(b.customer_email) AS customer_email, b.total_amount,
              (b.session_end_date IS NOT NULL AND b.session_end_date < UTC_TIMESTAMP()) AS completed,
              EXISTS(SELECT 1 FROM booking_attendance a WHERE a.booking_id = b.id AND a.status = 'Present') AS attended
         FROM bookings b
        WHERE b.user_id IN (?) OR LOWER(b.customer_email) IN (?)`,
      [ids, emails]
    );

    const byEmail = {};
    for (const u of users) byEmail[String(u.email).toLowerCase()] = u.id;

    for (const b of rows) {
      const userId = (b.user_id && stats[b.user_id]) ? b.user_id : byEmail[b.customer_email];
      const s = stats[userId];
      if (!s) continue;
      s.totalBookings += 1;
      s.bookingCount += 1;
      s.totalSpent += Number(b.total_amount) || 0;
      if (b.completed) s.completedCourses += 1;
      if (b.attended) s.attendanceStatus = 'Regular';
    }
  } catch (err) {
    // Stats are decoration on the Users page; never fail the request over them.
    logger.warn('[userStats] booking stats unavailable:', err.message);
  }
  return stats;
}

module.exports = { bookingStatsFor, EMPTY_STATS: EMPTY };
