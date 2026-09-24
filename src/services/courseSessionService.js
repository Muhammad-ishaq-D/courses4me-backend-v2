const db = require('../config/db');
const logger = require('../utils/logger');

/**
 * Sessions that come from the scheduling system (course_locations ->
 * course_location_dates). A link whose location has been disabled is left out,
 * so a disabled location's dates never show up in a course listing.
 *
 * Returns { [courseId]: [{ _id, startDate, endDate, availabilityStatus }] }.
 */
async function scheduledSessionsFor(courseIds) {
  const map = {};
  if (!courseIds.length) return map;

  try {
    const rows = await db.query(
      `SELECT cl.course_id, d.id, d.start_date, d.end_date, d.available_seats, d.booked_seats
         FROM course_locations cl
         JOIN course_location_dates d ON d.course_location_id = cl.id
         JOIN locations l ON l.id = cl.location_id AND l.status = 'Active'
        WHERE cl.course_id IN (?) AND cl.status = 'Active'
        ORDER BY d.start_date, d.id`,
      [courseIds]
    );

    for (const r of rows) {
      const remaining = (r.available_seats || 0) - (r.booked_seats || 0);
      const availabilityStatus = remaining <= 0 ? 'Sold Out' : (remaining <= 5 ? 'Selling Fast' : 'Available');
      (map[r.course_id] ||= []).push({
        _id: String(r.id),
        id: r.id,
        startDate: r.start_date,
        endDate: r.end_date,
        availabilityStatus
      });
    }
  } catch (err) {
    // Listings must still render if the scheduling query fails.
    logger.warn('[courseSessions] scheduled sessions unavailable:', err.message);
  }
  return map;
}

module.exports = { scheduledSessionsFor };
