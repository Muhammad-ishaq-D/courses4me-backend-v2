const crypto = require('crypto');
const db = require('../config/db');

const REFERENCE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// ── job listings ───────────────────────────────────────────────────────────
const LISTING_COLUMNS = {
  title: 'title',
  company: 'company',
  location: 'location',
  type: 'type',
  category: 'category',
  career: 'career',
  salary: 'salary',
  description: 'description',
  status: 'status',
  isFeatured: 'is_featured',
  legacyId: 'legacy_id'
};

const LISTING_SELECT = 'id, title, company, location, type, category, career, salary, description, ' +
  'status, is_featured, created_at, updated_at';

// ── applications ───────────────────────────────────────────────────────────
const APPLICATION_COLUMNS = {
  jobListingId: 'job_listing_id',
  jobTitle: 'job_title',
  userId: 'user_id',
  firstName: 'first_name',
  lastName: 'last_name',
  email: 'email',
  phone: 'phone',
  address: 'address',
  city: 'city',
  postcode: 'postcode',
  license: 'license',
  experience: 'experience',
  availability: 'availability',
  cover: 'cover',
  cvFile: 'cv_file',
  status: 'status',
  legacyId: 'legacy_id'
};

const APPLICATION_SELECT = 'id, application_reference, job_listing_id, job_title, user_id, ' +
  'first_name, last_name, applicant_name, email, phone, address, city, postcode, ' +
  'license, experience, availability, cover, cv_file, status, created_at, updated_at';

const emptyToNull = (v) => (v === '' || v === undefined ? null : v);
const toBool = (v) => (v === true || v === 'true' || v === 1 || v === '1' ? 1 : 0);

/** REF-XXXXXXX, the code a candidate quotes when they get in touch. */
function generateReference() {
  let ref = 'REF-';
  for (let i = 0; i < 7; i++) ref += REFERENCE_CHARS[crypto.randomInt(0, REFERENCE_CHARS.length)];
  return ref;
}

function listingToColumns(data) {
  const out = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (value === undefined) continue;
    const col = LISTING_COLUMNS[key];
    if (col) out[col] = value === '' && col !== 'career' ? null : value;
  }
  if (out.is_featured !== undefined && out.is_featured !== null) out.is_featured = toBool(out.is_featured);
  return out;
}

function applicationToColumns(data) {
  const out = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (value === undefined) continue;
    const col = APPLICATION_COLUMNS[key];
    if (col) out[col] = emptyToNull(value);
  }
  if (out.email) out.email = String(out.email).trim().toLowerCase();
  // The display name is kept in step with the two name fields.
  if (data.firstName !== undefined || data.lastName !== undefined) {
    out.applicant_name = `${data.firstName ?? ''} ${data.lastName ?? ''}`.trim();
  }
  return out;
}

