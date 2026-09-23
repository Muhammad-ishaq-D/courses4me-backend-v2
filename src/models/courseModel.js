const db = require('../config/db');

// camelCase (API) -> snake_case (column) for the scalar fields of `courses`.
const COLUMNS = {
  title: 'title',
  category: 'category',
  subtitle: 'subtitle',
  level: 'level',
  duration: 'duration',
  reviewsCount: 'reviews_count',
  bookedCount: 'booked_count',
  passRate: 'pass_rate',
  shortDescription: 'short_description',
  fullDescription: 'full_description',
  thumbnail: 'thumbnail',
  locationId: 'location_id',
  centerId: 'center_id',
  centerName: 'center_name',
  status: 'status',
  isPopular: 'is_popular',
  legacyId: 'legacy_id'
};

// The four ordered display lists live in one table, told apart by `type`.
const LIST_TYPES = {
  highlights: 'highlight',
  learningPoints: 'learning_point',
  targetAudience: 'target_audience',
  requirements: 'requirement'
};

const emptyToNull = (v) => (v === '' || v === undefined ? null : v);
// NOT NULL text columns keep a blank value as '' (the admin form sends '' when
// a field is cleared).
const NOT_NULL_TEXT = ['level', 'reviews_count', 'booked_count', 'pass_rate'];
/**
 * Calendar date for a DATE column. The validator turns an ISO string into a
 * Date, and handing that to the driver would let the server's zone move it to
 * the day before, so the UTC parts are formatted here.
 */
const toSqlDate = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const toNumberOrNull = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/**
 * Flattens the API payload into `courses` columns. Nested objects (pricing,
 * instructor, guarantee) become prefixed columns; only whitelisted keys are
 * ever written.
 */
function toColumns(data) {
  const out = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (value === undefined) continue;
    const col = COLUMNS[key];
    if (col) out[col] = NOT_NULL_TEXT.includes(col) ? (value ?? '') : emptyToNull(value);
  }
  if (out.is_popular !== undefined && out.is_popular !== null) {
    out.is_popular = out.is_popular === true || out.is_popular === 'true' || out.is_popular === 1 || out.is_popular === '1' ? 1 : 0;
  }
  if (out.location_id !== undefined) out.location_id = toNumberOrNull(out.location_id);

  if (data && data.pricing && typeof data.pricing === 'object') {
    const p = data.pricing;
    if (p.basePrice !== undefined) out.base_price = toNumberOrNull(p.basePrice);
    if (p.salePrice !== undefined) out.sale_price = toNumberOrNull(p.salePrice);
    if (p.originalPrice !== undefined) out.original_price = toNumberOrNull(p.originalPrice);
  }
  if (data && data.instructor && typeof data.instructor === 'object') {
    const i = data.instructor;
    if (i.name !== undefined) out.instructor_name = emptyToNull(i.name);
    if (i.title !== undefined) out.instructor_title = emptyToNull(i.title);
    if (i.bio !== undefined) out.instructor_bio = emptyToNull(i.bio);
    if (i.photo !== undefined) out.instructor_photo = emptyToNull(i.photo);
  }
  if (data && data.guarantee && typeof data.guarantee === 'object') {
    const g = data.guarantee;
    if (g.title) out.guarantee_title = g.title;
    if (g.description) out.guarantee_description = g.description;
  }
  return out;
}

/**
 * Row -> API shape: nested objects, plus the `_id` alias the frontends read.
 * `_id` is a string (the clients do string work on it, e.g. slicing a short
 * reference out of it); `id` is the numeric key.
 */
