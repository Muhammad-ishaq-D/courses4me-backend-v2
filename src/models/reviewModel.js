const db = require('../config/db');

const SELECT = 'id, user_id, course_id, course_type, booking_id, rating, comment, created_at, updated_at';

function toPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    _id: String(row.id),
    user: String(row.user_id),
    course: String(row.course_id),
    courseModel: row.course_type,
    booking: row.booking_id === null ? null : String(row.booking_id),
    rating: row.rating,
    comment: row.comment,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const ReviewModel = {
  toPublic,

  async findById(id) {
    const rows = await db.query(`SELECT ${SELECT} FROM reviews WHERE id = ? LIMIT 1`, [id]);
    return rows[0] || null;
  },

  /** The review this customer already left for this course, if any. */
  async findByUserAndCourse(userId, courseId, courseType = 'Course') {
    const rows = await db.query(
      `SELECT ${SELECT} FROM reviews WHERE user_id = ? AND course_id = ? AND course_type = ? LIMIT 1`,
      [userId, courseId, courseType]
    );
    return rows[0] || null;
  },

  async findForUser(userId) {
    return db.query(`SELECT ${SELECT} FROM reviews WHERE user_id = ? ORDER BY created_at DESC, id DESC`, [userId]);
  },

  async findForCourse(courseId, courseType = 'Course') {
    return db.query(
      `SELECT ${SELECT} FROM reviews WHERE course_id = ? AND course_type = ? ORDER BY created_at DESC, id DESC`,
      [courseId, courseType]
    );
  },

  /**
   * Writes the review, replacing the customer's previous one for the same
   * course. One statement, so two submissions at once cannot both insert.
   */
  async save({ userId, courseId, courseType, bookingId, rating, comment }) {
    await db.query(
      `INSERT INTO reviews (user_id, course_id, course_type, booking_id, rating, comment)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE booking_id = VALUES(booking_id), rating = VALUES(rating), comment = VALUES(comment)`,
      [userId, courseId, courseType, bookingId ?? null, rating, comment ?? null]
    );
    return ReviewModel.findByUserAndCourse(userId, courseId, courseType);
  },

  /** Average rating and count per course: { [courseId]: { average, count } } */
  async statsForCourses(courseIds, courseType = 'Course') {
    const map = {};
    if (!courseIds.length) return map;
    const rows = await db.query(
      `SELECT course_id, AVG(rating) AS average, COUNT(*) AS total
         FROM reviews WHERE course_id IN (?) AND course_type = ?
        GROUP BY course_id`,
      [courseIds, courseType]
    );
    for (const r of rows) {
      map[r.course_id] = { average: Math.round(Number(r.average) * 10) / 10, count: Number(r.total) };
    }
    return map;
  }
};

module.exports = ReviewModel;
