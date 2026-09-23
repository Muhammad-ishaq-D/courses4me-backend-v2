/**
 * Locations and the course scheduling system.
 *
 * locations                     training venues managed in the admin panel.
 * location_facilities           the facilities checklist of a venue.
 * location_gallery              ordered gallery images of a venue.
 * course_locations              a course offered at a location, with its own
 *                               price and deposit terms (unique per pair).
 * course_location_dates         the dated sessions of that pairing, with seat
 *                               counts.
 * course_location_date_timings  per-weekday times, used when a session runs
 *                               on a flexible timetable.
 *
 * Also adds the foreign key from courses.location_id, which was left without
 * one while this table did not exist.
 */

async function hasIndex(knex, table, index) {
  const [rows] = await knex.raw(
    'SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1',
    [table, index]
  );
  return rows.length > 0;
}

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('locations'))) {
    await knex.raw(`
      CREATE TABLE locations (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL,
        venue_name VARCHAR(255) DEFAULT NULL,
        address_line1 VARCHAR(255) NOT NULL,
        address_line2 VARCHAR(255) DEFAULT NULL,
        city VARCHAR(120) NOT NULL,
        postcode VARCHAR(20) NOT NULL,
        country VARCHAR(100) NOT NULL DEFAULT 'United Kingdom',
        maps_url VARCHAR(1000) DEFAULT NULL,
        parking TINYINT(1) NOT NULL DEFAULT 0,
        parking_notes TEXT DEFAULT NULL,
        accessibility TEXT DEFAULT NULL,
        transport TEXT DEFAULT NULL,
        main_image VARCHAR(500) DEFAULT NULL,
        local_market_overview TEXT DEFAULT NULL,
        local_venues TEXT DEFAULT NULL,
        surrounding_areas TEXT DEFAULT NULL,
        status ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
        legacy_id CHAR(24) DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_locations_legacy_id (legacy_id),
        KEY idx_locations_status (status),
        KEY idx_locations_city (city),
        KEY idx_locations_postcode (postcode),
        KEY idx_locations_created_at (created_at),
        FULLTEXT KEY ft_locations_search (name, venue_name, city)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  if (!(await knex.schema.hasTable('location_facilities'))) {
    await knex.raw(`
      CREATE TABLE location_facilities (
        location_id INT UNSIGNED NOT NULL,
        facility ENUM('wifi','projector','whiteboard','catering','toilets','disabled_access','prayer_room','air_conditioning') NOT NULL,
        PRIMARY KEY (location_id, facility),
        CONSTRAINT fk_location_facilities_location FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  if (!(await knex.schema.hasTable('location_gallery'))) {
    await knex.raw(`
      CREATE TABLE location_gallery (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        location_id INT UNSIGNED NOT NULL,
        position INT UNSIGNED NOT NULL DEFAULT 0,
        url VARCHAR(500) NOT NULL,
        PRIMARY KEY (id),
        KEY idx_location_gallery_location (location_id, position),
        CONSTRAINT fk_location_gallery_location FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  if (!(await knex.schema.hasTable('course_locations'))) {
    await knex.raw(`
      CREATE TABLE course_locations (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        course_id INT UNSIGNED NOT NULL,
        location_id INT UNSIGNED NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        vat_included TINYINT(1) NOT NULL DEFAULT 0,
        deposit_required TINYINT(1) NOT NULL DEFAULT 0,
        deposit_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        whats_included TEXT DEFAULT NULL,
        status ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
        legacy_id CHAR(24) DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_course_locations_pair (course_id, location_id),
        UNIQUE KEY uq_course_locations_legacy_id (legacy_id),
        KEY idx_course_locations_location_status (location_id, status),
        CONSTRAINT fk_course_locations_course FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
        CONSTRAINT fk_course_locations_location FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  if (!(await knex.schema.hasTable('course_location_dates'))) {
    await knex.raw(`
      CREATE TABLE course_location_dates (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        course_location_id INT UNSIGNED NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        start_time TIME NOT NULL DEFAULT '09:00:00',
        end_time TIME NOT NULL DEFAULT '17:00:00',
        available_seats INT UNSIGNED NOT NULL,
        booked_seats INT UNSIGNED NOT NULL DEFAULT 0,
        timings_type ENUM('same','flexible') NOT NULL DEFAULT 'same',
        legacy_id CHAR(24) DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_course_location_dates_legacy_id (legacy_id),
        KEY idx_course_location_dates_link (course_location_id, start_date),
        KEY idx_course_location_dates_start (start_date),
        CONSTRAINT fk_course_location_dates_link FOREIGN KEY (course_location_id) REFERENCES course_locations (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  if (!(await knex.schema.hasTable('course_location_date_timings'))) {
    await knex.raw(`
      CREATE TABLE course_location_date_timings (
        course_location_date_id INT UNSIGNED NOT NULL,
        day ENUM('monday','tuesday','wednesday','thursday','friday','saturday','sunday') NOT NULL,
        is_off TINYINT(1) NOT NULL DEFAULT 0,
        start_time TIME DEFAULT NULL,
        end_time TIME DEFAULT NULL,
        PRIMARY KEY (course_location_date_id, day),
        CONSTRAINT fk_date_timings_date FOREIGN KEY (course_location_date_id) REFERENCES course_location_dates (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  // courses.location_id could not reference a table that did not exist yet.
  if (!(await hasIndex(knex, 'courses', 'fk_courses_location'))) {
    await knex.raw('ALTER TABLE courses ADD CONSTRAINT fk_courses_location FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE SET NULL');
  }
};

exports.down = async function (knex) {
  if (await hasIndex(knex, 'courses', 'fk_courses_location')) {
    await knex.raw('ALTER TABLE courses DROP FOREIGN KEY fk_courses_location');
  }
  await knex.raw('DROP TABLE IF EXISTS course_location_date_timings');
  await knex.raw('DROP TABLE IF EXISTS course_location_dates');
  await knex.raw('DROP TABLE IF EXISTS course_locations');
  await knex.raw('DROP TABLE IF EXISTS location_gallery');
  await knex.raw('DROP TABLE IF EXISTS location_facilities');
  await knex.raw('DROP TABLE IF EXISTS locations');
};
