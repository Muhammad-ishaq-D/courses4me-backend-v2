const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');

// For now, no auth middleware applied to match existing public routes or basic structure.
// If needed, we can add `passport.authenticate('jwt', { session: false })`
router.get('/', dashboardController.getDashboardStats);
router.get('/analytics', dashboardController.getAnalytics);

module.exports = router;
