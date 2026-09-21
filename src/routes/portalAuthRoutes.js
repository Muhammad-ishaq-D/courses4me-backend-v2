const express = require('express');
const PortalAuthController = require('../controllers/portalAuthController');
const { validate } = require('../middlewares/validateMiddleware');
const validators = require('../validators');

const router = express.Router();
const auth = validators.auth;

// Customer portal password reset (emailed link flow)
router.post('/forgot-password', validate(auth.forgotPassword), PortalAuthController.forgotPassword);
router.post('/reset-password', validate(auth.resetPassword), PortalAuthController.resetPassword);

module.exports = router;
