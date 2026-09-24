const ReviewModel = require('../models/reviewModel');
const BookingModel = require('../models/bookingModel');
const notifyAdmins = require('../utils/notifyAdmins');
const { findCourse } = require('../services/bookingService');

const ReviewController = {
  // @desc    Leave or update a review for a course the customer has paid for
  // @route   POST /api/reviews
  // @access  Private
  async create(req, res, next) {
    try {
      const { bookingId, rating, comment } = req.body;

      // Only the customer who paid for the booking may review its course.
      const booking = await BookingModel.findById(bookingId);
      if (!booking || String(booking.user_id) !== String(req.user.id) || booking.status !== 'PAID') {
        return res.status(403).json({ success: false, message: 'You can only review courses you have booked and paid for.' });
      }

      const existing = await ReviewModel.findByUserAndCourse(req.user.id, booking.course_id, booking.course_type);
      const row = await ReviewModel.save({
        userId: req.user.id,
        courseId: booking.course_id,
        courseType: booking.course_type,
        bookingId: booking.id,
        rating,
        comment
      });

      if (!existing) {
        const course = await findCourse(booking.course_id, booking.course_type);
        await notifyAdmins({
          settingKey: 'courseReview',
          title: 'Course Review Submitted',
          message: `${req.user.name} left a ${rating}-star review for ${course?.title || 'a course'}.`,
          type: 'system'
        });
      }

      res.status(existing ? 200 : 201).json({ success: true, data: ReviewModel.toPublic(row) });
    } catch (error) {
      next(error);
    }
  },

  // @desc    The signed-in customer's own reviews
  // @route   GET /api/reviews/my
  // @access  Private
  async getMine(req, res, next) {
    try {
      const rows = await ReviewModel.findForUser(req.user.id);
      res.status(200).json({ success: true, data: rows.map(ReviewModel.toPublic) });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = ReviewController;
