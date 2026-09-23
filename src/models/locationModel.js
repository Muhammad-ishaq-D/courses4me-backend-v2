const db = require('../config/db');

const FACILITIES = ['wifi', 'projector', 'whiteboard', 'catering', 'toilets', 'disabled_access', 'prayer_room', 'air_conditioning'];

// camelCase (API) -> snake_case (column). Only these keys can ever be written.
const COLUMNS = {
  name: 'name',
  venueName: 'venue_name',
  addressLine1: 'address_line1',
  addressLine2: 'address_line2',
  city: 'city',
  postcode: 'postcode',
  country: 'country',
  mapsUrl: 'maps_url',
  parking: 'parking',
  parkingNotes: 'parking_notes',
  accessibility: 'accessibility',
  transport: 'transport',
  mainImage: 'main_image',
  localMarketOverview: 'local_market_overview',
  localVenues: 'local_venues',
  surroundingAreas: 'surrounding_areas',
  status: 'status',
  legacyId: 'legacy_id'
};

const SELECT = 'id, name, venue_name, address_line1, address_line2, city, postcode, country, maps_url, ' +
  'parking, parking_notes, accessibility, transport, main_image, local_market_overview, local_venues, ' +
  'surrounding_areas, status, created_at, updated_at';

const emptyToNull = (v) => (v === '' || v === undefined ? null : v);
const toBool = (v) => (v === true || v === 'true' || v === 1 || v === '1' ? 1 : 0);

function toColumns(data) {
  const out = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (value === undefined) continue;
    const col = COLUMNS[key];
    if (col) out[col] = emptyToNull(value);
  }
  if (out.parking !== undefined && out.parking !== null) out.parking = toBool(out.parking);
  // Postcodes are stored upper-case so lookups and display are consistent.
  if (out.postcode) out.postcode = String(out.postcode).toUpperCase();
  return out;
}

/** Row -> API shape. `_id` is the string alias the frontends read. */
function toPublic(row, { facilities = [], gallery = [], ...extras } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    _id: String(row.id),
    name: row.name,
    venueName: row.venue_name,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    postcode: row.postcode,
    country: row.country,
    mapsUrl: row.maps_url,
    parking: !!row.parking,
    parkingNotes: row.parking_notes,
    accessibility: row.accessibility,
    transport: row.transport,
    facilities,
    mainImage: row.main_image,
    gallery,
    localMarketOverview: row.local_market_overview,
    localVenues: row.local_venues,
    surroundingAreas: row.surrounding_areas,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extras
  };
}

async function replaceFacilities(conn, locationId, facilities) {
  await conn.query('DELETE FROM location_facilities WHERE location_id = ?', [locationId]);
  const values = [...new Set((facilities || []).filter(f => FACILITIES.includes(f)))];
  if (!values.length) return;
  await conn.query(
    `INSERT INTO location_facilities (location_id, facility) VALUES ${values.map(() => '(?, ?)').join(', ')}`,
    values.flatMap(f => [locationId, f])
  );
}

async function replaceGallery(conn, locationId, gallery) {
  await conn.query('DELETE FROM location_gallery WHERE location_id = ?', [locationId]);
  const urls = (gallery || []).filter(u => typeof u === 'string' && u.trim() !== '');
  if (!urls.length) return;
  await conn.query(
    `INSERT INTO location_gallery (location_id, position, url) VALUES ${urls.map(() => '(?, ?, ?)').join(', ')}`,
    urls.flatMap((url, position) => [locationId, position, url])
  );
}

const LocationModel = {
  FACILITIES,
  toPublic,

  async findById(id) {
    const rows = await db.query(`SELECT ${SELECT} FROM locations WHERE id = ? LIMIT 1`, [id]);
    return rows[0] || null;
  },

  /** Page of locations matching the filters, newest first, plus the total. */
  async findAll({ search, status } = {}, { limit, offset } = {}) {
    const where = [];
    const params = [];
    if (status) { where.push('status = ?'); params.push(status); }
    if (search) {
      const like = `%${search}%`;
      where.push('(name LIKE ? OR city LIKE ? OR postcode LIKE ? OR venue_name LIKE ?)');
      params.push(like, like, like, like);
    }
    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';

    const [{ total }] = await db.query(`SELECT COUNT(*) AS total FROM locations${whereSql}`, params);
    const rows = await db.query(
      `SELECT ${SELECT} FROM locations${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return { rows, total: Number(total) };
  },

  /** Facilities for one or many locations: { [locationId]: ['wifi', ...] } */
  async facilitiesFor(locationIds) {
    const map = {};
    if (!locationIds.length) return map;
    const rows = await db.query('SELECT location_id, facility FROM location_facilities WHERE location_id IN (?) ORDER BY facility', [locationIds]);
    for (const r of rows) (map[r.location_id] ||= []).push(r.facility);
    return map;
  },

  /** Gallery images for one or many locations: { [locationId]: [url, ...] } */
  async galleryFor(locationIds) {
    const map = {};
    if (!locationIds.length) return map;
    const rows = await db.query('SELECT location_id, url FROM location_gallery WHERE location_id IN (?) ORDER BY location_id, position, id', [locationIds]);
    for (const r of rows) (map[r.location_id] ||= []).push(r.url);
    return map;
  },

  /** Active links to published courses, counted per location. */
  async publishedCourseCounts(locationIds) {
    const map = {};
    if (!locationIds.length) return map;
    const rows = await db.query(
      `SELECT cl.location_id, COUNT(*) AS total
         FROM course_locations cl
         JOIN courses c ON c.id = cl.course_id AND c.status = 'Published'
        WHERE cl.location_id IN (?) AND cl.status = 'Active'
        GROUP BY cl.location_id`,
      [locationIds]
    );
    for (const r of rows) map[r.location_id] = Number(r.total);
    return map;
  },

  /** Every link to the location, whatever its status. */
  async linkCount(locationId) {
    const [{ total }] = await db.query('SELECT COUNT(*) AS total FROM course_locations WHERE location_id = ?', [locationId]);
    return Number(total);
  },

  async create(data) {
    return db.withTransaction(async (trx) => {
      const cols = toColumns(data);
      const keys = Object.keys(cols);
      const result = await trx.query(
        `INSERT INTO locations (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
        Object.values(cols)
      );
      const id = result.insertId;
      if (Array.isArray(data.facilities)) await replaceFacilities(trx, id, data.facilities);
      if (Array.isArray(data.gallery)) await replaceGallery(trx, id, data.gallery);
      return id;
    });
  },

  /** Facilities and gallery are replaced only when the payload carries them. */
  async update(id, data) {
    return db.withTransaction(async (trx) => {
      const cols = toColumns(data);
      const keys = Object.keys(cols);
      if (keys.length) {
        await trx.query(
          `UPDATE locations SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
          [...Object.values(cols), id]
        );
      }
      if (Array.isArray(data.facilities)) await replaceFacilities(trx, id, data.facilities);
      if (Array.isArray(data.gallery)) await replaceGallery(trx, id, data.gallery);
      return true;
    });
  },

  async setStatus(id, status) {
    const result = await db.query('UPDATE locations SET status = ? WHERE id = ?', [status, id]);
    return result.affectedRows > 0;
  }
};

module.exports = LocationModel;
