const express = require('express');
const {
    createCourse,
    getCourses,
    getCourseById,
    updateCourse,
    deleteCourse,
    getCategoryStats
} = require('../controllers/courseController');
const { getUserEnrolledCourses } = require('../controllers/bookingController');
const { protect, authorize, optionalProtect } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/uploadMiddleware');
const { validateCourse } = require('../middlewares/validators');

const router = express.Router();

// Public routes (with optional auth for status filtering)
router.get('/stats/categories', optionalProtect, getCategoryStats);
router.get('/', optionalProtect, getCourses);
router.get('/:id', optionalProtect, getCourseById);

// Protected routes
router.get('/user/enrolled', protect, getUserEnrolledCourses);

// Protected routes (Only Admins can create, update, delete)
router.post('/', protect, authorize('admin'), upload.fields([
    { name: 'thumbnail', maxCount: 1 },
    { name: 'instructorPhoto', maxCount: 1 }
]), validateCourse, createCourse);

router.put('/:id', protect, authorize('admin'), upload.fields([
    { name: 'thumbnail', maxCount: 1 },
    { name: 'instructorPhoto', maxCount: 1 }
]), validateCourse, updateCourse);

router.delete('/:id', protect, authorize('admin'), deleteCourse);

module.exports = router;
