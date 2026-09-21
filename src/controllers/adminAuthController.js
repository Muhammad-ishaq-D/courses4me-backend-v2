const UserModel = require('../models/userModel');
const resetService = require('../services/passwordResetService');

// Same wording whether or not the account exists (no account enumeration)
const GENERIC_SENT = 'If an account exists, a verification code has been sent.';
const GENERIC_INVALID = 'Invalid or expired verification code.';

/**
 * Admin panel password reset: forgot (OTP by email) -> verify-otp (returns a
 * single-use reset token) -> reset-password. Login is shared with the
 * customer flow (authController.login) and mounted at /api/admin/auth/login.
 */
const AdminAuthController = {
  // @route   POST /api/admin/auth/forgot-password
  // @access  Public
  async forgotPassword(req, res, next) {
    try {
      const user = await UserModel.findByEmail(req.body.email);
      if (!user || !resetService.isAdminRole(user.role)) {
        return res.status(200).json({ success: true, message: GENERIC_SENT });
      }

      if (!(await resetService.resetEmailsEnabled())) {
        return res.status(503).json({ success: false, message: 'Password reset emails are currently disabled. Please contact support.' });
      }

      await resetService.issueOtp(user, req); // delivery runs in the background
      res.status(200).json({ success: true, message: GENERIC_SENT });
    } catch (error) {
      next(error);
    }
  },

  // @route   POST /api/admin/auth/verify-otp   body: { code } (or { otp })
  // @access  Public
  async verifyOtp(req, res, next) {
    try {
      const otp = req.body.code ?? req.body.otp;
      const resetToken = await resetService.verifyOtp(otp, req, { requireAdmin: true });
      if (!resetToken) {
        return res.status(400).json({ success: false, message: GENERIC_INVALID });
      }
      res.status(200).json({ success: true, message: 'OTP verified successfully.', data: { resetToken } });
    } catch (error) {
      next(error);
    }
  },

  // @route   POST /api/admin/auth/reset-password   body: { resetToken, newPassword }
  // @access  Public
  async resetPassword(req, res, next) {
    try {
      const resetToken = req.body.resetToken ?? req.body.token;
      const newPassword = req.body.newPassword ?? req.body.password;
      const ok = await resetService.completeReset(resetToken, newPassword, 'admin', req);
      if (!ok) {
        return res.status(400).json({ success: false, message: 'Invalid or expired reset token.' });
      }
      res.status(200).json({ success: true, message: 'Password reset successful. Please login.' });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = AdminAuthController;
