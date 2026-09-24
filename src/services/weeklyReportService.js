const db = require('../config/db');
const notifyAdmins = require('../utils/notifyAdmins');
const logger = require('../utils/logger');

/** Bookings, customers and revenue of the last seven days. */
async function buildDigest() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [[bookings], [customers], [revenue], topCourses] = await Promise.all([
    db.query('SELECT COUNT(*) AS total FROM bookings WHERE created_at >= ?', [weekAgo]),
    db.query("SELECT COUNT(*) AS total FROM users WHERE created_at >= ? AND role = 'customer'", [weekAgo]),
    db.query("SELECT COALESCE(SUM(total_amount), 0) AS total FROM bookings WHERE created_at >= ? AND payment_status = 'Paid'", [weekAgo]),
    db.query(
      `SELECT c.title, COUNT(*) AS bookings
         FROM bookings b JOIN courses c ON c.id = b.course_id
        WHERE b.created_at >= ?
        GROUP BY c.id, c.title ORDER BY bookings DESC LIMIT 1`,
      [weekAgo]
    )
  ]);

  return {
    bookingsInRange: Number(bookings.total),
    newUsersInRange: Number(customers.total),
    revenueInRange: Number(revenue.total),
    topCourse: topCourses[0] ? { title: topCourses[0].title, bookings: Number(topCourses[0].bookings) } : null
  };
}

/**
 * Sends the weekly summary to the admins. `notifyAdmins` honours the
 * weeklyReport toggle, so a disabled report simply sends nothing.
 */
async function sendWeeklyReport() {
  try {
    const { bookingsInRange, newUsersInRange, revenueInRange, topCourse } = await buildDigest();

    const message = `Last 7 days: £${revenueInRange.toFixed(2)} revenue, ${bookingsInRange} booking${bookingsInRange === 1 ? '' : 's'}, ` +
      `${newUsersInRange} new customer${newUsersInRange === 1 ? '' : 's'}.` +
      (topCourse ? ` Top course: ${topCourse.title || 'Unknown'} (${topCourse.bookings} bookings).` : '');

    await notifyAdmins({ settingKey: 'weeklyReport', title: 'Weekly Summary Report', message, type: 'system' });
    logger.info('[reports] weekly summary sent to the admins');
    return message;
  } catch (error) {
    logger.error('[reports] weekly summary failed:', error.message);
    return null;
  }
}

module.exports = { buildDigest, sendWeeklyReport };
