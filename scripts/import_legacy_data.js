#!/usr/bin/env node
/**
 * Loads a snapshot of the previous database into MySQL.
 *
 *   node scripts/import_legacy_data.js --dry-run
 *   node scripts/import_legacy_data.js
 *   node scripts/import_legacy_data.js --only users,courses
 *
 * The snapshot is the folder written by `export_for_mysql.js` in the previous
 * backend (one JSON file per collection). Options:
 *
 *   --dir <path>   where the snapshot is           (default ../legacy-export)
 *   --dry-run      run the whole import, then undo it and print the summary
 *   --only a,b     import only these groups        (default all, in order)
 *
 * Two properties make this safe to run more than once:
 *
 *   Everything happens in one transaction. Any failure — a value that will
 *   not fit, a reference that cannot be resolved — undoes the entire run, so
 *   the database is never left half-migrated.
 *
 *   Every record keeps its previous id in `legacy_id`. A second run finds
 *   that row and updates it instead of inserting a duplicate, so the import
 *   can be repeated against a fresher snapshot.
 *
 * An account that already exists here under the same address is linked to its
 * previous id and otherwise left alone: the password and profile in this
 * database are the current ones and are not overwritten by the snapshot.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/config/db');

const ROLLBACK = Symbol('dry run');
const MAX_ATTEMPTS = 4;

/**
 * A dropped connection rather than anything wrong with the data. The import
 * rolls back as a whole, so it is safe to simply start it again.
 */
const isTransient = (err) => ['ECONNRESET', 'PROTOCOL_CONNECTION_LOST', 'EPIPE', 'ETIMEDOUT', 'ER_LOCK_DEADLOCK']
  .includes(err?.code) || /ECONNRESET|connection is in closed state|connection lost|server has gone away/i.test(err?.message || '');

// ── command line ──────────────────────────────────────────────────────────
function arg(name, fallback) {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(`--${name}`);
  if (index !== -1 && argv[index + 1] && !argv[index + 1].startsWith('--')) return argv[index + 1];
  const inline = argv.find(a => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : fallback;
}
const flag = (name) => process.argv.slice(2).includes(`--${name}`);

const SNAPSHOT_DIR = path.resolve(process.cwd(), arg('dir', path.join('..', 'legacy-export')));
const DRY_RUN = flag('dry-run');
const ONLY = (arg('only', '') || '').split(',').map(s => s.trim()).filter(Boolean);

// ── value conversion ──────────────────────────────────────────────────────
const isBlank = (v) => v === null || v === undefined || v === '';

/** A timestamp column. Snapshot values are ISO strings. */
const toDateTime = (v) => {
  if (isBlank(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
/** A date-only column, kept as the calendar day it was, free of any offset. */
const toDate = (v) => {
  if (isBlank(v)) return null;
  const text = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
/** A time column: `9:00` and `09:00` both become `09:00:00`. */
const toTime = (v, fallback = null) => {
  if (isBlank(v)) return fallback;
  const match = String(v).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return fallback;
  return `${match[1].padStart(2, '0')}:${match[2]}:${match[3] || '00'}`;
};
const toBool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
const toNumber = (v, fallback = null) => {
  if (isBlank(v)) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
/** A text column, trimmed to what it can hold. */
const toText = (v, max, fallback = null) => {
  if (isBlank(v)) return fallback;
  const text = String(v);
  return max && text.length > max ? text.slice(0, max) : text;
};
/** A value the column will accept, or the column's own default. */
const toEnum = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
/** Array fields are sometimes absent, sometimes a single value. */
const toArray = (v) => (Array.isArray(v) ? v : isBlank(v) ? [] : [v]);
/** The previous record id, as the 24 characters `legacy_id` holds. */
const toId = (v) => {
  if (isBlank(v)) return null;
  const text = typeof v === 'object' ? String(v._id ?? v.id ?? '') : String(v);
  return /^[0-9a-f]{24}$/i.test(text) ? text.toLowerCase() : null;
};

// ── reporting ─────────────────────────────────────────────────────────────
const report = [];
const notes = [];
const count = (group) => {
  let row = report.find(r => r.group === group);
  if (!row) { row = { group, inserted: 0, updated: 0, linked: 0, skipped: 0 }; report.push(row); }
  return row;
};
const note = (message) => { if (!notes.includes(message)) notes.push(message); };

function readSnapshot(name) {
  const file = path.join(SNAPSHOT_DIR, `${name}.json`);
  if (!fs.existsSync(file)) {
    note(`${name}.json is not in the snapshot — that group was skipped`);
    return [];
  }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(parsed) ? parsed : [parsed];
}

// ── writing ───────────────────────────────────────────────────────────────
/**
 * Inserts the row, or updates the one already carrying this previous id.
 * Returns the key of the row in this database.
 *
 * `known` is the table's previous-id map, read once at the start, so deciding
 * between an insert and an update costs no extra round trip.
 */
async function upsert(trx, table, legacyId, columns, group, known) {
  const stats = count(group);
  const existingId = legacyId ? known.get(legacyId) : undefined;

  if (existingId) {
    const keys = Object.keys(columns);
    await trx.query(
      `UPDATE \`${table}\` SET ${keys.map(k => `\`${k}\` = ?`).join(', ')} WHERE id = ?`,
      [...keys.map(k => columns[k]), existingId]
    );
    stats.updated += 1;
    return existingId;
  }

  const cols = { ...columns, legacy_id: legacyId };
  const keys = Object.keys(cols);
  const result = await trx.query(
    `INSERT INTO \`${table}\` (${keys.map(k => `\`${k}\``).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
    keys.map(k => cols[k])
  );
  stats.inserted += 1;
  if (legacyId) known.set(legacyId, result.insertId);
  return result.insertId;
}

/**
 * The same, for the tables nothing else refers to. Their keys are never
 * needed, so whole batches go in at once rather than a row at a time.
 */
async function bulkUpsert(trx, table, rows, group, known) {
  const stats = count(group);
  if (!rows.length) return;

  const keys = [...Object.keys(rows[0].columns), 'legacy_id'];
  const placeholders = `(${keys.map(() => '?').join(', ')})`;
  const assignments = keys.filter(k => k !== 'legacy_id').map(k => `\`${k}\` = VALUES(\`${k}\`)`).join(', ');

  // Batches are capped by size as well as by count: a record that carries a
  // file inline is worth hundreds of kilobytes on its own, and one enormous
  // statement is slower to send than several ordinary ones.
  const MAX_ROWS = 50;
  const MAX_BYTES = 512 * 1024;

  let chunk = [];
  let bytes = 0;
  const flush = async () => {
    if (!chunk.length) return;
    const values = [];
    for (const row of chunk) {
      const cols = { ...row.columns, legacy_id: row.legacyId };
      values.push(...keys.map(k => cols[k]));
      if (row.legacyId && known.has(row.legacyId)) stats.updated += 1; else stats.inserted += 1;
    }
    await trx.query(
      `INSERT INTO \`${table}\` (${keys.map(k => `\`${k}\``).join(', ')}) VALUES ${chunk.map(() => placeholders).join(', ')}
       ON DUPLICATE KEY UPDATE ${assignments}`,
      values
    );
    chunk = [];
    bytes = 0;
  };

  for (const row of rows) {
    const size = Object.values(row.columns).reduce((a, v) => a + (typeof v === 'string' ? v.length : 8), 0);
    if (chunk.length && (chunk.length >= MAX_ROWS || bytes + size > MAX_BYTES)) await flush();
    chunk.push(row);
    bytes += size;
  }
  await flush();
}

/**
 * Replaces the rows belonging to one parent, so a repeat run does not stack
 * them. They go in as one statement: the database is remote, and a row at a
 * time would spend the whole import waiting on the network.
 */
async function replaceChildren(trx, table, foreignKey, parentId, rows) {
  await trx.query(`DELETE FROM \`${table}\` WHERE \`${foreignKey}\` = ?`, [parentId]);
  if (!rows.length) return;

  const keys = [foreignKey, ...Object.keys(rows[0])];
  const placeholders = `(${keys.map(() => '?').join(', ')})`;
  const values = [];
  for (const row of rows) {
    const cols = { [foreignKey]: parentId, ...row };
    values.push(...keys.map(k => cols[k]));
  }
  await trx.query(
    `INSERT INTO \`${table}\` (${keys.map(k => `\`${k}\``).join(', ')}) VALUES ${rows.map(() => placeholders).join(', ')}`,
    values
  );
}

/** The previous id of every row already imported into a table. */
async function loadMap(trx, table) {
  const rows = await trx.query(`SELECT id, legacy_id FROM \`${table}\` WHERE legacy_id IS NOT NULL`);
  return new Map(rows.map(r => [r.legacy_id, r.id]));
}

