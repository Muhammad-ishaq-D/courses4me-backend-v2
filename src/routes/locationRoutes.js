const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const {
    getLocations, getLocationById, createLocation,
    updateLocation, toggleStatus, getLinkedCourses
} = require('../controllers/locationController');

// Public — portal reads these
router.get('/', getLocations);
router.get('/:id', getLocationById);
router.get('/:id/courses', getLinkedCourses);

// Admin only
router.post('/', protect, authorize('admin'), createLocation);
router.put('/:id', protect, authorize('admin'), updateLocation);
router.patch('/:id/status', protect, authorize('admin'), toggleStatus);

module.exports = router;
