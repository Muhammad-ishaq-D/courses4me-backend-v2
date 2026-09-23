const express = require('express');
const LocationController = require('../controllers/locationController');
const { protect, authorize } = require('../middlewares/authMiddleware');
const { validate } = require('../middlewares/validateMiddleware');
const validators = require('../validators');

const router = express.Router();
const location = validators.location;

// Public — the portal reads these
router.get('/', validate(location.list, 'query'), LocationController.getAll);
router.get('/:id', validate(location.idParam, 'params'), LocationController.getById);
router.get('/:id/courses', validate(location.idParam, 'params'), LocationController.getLinkedCourses);

// Admin only
const adminOnly = [protect, authorize('admin')];
router.post('/', ...adminOnly, validate(location.create), LocationController.create);
router.put('/:id', ...adminOnly, validate(location.idParam, 'params'), validate(location.update), LocationController.update);
router.patch('/:id/status', ...adminOnly, validate(location.idParam, 'params'), validate(location.setStatus), LocationController.toggleStatus);

module.exports = router;
