const db = require('../config/db');
const logger = require('../utils/logger');

/**
 * `GET /courses/:id` also answers for a licence id: the licence is resolved to
 * the course that teaches it by matching a keyword in its title, and the
 * licence itself is returned when there is no match.
 *
 * Returns { courseId } when a course matched, { license } when only the
 * licence did, or null when the id is not a licence.
 */
const TITLE_KEYWORDS = [
  'door supervisor',
  'cctv',
  'security guard',
  'close protection',
  'emergency first aid',
  'first aid',
  'fire marshal',
  'manual handling',
  'conflict management'
];

async function resolveLicense(id) {
  try {
    const rows = await db.query('SELECT * FROM licenses WHERE id = ? LIMIT 1', [id]);
    const license = rows[0];
    if (!license) return null;

    const titleLower = String(license.title || '').toLowerCase();
    // Web development licences are stand-alone products, never mapped to a course.
    if (titleLower.includes('web development')) return { license };

    const keyword = TITLE_KEYWORDS.find(term => titleLower.includes(term));
    if (keyword) {
      const matches = await db.query('SELECT id FROM courses WHERE title LIKE ? LIMIT 1', [`%${keyword}%`]);
      if (matches.length) return { courseId: matches[0].id };
    }
    return { license };
  } catch (err) {
    logger.warn('[licenseLookup] lookup failed:', err.message);
    return null;
  }
}

module.exports = { resolveLicense, TITLE_KEYWORDS };