/** Positioned list rows, from an array of plain values. */
const listItems = (values, type) => toArray(values)
  .filter(v => !isBlank(v))
  .map((value, position) => ({ type, position, value: toText(value, 1000, '') }));

// ── the groups, in the order their references require ─────────────────────
const GROUPS = {
  async users(trx, maps) {
    for (const doc of readSnapshot('users')) {
      const legacyId = toId(doc._id);
      const email = toText(doc.email, 190);
      if (!email) { count('users').skipped += 1; note('an account without an address was skipped'); continue; }

      // An account already here under this address keeps its current
      // credentials; it is only linked to its previous id.
      const match = maps.usersByEmail.get(email.toLowerCase());
      if (match && match.legacy_id !== legacyId) {
        if (!match.legacy_id) {
          await trx.query('UPDATE users SET legacy_id = ? WHERE id = ?', [legacyId, match.id]);
          count('users').linked += 1;
          note(`${email} already existed here — linked, not overwritten`);
        } else {
          count('users').skipped += 1;
          note(`${email} is held by another imported account — skipped`);
        }
        maps.users.set(legacyId, match.id);
        continue;
      }

      const id = await upsert(trx, 'users', legacyId, {
        name: toText(doc.name, 150, 'Unnamed'),
        email,
        password_hash: toText(doc.password, 255),
        google_id: toText(doc.googleId, 64),
        facebook_id: toText(doc.facebookId, 64),
        phone: toText(doc.phone, 30),
        dob: toDate(doc.dob),
        billing_postcode: toText(doc.billingAddress?.postcode, 20),
        billing_line1: toText(doc.billingAddress?.line1, 255),
        billing_line2: toText(doc.billingAddress?.line2, 255),
        billing_city: toText(doc.billingAddress?.city, 100),
        role: toEnum(doc.role, ['admin', 'editor', 'customer'], 'customer'),
        job_title: toText(doc.jobTitle, 150),
        bio: toText(doc.bio),
        profile_image: toText(doc.profileImage, 500),
        token_version: toNumber(doc.tokenVersion, 0),
        status: toEnum(doc.status, ['active', 'inactive', 'suspended', 'blocked', 'pending verification'], 'active'),
        status_reason: toText(doc.statusReason, 500),
        last_login_at: toDateTime(doc.lastLogin),
        last_active_at: toDateTime(doc.lastActive),
        created_at: toDateTime(doc.createdAt) || new Date()
      }, 'users', maps.users);
      maps.users.set(legacyId, id);

      await replaceChildren(trx, 'user_devices', 'user_id', id, toArray(doc.knownDevices)
        .filter(d => !isBlank(d?.fingerprint))
        .map(d => ({
          fingerprint: toText(d.fingerprint, 64),
          user_agent: toText(d.userAgent, 500),
          ip: toText(d.ip, 45),
          first_seen_at: toDateTime(d.firstSeenAt) || new Date()
        })));

      await replaceChildren(trx, 'user_activity_logs', 'user_id', id, toArray(doc.activityHistory)
        .filter(a => !isBlank(a?.action))
        .map(a => ({
          action: toText(a.action, 100, ''),
          details: toText(a.details),
          created_at: toDateTime(a.timestamp) || new Date()
        })));
    }
  },

  async locations(trx, maps) {
    const FACILITIES = ['wifi', 'projector', 'whiteboard', 'catering', 'toilets', 'disabled_access', 'prayer_room', 'air_conditioning'];
    for (const doc of readSnapshot('locations')) {
      const legacyId = toId(doc._id);
      const id = await upsert(trx, 'locations', legacyId, {
        name: toText(doc.name, 255, 'Unnamed location'),
        venue_name: toText(doc.venueName, 255),
        address_line1: toText(doc.addressLine1, 255, ''),
        address_line2: toText(doc.addressLine2, 255),
        city: toText(doc.city, 120, ''),
        postcode: toText(doc.postcode, 20, ''),
        country: toText(doc.country, 100, 'United Kingdom'),
        maps_url: toText(doc.mapsUrl, 1000),
        parking: toBool(doc.parking),
        parking_notes: toText(doc.parkingNotes),
        accessibility: toText(doc.accessibility),
        transport: toText(doc.transport),
        main_image: toText(doc.mainImage, 500),
        local_market_overview: toText(doc.localMarketOverview),
        local_venues: toText(doc.localVenues),
        surrounding_areas: toText(doc.surroundingAreas),
        status: toEnum(doc.status, ['Active', 'Inactive'], 'Active'),
        created_at: toDateTime(doc.createdAt) || new Date()
      }, 'locations', maps.locations);
      maps.locations.set(legacyId, id);

      const listed = toArray(doc.facilities);
      const facilities = [...new Set(listed.filter(f => FACILITIES.includes(f)))];
      if (listed.some(f => !FACILITIES.includes(f))) {
        note(`${doc.name}: a facility this database does not list was dropped`);
      }
      await replaceChildren(trx, 'location_facilities', 'location_id', id, facilities.map(facility => ({ facility })));

      await replaceChildren(trx, 'location_gallery', 'location_id', id, toArray(doc.gallery)
        .filter(url => !isBlank(url))
        .map((url, position) => ({ position, url: toText(url, 500, '') })));
    }
  },

  async courses(trx, maps) {
    const CATEGORIES = ['SIA Training', 'Specialist', 'First Aid', 'Health & Safety', 'Hospitality'];
    for (const doc of readSnapshot('courses')) {
      const legacyId = toId(doc._id);
      if (doc.category && !CATEGORIES.includes(doc.category)) {
        note(`${doc.title}: category "${doc.category}" is not one this database lists — stored as Specialist`);
      }

      const id = await upsert(trx, 'courses', legacyId, {
        // The reference is the tail of the previous id, so a course keeps the
        // short code staff already know it by.
        reference: (legacyId ? legacyId.slice(-6) : Math.random().toString(16).slice(2, 8)).toUpperCase(),
        title: toText(doc.title, 255, 'Untitled course'),
        category: toEnum(doc.category, CATEGORIES, 'Specialist'),
        subtitle: toText(doc.subtitle, 255),
        level: toText(doc.level, 50, 'Level 2'),
        duration: toText(doc.duration, 100, ''),
        reviews_count: toText(doc.reviewsCount, 50, '1,000+'),
        booked_count: toText(doc.bookedCount, 50, '500+'),
        pass_rate: toText(doc.passRate, 50, '98%'),
        short_description: toText(doc.shortDescription, null, ''),
        full_description: toText(doc.fullDescription, null, ''),
        guarantee_title: toText(doc.guarantee?.title, 150, 'Training Guarantee'),
        guarantee_description: toText(doc.guarantee?.description, 500, ''),
        thumbnail: toText(doc.thumbnail),
        base_price: toNumber(doc.pricing?.basePrice, 0),
        sale_price: toNumber(doc.pricing?.salePrice),
        original_price: toNumber(doc.pricing?.originalPrice),
        location_id: maps.locations.get(toId(doc.locationId)) || null,
        center_id: toText(doc.centerId, 64),
        center_name: toText(doc.centerName, 255),
        instructor_name: toText(doc.instructor?.name, 150),
        instructor_title: toText(doc.instructor?.title, 150),
        instructor_bio: toText(doc.instructor?.bio),
        instructor_photo: toText(doc.instructor?.photo),
        status: toEnum(doc.status, ['Published', 'Draft', 'Archived'], 'Draft'),
        is_popular: toBool(doc.isPopular),
        created_at: toDateTime(doc.createdAt) || new Date()
      }, 'courses', maps.courses);
      maps.courses.set(legacyId, id);

      await replaceChildren(trx, 'course_list_items', 'course_id', id, [
        ...listItems(doc.highlights, 'highlight'),
        ...listItems(doc.learningPoints, 'learning_point'),
        ...listItems(doc.targetAudience, 'target_audience'),
        ...listItems(doc.requirements, 'requirement')
      ]);

      // Venues written on the course itself, which are separate from the
      // shared locations the scheduling module uses.
      const venues = toArray(doc.locations).filter(v => !isBlank(v?.name));
      await trx.query(
        'DELETE FROM course_venue_schedules WHERE course_venue_id IN (SELECT id FROM course_venues WHERE course_id = ?)',
        [id]
      );
      await trx.query('DELETE FROM course_venues WHERE course_id = ?', [id]);
      for (const [position, venue] of venues.entries()) {
        const { insertId: venueId } = await trx.query(
          `INSERT INTO course_venues (course_id, position, name, address, postcode, latitude, longitude,
                                      parking_main, parking_sub, commute_main, commute_sub)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, position, toText(venue.name, 255, ''), toText(venue.address, 500), toText(venue.postcode, 20, ''),
            toNumber(venue.latitude), toNumber(venue.longitude),
            toText(venue.parking?.main, 255), toText(venue.parking?.sub, 255),
            toText(venue.commute?.main, 255), toText(venue.commute?.sub, 255)]
        );
        for (const [index, schedule] of toArray(venue.schedules).entries()) {
          await trx.query(
            `INSERT INTO course_venue_schedules (course_venue_id, position, time, start_date, end_date, price, seats_available, availability_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [venueId, index, toText(schedule.time, 100, '09:00 - 17:00'),
              toDate(schedule.startDate), toDate(schedule.endDate), toNumber(schedule.price, 0),
              toNumber(schedule.seatsAvailable, 20),
              toEnum(schedule.availabilityStatus, ['Available', 'Selling Fast', 'Sold Out'], 'Available')]
          );
        }
      }
    }
  },

  async courseLocations(trx, maps) {
    for (const doc of readSnapshot('courselocations')) {
      const legacyId = toId(doc._id);
      const courseId = maps.courses.get(toId(doc.courseId));
      const locationId = maps.locations.get(toId(doc.locationId));
      if (!courseId || !locationId) {
        // The previous database had no foreign keys, so deleting a course
        // left its links behind. They cannot be recreated here, and nothing
        // could reach them anyway.
        count('courseLocations').skipped += 1;
        note(`course/location link …${String(legacyId).slice(-6)} refers to a ${courseId ? 'location' : 'course'} that no longer exists — skipped`);
        continue;
      }

      // The pair is unique. If it is already here under a different previous
      // id, adopt that row rather than colliding with it.
      const pair = maps.courseLocationPairs.get(`${courseId}:${locationId}`);
      if (pair && pair.legacy_id !== legacyId) {
        await trx.query('UPDATE course_locations SET legacy_id = ? WHERE id = ?', [legacyId, pair.id]);
        maps.courseLocations.set(legacyId, pair.id);
      }

      const id = await upsert(trx, 'course_locations', legacyId, {
        course_id: courseId,
        location_id: locationId,
        price: toNumber(doc.price, 0),
        vat_included: toBool(doc.vatIncluded),
        deposit_required: toBool(doc.depositRequired),
        deposit_amount: toNumber(doc.depositAmount, 0),
        whats_included: toText(doc.whatsIncluded),
        status: toEnum(doc.status, ['Active', 'Inactive'], 'Active'),
        created_at: toDateTime(doc.createdAt) || new Date()
      }, 'courseLocations', maps.courseLocations);
      maps.courseLocations.set(legacyId, id);
    }
  },

  async courseLocationDates(trx, maps) {
    const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    for (const doc of readSnapshot('courselocationdates')) {
      const legacyId = toId(doc._id);
      const courseLocationId = maps.courseLocations.get(toId(doc.courseLocationId));
      if (!courseLocationId) {
        count('courseLocationDates').skipped += 1;
        note(`session …${String(legacyId).slice(-6)} belongs to a course/location link that was skipped — skipped too`);
        continue;
      }

      const id = await upsert(trx, 'course_location_dates', legacyId, {
        course_location_id: courseLocationId,
        start_date: toDate(doc.startDate),
        end_date: toDate(doc.endDate) || toDate(doc.startDate),
        start_time: toTime(doc.startTime, '09:00:00'),
        end_time: toTime(doc.endTime, '17:00:00'),
        available_seats: toNumber(doc.availableSeats, 0),
        booked_seats: toNumber(doc.bookedSeats, 0),
        timings_type: toEnum(doc.timingsType, ['same', 'flexible'], 'same'),
        created_at: toDateTime(doc.createdAt) || new Date()
      }, 'courseLocationDates', maps.courseLocationDates);
      maps.courseLocationDates.set(legacyId, id);

      const timings = doc.weeklyTimings || {};
      await replaceChildren(trx, 'course_location_date_timings', 'course_location_date_id', id,
        DAYS.filter(day => timings[day]).map(day => ({
          day,
          is_off: toBool(timings[day].isOff),
          start_time: toTime(timings[day].startTime),
          end_time: toTime(timings[day].endTime)
        })));
    }
  },

  async licenses(trx, maps) {
    const CATEGORIES = ['SIA Training', 'First Aid', 'Health & Safety', 'Specialist'];
    for (const doc of readSnapshot('licenses')) {
      const legacyId = toId(doc._id);
      const id = await upsert(trx, 'licenses', legacyId, {
        title: toText(doc.title, 255, 'Untitled licence'),
        license_type: toText(doc.licenseType, 150, 'Security Guard'),
        category: toEnum(doc.category, CATEGORIES, 'SIA Training'),
        subtitle: toText(doc.subtitle, 255),
        short_description: toText(doc.shortDescription, null, ''),
        full_description: toText(doc.fullDescription, null, ''),
        thumbnail: toText(doc.thumbnail),
        salary: toText(doc.salary, 100),
        duration: toText(doc.duration, 100),
        valid: toText(doc.valid, 100),
        experience: toText(doc.experience, 100, '5 Years'),
        training_count: toText(doc.trainingCount, 100, '12 Courses'),
        rating: toText(doc.rating, 20, '4.9/5'),
        renewal_info: toText(doc.renewalInfo),
        base_price: toNumber(doc.pricing?.basePrice, 0),
        sale_price: toNumber(doc.pricing?.salePrice),
        original_price: toNumber(doc.pricing?.originalPrice),
        instructor_name: toText(doc.instructor?.name, 150),
        instructor_title: toText(doc.instructor?.title, 150),
        instructor_bio: toText(doc.instructor?.bio),
        instructor_photo: toText(doc.instructor?.photo),
        status: toEnum(doc.status, ['Published', 'Draft', 'Archived'], 'Draft'),
        is_popular: toBool(doc.isPopular),
        icon: toText(doc.icon, 60, 'shield'),
        icon_color: toText(doc.iconColor, 60, 'bg-blue-600'),
        license_number: toText(doc.licenseNumber, 60),
        holder_name: toText(doc.holderName, 150),
        email: toText(doc.email, 190),
        license_authority: toText(doc.licenseAuthority, 190, 'SIA (Security Industry Authority)'),
        holder_id: toText(doc.holderId, 60),
        expiry_date: toDate(doc.expiryDate),
        created_at: toDateTime(doc.createdAt) || new Date()
      }, 'licenses', maps.licenses);
      maps.licenses.set(legacyId, id);

      await replaceChildren(trx, 'license_list_items', 'license_id', id, [
        ...listItems(doc.highlights, 'highlight'),
        ...listItems(doc.learningPoints, 'learning_point'),
        ...listItems(doc.requirements, 'requirement')
      ]);

      await replaceChildren(trx, 'license_application_steps', 'license_id', id, toArray(doc.applicationSteps)
        .map((step, position) => ({
          position,
          title: toText(step?.title, 255),
          description: toText(step?.desc ?? step?.description)
        })));

      await replaceChildren(trx, 'license_pricing_breakdown', 'license_id', id, toArray(doc.pricingBreakdown)
        .map((line, position) => ({
          position,
          label: toText(line?.label, 255),
          price: toText(line?.price, 100)
        })));

      const related = toArray(doc.relatedCourses)
        .map(toId)
        .map(ref => maps.courses.get(ref))
        .filter(Boolean);
      if (toArray(doc.relatedCourses).length !== related.length) {
        note(`${doc.title}: a related course that is not in the snapshot was left off`);
      }
      await replaceChildren(trx, 'license_related_courses', 'license_id', id,
        [...new Set(related)].map((courseId, position) => ({ course_id: courseId, position })));

      const venues = toArray(doc.locations).filter(v => !isBlank(v?.name));
      await trx.query(
        'DELETE FROM license_venue_schedules WHERE license_venue_id IN (SELECT id FROM license_venues WHERE license_id = ?)',
        [id]
      );
      await trx.query('DELETE FROM license_venues WHERE license_id = ?', [id]);
      for (const [position, venue] of venues.entries()) {
        const { insertId: venueId } = await trx.query(
          'INSERT INTO license_venues (license_id, position, name) VALUES (?, ?, ?)',
          [id, position, toText(venue.name, 255, '')]
        );
        for (const [index, schedule] of toArray(venue.schedules).entries()) {
          await trx.query(
            `INSERT INTO license_venue_schedules (license_venue_id, position, time, start_date, end_date, price, seats_available, availability_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [venueId, index, toText(schedule.time, 100, '09:00 - 17:00'),
              toDate(schedule.startDate), toDate(schedule.endDate), toNumber(schedule.price, 0),
              toNumber(schedule.seatsAvailable, 20),
              toEnum(schedule.availabilityStatus, ['Available', 'Selling Fast', 'Sold Out'], 'Available')]
          );
        }
      }
    }
  },

  async bookings(trx, maps) {
    for (const doc of readSnapshot('bookings')) {
      const legacyId = toId(doc._id);
      const courseType = toEnum(doc.courseModel, ['Course', 'License'], 'Course');
      const userId = maps.users.get(toId(doc.user));
      const courseId = courseType === 'License'
        ? maps.licenses.get(toId(doc.course))
        : maps.courses.get(toId(doc.course));

      if (!userId || !courseId) {
        count('bookings').skipped += 1;
        note(`booking ${doc.bookingReference || legacyId} points at a customer or course that is not in the snapshot — skipped`);
        continue;
      }

      const scheduleId = maps.courseLocationDates.get(toId(doc.session?.scheduleId)) || null;
      if (doc.session?.scheduleId && !scheduleId) {
        note(`booking ${doc.bookingReference}: its session could not be matched, so the dates were kept without the link`);
      }

      const customer = doc.customerDetails || {};
      const billing = doc.billingAddress || {};
      const refund = doc.refundRequest || {};
      const reschedule = doc.pendingReschedule || {};

      const id = await upsert(trx, 'bookings', legacyId, {
        booking_reference: toText(doc.bookingReference, 20, `LEG-${String(legacyId).slice(-6).toUpperCase()}`),
        user_id: userId,
        course_id: courseId,
        course_type: courseType,
        package_name: toText(doc.packageName, 150, 'Standard'),
        session_location_name: toText(doc.session?.locationName, 255),
        session_branch_name: toText(doc.session?.branchName, 255),
        session_schedule_id: scheduleId,
        session_schedule_source: scheduleId ? 'course_location_date' : null,
        session_start_date: toDateTime(doc.session?.startDate),
        session_end_date: toDateTime(doc.session?.endDate),
        session_time: toText(doc.session?.time, 100),
        session_price: toNumber(doc.session?.price),
        customer_first_name: toText(customer.firstName, 100, ''),
        customer_last_name: toText(customer.lastName, 100, ''),
        customer_email: toText(customer.email, 190, ''),
        customer_phone: toText(customer.phone, 30, ''),
        customer_dob: toText(customer.dob, 30),
        billing_postcode: toText(billing.postcode, 20),
        billing_line1: toText(billing.line1, 255),
        billing_line2: toText(billing.line2, 255),
        billing_city: toText(billing.city, 100),
        option_easy_apply: toBool(doc.options?.easyApply),
        additional_info: toText(doc.additionalInfo),
        total_amount: toNumber(doc.totalAmount, 0),
        currency: toText(doc.currency, 3, 'GBP'),
        payment_method: toEnum(doc.paymentMethod, ['card', 'paypal', 'instalments', 'klarna'], 'card'),
        payment_status: toEnum(doc.paymentStatus, ['Pending', 'Paid', 'Failed', 'Refunded'], 'Pending'),
        stripe_session_id: toText(doc.stripeSessionId, 255),
        payment_intent_id: toText(doc.paymentIntentId, 255),
        status: toEnum(doc.status, ['PENDING', 'PAID', 'EXPIRED', 'CANCELLED'], 'PENDING'),
        lifecycle_status: toEnum(doc.lifecycleStatus, ['Upcoming', 'Ongoing', 'Completed', 'Postponed', 'Cancelled', 'Extended'], 'Upcoming'),
        original_end_date: toDateTime(doc.originalEndDate),
        progress: Math.min(100, Math.max(0, toNumber(doc.progress, 0))),
        refund_status: toEnum(refund.status, ['None', 'Requested', 'Approved', 'Rejected'], 'None'),
        refund_reason: toText(refund.reason),
        refund_requested_at: toDateTime(refund.requestedAt),
        refund_processed_at: toDateTime(refund.processedAt),
        refund_admin_notes: toText(refund.adminNotes),
        refund_id: toText(refund.refundId, 255),
        refund_proof_url: toText(refund.proofUrl, 500),
        pending_reschedule_start_date: toDateTime(reschedule.startDate),
        pending_reschedule_end_date: toDateTime(reschedule.endDate),
        pending_reschedule_reason: toText(reschedule.reason),
        pending_reschedule_status: toEnum(reschedule.status, ['Awaiting Payment', 'Paid'], null),
        pending_reschedule_created_at: toDateTime(reschedule.createdAt),
        booking_date: toDateTime(doc.bookingDate) || toDateTime(doc.createdAt) || new Date(),
        created_at: toDateTime(doc.createdAt) || new Date()
      }, 'bookings', maps.bookings);
      maps.bookings.set(legacyId, id);

      await replaceChildren(trx, 'booking_attendance', 'booking_id', id, toArray(doc.attendance).map(a => ({
        date: toDate(a?.date),
        status: toEnum(a?.status, ['Present', 'Absent', 'Late'], 'Present'),
        created_at: toDateTime(a?.createdAt) || new Date()
      })));

      await replaceChildren(trx, 'booking_certificates', 'booking_id', id, toArray(doc.certificates).map(c => ({
        name: toText(c?.name, 255),
        url: toText(c?.url, 500),
        issued_at: toDateTime(c?.issuedAt) || new Date()
      })));

      await replaceChildren(trx, 'booking_extension_history', 'booking_id', id, toArray(doc.extensionHistory).map(e => ({
        previous_end_date: toDateTime(e?.previousEndDate),
        new_end_date: toDateTime(e?.newEndDate),
        reason: toText(e?.reason),
        created_at: toDateTime(e?.createdAt) || new Date()
      })));

      await replaceChildren(trx, 'booking_reschedule_history', 'booking_id', id, toArray(doc.rescheduleHistory).map(r => ({
        previous_start_date: toDateTime(r?.previousStartDate),
        new_start_date: toDateTime(r?.newStartDate),
        previous_end_date: toDateTime(r?.previousEndDate),
        new_end_date: toDateTime(r?.newEndDate),
        reason: toText(r?.reason),
        created_at: toDateTime(r?.createdAt) || new Date()
      })));
    }
  },

  async jobListings(trx, maps) {
    const TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship', 'Remote'];
    const CATEGORIES = ['SIA Training', 'First Aid', 'Health & Safety', 'Specialist', 'Security Officer',
      'Door Supervisor', 'Event Security', 'CCTV Operator', 'Close Protection', 'First Aider',
      'Paediatric First Aider', 'Safety Inspector', 'Risk Assessor', 'Security Manager'];

    for (const doc of readSnapshot('joblistings')) {
      const legacyId = toId(doc._id);
      if (doc.category && !CATEGORIES.includes(doc.category)) {
        note(`vacancy "${doc.title}": category "${doc.category}" is not one this database lists — stored as Specialist`);
      }
      const id = await upsert(trx, 'job_listings', legacyId, {
        title: toText(doc.title, 255, 'Untitled vacancy'),
        company: toText(doc.company, 255, ''),
        location: toText(doc.location, 255, ''),
        type: toEnum(doc.type, TYPES, 'Full-time'),
        category: toEnum(doc.category, CATEGORIES, 'Specialist'),
        career: toText(doc.career, 150, ''),
        salary: toText(doc.salary, 150, ''),
        description: toText(doc.description, null, ''),
        status: toEnum(doc.status, ['Active', 'Paused', 'Closed'], 'Active'),
        is_featured: toBool(doc.isFeatured),
        created_at: toDateTime(doc.createdAt) || new Date()
      }, 'jobListings', maps.jobListings);
      maps.jobListings.set(legacyId, id);

      await replaceChildren(trx, 'job_listing_requirements', 'job_listing_id', id, toArray(doc.requirements)
        .filter(r => !isBlank(r))
        .map((value, position) => ({ position, value: toText(value, 1000, '') })));
    }
  },

  async jobApplications(trx, maps) {
    const rows = readSnapshot('jobapplications').map((doc) => {
      const legacyId = toId(doc._id);
      const first = toText(doc.firstName, 100, '');
      const last = toText(doc.lastName, 100, '');
      return { legacyId, columns: {
        application_reference: toText(doc.applicationReference, 20, `LEG-${String(legacyId).slice(-6).toUpperCase()}`),
        // A vacancy that has since been removed leaves the application in
        // place; the title it was made against is stored on the row.
        job_listing_id: maps.jobListings.get(toId(doc.jobId)) || null,
        job_title: toText(doc.jobTitle, 255, ''),
        user_id: maps.users.get(toId(doc.user)) || null,
        first_name: first,
        last_name: last,
        applicant_name: toText(doc.applicantName, 201, `${first} ${last}`.trim()),
        email: toText(doc.email, 190, ''),
        phone: toText(doc.phone, 30, ''),
        address: toText(doc.address, 500, ''),
        city: toText(doc.city, 120, ''),
        postcode: toText(doc.postcode, 20, ''),
        license: toText(doc.license, 150, ''),
        experience: toText(doc.experience, 150, ''),
        availability: toText(doc.availability, 150, ''),
        cover: toText(doc.cover, null, ''),
        cv_file: toText(doc.cvFile, null, 'cv_resume.pdf'),
        status: toEnum(doc.status, ['Pending', 'Shortlisted', 'Interview', 'Rejected', 'Accepted'], 'Pending'),
        created_at: toDateTime(doc.createdAt) || new Date()
      } };
    });
    await bulkUpsert(trx, 'job_applications', rows, 'jobApplications', maps.jobApplications);
  },

  async reviews(trx, maps) {
    const rows = [];
    for (const doc of readSnapshot('reviews')) {
      const courseType = toEnum(doc.courseModel, ['Course', 'License'], 'Course');
      const userId = maps.users.get(toId(doc.user));
      const courseId = courseType === 'License'
        ? maps.licenses.get(toId(doc.course))
        : maps.courses.get(toId(doc.course));

      if (!userId || !courseId) {
        count('reviews').skipped += 1;
        note('a review of a course or customer that is not in the snapshot was skipped');
        continue;
      }

      rows.push({
        legacyId: toId(doc._id),
        columns: {
          user_id: userId,
          course_id: courseId,
          course_type: courseType,
          booking_id: maps.bookings.get(toId(doc.booking)) || null,
          rating: Math.min(5, Math.max(1, toNumber(doc.rating, 5))),
          comment: toText(doc.comment, 1000),
          created_at: toDateTime(doc.createdAt) || new Date()
        }
      });
    }
    await bulkUpsert(trx, 'reviews', rows, 'reviews', maps.reviews);
  },

  async notifications(trx, maps) {
    const rows = [];
    for (const doc of readSnapshot('notifications')) {
      const userId = maps.users.get(toId(doc.user));
      if (!userId) {
        count('notifications').skipped += 1;
        note('a notification addressed to a customer that is not in the snapshot was skipped');
        continue;
      }
      rows.push({
        legacyId: toId(doc._id),
        columns: {
          user_id: userId,
          title: toText(doc.title, 255, ''),
          message: toText(doc.message, null, ''),
          type: toEnum(doc.type, ['booking', 'user', 'payment', 'system'], 'system'),
          is_read: toBool(doc.isRead),
          created_at: toDateTime(doc.createdAt) || new Date()
        }
      });
    }
    await bulkUpsert(trx, 'notifications', rows, 'notifications', maps.notifications);
  },

  async settings(trx) {
    const [doc] = readSnapshot('settings');
    if (!doc) return;

    const general = JSON.stringify(doc.general || {});
    const notificationToggles = JSON.stringify(doc.notifications || {});
    const templates = JSON.stringify(doc.emailTemplates || []);

    const [existing] = await trx.query('SELECT id FROM settings ORDER BY id ASC LIMIT 1');
    if (existing) {
      await trx.query('UPDATE settings SET general = ?, notifications = ?, email_templates = ? WHERE id = ?',
        [general, notificationToggles, templates, existing.id]);
      count('settings').updated += 1;
      note('the site settings were replaced by the ones in the snapshot');
    } else {
      await trx.query('INSERT INTO settings (general, notifications, email_templates) VALUES (?, ?, ?)',
        [general, notificationToggles, templates]);
      count('settings').inserted += 1;
    }
  }
};

const ORDER = ['users', 'locations', 'courses', 'courseLocations', 'courseLocationDates',
  'licenses', 'bookings', 'jobListings', 'jobApplications', 'reviews', 'notifications', 'settings'];

// ── run ───────────────────────────────────────────────────────────────────
/** One attempt at the whole import, inside a single transaction. */
async function runImport(groups) {
  await db.withTransaction(async (trx) => {
    const maps = {
      users: await loadMap(trx, 'users'),
      locations: await loadMap(trx, 'locations'),
      courses: await loadMap(trx, 'courses'),
      courseLocations: await loadMap(trx, 'course_locations'),
      courseLocationDates: await loadMap(trx, 'course_location_dates'),
      licenses: await loadMap(trx, 'licenses'),
      bookings: await loadMap(trx, 'bookings'),
      jobListings: await loadMap(trx, 'job_listings'),
      jobApplications: await loadMap(trx, 'job_applications'),
      reviews: await loadMap(trx, 'reviews'),
      notifications: await loadMap(trx, 'notifications'),
      usersByEmail: new Map(),
      courseLocationPairs: new Map()
    };

    for (const row of await trx.query('SELECT id, email, legacy_id FROM users')) {
      maps.usersByEmail.set(String(row.email).toLowerCase(), row);
    }
    for (const row of await trx.query('SELECT id, course_id, location_id, legacy_id FROM course_locations')) {
      maps.courseLocationPairs.set(`${row.course_id}:${row.location_id}`, row);
    }

    for (const group of groups) {
      process.stdout.write(`  ${group} … `);
      try {
        await GROUPS[group](trx, maps);
      } catch (err) {
        // Said here, while the connection is still up: a failed rollback
        // would otherwise be the only error left to report.
        console.log('failed');
        console.error(`\n  ${group}: ${err.sqlMessage || err.message}`);
        if (err.sql) console.error(`  while running: ${String(err.sql).slice(0, 200)}`);
        throw err;
      }
      console.log('done');
    }

    // A dry run does the whole import and then undoes it, so what it
    // reports is what a real run would do.
    if (DRY_RUN) throw ROLLBACK;
  });
}

async function main() {
  if (!fs.existsSync(SNAPSHOT_DIR)) {
    console.error(`No snapshot at ${SNAPSHOT_DIR}.`);
    console.error('Run `node scripts/export_for_mysql.js` in the previous backend first.');
    process.exit(1);
  }

  const unknown = ONLY.filter(g => !ORDER.includes(g));
  if (unknown.length) {
    console.error(`Not a group: ${unknown.join(', ')}`);
    console.error(`Choose from: ${ORDER.join(', ')}`);
    process.exit(1);
  }
  const groups = ONLY.length ? ORDER.filter(g => ONLY.includes(g)) : ORDER;

  const manifestFile = path.join(SNAPSHOT_DIR, '_manifest.json');
  if (fs.existsSync(manifestFile)) {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    console.log(`Snapshot of "${manifest.database}" taken ${manifest.exportedAt}\n`);
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      report.length = 0;
      notes.length = 0;
      console.log(`\n  the connection dropped — starting again (attempt ${attempt} of ${MAX_ATTEMPTS})\n`);
    }
    try {
      await runImport(groups);
      break;
    } catch (err) {
      if (err === ROLLBACK) break;
      if (isTransient(err) && attempt < MAX_ATTEMPTS) continue;
      console.error(`\nImport failed, nothing was written: ${err.sqlMessage || err.message}`);
      if (err.sql) console.error(`  while running: ${String(err.sql).slice(0, 200)}`);
      process.exit(1);
    }
  }

  console.log(`\n${'group'.padEnd(22)}${'new'.padStart(6)}${'updated'.padStart(9)}${'linked'.padStart(8)}${'skipped'.padStart(9)}`);
  console.log('-'.repeat(54));
  for (const row of report) {
    console.log(row.group.padEnd(22) + String(row.inserted).padStart(6) + String(row.updated).padStart(9) +
      String(row.linked).padStart(8) + String(row.skipped).padStart(9));
  }

  if (notes.length) {
    console.log('\nWorth knowing:');
    notes.forEach(n => console.log(`  - ${n}`));
  }

  console.log(DRY_RUN
    ? '\nDry run — everything above was undone. Run again without --dry-run to keep it.'
    : '\nImport complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error(`Import failed: ${err.message}`);
  process.exit(1);
});
