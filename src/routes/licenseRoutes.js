const express = require('express');
const {
    createLicense,
    getLicenses,
    getLicenseById,
    updateLicense,
    deleteLicense
} = require('../controllers/licenseController');
const { protect, authorize, optionalProtect } = require('../middlewares/authMiddleware');
const { validateLicense } = require('../middlewares/validators');

const router = express.Router();

// Public routes (with optional auth for status checking)
router.get('/', optionalProtect, getLicenses);
router.get('/:id', optionalProtect, getLicenseById);

// Protected routes (Only Admins can create, update, delete licenses)
router.post('/', protect, authorize('admin'), validateLicense, createLicense);
router.put('/:id', protect, authorize('admin'), validateLicense, updateLicense);
router.delete('/:id', protect, authorize('admin'), deleteLicense);

module.exports = router;
