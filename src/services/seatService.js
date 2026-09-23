const db = require('../config/db');
const logger = require('../utils/logger');

/**
 * Seat inventory for the two places a session can come from:
 *
 *  - `course_location_date`   the scheduling module: a seat is taken by raising
 *                             `booked_seats` towards `available_seats`.
 *  - `course_venue_schedule`  a schedule attached directly to the course: a seat
 *                             is taken by lowering `seats_available`, and the
 *                             availability label is kept in step.
 *
 * Both sequences start at 1, so an id only identifies a session together with
 * its source, which is why bookings store both.
 */
const SOURCES = { SCHEDULED: 'course_location_date', VENUE: 'course_venue_schedule' };

/**
 * Finds the session the customer picked and the venue it runs at.
 * Returns null when the id belongs to another course or does not exist.
 */
async function resolveSchedule({ scheduleId, courseId, startDate, locationName }) {
  if (scheduleId) {
    const scheduled = await db.query(
      `SELECT d.id, d.course_location_id, d.start_date, d.end_date, d.start_time, d.end_time,
              d.available_seats, d.booked_seats, d.timings_type,
              cl.course_id, cl.price, l.id AS location_id, l.name AS location_name
         FROM course_location_dates d
         JOIN course_locations cl ON cl.id = d.course_location_id
         JOIN locations l ON l.id = cl.location_id
        WHERE d.id = ? LIMIT 1`,
      [scheduleId]
    );
    if (scheduled.length && String(scheduled[0].course_id) === String(courseId)) {
      const row = scheduled[0];
      const timings = row.timings_type === 'flexible'
        ? await db.query('SELECT day, is_off, start_time, end_time FROM course_location_date_timings WHERE course_location_date_id = ?', [row.id])
        : [];
      return {
        source: SOURCES.SCHEDULED,
        id: row.id,
        startDate: row.start_date,
        endDate: row.end_date,
        startTime: row.start_time,
        endTime: row.end_time,
        timingsType: row.timings_type,
        weeklyTimings: timings,
        // The link price wins over the course price.
        price: row.price,
        seatsRemaining: Math.max(0, (row.available_seats || 0) - (row.booked_seats || 0)),
        locationName: row.location_name
      };
    }
  }

  // Sessions attached to the course itself, matched by id or by date + venue.
  const venues = await db.query(
    `SELECT s.id, s.time, s.start_date, s.end_date, s.price, s.seats_available, v.name AS location_name
       FROM course_venue_schedules s
       JOIN course_venues v ON v.id = s.course_venue_id
      WHERE v.course_id = ?
      ORDER BY v.position, s.position, s.id`,
    [courseId]
  );
  const match = venues.find(s =>
    (scheduleId && String(s.id) === String(scheduleId)) ||
    (startDate && locationName && String(s.start_date) === String(startDate).slice(0, 10) && s.location_name === locationName)
  );
  if (!match) return null;

  return {
    source: SOURCES.VENUE,
    id: match.id,
    startDate: match.start_date,
    endDate: match.end_date,
    time: match.time,
    price: match.price,
    seatsRemaining: match.seats_available,
    locationName: match.location_name
  };
}

/**
 * Takes one seat. The condition is part of the UPDATE, so two customers
 * checking out at the same moment cannot both take the last seat.
 * Returns the seats left, or null when there were none.
 */
async function reserveSeat(schedule, conn = db) {
  if (schedule.source === SOURCES.SCHEDULED) {
    const result = await conn.query(
      'UPDATE course_location_dates SET booked_seats = booked_seats + 1 WHERE id = ? AND booked_seats < available_seats',
      [schedule.id]
    );
    if (!result.affectedRows) return null;
    const [row] = await conn.query('SELECT available_seats, booked_seats FROM course_location_dates WHERE id = ?', [schedule.id]);
    return Math.max(0, (row.available_seats || 0) - (row.booked_seats || 0));
  }

  const result = await conn.query(
    'UPDATE course_venue_schedules SET seats_available = seats_available - 1 WHERE id = ? AND seats_available > 0',
    [schedule.id]
  );
  if (!result.affectedRows) return null;
  const [row] = await conn.query('SELECT seats_available FROM course_venue_schedules WHERE id = ?', [schedule.id]);
  const remaining = row.seats_available;
  await conn.query(
    'UPDATE course_venue_schedules SET availability_status = ? WHERE id = ?',
    [remaining === 0 ? 'Sold Out' : remaining <= 5 ? 'Selling Fast' : 'Available', schedule.id]
  );
  return remaining;
}

/** Gives the seat back (a booking expired, was cancelled or refunded). */
async function releaseSeat({ source, id }, conn = db) {
  if (!id || !source) return false;
  try {
    if (source === SOURCES.SCHEDULED) {
      const result = await conn.query(
        'UPDATE course_location_dates SET booked_seats = GREATEST(booked_seats - 1, 0) WHERE id = ?',
        [id]
      );
      return result.affectedRows > 0;
    }
    const result = await conn.query(
      'UPDATE course_venue_schedules SET seats_available = seats_available + 1 WHERE id = ?',
      [id]
    );
    if (!result.affectedRows) return false;
    const [row] = await conn.query('SELECT seats_available FROM course_venue_schedules WHERE id = ?', [id]);
    const remaining = row.seats_available;
    await conn.query(
      'UPDATE course_venue_schedules SET availability_status = ? WHERE id = ?',
      [remaining === 0 ? 'Sold Out' : remaining <= 5 ? 'Selling Fast' : 'Available', id]
    );
    return true;
  } catch (err) {
    logger.warn('[seats] could not release a seat:', err.message);
    return false;
  }
}

/** Seats left for a stored session, or null when it no longer exists. */
async function seatsRemaining({ source, id }) {
  if (!id || !source) return null;
  if (source === SOURCES.SCHEDULED) {
    const rows = await db.query('SELECT available_seats, booked_seats FROM course_location_dates WHERE id = ? LIMIT 1', [id]);
    if (!rows.length) return null;
    return Math.max(0, (rows[0].available_seats || 0) - (rows[0].booked_seats || 0));
  }
  const rows = await db.query('SELECT seats_available FROM course_venue_schedules WHERE id = ? LIMIT 1', [id]);
  return rows.length ? rows[0].seats_available : null;
}

module.exports = { SOURCES, resolveSchedule, reserveSeat, releaseSeat, seatsRemaining };
