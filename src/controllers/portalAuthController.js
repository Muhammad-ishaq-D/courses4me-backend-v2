const crypto = require('crypto');
const User = require('../models/User');
const PasswordReset = require('../models/PasswordReset');
const sendEmail = require('../utils/sendEmail');
const isEmailTemplateActive = require('../utils/isEmailTemplateActive');

const ADMIN_ROLES = ['admin', 'editor'];

const hashToken = (token) => crypto.createHmac('sha256', process.env.OTP_SECRET).update(String(token)).digest('hex');

// @desc    Portal - Forgot password (emails a reset link)
// @route   POST /api/portal/auth/forgot-password
// @access  Public
exports.forgotPassword = async (req, res) => {
    try {
        const email = req.body.email?.toLowerCase().trim();
        const user = await User.findOne({ email });

        const successMessage = 'If an account exists, a password reset link has been sent.';

        if (!user || ADMIN_ROLES.includes(user.role)) {
            return res.status(200).json({ success: true, message: successMessage });
        }

        if (!(await isEmailTemplateActive('passwordReset'))) {
            return res.status(503).json({ success: false, message: 'Password reset emails are currently disabled. Please contact support.' });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetTokenHash = hashToken(resetToken);

        // Invalidate previous active requests
        await PasswordReset.updateMany(
            { user: user._id, resetTokenConsumedAt: null },
            { $set: { resetTokenConsumedAt: new Date() } }
        );

        const passwordReset = new PasswordReset({
            user: user._id,
            // For portal, we skip the OTP step and directly issue a reset token in the link
            otpHash: 'portal-link',
            otpExpiresAt: new Date(),
            otpConsumedAt: new Date(), // Mark OTP as already consumed so resetToken is active
            resetTokenHash,
            resetTokenExpiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 mins
            lastSentAt: new Date(),
            requestIp: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown',
            userAgent: req.headers['user-agent'] || 'unknown'
        });

        await passwordReset.save();

        const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

        const message = `You are receiving this email because you (or someone else) has requested the reset of a password. Please click on the link below or paste it into your browser to complete the process: \n\n ${resetUrl}`;

        const html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                <h3 style="color: #333;">Password Reset Request</h3>
                <p style="color: #555; font-size: 16px;">You requested a password reset. Please click the button below to reset your password.</p>
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${resetUrl}" style="background-color: #F8510C; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">Reset Password</a>
                </div>
                <p style="color: #777; font-size: 14px;">This link will expire in 10 minutes.</p>
                <p style="color: #999; font-size: 12px; margin-top: 20px;">If the button above doesn't work, copy and paste this link into your browser:</p>
                <p style="color: #F8510C; font-size: 12px; word-break: break-all;">${resetUrl}</p>
                <p style="color: #777; font-size: 14px; margin-top: 30px;">If you didn't request this, you can safely ignore this email.</p>
            </div>
        `;

        try {
            await sendEmail({
                email: user.email,
                subject: 'Password Reset Request',
                message,
                html
            });

            console.log(`[Audit] Password reset requested for Portal user ID: ${user._id}`);
            res.status(200).json({ success: true, message: successMessage });
        } catch (error) {
            console.error('SMTP Failure:', error);
            await PasswordReset.findByIdAndDelete(passwordReset._id);
            return res.status(200).json({ success: true, message: successMessage });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// @desc    Portal - Reset password using the emailed link token
// @route   POST /api/portal/auth/reset-password
// @access  Public
exports.resetPassword = async (req, res) => {
    try {
        const { resetToken, newPassword } = req.body;

        // Support old frontend payload if they haven't updated it yet, although we will rename it to resetToken.
        const token = resetToken || req.body.token;
        const password = newPassword || req.body.password;

        if (!token || !password) {
            return res.status(400).json({ success: false, message: 'Invalid or expired reset token.' });
        }

        const resetTokenHash = hashToken(token);

        const resetRecord = await PasswordReset.findOneAndUpdate(
            {
                resetTokenHash,
                resetTokenConsumedAt: null,
                resetTokenExpiresAt: { $gt: new Date() }
            },
            {
                $set: { resetTokenConsumedAt: new Date() }
            },
            { new: true }
        ).populate('user');

        if (!resetRecord || !resetRecord.user || ADMIN_ROLES.includes(resetRecord.user.role)) {
            console.log(`[Audit] Reset password failed for portal flow (Invalid or Expired)`);
            return res.status(400).json({ success: false, message: 'Invalid or expired reset link' });
        }

        const user = resetRecord.user;

        user.password = password;
        user.tokenVersion = (user.tokenVersion || 0) + 1;
        user.activityHistory.push({
            action: 'Password Reset',
            details: 'Password was reset using the portal email link'
        });

        await user.save();

        console.log(`[Audit] Password reset completed for Portal user ID: ${user._id}`);

        res.status(200).json({
            success: true,
            message: 'Password reset successful. Please login.'
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};
