const db = require('../config/db');
const LocationModel = require('./locationModel');

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const LINK_COLUMNS = {
  price: 'price',
  vatIncluded: 'vat_included',
  depositRequired: 'deposit_required',
  depositAmount: 'deposit_amount',
  whatsIncluded: 'whats_included',
  status: 'status',
  legacyId: 'legacy_id'
};

const LINK_SELECT = 'cl.id, cl.course_id, cl.location_id, cl.price, cl.vat_included, cl.deposit_required, ' +
  'cl.deposit_amount, cl.whats_included, cl.status, cl.created_at, cl.updated_at';

const emptyToNull = (v) => (v === '' || v === undefined ? null : v);
const toBool = (v) => (v === true || v === 'true' || v === 1 || v === '1' ? 1 : 0);
const toNumberOrNull = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

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

/** 'HH:MM:SS' -> 'HH:MM', which is what the time inputs send and expect. */
const toHm = (v) => (typeof v === 'string' ? v.slice(0, 5) : v ?? null);
/** 'HH:MM' -> 'HH:MM:00'; blank means "not set". */
const toSqlTime = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v);
  return s.length === 5 ? `${s}:00` : s;
};

function linkToColumns(data) {
  const out = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (value === undefined) continue;
    const col = LINK_COLUMNS[key];
    if (col) out[col] = emptyToNull(value);
  }
  if (out.price !== undefined) out.price = toNumberOrNull(out.price);
  if (out.deposit_amount !== undefined) out.deposit_amount = toNumberOrNull(out.deposit_amount) ?? 0;
  if (out.vat_included !== undefined) out.vat_included = toBool(out.vat_included);
  if (out.deposit_required !== undefined) out.deposit_required = toBool(out.deposit_required);
  return out;
}

/** Row -> API shape. `locationId` / `courseId` carry the related records. */
function linkToPublic(row, { location = null, course = null, dates = [] } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    _id: String(row.id),
    courseId: course,
    locationId: location,
    price: row.price,
    vatIncluded: !!row.vat_included,
    depositRequired: !!row.deposit_required,
    depositAmount: row.deposit_amount,
    whatsIncluded: row.whats_included,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dates
  };
}

/** The course fields the scheduling endpoints carry with a link. */
function courseSummary(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: String(row.id),
    title: row.title,
    category: row.category,
    duration: row.duration,
    thumbnail: row.thumbnail,
    pricing: { basePrice: row.base_price, salePrice: row.sale_price, originalPrice: row.original_price },
    guarantee: { title: row.guarantee_title, description: row.guarantee_description },
    shortDescription: row.short_description,
    status: row.status
  };
}

/** The smaller course shape used by the location's linked-courses endpoint. */
function courseBrief(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: String(row.id),
    title: row.title,
    category: row.category,
    status: row.status,
    thumbnail: row.thumbnail
  };
}

