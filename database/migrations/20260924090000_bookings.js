/**
 * Bookings and payments.
 *
 * bookings                      one row per booking, with the session, customer
 *                               and billing details captured at the time of
 *                               booking, the payment state and the refund and
 *                               pending-reschedule blocks.
 * booking_extension_history     each time the end date was extended.
 * booking_reschedule_history    each time the course dates were moved.
 * booking_attendance            attendance marked per day.
 * booking_certificates          certificates issued for the booking.
 *
 * `session_schedule_id` points at whichever table the chosen session came
 * from, named by `session_schedule_source`: a scheduled date
 * (course_location_dates) or a venue schedule attached to the course
 * (course_venue_schedules). Both use their own id sequence, so the source has
 * to be stored — the id alone is ambiguous. No foreign key: a booking keeps
 * its history even after a schedule is removed.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('bookings'))) {
    await knex.raw(`
      CREATE TABLE bookings (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        booking_reference VARCHAR(20) NOT NULL,
        user_id INT UNSIGNED NOT NULL,
        course_id INT UNSIGNED NOT NULL,
        course_type ENUM('Course','License') NOT NULL DEFAULT 'Course',
        package_name VARCHAR(150) NOT NULL DEFAULT 'Standard',

        session_location_name VARCHAR(255) DEFAULT NULL,
        session_branch_name VARCHAR(255) DEFAULT NULL,
        session_schedule_id INT UNSIGNED DEFAULT NULL,
        session_schedule_source ENUM('course_location_date','course_venue_schedule') DEFAULT NULL,
        session_start_date DATETIME DEFAULT NULL,
        session_end_date DATETIME DEFAULT NULL,
        session_time VARCHAR(100) DEFAULT NULL,
        session_price DECIMAL(10,2) DEFAULT NULL,

        customer_first_name VARCHAR(100) NOT NULL,
        customer_last_name VARCHAR(100) NOT NULL,
        customer_email VARCHAR(190) NOT NULL,
        customer_phone VARCHAR(30) NOT NULL,
        customer_dob VARCHAR(30) DEFAULT NULL,

        billing_postcode VARCHAR(20) DEFAULT NULL,
        billing_line1 VARCHAR(255) DEFAULT NULL,
        billing_line2 VARCHAR(255) DEFAULT NULL,
        billing_city VARCHAR(100) DEFAULT NULL,

        option_easy_apply TINYINT(1) NOT NULL DEFAULT 0,
        additional_info TEXT DEFAULT NULL,
        total_amount DECIMAL(10,2) NOT NULL,
        currency CHAR(3) NOT NULL DEFAULT 'GBP',
        payment_method ENUM('card','paypal','instalments','klarna') NOT NULL DEFAULT 'card',
        payment_status ENUM('Pending','Paid','Failed','Refunded') NOT NULL DEFAULT 'Pending',
        stripe_session_id VARCHAR(255) DEFAULT NULL,
        payment_intent_id VARCHAR(255) DEFAULT NULL,
        status ENUM('PENDING','PAID','EXPIRED','CANCELLED') NOT NULL DEFAULT 'PENDING',
        lifecycle_status ENUM('Upcoming','Ongoing','Completed','Postponed','Cancelled','Extended') NOT NULL DEFAULT 'Upcoming',
        original_end_date DATETIME DEFAULT NULL,
        progress TINYINT UNSIGNED NOT NULL DEFAULT 0,

        refund_status ENUM('None','Requested','Approved','Rejected') NOT NULL DEFAULT 'None',
        refund_reason TEXT DEFAULT NULL,
        refund_requested_at DATETIME DEFAULT NULL,
        refund_processed_at DATETIME DEFAULT NULL,
        refund_admin_notes TEXT DEFAULT NULL,
        refund_id VARCHAR(255) DEFAULT NULL,
        refund_proof_url VARCHAR(500) DEFAULT NULL,

        pending_reschedule_start_date DATETIME DEFAULT NULL,
        pending_reschedule_end_date DATETIME DEFAULT NULL,
        pending_reschedule_reason TEXT DEFAULT NULL,
        pending_reschedule_status ENUM('Awaiting Payment','Paid') DEFAULT NULL,
        pending_reschedule_created_at DATETIME DEFAULT NULL,

        booking_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        legacy_id CHAR(24) DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

        PRIMARY KEY (id),
        UNIQUE KEY uq_bookings_reference (booking_reference),
        UNIQUE KEY uq_bookings_legacy_id (legacy_id),
        KEY idx_bookings_user_status (user_id, status),
        KEY idx_bookings_course (course_id, course_type),
        KEY idx_bookings_status_created (status, created_at),
        KEY idx_bookings_payment_status (payment_status),
        KEY idx_bookings_refund_status (refund_status),
        KEY idx_bookings_customer_email (customer_email),
        KEY idx_bookings_schedule (session_schedule_source, session_schedule_id),
        KEY idx_bookings_stripe_session (stripe_session_id),
        KEY idx_bookings_payment_intent (payment_intent_id),
        CONSTRAINT fk_bookings_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  if (!(await knex.schema.hasTable('booking_extension_history'))) {
    await knex.raw(`
      CREATE TABLE booking_extension_history (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        booking_id INT UNSIGNED NOT NULL,
        previous_end_date DATETIME DEFAULT NULL,
        new_end_date DATETIME DEFAULT NULL,
        reason TEXT DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_booking_extensions_booking (booking_id, created_at),
        CONSTRAINT fk_booking_extensions_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  if (!(await knex.schema.hasTable('booking_reschedule_history'))) {
    await knex.raw(`
      CREATE TABLE booking_reschedule_history (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        booking_id INT UNSIGNED NOT NULL,
        previous_start_date DATETIME DEFAULT NULL,
        new_start_date DATETIME DEFAULT NULL,
        previous_end_date DATETIME DEFAULT NULL,
        new_end_date DATETIME DEFAULT NULL,
        reason TEXT DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_booking_reschedules_booking (booking_id, created_at),
        CONSTRAINT fk_booking_reschedules_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  if (!(await knex.schema.hasTable('booking_attendance'))) {
    await knex.raw(`
      CREATE TABLE booking_attendance (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        booking_id INT UNSIGNED NOT NULL,
        date DATE DEFAULT NULL,
        status ENUM('Present','Absent','Late') NOT NULL DEFAULT 'Present',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_booking_attendance_booking (booking_id, date),
        CONSTRAINT fk_booking_attendance_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  if (!(await knex.schema.hasTable('booking_certificates'))) {
    await knex.raw(`
      CREATE TABLE booking_certificates (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        booking_id INT UNSIGNED NOT NULL,
        name VARCHAR(255) DEFAULT NULL,
        url VARCHAR(500) DEFAULT NULL,
        issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_booking_certificates_booking (booking_id),
        CONSTRAINT fk_booking_certificates_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
};

exports.down = async function (knex) {
  await knex.raw('DROP TABLE IF EXISTS booking_certificates');
  await knex.raw('DROP TABLE IF EXISTS booking_attendance');
  await knex.raw('DROP TABLE IF EXISTS booking_reschedule_history');
  await knex.raw('DROP TABLE IF EXISTS booking_extension_history');
  await knex.raw('DROP TABLE IF EXISTS bookings');
};
