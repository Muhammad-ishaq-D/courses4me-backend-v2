/**
 * The jobs board.
 *
 * job_listings               a vacancy, with the career it maps to.
 * job_listing_requirements   the ordered "what we're looking for" list.
 * job_applications           one application per candidate per vacancy. The
 *                            job title is copied onto the row so an
 *                            application still reads correctly after the
 *                            vacancy is edited or removed, which is also why
 *                            `job_listing_id` is nullable with ON DELETE SET
 *                            NULL. `user_id` is null for a guest application.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('job_listings'))) {
    await knex.raw(`
      CREATE TABLE job_listings (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        title VARCHAR(255) NOT NULL,
        company VARCHAR(255) NOT NULL,
        location VARCHAR(255) NOT NULL,
        type ENUM('Full-time','Part-time','Contract','Internship','Remote') NOT NULL DEFAULT 'Full-time',
        category ENUM(
          'SIA Training','First Aid','Health & Safety','Specialist',
          'Security Officer','Door Supervisor','Event Security','CCTV Operator','Close Protection',
          'First Aider','Paediatric First Aider',
          'Safety Inspector','Risk Assessor',
          'Security Manager'
        ) NOT NULL DEFAULT 'SIA Training',
        career VARCHAR(150) NOT NULL DEFAULT '',
        salary VARCHAR(150) NOT NULL,
        description LONGTEXT NOT NULL,
        status ENUM('Active','Paused','Closed') NOT NULL DEFAULT 'Active',
        is_featured TINYINT(1) NOT NULL DEFAULT 0,
        legacy_id CHAR(24) DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_job_listings_legacy_id (legacy_id),
        KEY idx_job_listings_status_category (status, category),
        KEY idx_job_listings_type (type),
        KEY idx_job_listings_created_at (created_at),
        FULLTEXT KEY ft_job_listings_search (title, company, description)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  if (!(await knex.schema.hasTable('job_listing_requirements'))) {
    await knex.raw(`
      CREATE TABLE job_listing_requirements (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        job_listing_id INT UNSIGNED NOT NULL,
        position INT UNSIGNED NOT NULL DEFAULT 0,
        value VARCHAR(1000) NOT NULL,
        PRIMARY KEY (id),
        KEY idx_job_requirements_listing (job_listing_id, position),
        CONSTRAINT fk_job_requirements_listing FOREIGN KEY (job_listing_id) REFERENCES job_listings (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  if (!(await knex.schema.hasTable('job_applications'))) {
    await knex.raw(`
      CREATE TABLE job_applications (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        application_reference VARCHAR(20) NOT NULL,
        job_listing_id INT UNSIGNED DEFAULT NULL,
        job_title VARCHAR(255) NOT NULL,
        user_id INT UNSIGNED DEFAULT NULL,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        applicant_name VARCHAR(201) NOT NULL,
        email VARCHAR(190) NOT NULL,
        phone VARCHAR(30) NOT NULL,
        address VARCHAR(500) NOT NULL,
        city VARCHAR(120) NOT NULL,
        postcode VARCHAR(20) NOT NULL,
        license VARCHAR(150) NOT NULL,
        experience VARCHAR(150) NOT NULL,
        availability VARCHAR(150) NOT NULL,
        cover LONGTEXT NOT NULL,
        cv_file VARCHAR(500) NOT NULL DEFAULT 'cv_resume.pdf',
        status ENUM('Pending','Shortlisted','Interview','Rejected','Accepted') NOT NULL DEFAULT 'Pending',
        legacy_id CHAR(24) DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_job_applications_reference (application_reference),
        UNIQUE KEY uq_job_applications_legacy_id (legacy_id),
        KEY idx_job_applications_listing (job_listing_id),
        KEY idx_job_applications_user (user_id),
        KEY idx_job_applications_email (email),
        KEY idx_job_applications_status_created (status, created_at),
        CONSTRAINT fk_job_applications_listing FOREIGN KEY (job_listing_id) REFERENCES job_listings (id) ON DELETE SET NULL,
        CONSTRAINT fk_job_applications_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
};

exports.down = async function (knex) {
  await knex.raw('DROP TABLE IF EXISTS job_applications');
  await knex.raw('DROP TABLE IF EXISTS job_listing_requirements');
  await knex.raw('DROP TABLE IF EXISTS job_listings');
};