function dateToPublic(row, timings = []) {
  const weeklyTimings = {};
  for (const day of DAYS) {
    const t = timings.find(x => x.day === day);
    weeklyTimings[day] = t
      ? { isOff: !!t.is_off, startTime: toHm(t.start_time), endTime: toHm(t.end_time) }
      : { isOff: false, startTime: null, endTime: null };
  }
  return {
    id: row.id,
    _id: String(row.id),
    courseLocationId: String(row.course_location_id),
    startDate: row.start_date,
    endDate: row.end_date,
    startTime: toHm(row.start_time),
    endTime: toHm(row.end_time),
    availableSeats: row.available_seats,
    bookedSeats: row.booked_seats,
    timingsType: row.timings_type,
    weeklyTimings,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const COURSE_SELECT = 'id, title, category, duration, thumbnail, base_price, sale_price, original_price, ' +
  'guarantee_title, guarantee_description, short_description, status';

async function replaceTimings(conn, dateId, weeklyTimings) {
  await conn.query('DELETE FROM course_location_date_timings WHERE course_location_date_id = ?', [dateId]);
  if (!weeklyTimings || typeof weeklyTimings !== 'object') return;
  const rows = DAYS
    .filter(day => weeklyTimings[day])
    .map(day => [dateId, day, toBool(weeklyTimings[day].isOff), toSqlTime(weeklyTimings[day].startTime), toSqlTime(weeklyTimings[day].endTime)]);
  if (!rows.length) return;
  await conn.query(
    `INSERT INTO course_location_date_timings (course_location_date_id, day, is_off, start_time, end_time)
     VALUES ${rows.map(() => '(?, ?, ?, ?, ?)').join(', ')}`,
    rows.flat()
  );
}

async function insertDate(conn, courseLocationId, d) {
  const result = await conn.query(
    `INSERT INTO course_location_dates
       (course_location_id, start_date, end_date, start_time, end_time, available_seats, booked_seats, timings_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      courseLocationId, toSqlDate(d.startDate), toSqlDate(d.endDate),
      toSqlTime(d.startTime) || '09:00:00', toSqlTime(d.endTime) || '17:00:00',
      Number(d.availableSeats), d.bookedSeats === undefined || d.bookedSeats === '' ? 0 : Number(d.bookedSeats),
      d.timingsType || 'same'
    ]
  );
  await replaceTimings(conn, result.insertId, d.weeklyTimings);
  return result.insertId;
}

async function updateDateRow(conn, id, d) {
  const cols = {};
  if (d.startDate !== undefined) cols.start_date = toSqlDate(d.startDate);
  if (d.endDate !== undefined) cols.end_date = toSqlDate(d.endDate);
  if (d.startTime !== undefined) cols.start_time = toSqlTime(d.startTime) || '09:00:00';
  if (d.endTime !== undefined) cols.end_time = toSqlTime(d.endTime) || '17:00:00';
  if (d.availableSeats !== undefined) cols.available_seats = Number(d.availableSeats);
  if (d.bookedSeats !== undefined) cols.booked_seats = Number(d.bookedSeats);
  if (d.timingsType !== undefined) cols.timings_type = d.timingsType;

  const keys = Object.keys(cols);
  if (keys.length) {
    await conn.query(
      `UPDATE course_location_dates SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
      [...Object.values(cols), id]
    );
  }
  if (d.weeklyTimings !== undefined) await replaceTimings(conn, id, d.weeklyTimings);
}

const CourseLocationModel = {
  DAYS,
  linkToPublic,
  courseSummary,
  courseBrief,
  dateToPublic,

  async findById(id) {
    const rows = await db.query(`SELECT ${LINK_SELECT} FROM course_locations cl WHERE cl.id = ? LIMIT 1`, [id]);
    return rows[0] || null;
  },

  async findByPair(courseId, locationId) {
    const rows = await db.query('SELECT id FROM course_locations cl WHERE cl.course_id = ? AND cl.location_id = ? LIMIT 1', [courseId, locationId]);
    return rows[0] || null;
  },

  /** Active links whose course is published (the public scheduling feed). */
  async findActiveForPublishedCourses() {
    return db.query(
      `SELECT ${LINK_SELECT} FROM course_locations cl
         JOIN courses c ON c.id = cl.course_id
        WHERE cl.status = 'Active' AND c.status = 'Published'
        ORDER BY cl.id`
    );
  },

  async findByCourse(courseId, { activeOnly = false } = {}) {
    const where = ['cl.course_id = ?'];
    const params = [courseId];
    if (activeOnly) {
      where.push("cl.status = 'Active'");
      where.push("EXISTS (SELECT 1 FROM locations l WHERE l.id = cl.location_id AND l.status = 'Active')");
    }
    return db.query(`SELECT ${LINK_SELECT} FROM course_locations cl WHERE ${where.join(' AND ')} ORDER BY cl.id`, params);
  },

  async findByLocation(locationId) {
    return db.query(`SELECT ${LINK_SELECT} FROM course_locations cl WHERE cl.location_id = ? ORDER BY cl.id`, [locationId]);
  },

  /** Course rows for the given ids, keyed by id. */
  async coursesByIds(courseIds) {
    const map = {};
    if (!courseIds.length) return map;
    const rows = await db.query(`SELECT ${COURSE_SELECT} FROM courses WHERE id IN (?)`, [courseIds]);
    for (const r of rows) map[r.id] = r;
    return map;
  },

  /** Locations for the given ids, already in API shape, keyed by id. */
  async locationsByIds(locationIds) {
    const map = {};
    if (!locationIds.length) return map;
    const ids = [...new Set(locationIds)];
    const rows = await db.query(
      `SELECT id, name, venue_name, address_line1, address_line2, city, postcode, country, maps_url,
              parking, parking_notes, accessibility, transport, main_image, local_market_overview,
              local_venues, surrounding_areas, status, created_at, updated_at
         FROM locations WHERE id IN (?)`,
      [ids]
    );
    const [facilities, gallery] = await Promise.all([
      LocationModel.facilitiesFor(ids),
      LocationModel.galleryFor(ids)
    ]);
    for (const r of rows) {
      map[r.id] = LocationModel.toPublic(r, { facilities: facilities[r.id] || [], gallery: gallery[r.id] || [] });
    }
    return map;
  },

  /** Dates (with their weekday timings) for one or many links, earliest first. */
  async datesFor(linkIds) {
    const map = {};
    if (!linkIds.length) return map;
    const rows = await db.query(
      `SELECT id, course_location_id, start_date, end_date, start_time, end_time, available_seats,
              booked_seats, timings_type, created_at, updated_at
         FROM course_location_dates WHERE course_location_id IN (?) ORDER BY start_date, id`,
      [linkIds]
    );
    if (!rows.length) return map;

    const timings = await db.query(
      'SELECT course_location_date_id, day, is_off, start_time, end_time FROM course_location_date_timings WHERE course_location_date_id IN (?)',
      [rows.map(r => r.id)]
    );
    const byDate = {};
    for (const t of timings) (byDate[t.course_location_date_id] ||= []).push(t);

    for (const r of rows) (map[r.course_location_id] ||= []).push(dateToPublic(r, byDate[r.id] || []));
    return map;
  },

  async findDateById(id) {
    const rows = await db.query(
      `SELECT id, course_location_id, start_date, end_date, start_time, end_time, available_seats,
              booked_seats, timings_type, created_at, updated_at
         FROM course_location_dates WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!rows.length) return null;
    const timings = await db.query(
      'SELECT course_location_date_id, day, is_off, start_time, end_time FROM course_location_date_timings WHERE course_location_date_id = ?',
      [id]
    );
    return dateToPublic(rows[0], timings);
  },

  /** Creates the link and any dates supplied with it. */
  async create(courseId, locationId, data) {
    return db.withTransaction(async (trx) => {
      const cols = { course_id: courseId, location_id: locationId, ...linkToColumns(data) };
      const keys = Object.keys(cols);
      const result = await trx.query(
        `INSERT INTO course_locations (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
        Object.values(cols)
      );
      const id = result.insertId;
      for (const d of data.dates || []) await insertDate(trx, id, d);
      return id;
    });
  },

  /**
   * Updates the link. When `dates` is supplied it becomes the full set: rows
   * missing from it are deleted, rows with an id are updated, the rest added.
   */
  async update(id, data) {
    return db.withTransaction(async (trx) => {
      const cols = linkToColumns(data);
      const keys = Object.keys(cols);
      if (keys.length) {
        await trx.query(
          `UPDATE course_locations SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
          [...Object.values(cols), id]
        );
      }

      if (Array.isArray(data.dates)) {
        const keepIds = data.dates.map(d => d._id ?? d.id).filter(Boolean).map(Number);
        if (keepIds.length) {
          await trx.query('DELETE FROM course_location_dates WHERE course_location_id = ? AND id NOT IN (?)', [id, keepIds]);
        } else {
          await trx.query('DELETE FROM course_location_dates WHERE course_location_id = ?', [id]);
        }
        for (const d of data.dates) {
          const dateId = d._id ?? d.id;
          if (dateId) await updateDateRow(trx, Number(dateId), d);
          else await insertDate(trx, id, d);
        }
      }
      return true;
    });
  },

  async delete(id) {
    // The dates and their timings go with the link (ON DELETE CASCADE).
    const result = await db.query('DELETE FROM course_locations WHERE id = ?', [id]);
    return result.affectedRows > 0;
  },

  async addDate(linkId, data) {
    return db.withTransaction(async (trx) => insertDate(trx, linkId, data));
  },

  async updateDate(id, data) {
    return db.withTransaction(async (trx) => {
      await updateDateRow(trx, id, data);
      return true;
    });
  },

  async deleteDate(id) {
    const result = await db.query('DELETE FROM course_location_dates WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }
};

module.exports = CourseLocationModel;
