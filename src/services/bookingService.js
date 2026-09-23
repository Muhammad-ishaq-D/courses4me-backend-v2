const db = require('../config/db');
const BookingModel = require('../models/bookingModel');
const tableExists = require('../utils/tableExists');
const logger = require('../utils/logger');

/**
 * The lifecycle status shown to students is derived from the dates, except
 * when an admin has put the booking into a state that overrides them.
 */
function calculateLifecycleStatus(booking) {
  if (['Cancelled', 'Postponed'].includes(booking.lifecycleStatus)) return booking.lifecycleStatus;

  const now = new Date();
  const start = new Date(booking.session.startDate);
  const end = new Date(booking.session.endDate);

  if (now < start) return 'Upcoming';
  if (now >= start && now <= end) {
    return booking.extensionHistory && booking.extensionHistory.length > 0 ? 'Extended' : 'Ongoing';
  }
  return 'Completed';
}

/** The course (or licence) a booking is for, or null when it is gone. */
async function findCourse(courseId, courseType = 'Course') {
  if (courseType === 'License') {
    if (!(await tableExists('licenses'))) return null;
    const rows = await db.query('SELECT id, title, category, thumbnail, status FROM licenses WHERE id = ? LIMIT 1', [courseId]);
    return rows[0] || null;
  }
  const rows = await db.query(
    'SELECT id, title, category, thumbnail, status, base_price, sale_price, original_price FROM courses WHERE id = ? LIMIT 1',
    [courseId]
  );
  return rows[0] || null;
}

/** Course rows for many bookings at once, keyed by `${type}:${id}`. */
async function coursesForBookings(rows) {
  const map = {};
  const courseIds = [...new Set(rows.filter(r => r.course_type !== 'License').map(r => r.course_id))];
  const licenseIds = [...new Set(rows.filter(r => r.course_type === 'License').map(r => r.course_id))];

  if (courseIds.length) {
    const courses = await db.query(
      'SELECT id, title, category, thumbnail, status, base_price, sale_price, original_price FROM courses WHERE id IN (?)',
      [courseIds]
    );
    for (const c of courses) map[`Course:${c.id}`] = c;
  }
  if (licenseIds.length && (await tableExists('licenses'))) {
    try {
      const licenses = await db.query('SELECT id, title, category, thumbnail, status FROM licenses WHERE id IN (?)', [licenseIds]);
      for (const l of licenses) map[`License:${l.id}`] = l;
    } catch (err) {
      logger.warn('[bookings] licence lookup failed:', err.message);
    }
  }
  return map;
}

/** What the apps read off `booking.course`. */
const coursePublic = (row) => (row ? {
  id: row.id,
  _id: String(row.id),
  title: row.title,
  category: row.category,
  thumbnail: row.thumbnail,
  status: row.status,
  ...(row.base_price !== undefined
    ? { pricing: { basePrice: row.base_price, salePrice: row.sale_price, originalPrice: row.original_price } }
    : {})
} : null);

/** What the apps read off `booking.user`. */
const userPublic = (row) => (row ? {
  id: row.id,
  _id: String(row.id),
  name: row.name,
  email: row.email,
  role: row.role,
  status: row.status
} : null);

/**
 * Turns booking rows into API objects with their user, course, history and
 * the freshly calculated lifecycle status.
 */
async function expandBookings(rows, { withChildren = true } = {}) {
  if (!rows.length) return [];

  const userIds = [...new Set(rows.map(r => r.user_id))];
  const [users, courses, children] = await Promise.all([
    db.query('SELECT id, name, email, role, status FROM users WHERE id IN (?)', [userIds]),
    coursesForBookings(rows),
    withChildren ? BookingModel.childrenFor(rows.map(r => r.id)) : Promise.resolve({})
  ]);
  const usersById = {};
  for (const u of users) usersById[u.id] = u;

  return rows.map(row => {
    const booking = BookingModel.toPublic(row, {
      user: userPublic(usersById[row.user_id]),
      course: coursePublic(courses[`${row.course_type}:${row.course_id}`]),
      ...(children[row.id] || {})
    });
    booking.lifecycleStatus = calculateLifecycleStatus(booking);
    return booking;
  });
}

/** One booking, expanded. */
async function expandBooking(row, options) {
  const [booking] = await expandBookings([row], options);
  return booking || null;
}

module.exports = {
  calculateLifecycleStatus,
  findCourse,
  coursePublic,
  userPublic,
  expandBookings,
  expandBooking
};
