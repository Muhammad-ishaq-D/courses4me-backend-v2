const Review = require('../models/Review');
const Booking = require('../models/Booking');
const notifyAdmins = require('../utils/notifyAdmins');

// @desc    Create or update the logged-in user's review for a booking they've paid for
// @route   POST /api/reviews
// @access  Private
exports.createReview = async (req, res) => {
    try {
        const { bookingId, rating, comment } = req.body;

        if (!bookingId || !rating) {
            return res.status(400).json({ success: false, message: 'bookingId and rating are required.' });
        }
        if (rating < 1 || rating > 5) {
            return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5.' });
        }

        // Only the customer who paid for this booking may review the course it's for
        const booking = await Booking.findOne({
            _id: bookingId,
            user: req.user._id,
            status: 'PAID'
        }).populate('course', 'title');

        if (!booking) {
            return res.status(403).json({ success: false, message: 'You can only review courses you have booked and paid for.' });
        }

        const existingReview = await Review.findOne({ user: req.user._id, course: booking.course._id || booking.course });

        const review = await Review.findOneAndUpdate(
            { user: req.user._id, course: booking.course._id || booking.course },
            {
                user: req.user._id,
                course: booking.course._id || booking.course,
                courseModel: booking.courseModel,
                booking: booking._id,
                rating,
                comment
            },
            { upsert: true, new: true, runValidators: true }
        );

        if (!existingReview) {
            try {
                await notifyAdmins({
                    settingKey: 'courseReview',
                    title: 'Course Review Submitted',
                    message: `${req.user.name} left a ${rating}-star review for ${booking.course?.title || 'a course'}.`,
                    type: 'system'
                });
            } catch (notifErr) {
                console.error('Notification Error (Course Review Submitted):', notifErr);
            }
        }

        res.status(existingReview ? 200 : 201).json({ success: true, data: review });
    } catch (error) {
        console.error('createReview error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get the logged-in user's own reviews
// @route   GET /api/reviews/my
// @access  Private
exports.getMyReviews = async (req, res) => {
    try {
        const reviews = await Review.find({ user: req.user._id });
        res.status(200).json({ success: true, data: reviews });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
