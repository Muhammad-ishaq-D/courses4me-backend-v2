const UserModel = require('../models/userModel');
const resetService = require('../services/passwordResetService');

// Same wording whether or not the account exists (no account enumeration)
const GENERIC_SENT = 'If an account exists, a password reset link has been sent.';

/**
 * Customer portal password reset: forgot (emailed link with a single-use
 * token) -> reset-password. Admin/editor accounts are excluded here; they use
 * the OTP flow in adminAuthController.
 */
const PortalAuthController = {
  // @route   POST /api/portal/auth/forgot-password
  // @access  Public
  async forgotPassword(req, res, next) {
    try {
      const user = await UserModel.findByEmail(req.body.email);
      if (!user || resetService.isAdminRole(user.role)) {
        return res.status(200).json({ success: true, message: GENERIC_SENT });
      }

      if (!(await resetService.resetEmailsEnabled())) {
        return res.status(503).json({ success: false, message: 'Password reset emails are currently disabled. Please contact support.' });
      }

      await resetService.issueResetLink(user, req); // delivery runs in the background
      res.status(200).json({ success: true, message: GENERIC_SENT });
    } catch (error) {
      next(error);
    }
  },

  // @route   POST /api/portal/auth/reset-password   body: { resetToken, newPassword }
  //          (legacy { token, password } still accepted)
  // @access  Public
  async resetPassword(req, res, next) {
    try {
      const resetToken = req.body.resetToken ?? req.body.token;
      const newPassword = req.body.newPassword ?? req.body.password;
      const ok = await resetService.completeReset(resetToken, newPassword, 'portal', req);
      if (!ok) {
        return res.status(400).json({ success: false, message: 'Invalid or expired reset link' });
      }
      res.status(200).json({ success: true, message: 'Password reset successful. Please login.' });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = PortalAuthController;
