const express = require('express');
const AdminAuthController = require('../controllers/adminAuthController');
const AuthController = require('../controllers/authController');
const { validate } = require('../middlewares/validateMiddleware');
const validators = require('../validators');

const router = express.Router();
const auth = validators.auth;

// Admin panel authentication (login is shared with the customer flow; the
// controller uses the /admin/ prefix to accept only admin/editor accounts).
router.post('/login', validate(auth.login), AuthController.login);
router.post('/forgot-password', validate(auth.forgotPassword), AdminAuthController.forgotPassword);
router.post('/verify-otp', validate(auth.verifyOtp), AdminAuthController.verifyOtp);
router.post('/reset-password', validate(auth.resetPassword), AdminAuthController.resetPassword);

module.exports = router;
