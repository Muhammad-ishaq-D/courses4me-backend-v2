const db = require('../config/db');

/**
 * Every figure on the admin dashboard and analytics pages.
 *
 * The charts cover the last six months and always return six points, so an
 * empty month still appears on the axis.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CATEGORY_COLORS = ['#3182CE', '#38A169', '#E53E3E', '#ED8936', '#805AD5'];
const LOW_SEAT_THRESHOLD = 5;

/** First day of the month, `monthsBack` months ago, at midnight UTC. */
function monthWindowStart(monthsBack = 6) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCMonth(d.getUTCMonth() - monthsBack);
  return d;
}

/** `WHERE created_at BETWEEN …` for the optional date range of the page. */
function rangeClause({ startDate, endDate } = {}, column = 'created_at') {
  const where = [];
  const params = [];
  if (startDate) { where.push(`${column} >= ?`); params.push(new Date(startDate)); }
  if (endDate) { where.push(`${column} <= ?`); params.push(new Date(endDate)); }
  return { sql: where.length ? ` WHERE ${where.join(' AND ')}` : '', params };
}

/** Pads a year/month series out to the last `count` months, oldest first. */
function fillMonths(rows, count, build) {
  const series = [];
  const cursor = new Date();
  cursor.setUTCDate(1);
  cursor.setUTCHours(0, 0, 0, 0);
  cursor.setUTCMonth(cursor.getUTCMonth() - (count - 1));

  for (let i = 0; i < count; i++) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth() + 1;
    const row = rows.find(r => Number(r.year) === year && Number(r.month) === month);
    series.push({ name: MONTHS[month - 1], ...build(row) });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return series;
}

