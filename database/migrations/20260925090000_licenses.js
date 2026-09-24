/**
 * Licences: the SIA-style credentials sold alongside the courses.
 *
 * licenses                    the product itself, with its listing specs and
 *                             the credential details shown to the holder.
 * license_list_items          the ordered display lists (highlights, learning
 *                             points, requirements) in one table by `type`.
 * license_application_steps   "how to apply", in order.
 * license_pricing_breakdown   the fee table; the amounts are free text
 *                             ("£220", "Included") so they print as written.
 * license_related_courses     the courses that lead to this licence.
 * license_venues              venues the licence is taught at, with their
 * license_venue_schedules     dated sessions — the same shape as a course's
 *                             own venues, because a licence can be booked.
 *
 * `bookings.session_schedule_source` gains the licence option so a booking can
 * point at one of these sessions.
 */

async function columnType(knex, table, column) {
  const [rows] = await knex.raw(
    'SELECT column_type FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
    [table, column]
  );
  return rows.length ? rows[0].column_type : null;
}

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('licenses'))) {
    await knex.raw(`
      CREATE TABLE licenses (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        title VARCHAR(255) NOT NULL,
        license_type VARCHAR(150) NOT NULL DEFAULT 'Security Guard',
        category ENUM('SIA Training','First Aid','Health & Safety','Specialist') NOT NULL DEFAULT 'SIA Training',
        subtitle VARCHAR(255) DEFAULT NULL,
        short_description TEXT NOT NULL,
        full_description LONGTEXT NOT NULL,
        thumbnail VARCHAR(500) DEFAULT NULL,

        salary VARCHAR(100) DEFAULT NULL,
        duration VARCHAR(100) DEFAULT NULL,
        valid VARCHAR(100) DEFAULT NULL,
        experience VARCHAR(100) NOT NULL DEFAULT '5 Years',
        training_count VARCHAR(100) NOT NULL DEFAULT '12 Courses',
        rating VARCHAR(20) NOT NULL DEFAULT '4.9/5',
        renewal_info TEXT DEFAULT NULL,

        base_price DECIMAL(10,2) NOT NULL,
        sale_price DECIMAL(10,2) DEFAULT NULL,
        original_price DECIMAL(10,2) DEFAULT NULL,

        instructor_name VARCHAR(150) DEFAULT NULL,
        instructor_title VARCHAR(150) DEFAULT NULL,
        instructor_bio TEXT DEFAULT NULL,
        instructor_photo VARCHAR(500) DEFAULT NULL,

        status ENUM('Published','Draft','Archived') NOT NULL DEFAULT 'Draft',
        is_popular TINYINT(1) NOT NULL DEFAULT 0,
        icon VARCHAR(60) NOT NULL DEFAULT 'shield',
        icon_color VARCHAR(60) NOT NULL DEFAULT 'bg-blue-600',

        license_number VARCHAR(60) DEFAULT NULL,
        holder_name VARCHAR(150) DEFAULT NULL,
        email VARCHAR(190) DEFAULT NULL,
        license_authority VARCHAR(190) NOT NULL DEFAULT 'SIA (Security Industry Authority)',
        holder_id VARCHAR(60) DEFAULT NULL,
        expiry_date DATE DEFAULT NULL,

        legacy_id CHAR(24) DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_licenses_legacy_id (legacy_id),
        KEY idx_licenses_status_category (status, category),
        KEY idx_licenses_created_at (created_at),
        KEY idx_licenses_number (license_number),
        FULLTEXT KEY ft_licenses_search (title, holder_name, license_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  if (!(await knex.schema.hasTable('license_list_items'))) {
    await knex.raw(`
      CREATE TABLE license_list_items (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        license_id INT UNSIGNED NOT NULL,
        type ENUM('highlight','learning_point','requirement') NOT NULL,
        position INT UNSIGNED NOT NULL DEFAULT 0,
        value VARCHAR(1000) NOT NULL,
        PRIMARY KEY (id),
        KEY idx_license_list_license_type (license_id, type, position),
        CONSTRAINT fk_license_list_license FOREIGN KEY (license_id) REFERENCES licenses (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  if (!(await knex.schema.hasTable('license_application_steps'))) {
    await knex.raw(`
      CREATE TABLE license_application_steps (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        license_id INT UNSIGNED NOT NULL,
        position INT UNSIGNED NOT NULL DEFAULT 0,
        title VARCHAR(255) DEFAULT NULL,
        description TEXT DEFAULT NULL,
        PRIMARY KEY (id),
        KEY idx_license_steps_license (license_id, position),
        CONSTRAINT fk_license_steps_license FOREIGN KEY (license_id) REFERENCES licenses (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  if (!(await knex.schema.hasTable('license_pricing_breakdown'))) {
    await knex.raw(`
      CREATE TABLE license_pricing_breakdown (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        license_id INT UNSIGNED NOT NULL,
        position INT UNSIGNED NOT NULL DEFAULT 0,
        label VARCHAR(255) DEFAULT NULL,
        price VARCHAR(100) DEFAULT NULL,
        PRIMARY KEY (id),
        KEY idx_license_pricing_license (license_id, position),
        CONSTRAINT fk_license_pricing_license FOREIGN KEY (license_id) REFERENCES licenses (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  if (!(await knex.schema.hasTable('license_related_courses'))) {
    await knex.raw(`
      CREATE TABLE license_related_courses (
        license_id INT UNSIGNED NOT NULL,
        course_id INT UNSIGNED NOT NULL,
        position INT UNSIGNED NOT NULL DEFAULT 0,
        PRIMARY KEY (license_id, course_id),
        KEY idx_license_related_course (course_id),
        CONSTRAINT fk_license_related_license FOREIGN KEY (license_id) REFERENCES licenses (id) ON DELETE CASCADE,
        CONSTRAINT fk_license_related_course FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  if (!(await knex.schema.hasTable('license_venues'))) {
    await knex.raw(`
      CREATE TABLE license_venues (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        license_id INT UNSIGNED NOT NULL,
        position INT UNSIGNED NOT NULL DEFAULT 0,
        name VARCHAR(255) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_license_venues_license (license_id, position),
        CONSTRAINT fk_license_venues_license FOREIGN KEY (license_id) REFERENCES licenses (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  if (!(await knex.schema.hasTable('license_venue_schedules'))) {
    await knex.raw(`
      CREATE TABLE license_venue_schedules (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        license_venue_id INT UNSIGNED NOT NULL,
        position INT UNSIGNED NOT NULL DEFAULT 0,
        time VARCHAR(100) NOT NULL DEFAULT '09:00 - 17:00',
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        seats_available INT NOT NULL DEFAULT 20,
        availability_status ENUM('Available','Selling Fast','Sold Out') NOT NULL DEFAULT 'Available',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_license_schedules_venue (license_venue_id, position),
        KEY idx_license_schedules_start (start_date),
        CONSTRAINT fk_license_schedules_venue FOREIGN KEY (license_venue_id) REFERENCES license_venues (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  // A booking can now hold a seat on a licence session.
  const sourceType = await columnType(knex, 'bookings', 'session_schedule_source');
  if (sourceType && !sourceType.includes('license_venue_schedule')) {
    await knex.raw(
      "ALTER TABLE bookings MODIFY session_schedule_source ENUM('course_location_date','course_venue_schedule','license_venue_schedule') DEFAULT NULL"
    );
  }
};

exports.down = async function (knex) {
  const sourceType = await columnType(knex, 'bookings', 'session_schedule_source');
  if (sourceType && sourceType.includes('license_venue_schedule')) {
    await knex.raw("UPDATE bookings SET session_schedule_source = NULL WHERE session_schedule_source = 'license_venue_schedule'");
    await knex.raw(
      "ALTER TABLE bookings MODIFY session_schedule_source ENUM('course_location_date','course_venue_schedule') DEFAULT NULL"
    );
  }
  await knex.raw('DROP TABLE IF EXISTS license_venue_schedules');
  await knex.raw('DROP TABLE IF EXISTS license_venues');
  await knex.raw('DROP TABLE IF EXISTS license_related_courses');
  await knex.raw('DROP TABLE IF EXISTS license_pricing_breakdown');
  await knex.raw('DROP TABLE IF EXISTS license_application_steps');
  await knex.raw('DROP TABLE IF EXISTS license_list_items');
  await knex.raw('DROP TABLE IF EXISTS licenses');
};
