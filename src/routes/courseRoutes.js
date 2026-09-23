const express = require('express');
const CourseController = require('../controllers/courseController');
const BookingController = require('../controllers/bookingController');
const { protect, authorize, optionalProtect } = require('../middlewares/authMiddleware');
const { validate } = require('../middlewares/validateMiddleware');
const parseJsonBody = require('../middlewares/parseJsonBody');
const upload = require('../middlewares/uploadMiddleware');
const validators = require('../validators');

const router = express.Router();
const course = validators.course;

// Nested fields arrive as JSON strings when the form also uploads files
const NESTED_FIELDS = ['pricing', 'locations', 'instructor', 'guarantee', 'highlights', 'learningPoints', 'targetAudience', 'requirements'];

const uploadImages = upload.fields([
  { name: 'thumbnail', maxCount: 1 },
  { name: 'instructorPhoto', maxCount: 1 }
]);

// Public routes (optional auth: an admin also sees drafts and archived courses)
router.get('/stats/categories', optionalProtect, CourseController.getCategoryStats);
router.get('/', optionalProtect, validate(course.list, 'query'), CourseController.getAll);
// Declared before /:id so the literal path is not swallowed by the id route
// The student dashboard reads its enrolled courses from the bookings module
router.get('/user/enrolled', protect, BookingController.getUserEnrolledCourses);

router.get('/:id', optionalProtect, validate(course.idParam, 'params'), CourseController.getById);

// Admin routes
const adminOnly = [protect, authorize('admin')];
router.post('/', ...adminOnly, uploadImages, parseJsonBody(NESTED_FIELDS), validate(course.create), CourseController.create);
router.put('/:id', ...adminOnly, uploadImages, parseJsonBody(NESTED_FIELDS), validate(course.idParam, 'params'), validate(course.update), CourseController.update);
router.delete('/:id', ...adminOnly, validate(course.idParam, 'params'), CourseController.delete);

module.exports = router;
