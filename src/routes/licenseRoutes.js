const express = require('express');
const LicenseController = require('../controllers/licenseController');
const { protect, authorize, optionalProtect } = require('../middlewares/authMiddleware');
const { validate } = require('../middlewares/validateMiddleware');
const parseJsonBody = require('../middlewares/parseJsonBody');
const validators = require('../validators');

const router = express.Router();
const license = validators.license;

// Nested fields arrive as JSON strings when the form also uploads files
const NESTED_FIELDS = ['pricing', 'locations', 'instructor', 'highlights', 'learningPoints', 'requirements', 'applicationSteps', 'pricingBreakdown', 'relatedCourses'];

// Public routes (optional auth: an admin also sees drafts and archived licences)
router.get('/', optionalProtect, validate(license.list, 'query'), LicenseController.getAll);
router.get('/:id', optionalProtect, validate(license.idParam, 'params'), LicenseController.getById);

// Admin routes
const adminOnly = [protect, authorize('admin')];
router.post('/', ...adminOnly, parseJsonBody(NESTED_FIELDS), validate(license.create), LicenseController.create);
router.put('/:id', ...adminOnly, parseJsonBody(NESTED_FIELDS), validate(license.idParam, 'params'), validate(license.update), LicenseController.update);
router.delete('/:id', ...adminOnly, validate(license.idParam, 'params'), LicenseController.delete);

module.exports = router;
