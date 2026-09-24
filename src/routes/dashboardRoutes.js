const express = require('express');
const DashboardController = require('../controllers/dashboardController');
const { protect, authorize } = require('../middlewares/authMiddleware');
const { validate } = require('../middlewares/validateMiddleware');
const validators = require('../validators');

const router = express.Router();
const adminOnly = [protect, authorize('admin')];

router.get('/', ...adminOnly, validate(validators.dashboard.stats, 'query'), DashboardController.getStats);
router.get('/analytics', ...adminOnly, DashboardController.getAnalytics);

module.exports = router;
