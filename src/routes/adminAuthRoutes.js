const express = require('express');
const { forgotPassword, verifyOtp, resetPassword } = require('../controllers/adminAuthController');
const { login } = require('../controllers/authController');

const router = express.Router();

router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/verify-otp', verifyOtp);
router.post('/reset-password', resetPassword);

module.exports = router;
