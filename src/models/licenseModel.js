const crypto = require('crypto');
const db = require('../config/db');

// camelCase (API) -> snake_case (column) for the scalar fields of `licenses`.
const COLUMNS = {
  title: 'title',
  licenseType: 'license_type',
  category: 'category',
  subtitle: 'subtitle',
  shortDescription: 'short_description',
  fullDescription: 'full_description',
  thumbnail: 'thumbnail',
  salary: 'salary',
  duration: 'duration',
  valid: 'valid',
  experience: 'experience',
  trainingCount: 'training_count',
  rating: 'rating',
  renewalInfo: 'renewal_info',
  status: 'status',
  isPopular: 'is_popular',
  icon: 'icon',
  iconColor: 'icon_color',
  licenseNumber: 'license_number',
  holderName: 'holder_name',
  email: 'email',
  licenseAuthority: 'license_authority',
  holderId: 'holder_id',
  expiryDate: 'expiry_date',
  legacyId: 'legacy_id'
};

// The three ordered display lists share one table, told apart by `type`.
const LIST_TYPES = {
  highlights: 'highlight',
  learningPoints: 'learning_point',
  requirements: 'requirement'
};

const SELECT = 'id, title, license_type, category, subtitle, short_description, full_description, thumbnail, ' +
  'salary, duration, valid, experience, training_count, rating, renewal_info, ' +
  'base_price, sale_price, original_price, instructor_name, instructor_title, instructor_bio, instructor_photo, ' +
  'status, is_popular, icon, icon_color, license_number, holder_name, email, license_authority, holder_id, ' +
  'expiry_date, created_at, updated_at';

const emptyToNull = (v) => (v === '' || v === undefined ? null : v);
const toNumberOrNull = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const toSqlDate = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

/** Credential defaults a new licence is issued with. */
const defaultLicenseNumber = () => `SIA-${crypto.randomInt(10000000, 100000000)}`;
const defaultHolderId = () => `LH-${crypto.randomInt(100, 1000)}`;
const defaultExpiryDate = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 3);
  return d.toISOString().slice(0, 10);
};

function toColumns(data) {
  const out = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (value === undefined) continue;
    const col = COLUMNS[key];
    if (col) out[col] = emptyToNull(value);
  }
  if (out.is_popular !== undefined && out.is_popular !== null) {
    out.is_popular = out.is_popular === true || out.is_popular === 'true' || out.is_popular === 1 || out.is_popular === '1' ? 1 : 0;
  }
  if (out.expiry_date !== undefined) out.expiry_date = toSqlDate(out.expiry_date);

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
  return out;
}

