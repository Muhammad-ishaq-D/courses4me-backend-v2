/**
 * Course reviews.
 *
 * One review per customer per course, so submitting again updates the review
 * they already left (`uq_reviews_user_course`). `course_id` is not a foreign
 * key because a review can be about a course or a licence, named by
 * `course_type`, the same pair a booking stores.
 *
 * The booking the review came from is kept so the review can be traced back
 * to the purchase that earned it.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('reviews'))) {
    await knex.raw(`
      CREATE TABLE reviews (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id INT UNSIGNED NOT NULL,
        course_id INT UNSIGNED NOT NULL,
        course_type ENUM('Course','License') NOT NULL DEFAULT 'Course',
        booking_id INT UNSIGNED DEFAULT NULL,
        rating TINYINT UNSIGNED NOT NULL,
        comment VARCHAR(1000) DEFAULT NULL,
        legacy_id CHAR(24) DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_reviews_user_course (user_id, course_id, course_type),
        UNIQUE KEY uq_reviews_legacy_id (legacy_id),
        KEY idx_reviews_course (course_id, course_type),
        KEY idx_reviews_booking (booking_id),
        CONSTRAINT chk_reviews_rating CHECK (rating BETWEEN 1 AND 5),
        CONSTRAINT fk_reviews_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT fk_reviews_booking FOREIGN KEY (booking_id) REFERENCES bookings (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
};

exports.down = async function (knex) {
  await knex.raw('DROP TABLE IF EXISTS reviews');
};
