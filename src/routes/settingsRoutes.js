const express = require('express');
const SettingsController = require('../controllers/settingsController');
const { protect, authorize } = require('../middlewares/authMiddleware');
const { validate } = require('../middlewares/validateMiddleware');
const validators = require('../validators');

const router = express.Router();
const adminOnly = [protect, authorize('admin')];

router.get('/', ...adminOnly, SettingsController.get);
router.put('/', ...adminOnly, validate(validators.settings.update), SettingsController.update);

module.exports = router;