/** Row -> API shape: nested objects and the `_id` string alias. */
function toPublic(row, { listItems = [], applicationSteps = [], pricingBreakdown = [], relatedCourses = [], venues = [] } = {}) {
  if (!row) return null;

  const lists = { highlights: [], learningPoints: [], requirements: [] };
  const byType = Object.fromEntries(Object.entries(LIST_TYPES).map(([k, v]) => [v, k]));
  for (const item of listItems) lists[byType[item.type]].push(item.value);

  return {
    id: row.id,
    _id: String(row.id),
    title: row.title,
    licenseType: row.license_type,
    category: row.category,
    subtitle: row.subtitle,
    shortDescription: row.short_description,
    fullDescription: row.full_description,
    thumbnail: row.thumbnail,
    salary: row.salary,
    duration: row.duration,
    valid: row.valid,
    experience: row.experience,
    trainingCount: row.training_count,
    rating: row.rating,
    ...lists,
    applicationSteps,
    pricingBreakdown,
    renewalInfo: row.renewal_info,
    pricing: {
      basePrice: row.base_price,
      salePrice: row.sale_price,
      originalPrice: row.original_price
    },
    locations: venues,
    instructor: {
      name: row.instructor_name,
      title: row.instructor_title,
      bio: row.instructor_bio,
      photo: row.instructor_photo
    },
    relatedCourses,
    status: row.status,
    isPopular: !!row.is_popular,
    icon: row.icon,
    iconColor: row.icon_color,
    licenseNumber: row.license_number,
    holderName: row.holder_name,
    email: row.email,
    licenseAuthority: row.license_authority,
    holderId: row.holder_id,
    expiryDate: row.expiry_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at
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

const venueToPublic = (row, schedules = []) => ({
  id: row.id,
  _id: String(row.id),
  name: row.name,
  schedules
});

// ── child-row writers (always inside a transaction) ────────────────────────
async function insertListItems(conn, licenseId, data) {
  const rows = [];
  for (const [key, type] of Object.entries(LIST_TYPES)) {
    const values = data[key];
    if (!Array.isArray(values)) continue;
    values
      .map(v => (typeof v === 'string' ? v.trim() : v))
      .filter(v => v !== null && v !== undefined && v !== '')
      .forEach((value, position) => rows.push([licenseId, type, position, String(value).slice(0, 1000)]));
  }
  if (!rows.length) return;
  await conn.query(
    `INSERT INTO license_list_items (license_id, type, position, value) VALUES ${rows.map(() => '(?, ?, ?, ?)').join(', ')}`,
    rows.flat()
  );
}

async function insertApplicationSteps(conn, licenseId, steps) {
  if (!Array.isArray(steps) || !steps.length) return;
  const rows = steps.map((s, position) => [licenseId, position, emptyToNull(s.title), emptyToNull(s.desc ?? s.description)]);
  await conn.query(
    `INSERT INTO license_application_steps (license_id, position, title, description) VALUES ${rows.map(() => '(?, ?, ?, ?)').join(', ')}`,
    rows.flat()
  );
}

async function insertPricingBreakdown(conn, licenseId, items) {
  if (!Array.isArray(items) || !items.length) return;
  const rows = items.map((p, position) => [licenseId, position, emptyToNull(p.label), emptyToNull(p.price)]);
  await conn.query(
    `INSERT INTO license_pricing_breakdown (license_id, position, label, price) VALUES ${rows.map(() => '(?, ?, ?, ?)').join(', ')}`,
    rows.flat()
  );
}

async function insertRelatedCourses(conn, licenseId, courseIds) {
  if (!Array.isArray(courseIds)) return;
  const ids = [...new Set(courseIds.map(Number).filter(Boolean))];
  if (!ids.length) return;
  // A course that has since been deleted is simply skipped.
  const existing = await conn.query('SELECT id FROM courses WHERE id IN (?)', [ids]);
  const valid = existing.map(r => r.id);
  if (!valid.length) return;
  await conn.query(
    `INSERT INTO license_related_courses (license_id, course_id, position) VALUES ${valid.map(() => '(?, ?, ?)').join(', ')}`,
    valid.flatMap((id, position) => [licenseId, id, position])
  );
}

async function insertVenues(conn, licenseId, venues) {
  if (!Array.isArray(venues)) return;
  for (const [position, venue] of venues.entries()) {
    const result = await conn.query(
      'INSERT INTO license_venues (license_id, position, name) VALUES (?, ?, ?)',
      [licenseId, position, venue.name]
    );
    const venueId = result.insertId;

    const schedules = Array.isArray(venue.schedules) ? venue.schedules : [];
    if (!schedules.length) continue;
    const rows = schedules.map((s, i) => [
      venueId, i, s.time || '09:00 - 17:00', toSqlDate(s.startDate), toSqlDate(s.endDate), toNumberOrNull(s.price),
      s.seatsAvailable === undefined || s.seatsAvailable === '' ? 20 : Number(s.seatsAvailable),
      s.availabilityStatus || 'Available'
    ]);
    await conn.query(
      `INSERT INTO license_venue_schedules
         (license_venue_id, position, time, start_date, end_date, price, seats_available, availability_status)
       VALUES ${rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
      rows.flat()
    );
  }
}

const LicenseModel = {
  LIST_TYPES,
  toPublic,

  async findById(id) {
    const rows = await db.query(`SELECT ${SELECT} FROM licenses WHERE id = ? LIMIT 1`, [id]);
    return rows[0] || null;
  },

  /** A page of licences matching the filters, newest first, plus the total. */
  async findAll({ category, status, search } = {}, { limit, offset } = {}) {
    const where = [];
    const params = [];
    if (category) { where.push('category = ?'); params.push(category); }
    if (status) { where.push('status = ?'); params.push(status); }
    if (search) {
      const like = `%${search}%`;
      where.push('(title LIKE ? OR license_number LIKE ? OR holder_name LIKE ? OR license_type LIKE ?)');
      params.push(like, like, like, like);
    }
    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';

    const [{ total }] = await db.query(`SELECT COUNT(*) AS total FROM licenses${whereSql}`, params);
    const rows = await db.query(
      `SELECT ${SELECT} FROM licenses${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return { rows, total: Number(total) };
  },

  /** Display lists for one or many licences: { [licenseId]: [{ type, value }] } */
  async listItemsFor(licenseIds) {
    const map = {};
    if (!licenseIds.length) return map;
    const rows = await db.query(
      'SELECT license_id, type, value FROM license_list_items WHERE license_id IN (?) ORDER BY type, position, id',
      [licenseIds]
    );
    for (const r of rows) (map[r.license_id] ||= []).push({ type: r.type, value: r.value });
    return map;
  },

  async applicationStepsFor(licenseIds) {
    const map = {};
    if (!licenseIds.length) return map;
    const rows = await db.query(
      'SELECT id, license_id, title, description FROM license_application_steps WHERE license_id IN (?) ORDER BY position, id',
      [licenseIds]
    );
    for (const r of rows) (map[r.license_id] ||= []).push({ _id: String(r.id), title: r.title, desc: r.description });
    return map;
  },

  async pricingBreakdownFor(licenseIds) {
    const map = {};
    if (!licenseIds.length) return map;
    const rows = await db.query(
      'SELECT id, license_id, label, price FROM license_pricing_breakdown WHERE license_id IN (?) ORDER BY position, id',
      [licenseIds]
    );
    for (const r of rows) (map[r.license_id] ||= []).push({ _id: String(r.id), label: r.label, price: r.price });
    return map;
  },

  /**
   * Related courses. `full` returns the course records the licence page shows;
   * otherwise just their ids, which is what a listing needs.
   */
  async relatedCoursesFor(licenseIds, { full = false } = {}) {
    const map = {};
    if (!licenseIds.length) return map;

    const links = await db.query(
      'SELECT license_id, course_id FROM license_related_courses WHERE license_id IN (?) ORDER BY position, course_id',
      [licenseIds]
    );
    if (!links.length) return map;

    if (!full) {
      for (const l of links) (map[l.license_id] ||= []).push(String(l.course_id));
      return map;
    }

    const courses = await db.query(
      `SELECT id, title, category, duration, thumbnail, short_description, status,
              base_price, sale_price, original_price
         FROM courses WHERE id IN (?)`,
      [[...new Set(links.map(l => l.course_id))]]
    );
    const byId = {};
    for (const c of courses) {
      byId[c.id] = {
        id: c.id,
        _id: String(c.id),
        title: c.title,
        category: c.category,
        duration: c.duration,
        thumbnail: c.thumbnail,
        shortDescription: c.short_description,
        status: c.status,
        pricing: { basePrice: c.base_price, salePrice: c.sale_price, originalPrice: c.original_price }
      };
    }
    for (const l of links) {
      if (byId[l.course_id]) (map[l.license_id] ||= []).push(byId[l.course_id]);
    }
    return map;
  },

  /** Venues with their schedules: { [licenseId]: [venue] } */
  async venuesFor(licenseIds) {
    const map = {};
    if (!licenseIds.length) return map;

    const venues = await db.query(
      'SELECT id, license_id, name FROM license_venues WHERE license_id IN (?) ORDER BY license_id, position, id',
      [licenseIds]
    );
    if (!venues.length) return map;

    const schedules = await db.query(
      'SELECT id, license_venue_id, time, start_date, end_date, price, seats_available, availability_status FROM license_venue_schedules WHERE license_venue_id IN (?) ORDER BY license_venue_id, position, id',
      [venues.map(v => v.id)]
    );
    const byVenue = {};
    for (const s of schedules) (byVenue[s.license_venue_id] ||= []).push(scheduleToPublic(s));

    for (const v of venues) (map[v.license_id] ||= []).push(venueToPublic(v, byVenue[v.id] || []));
    return map;
  },

  async create(data) {
    return db.withTransaction(async (trx) => {
      const cols = {
        license_number: defaultLicenseNumber(),
        holder_id: defaultHolderId(),
        expiry_date: defaultExpiryDate(),
        ...toColumns(data)
      };
      const keys = Object.keys(cols);
      const result = await trx.query(
        `INSERT INTO licenses (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
        Object.values(cols)
      );
      const id = result.insertId;

      await insertListItems(trx, id, data);
      await insertApplicationSteps(trx, id, data.applicationSteps);
      await insertPricingBreakdown(trx, id, data.pricingBreakdown);
      await insertRelatedCourses(trx, id, data.relatedCourses);
      await insertVenues(trx, id, data.locations);
      return id;
    });
  },

  /** Each list is replaced only when the payload carries it. */
  async update(id, data) {
    return db.withTransaction(async (trx) => {
      const cols = toColumns(data);
      const keys = Object.keys(cols);
      if (keys.length) {
        await trx.query(
          `UPDATE licenses SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
          [...Object.values(cols), id]
        );
      }

      const touchesLists = Object.keys(LIST_TYPES).some(k => Array.isArray(data[k]));
      if (touchesLists) {
        const types = Object.entries(LIST_TYPES).filter(([k]) => Array.isArray(data[k])).map(([, t]) => t);
        await trx.query('DELETE FROM license_list_items WHERE license_id = ? AND type IN (?)', [id, types]);
        await insertListItems(trx, id, data);
      }
      if (Array.isArray(data.applicationSteps)) {
        await trx.query('DELETE FROM license_application_steps WHERE license_id = ?', [id]);
        await insertApplicationSteps(trx, id, data.applicationSteps);
      }
      if (Array.isArray(data.pricingBreakdown)) {
        await trx.query('DELETE FROM license_pricing_breakdown WHERE license_id = ?', [id]);
        await insertPricingBreakdown(trx, id, data.pricingBreakdown);
      }
      if (Array.isArray(data.relatedCourses)) {
        await trx.query('DELETE FROM license_related_courses WHERE license_id = ?', [id]);
        await insertRelatedCourses(trx, id, data.relatedCourses);
      }
      if (Array.isArray(data.locations)) {
        // Schedules go with their venue (ON DELETE CASCADE)
        await trx.query('DELETE FROM license_venues WHERE license_id = ?', [id]);
        await insertVenues(trx, id, data.locations);
      }
      return true;
    });
  },

  async delete(id) {
    const result = await db.query('DELETE FROM licenses WHERE id = ?', [id]);
    return result.affectedRows > 0;
  }
};

module.exports = LicenseModel;
