/**
 * Courses module.
 *
 * courses                 one row per course; pricing, instructor and guarantee
 *                         are flattened into prefixed columns.
 * course_list_items       the ordered display lists (highlights, learning
 *                         points, target audience, requirements) in one table
 *                         keyed by `type`.
 * course_venues           venues attached directly to a course, with the
 *                         coordinates resolved from the postcode.
 * course_venue_schedules  the dated sessions of a course venue.
 *
 * `courses.location_id` points at the locations module and is left without a
 * foreign key until that table exists.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('courses'))) {
    await knex.raw(`
      CREATE TABLE courses (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        title VARCHAR(255) NOT NULL,
        category ENUM('SIA Training','Specialist','First Aid','Health & Safety','Hospitality') NOT NULL,
        subtitle VARCHAR(255) DEFAULT NULL,
        level VARCHAR(50) NOT NULL DEFAULT 'Level 2',
        duration VARCHAR(100) NOT NULL,
        reviews_count VARCHAR(50) NOT NULL DEFAULT '1,000+',
        booked_count VARCHAR(50) NOT NULL DEFAULT '500+',
        pass_rate VARCHAR(50) NOT NULL DEFAULT '98%',
        short_description TEXT NOT NULL,
        full_description LONGTEXT NOT NULL,
        guarantee_title VARCHAR(150) NOT NULL DEFAULT 'Training Guarantee',
        guarantee_description VARCHAR(500) NOT NULL DEFAULT 'Free exam retakes if you don''t pass first time',
        thumbnail VARCHAR(500) DEFAULT NULL,
        base_price DECIMAL(10,2) NOT NULL,
        sale_price DECIMAL(10,2) DEFAULT NULL,
        original_price DECIMAL(10,2) DEFAULT NULL,
        location_id INT UNSIGNED DEFAULT NULL,
        center_id VARCHAR(64) DEFAULT NULL,
        center_name VARCHAR(255) DEFAULT NULL,
        instructor_name VARCHAR(150) DEFAULT NULL,
        instructor_title VARCHAR(150) DEFAULT NULL,
        instructor_bio TEXT DEFAULT NULL,
        instructor_photo VARCHAR(500) DEFAULT NULL,
        status ENUM('Published','Draft','Archived') NOT NULL DEFAULT 'Draft',
        is_popular TINYINT(1) NOT NULL DEFAULT 0,
        legacy_id CHAR(24) DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_courses_legacy_id (legacy_id),
        KEY idx_courses_status_category (status, category),
        KEY idx_courses_created_at (created_at),
        KEY idx_courses_location (location_id),
        FULLTEXT KEY ft_courses_search (title, short_description)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  if (!(await knex.schema.hasTable('course_list_items'))) {
    await knex.raw(`
      CREATE TABLE course_list_items (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        course_id INT UNSIGNED NOT NULL,
        type ENUM('highlight','learning_point','target_audience','requirement') NOT NULL,
        position INT UNSIGNED NOT NULL DEFAULT 0,
        value VARCHAR(1000) NOT NULL,
        PRIMARY KEY (id),
        KEY idx_course_list_course_type (course_id, type, position),
        CONSTRAINT fk_course_list_course FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  if (!(await knex.schema.hasTable('course_venues'))) {
    await knex.raw(`
      CREATE TABLE course_venues (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        course_id INT UNSIGNED NOT NULL,
        position INT UNSIGNED NOT NULL DEFAULT 0,
        name VARCHAR(255) NOT NULL,
        address VARCHAR(500) DEFAULT NULL,
        postcode VARCHAR(20) NOT NULL,
        latitude DECIMAL(10,7) DEFAULT NULL,
        longitude DECIMAL(10,7) DEFAULT NULL,
        parking_main VARCHAR(255) DEFAULT NULL,
        parking_sub VARCHAR(255) DEFAULT NULL,
        commute_main VARCHAR(255) DEFAULT NULL,
        commute_sub VARCHAR(255) DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_course_venues_course (course_id, position),
        KEY idx_course_venues_postcode (postcode),
        CONSTRAINT fk_course_venues_course FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  if (!(await knex.schema.hasTable('course_venue_schedules'))) {
    await knex.raw(`
      CREATE TABLE course_venue_schedules (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        course_venue_id INT UNSIGNED NOT NULL,
        position INT UNSIGNED NOT NULL DEFAULT 0,
        time VARCHAR(100) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        seats_available INT NOT NULL DEFAULT 20,
        availability_status ENUM('Available','Selling Fast','Sold Out') NOT NULL DEFAULT 'Available',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_course_schedules_venue (course_venue_id, position),
        KEY idx_course_schedules_start (start_date),
        CONSTRAINT fk_course_schedules_venue FOREIGN KEY (course_venue_id) REFERENCES course_venues (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
};

exports.down = async function (knex) {
  await knex.raw('DROP TABLE IF EXISTS course_venue_schedules');
  await knex.raw('DROP TABLE IF EXISTS course_venues');
  await knex.raw('DROP TABLE IF EXISTS course_list_items');
  await knex.raw('DROP TABLE IF EXISTS courses');
};