function toPublic(row, { listItems = [], venues = [], sessions = [] } = {}) {
  if (!row) return null;

  const lists = { highlights: [], learningPoints: [], targetAudience: [], requirements: [] };
  const byType = Object.fromEntries(Object.entries(LIST_TYPES).map(([k, v]) => [v, k]));
  for (const item of listItems) lists[byType[item.type]].push(item.value);

  return {
    id: row.id,
    _id: String(row.id),
    title: row.title,
    category: row.category,
    subtitle: row.subtitle,
    level: row.level,
    duration: row.duration,
    reviewsCount: row.reviews_count,
    bookedCount: row.booked_count,
    passRate: row.pass_rate,
    shortDescription: row.short_description,
    fullDescription: row.full_description,
    ...lists,
    guarantee: { title: row.guarantee_title, description: row.guarantee_description },
    thumbnail: row.thumbnail,
    pricing: {
      basePrice: row.base_price,
      salePrice: row.sale_price,
      originalPrice: row.original_price
    },
    locations: venues,
    sessions,
    locationId: row.location_id,
    centerId: row.center_id,
    centerName: row.center_name,
    instructor: {
      name: row.instructor_name,
      title: row.instructor_title,
      bio: row.instructor_bio,
      photo: row.instructor_photo
    },
    status: row.status,
    isPopular: !!row.is_popular,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function venueToPublic(row, schedules = []) {
  return {
    id: row.id,
    _id: String(row.id),
    name: row.name,
    address: row.address,
    postcode: row.postcode,
    latitude: row.latitude,
    longitude: row.longitude,
    parkingMain: row.parking_main,
    parkingSub: row.parking_sub,
    commuteMain: row.commute_main,
    commuteSub: row.commute_sub,
    schedules
  };
}

function scheduleToPublic(row) {
  return {
    id: row.id,
    _id: String(row.id),
    time: row.time,
    startDate: row.start_date,
    endDate: row.end_date,
    price: row.price,
    seatsAvailable: row.seats_available,
    availabilityStatus: row.availability_status
  };
}

/** Venue schedules flattened for the `sessions` array of a course. */
function venueSessions(venues) {
  const sessions = [];
  for (const venue of venues) {
    for (const s of venue.schedules) {
      sessions.push({
        _id: s._id,
        id: s.id,
        location: venue.name,
        time: s.time,
        startDate: s.startDate,
        endDate: s.endDate,
        price: s.price,
        availabilityStatus: s.availabilityStatus,
        seatsAvailable: s.seatsAvailable
      });
    }
  }
  return sessions;
}

// ── child-row writers (always inside a transaction) ────────────────────────
async function insertListItems(conn, courseId, data) {
  const rows = [];
  for (const [key, type] of Object.entries(LIST_TYPES)) {
    const values = data[key];
    if (!Array.isArray(values)) continue;
    values
      .map(v => (typeof v === 'string' ? v.trim() : v))
      .filter(v => v !== null && v !== undefined && v !== '')
      .forEach((value, position) => rows.push([courseId, type, position, String(value).slice(0, 1000)]));
  }
  if (!rows.length) return;
  await conn.query(
    `INSERT INTO course_list_items (course_id, type, position, value) VALUES ${rows.map(() => '(?, ?, ?, ?)').join(', ')}`,
    rows.flat()
  );
}

async function insertVenues(conn, courseId, venues) {
  if (!Array.isArray(venues)) return;
  for (const [position, venue] of venues.entries()) {
    const result = await conn.query(
      `INSERT INTO course_venues
         (course_id, position, name, address, postcode, latitude, longitude, parking_main, parking_sub, commute_main, commute_sub)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        courseId, position, venue.name, emptyToNull(venue.address), venue.postcode,
        toNumberOrNull(venue.latitude), toNumberOrNull(venue.longitude),
        emptyToNull(venue.parkingMain), emptyToNull(venue.parkingSub),
        emptyToNull(venue.commuteMain), emptyToNull(venue.commuteSub)
      ]
    );
    const venueId = result.insertId;

    const schedules = Array.isArray(venue.schedules) ? venue.schedules : [];
    if (!schedules.length) continue;
    const rows = schedules.map((s, i) => [
      venueId, i, s.time, toSqlDate(s.startDate), toSqlDate(s.endDate), toNumberOrNull(s.price),
      s.seatsAvailable === undefined || s.seatsAvailable === '' ? 20 : Number(s.seatsAvailable),
      s.availabilityStatus || 'Available'
    ]);
    await conn.query(
      `INSERT INTO course_venue_schedules
         (course_venue_id, position, time, start_date, end_date, price, seats_available, availability_status)
       VALUES ${rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
      rows.flat()
    );
  }
}

const SELECT = 'id, title, category, subtitle, level, duration, reviews_count, booked_count, pass_rate, ' +
  'short_description, full_description, guarantee_title, guarantee_description, thumbnail, ' +
  'base_price, sale_price, original_price, location_id, center_id, center_name, ' +
  'instructor_name, instructor_title, instructor_bio, instructor_photo, status, is_popular, created_at, updated_at';

const CourseModel = {
  toPublic,
  venueSessions,
  LIST_TYPES,

  async findById(id) {
    const rows = await db.query(`SELECT ${SELECT} FROM courses WHERE id = ? LIMIT 1`, [id]);
    return rows[0] || null;
  },

  /** Rows matching the admin/public filters, newest first. */
  async findAll({ category, status, search, location } = {}) {
    const where = [];
    const params = [];
    if (category) { where.push('c.category = ?'); params.push(category); }
    if (status) { where.push('c.status = ?'); params.push(status); }
    if (search) {
      const like = `%${search}%`;
      where.push('(c.title LIKE ? OR c.short_description LIKE ?)');
      params.push(like, like);
    }
    if (location) {
      const like = `%${location}%`;
      where.push('EXISTS (SELECT 1 FROM course_venues v WHERE v.course_id = c.id AND (v.name LIKE ? OR v.address LIKE ? OR v.postcode LIKE ?))');
      params.push(like, like, like);
    }
    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    return db.query(
      `SELECT ${SELECT.split(', ').map(c => `c.${c}`).join(', ')} FROM courses c${whereSql} ORDER BY c.created_at DESC, c.id DESC`,
      params
    );
  },

  async countByCategory({ status } = {}) {
    const where = status ? ' WHERE status = ?' : '';
    const rows = await db.query(`SELECT category, COUNT(*) AS total FROM courses${where} GROUP BY category`, status ? [status] : []);
    return rows.map(r => ({ _id: r.category, count: Number(r.total) }));
  },

  /** Display lists for one or many courses: { [courseId]: [{ type, value }] } */
  async listItemsFor(courseIds) {
    const map = {};
    if (!courseIds.length) return map;
    const rows = await db.query(
      'SELECT course_id, type, value FROM course_list_items WHERE course_id IN (?) ORDER BY type, position, id',
      [courseIds]
    );
    for (const r of rows) (map[r.course_id] ||= []).push({ type: r.type, value: r.value });
    return map;
  },

  /** Venues (with their schedules) for one or many courses: { [courseId]: [venue] } */
  async venuesFor(courseIds) {
    const map = {};
    if (!courseIds.length) return map;

    const venues = await db.query(
      'SELECT id, course_id, name, address, postcode, latitude, longitude, parking_main, parking_sub, commute_main, commute_sub FROM course_venues WHERE course_id IN (?) ORDER BY course_id, position, id',
      [courseIds]
    );
    if (!venues.length) return map;

    const schedules = await db.query(
      'SELECT id, course_venue_id, time, start_date, end_date, price, seats_available, availability_status FROM course_venue_schedules WHERE course_venue_id IN (?) ORDER BY course_venue_id, position, id',
      [venues.map(v => v.id)]
    );
    const byVenue = {};
    for (const s of schedules) (byVenue[s.course_venue_id] ||= []).push(scheduleToPublic(s));

    for (const v of venues) (map[v.course_id] ||= []).push(venueToPublic(v, byVenue[v.id] || []));
    return map;
  },

  /** Creates the course with its lists and venues; returns the new id. */
  async create(data) {
    return db.withTransaction(async (trx) => {
      const cols = toColumns(data);
      const keys = Object.keys(cols);
      const result = await trx.query(
        `INSERT INTO courses (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
        Object.values(cols)
      );
      const id = result.insertId;
      await insertListItems(trx, id, data);
      await insertVenues(trx, id, data.locations);
      return id;
    });
  },

  /**
   * Updates the scalar fields, and replaces the lists / venues only when the
   * payload carries them, so a partial update leaves the rest untouched.
   */
  async update(id, data) {
    return db.withTransaction(async (trx) => {
      const cols = toColumns(data);
      const keys = Object.keys(cols);
      if (keys.length) {
        await trx.query(
          `UPDATE courses SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
          [...Object.values(cols), id]
        );
      }

      const touchesLists = Object.keys(LIST_TYPES).some(k => Array.isArray(data[k]));
      if (touchesLists) {
        const types = Object.entries(LIST_TYPES).filter(([k]) => Array.isArray(data[k])).map(([, t]) => t);
        await trx.query('DELETE FROM course_list_items WHERE course_id = ? AND type IN (?)', [id, types]);
        await insertListItems(trx, id, data);
      }

      if (Array.isArray(data.locations)) {
        // Schedules go with their venue (ON DELETE CASCADE)
        await trx.query('DELETE FROM course_venues WHERE course_id = ?', [id]);
        await insertVenues(trx, id, data.locations);
      }
      return true;
    });
  },

  async delete(id) {
    const result = await db.query('DELETE FROM courses WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }
};

module.exports = CourseModel;
