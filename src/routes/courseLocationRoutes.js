const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const {
    getAllCourseLocations, getCourseLocations, getCourseLocation, createCourseLocation,
    updateCourseLocation, deleteCourseLocation,
    addDate, updateDate, deleteDate
} = require('../controllers/courseLocationController');

// GET /api/course-locations  — all active links for published courses (public)
router.get('/', getAllCourseLocations);

// /api/course-locations/course/:courseId
router.get('/course/:courseId', getCourseLocations);
router.post('/course/:courseId', protect, authorize('admin'), createCourseLocation);

// /api/course-locations/:id
router.get('/:id', getCourseLocation);
router.put('/:id', protect, authorize('admin'), updateCourseLocation);
router.delete('/:id', protect, authorize('admin'), deleteCourseLocation);

// Dates nested under a course-location
router.post('/:id/dates', protect, authorize('admin'), addDate);

// /api/course-location-dates/:id  (separate path handled in app.js)
module.exports = router;