function listingToPublic(row, { requirements = [] } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    _id: String(row.id),
    title: row.title,
    company: row.company,
    location: row.location,
    type: row.type,
    category: row.category,
    career: row.career,
    salary: row.salary,
    description: row.description,
    requirements,
    status: row.status,
    isFeatured: !!row.is_featured,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** The vacancy fields carried with an application on the candidate's dashboard. */
const listingSummary = (row) => (row ? {
  id: row.id,
  _id: String(row.id),
  title: row.title,
  company: row.company,
  location: row.location,
  type: row.type,
  salary: row.salary,
  description: row.description,
  category: row.category
} : null);

function applicationToPublic(row, { listing } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    _id: String(row.id),
    applicationReference: row.application_reference,
    // `jobId` carries the vacancy itself where one was loaded, its id otherwise
    jobId: listing !== undefined ? listing : (row.job_listing_id === null ? null : String(row.job_listing_id)),
    jobTitle: row.job_title,
    user: row.user_id === null ? null : String(row.user_id),
    firstName: row.first_name,
    lastName: row.last_name,
    applicantName: row.applicant_name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    city: row.city,
    postcode: row.postcode,
    license: row.license,
    experience: row.experience,
    availability: row.availability,
    cover: row.cover,
    cvFile: row.cv_file,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const JobModel = {
  listingToPublic,
  applicationToPublic,
  listingSummary,
  generateReference,

  // ── listings ─────────────────────────────────────────────────────────────
  async findListingById(id) {
    const rows = await db.query(`SELECT ${LISTING_SELECT} FROM job_listings WHERE id = ? LIMIT 1`, [id]);
    return rows[0] || null;
  },

  /** Vacancies matching the board's filters, newest first. */
  async findListings({ category, type, status, search } = {}) {
    const where = [];
    const params = [];
    if (category) { where.push('category = ?'); params.push(category); }
    if (type) { where.push('type = ?'); params.push(type); }
    if (status) { where.push('status = ?'); params.push(status); }
    if (search) {
      const like = `%${search}%`;
      where.push('(title LIKE ? OR company LIKE ? OR description LIKE ?)');
      params.push(like, like, like);
    }
    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    return db.query(`SELECT ${LISTING_SELECT} FROM job_listings${whereSql} ORDER BY created_at DESC, id DESC`, params);
  },

  async listingsByIds(ids) {
    const map = {};
    if (!ids.length) return map;
    const rows = await db.query(`SELECT ${LISTING_SELECT} FROM job_listings WHERE id IN (?)`, [ids]);
    for (const r of rows) map[r.id] = r;
    return map;
  },

  /** Requirements for one or many vacancies: { [listingId]: ['...'] } */
  async requirementsFor(listingIds) {
    const map = {};
    if (!listingIds.length) return map;
    const rows = await db.query(
      'SELECT job_listing_id, value FROM job_listing_requirements WHERE job_listing_id IN (?) ORDER BY position, id',
      [listingIds]
    );
    for (const r of rows) (map[r.job_listing_id] ||= []).push(r.value);
    return map;
  },

  async createListing(data) {
    return db.withTransaction(async (trx) => {
      const cols = listingToColumns(data);
      const keys = Object.keys(cols);
      const result = await trx.query(
        `INSERT INTO job_listings (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
        Object.values(cols)
      );
      const id = result.insertId;
      await replaceRequirements(trx, id, data.requirements);
      return id;
    });
  },

  /** Requirements are replaced only when the payload carries them. */
  async updateListing(id, data) {
    return db.withTransaction(async (trx) => {
      const cols = listingToColumns(data);
      const keys = Object.keys(cols);
      if (keys.length) {
        await trx.query(
          `UPDATE job_listings SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
          [...Object.values(cols), id]
        );
      }
      if (Array.isArray(data.requirements)) {
        await trx.query('DELETE FROM job_listing_requirements WHERE job_listing_id = ?', [id]);
        await replaceRequirements(trx, id, data.requirements);
      }
      return true;
    });
  },

  async deleteListing(id) {
    const result = await db.query('DELETE FROM job_listings WHERE id = ?', [id]);
    return result.affectedRows > 0;
  },

  // ── applications ─────────────────────────────────────────────────────────
  async findApplicationById(id) {
    const rows = await db.query(`SELECT ${APPLICATION_SELECT} FROM job_applications WHERE id = ? LIMIT 1`, [id]);
    return rows[0] || null;
  },

  /** The application this candidate already has for this vacancy, if any. */
  async findExistingApplication(listingId, { userId, email }) {
    if (userId) {
      const rows = await db.query(
        `SELECT ${APPLICATION_SELECT} FROM job_applications WHERE job_listing_id = ? AND user_id = ? LIMIT 1`,
        [listingId, userId]
      );
      if (rows.length) return rows[0];
    }
    if (email) {
      const rows = await db.query(
        `SELECT ${APPLICATION_SELECT} FROM job_applications WHERE job_listing_id = ? AND email = ? LIMIT 1`,
        [listingId, String(email).trim().toLowerCase()]
      );
      if (rows.length) return rows[0];
    }
    return null;
  },

  /** Everything this candidate has applied for, by account or by email. */
  async findApplicationsForUser(userId, email) {
    const where = ['user_id = ?'];
    const params = [userId];
    if (email) { where.push('email = ?'); params.push(String(email).trim().toLowerCase()); }
    return db.query(
      `SELECT ${APPLICATION_SELECT} FROM job_applications WHERE ${where.join(' OR ')} ORDER BY created_at DESC, id DESC`,
      params
    );
  },

  async findApplications({ status, search } = {}) {
    const where = [];
    const params = [];
    if (status) { where.push('status = ?'); params.push(status); }
    if (search) {
      const like = `%${search}%`;
      where.push('(first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR job_title LIKE ?)');
      params.push(like, like, like, like);
    }
    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    return db.query(`SELECT ${APPLICATION_SELECT} FROM job_applications${whereSql} ORDER BY created_at DESC, id DESC`, params);
  },

  /** Inserts the application, retrying on a clashing reference. */
  async createApplication(data) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const cols = { application_reference: generateReference(), ...applicationToColumns(data) };
      const keys = Object.keys(cols);
      try {
        const result = await db.query(
          `INSERT INTO job_applications (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
          Object.values(cols)
        );
        return result.insertId;
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY' && /uq_job_applications_reference/.test(err.message)) continue;
        throw err;
      }
    }
    throw new Error('Could not allocate a unique application reference');
  },

  async updateApplicationStatus(id, status) {
    const result = await db.query('UPDATE job_applications SET status = ? WHERE id = ?', [status, id]);
    return result.affectedRows > 0;
  }
};

async function replaceRequirements(conn, listingId, requirements) {
  if (!Array.isArray(requirements)) return;
  const values = requirements
    .map(v => (typeof v === 'string' ? v.trim() : v))
    .filter(v => v !== null && v !== undefined && v !== '');
  if (!values.length) return;
  await conn.query(
    `INSERT INTO job_listing_requirements (job_listing_id, position, value) VALUES ${values.map(() => '(?, ?, ?)').join(', ')}`,
    values.flatMap((value, position) => [listingId, position, String(value).slice(0, 1000)])
  );
}

module.exports = JobModel;
