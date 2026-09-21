const crypto = require('crypto');
const User = require('../models/User');
const PasswordReset = require('../models/PasswordReset');
const sendEmail = require('../utils/sendEmail');
const isEmailTemplateActive = require('../utils/isEmailTemplateActive');

const ADMIN_ROLES = ['admin', 'editor'];

const hashOtp = (otp) => crypto.createHmac('sha256', process.env.OTP_SECRET).update(String(otp)).digest('hex');

// @desc    Admin - Forgot password (emails a 6-digit OTP)
// @route   POST /api/admin/auth/forgot-password
// @access  Public
exports.forgotPassword = async (req, res) => {
    try {
        const email = req.body.email?.toLowerCase().trim();
        const user = await User.findOne({ email });

        const successMessage = 'If an account exists, a verification code has been sent.';

        if (!user || !ADMIN_ROLES.includes(user.role)) {
            return res.status(200).json({ success: true, message: successMessage });
        }

        if (!(await isEmailTemplateActive('passwordReset'))) {
            return res.status(503).json({ success: false, message: 'Password reset emails are currently disabled. Please contact support.' });
        }

        const otp = crypto.randomInt(100000, 1000000).toString();
        const otpHash = hashOtp(otp);

        // Invalidate previous active requests
        await PasswordReset.updateMany(
            { user: user._id, otpConsumedAt: null },
            { $set: { otpConsumedAt: new Date() } }
        );

        const passwordReset = new PasswordReset({
            user: user._id,
            otpHash,
            otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 mins
            lastSentAt: new Date(),
            requestIp: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown',
            userAgent: req.headers['user-agent'] || 'unknown'
        });

        await passwordReset.save();

        const message = `You are receiving this email because you (or someone else) has requested a password reset.\n\nYour verification code is: ${otp}\n\nThis code will expire in 10 minutes. If you didn't request this, you can safely ignore this email.`;

        const html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                <h3 style="color: #333;">Password Reset Request</h3>
                <p style="color: #555; font-size: 16px;">Use the verification code below to reset your password.</p>
                <div style="text-align: center; margin: 30px 0;">
                    <span style="display: inline-block; background-color: #F8510C; color: white; padding: 16px 32px; border-radius: 8px; font-weight: bold; font-size: 28px; letter-spacing: 8px;">${otp}</span>
                </div>
                <p style="color: #777; font-size: 14px;">This code will expire in 10 minutes.</p>
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

            console.log(`[Audit] Password reset requested for Admin user ID: ${user._id}`);
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

// @desc    Admin - Verify OTP
// @route   POST /api/admin/auth/verify-otp
// @access  Public
exports.verifyOtp = async (req, res) => {
    try {
        const normalizedOtp = String(req.body.code ?? req.body.otp ?? "").trim();

        if (!/^\d{6}$/.test(normalizedOtp)) {
            return res.status(400).json({ success: false, message: 'Invalid or expired verification code.' });
        }

        const otpHash = hashOtp(normalizedOtp);

        const resetRecord = await PasswordReset.findOneAndUpdate(
            {
                otpHash,
                otpConsumedAt: null,
                otpExpiresAt: { $gt: new Date() }
            },
            {
                $inc: { attempts: 1 }
            },
            { new: true }
        ).populate('user');

        if (!resetRecord || !resetRecord.user || !ADMIN_ROLES.includes(resetRecord.user.role)) {
            console.log(`[Audit] OTP verification failed (Invalid or Expired)`);
            return res.status(400).json({ success: false, message: 'Invalid or expired verification code.' });
        }

        if (resetRecord.attempts > 15) {
            console.log(`[Audit] Too many OTP attempts for user ID: ${resetRecord.user._id}`);
            return res.status(400).json({ success: false, message: 'Invalid or expired verification code.' });
        }

        const resetToken = crypto.randomBytes(32).toString("hex");
        const resetTokenHash = hashOtp(resetToken);

        resetRecord.otpConsumedAt = new Date();
        resetRecord.resetTokenHash = resetTokenHash;
        resetRecord.resetTokenExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
        await resetRecord.save();

        console.log(`[Audit] OTP verification succeeded for user ID: ${resetRecord.user._id}`);

        res.status(200).json({
            success: true,
            message: 'OTP verified successfully.',
            data: {
                resetToken
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// @desc    Admin - Reset password using a verified OTP token
// @route   POST /api/admin/auth/reset-password
// @access  Public
exports.resetPassword = async (req, res) => {
    try {
        const { resetToken, newPassword } = req.body;

        if (!resetToken || !newPassword) {
            return res.status(400).json({ success: false, message: 'Invalid or expired verification code.' });
        }

        const resetTokenHash = hashOtp(resetToken);

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

        if (!resetRecord || !resetRecord.user || !ADMIN_ROLES.includes(resetRecord.user.role)) {
            return res.status(400).json({ success: false, message: 'Invalid or expired reset token.' });
        }

        const user = resetRecord.user;

        user.password = newPassword;
        user.tokenVersion = (user.tokenVersion || 0) + 1;
        user.activityHistory.push({
            action: 'Password Reset',
            details: 'Password was reset via admin reset token'
        });

        await user.save();

        console.log(`[Audit] Password reset completed for user ID: ${user._id}`);

        res.status(200).json({
            success: true,
            message: 'Password reset successful. Please login.'
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};