const DashboardService = {
  MONTHS,
  LOW_SEAT_THRESHOLD,

  /** Course totals and the booking/revenue figures for the selected range. */
  async headlineStats(range) {
    const { sql, params } = rangeClause(range);
    const [[courses], [bookings], [revenue]] = await Promise.all([
      db.query("SELECT COUNT(*) AS total, SUM(status = 'Published') AS active FROM courses"),
      db.query(`SELECT COUNT(*) AS total FROM bookings${sql}`, params),
      db.query(
        `SELECT COALESCE(SUM(total_amount), 0) AS total FROM bookings${sql ? `${sql} AND` : ' WHERE'} payment_status = 'Paid'`,
        params
      )
    ]);
    return {
      totalCourses: Number(courses.total),
      activeCourses: Number(courses.active || 0),
      bookingsInRange: Number(bookings.total),
      revenueInRange: Number(revenue.total)
    };
  },

  /** Enrolments and paid revenue per month. */
  async performance(months = 6) {
    const rows = await db.query(
      `SELECT YEAR(created_at) AS year, MONTH(created_at) AS month,
              COUNT(*) AS enrollments,
              COALESCE(SUM(CASE WHEN payment_status = 'Paid' THEN total_amount ELSE 0 END), 0) AS revenue
         FROM bookings WHERE created_at >= ?
        GROUP BY year, month ORDER BY year, month`,
      [monthWindowStart(months - 1)]
    );
    return fillMonths(rows, months, (r) => ({
      enrollments: r ? Number(r.enrollments) : 0,
      revenue: r ? Number(r.revenue) : 0
    }));
  },

  /** Share of bookings by course category. */
  async categoryBreakdown() {
    const rows = await db.query(
      `SELECT c.category, COUNT(*) AS value
         FROM bookings b JOIN courses c ON c.id = b.course_id
        GROUP BY c.category ORDER BY value DESC`
    );
    const total = rows.reduce((acc, r) => acc + Number(r.value), 0);
    return rows.map((r, index) => ({
      name: r.category || 'Other',
      value: total > 0 ? Math.round((Number(r.value) / total) * 100) : 0,
      count: Number(r.value),
      color: CATEGORY_COLORS[index % CATEGORY_COLORS.length]
    }));
  },

  /** The five most recent course edits and bookings, newest first. */
  async recentActivity(limit = 5) {
    const [courses, bookings] = await Promise.all([
      db.query('SELECT title, status, updated_at FROM courses ORDER BY updated_at DESC, id DESC LIMIT 3'),
      db.query(`SELECT b.customer_first_name, b.customer_last_name, u.name AS user_name, b.created_at
                  FROM bookings b LEFT JOIN users u ON u.id = b.user_id
                 ORDER BY b.created_at DESC, b.id DESC LIMIT 3`)
    ]);

    const activity = [
      ...courses.map(c => ({
        user: 'Admin',
        action: c.status === 'Published' ? 'published' : 'edited',
        target: c.title,
        time: c.updated_at,
        type: 'course'
      })),
      ...bookings.map(b => ({
        user: b.customer_first_name ? `${b.customer_first_name} ${b.customer_last_name}` : (b.user_name || 'Guest'),
        action: 'booked',
        target: 'a course',
        time: b.created_at,
        type: 'booking'
      }))
    ];

    return activity.sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, limit);
  },

  /** The latest bookings inside the selected range, formatted for the table. */
  async recentBookings(range, limit = 5) {
    const { sql, params } = rangeClause(range, 'b.created_at');
    const rows = await db.query(
      `SELECT b.customer_first_name, b.customer_last_name, b.total_amount, b.payment_status, c.title
         FROM bookings b LEFT JOIN courses c ON c.id = b.course_id${sql}
        ORDER BY b.created_at DESC, b.id DESC LIMIT ?`,
      [...params, limit]
    );
    return rows.map(b => {
      const first = b.customer_first_name || '';
      const last = b.customer_last_name || '';
      return {
        name: first ? `${first} ${last}` : 'Unknown',
        course: b.title || 'Unknown Course',
        price: `£${b.total_amount}`,
        status: b.payment_status,
        initials: first ? `${first[0]}${last[0] || ''}` : 'U'
      };
    });
  },

  /**
   * Sessions that are nearly full, from both places a session can live: the
   * scheduling module and the schedules attached to a course.
   */
  async lowSeats(limit = 3) {
    const [scheduled, venueBased] = await Promise.all([
      db.query(
        `SELECT c.title, l.name AS location, d.start_date,
                GREATEST(CAST(d.available_seats AS SIGNED) - CAST(d.booked_seats AS SIGNED), 0) AS seats_left
           FROM course_location_dates d
           JOIN course_locations cl ON cl.id = d.course_location_id
           JOIN courses c ON c.id = cl.course_id
           JOIN locations l ON l.id = cl.location_id
          WHERE CAST(d.available_seats AS SIGNED) - CAST(d.booked_seats AS SIGNED) <= ?
          ORDER BY d.start_date LIMIT ?`,
        [LOW_SEAT_THRESHOLD, limit]
      ),
      db.query(
        `SELECT c.title, v.name AS location, s.start_date, s.seats_available AS seats_left
           FROM course_venue_schedules s
           JOIN course_venues v ON v.id = s.course_venue_id
           JOIN courses c ON c.id = v.course_id
          WHERE s.seats_available <= ?
          ORDER BY s.start_date LIMIT ?`,
        [LOW_SEAT_THRESHOLD, limit]
      )
    ]);

    return [...scheduled, ...venueBased]
      .map(r => ({
        course: `${r.title} – ${r.location}`,
        status: `${Number(r.seats_left)} left`,
        date: r.start_date
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, limit);
  },

  /** Draft courses waiting to be published. */
  async pendingApprovals(limit = 5) {
    const rows = await db.query(
      "SELECT id, title, instructor_name, instructor_photo FROM courses WHERE status = 'Draft' ORDER BY created_at DESC, id DESC LIMIT ?",
      [limit]
    );
    return rows.map(r => ({
      id: String(r.id),
      title: r.title,
      subtitle: r.instructor_name || 'No Instructor',
      img: r.instructor_photo || 'https://ui-avatars.com/api/?name=Instructor'
    }));
  },

  /**
   * New against returning customers per month. A booking counts as "new" when
   * the customer's account was created in the same month as the booking.
   */
  async customerTrend(months = 6) {
    const rows = await db.query(
      `SELECT YEAR(b.created_at) AS year, MONTH(b.created_at) AS month,
              SUM(u.created_at IS NOT NULL
                  AND YEAR(u.created_at) = YEAR(b.created_at)
                  AND MONTH(u.created_at) = MONTH(b.created_at)) AS new_customers,
              SUM(u.created_at IS NULL
                  OR YEAR(u.created_at) <> YEAR(b.created_at)
                  OR MONTH(u.created_at) <> MONTH(b.created_at)) AS returning_customers
         FROM bookings b LEFT JOIN users u ON u.id = b.user_id
        WHERE b.created_at >= ?
        GROUP BY year, month ORDER BY year, month`,
      [monthWindowStart(months - 1)]
    );
    return fillMonths(rows, months, (r) => ({
      new: r ? Number(r.new_customers) : 0,
      returning: r ? Number(r.returning_customers) : 0
    }));
  },

  /** Paid revenue per month. */
  async revenueTrend(months = 6) {
    const rows = await db.query(
      `SELECT YEAR(created_at) AS year, MONTH(created_at) AS month, COALESCE(SUM(total_amount), 0) AS value
         FROM bookings WHERE created_at >= ? AND payment_status = 'Paid'
        GROUP BY year, month ORDER BY year, month`,
      [monthWindowStart(months - 1)]
    );
    return fillMonths(rows, months, (r) => ({ value: r ? Number(r.value) : 0 }));
  },

  /** The five courses earning the most, with their share of all revenue. */
  async topCourses(limit = 5) {
    const [totals] = await db.query("SELECT COALESCE(SUM(total_amount), 0) AS total FROM bookings WHERE payment_status = 'Paid'");
    const overall = Number(totals.total) || 1;

    const rows = await db.query(
      `SELECT c.id, c.title, COUNT(*) AS enrollments, COALESCE(SUM(b.total_amount), 0) AS revenue
         FROM bookings b JOIN courses c ON c.id = b.course_id
        WHERE b.payment_status = 'Paid'
        GROUP BY c.id, c.title
        ORDER BY revenue DESC LIMIT ?`,
      [limit]
    );

    return rows.map((c, index) => {
      const revenue = Number(c.revenue);
      const share = Math.round((revenue / overall) * 100);
      return {
        id: index + 1,
        courseId: String(c.id),
        name: c.title,
        enrollments: Number(c.enrollments).toLocaleString(),
        revenue: `£${revenue.toLocaleString()}`,
        // Filled in by the reviews module; no rating exists yet.
        rating: null,
        share: share > 0 ? share : 1
      };
    });
  }
};

module.exports = DashboardService;
