const UserModel = require('../models/userModel');
const cloudinary = require('../config/cloudinary');
const notifyAdmins = require('../utils/notifyAdmins');
const tableExists = require('../utils/tableExists');
const db = require('../config/db');
const { signToken, deviceFingerprint } = require('../services/tokenService');
const { isAdminRole, notifyPasswordChanged } = require('../services/passwordResetService');
const { bookingStatsFor } = require('../services/userStatsService');
const lockout = require('../services/loginLockoutService');
const audit = require('../services/auditService');

const socialProvidersOf = (row) => {
  const providers = [];
  if (row.google_id) providers.push('Google');
  if (row.facebook_id) providers.push('Facebook');
  return providers;
};

/** Full user for profile/admin responses, with the activity timeline attached. */
async function userWithActivity(row) {
  const activityHistory = await UserModel.getActivity(row.id);
  return UserModel.toPublic(row, { activityHistory });
}

const AuthController = {
  // @desc    Authenticate user & get token
  // @route   POST /api/auth/login, POST /api/admin/auth/login
  // @access  Public
  async login(req, res, next) {
    try {
      const { email, password } = req.body;

      const user = await UserModel.findByEmail(email);
      if (!user) {
        audit.record(req, { action: audit.ACTIONS.LOGIN_FAILED, success: false, details: 'unknown email' });
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }

      const lockedFor = lockout.minutesLocked(user);
      if (lockedFor) {
        audit.record(req, { action: audit.ACTIONS.LOGIN_LOCKED, userId: user.id, success: false });
        return res.status(423).json({
          success: false,
          message: `Too many failed attempts. Account locked for ${lockedFor} more minute${lockedFor === 1 ? '' : 's'}.`,
          error_code: 'ACCOUNT_LOCKED'
        });
      }

      // Social-only accounts have no password to check
      if (!user.password_hash) {
        const providers = socialProvidersOf(user);
        const providerList = providers.join(' or ');
        return res.status(401).json({
          success: false,
          message: `This account was created via ${providerList || 'a social provider'}. Please sign in using ${providerList || 'that method'}, or use "Forgot Password" to create an email password.`,
          socialProvider: providers[0]?.toLowerCase() || null
        });
      }

      if (!(await UserModel.verifyPassword(password, user.password_hash))) {
        const { locked, attemptsLeft } = await lockout.recordFailure(user);
        audit.record(req, { action: locked ? audit.ACTIONS.LOGIN_LOCKED : audit.ACTIONS.LOGIN_FAILED, userId: user.id, success: false, details: locked ? 'account locked' : `${attemptsLeft} attempt(s) left` });
        if (locked) {
          return res.status(423).json({
            success: false,
            message: `Too many failed attempts. Account locked for ${lockout.LOCK_MINUTES} minutes.`,
            error_code: 'ACCOUNT_LOCKED'
          });
        }
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }
      await lockout.recordSuccess(user);

      if (user.status === 'suspended' || user.status === 'blocked') {
        audit.record(req, { action: audit.ACTIONS.LOGIN_BLOCKED, userId: user.id, success: false, details: user.status });
        return res.status(403).json({
          success: false,
          message: `Your account has been ${user.status}. Reason: ${user.status_reason || 'Please contact support.'}`
        });
      }

      // Admin/editor: portal is off-limits, and logins from new devices raise an alert
      if (isAdminRole(user.role)) {
        if (!req.originalUrl.includes('/admin/')) {
          audit.record(req, { action: audit.ACTIONS.LOGIN_BLOCKED, userId: user.id, success: false, details: 'admin account on customer portal' });
          return res.status(403).json({
            success: false,
            message: 'Admin accounts cannot log into the customer portal. Please use the admin dashboard.'
          });
        }

        const { fingerprint, userAgent, ip } = deviceFingerprint(req);
        if (!(await UserModel.findDevice(user.id, fingerprint))) {
          await UserModel.addDevice(user.id, { fingerprint, userAgent, ip });
          audit.record(req, { action: audit.ACTIONS.ADMIN_NEW_DEVICE, userId: user.id });
          await notifyAdmins({
            settingKey: 'loginAlert',
            title: 'Admin Login - New Device',
            message: `${user.name} (${user.email}) logged in from a new device (IP: ${ip}).`,
            type: 'system'
          });
        }
      }

      await UserModel.touchLogin(user.id);
      await UserModel.addActivity(user.id, { action: 'Login', details: 'User logged in via email/password' });
      audit.record(req, { action: audit.ACTIONS.LOGIN_SUCCESS, userId: user.id });

      res.status(200).json({
        success: true,
        token: signToken(user),
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          phone: user.phone,
          dob: user.dob,
          profileImage: user.profile_image
        }
      });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Check if an email is already known (account or past booking)
  // @route   POST /api/auth/check-email
  // @access  Public
  async checkEmail(req, res, next) {
    try {
      const email = req.body.email;
      let exists = await UserModel.emailExists(email);

      if (!exists && (await tableExists('bookings'))) {
        const rows = await db.query('SELECT 1 FROM bookings WHERE LOWER(customer_email) = ? LIMIT 1', [email]);
        exists = rows.length > 0;
      }

      res.status(200).json({ success: true, exists });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Register user
  // @route   POST /api/auth/register
  // @access  Public
  async register(req, res, next) {
    try {
      const { name, email, password, role } = req.body;

      const existing = await UserModel.findByEmail(email);
      if (existing) {
        const providers = socialProvidersOf(existing);
        if (providers.length && !existing.password_hash) {
          return res.status(400).json({
            success: false,
            message: `An account with this email already exists via ${providers.join('/')}. Please sign in using that method, or use "Forgot Password" to set an email/password.`,
            socialProvider: providers[0]?.toLowerCase() || null
          });
        }
        return res.status(400).json({ success: false, message: 'An account with this email already exists. Please sign in.' });
      }

      const id = await UserModel.create({
        name,
        email,
        role,
        passwordHash: await UserModel.hashPassword(password)
      });
      await UserModel.addActivity(id, { action: 'Registration', details: `Account created with role: ${role}` });
      audit.record(req, { action: audit.ACTIONS.REGISTER, userId: id });

      await notifyAdmins({
        settingKey: 'userRegistration',
        title: 'New User Registration',
        message: `${name} (${email}) just created an account.`,
        type: 'user'
      });

      res.status(201).json({ success: true, message: 'User registered successfully' });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Get current logged in user
  // @route   GET /api/auth/me
  // @access  Private
  async getMe(req, res, next) {
    try {
      const row = await UserModel.findById(req.user.id);
      res.status(200).json({ success: true, data: row ? await userWithActivity(row) : null });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Update user profile
  // @route   PUT /api/auth/updatedetails
  // @access  Private
  async updateDetails(req, res, next) {
    try {
      // Only update fields that were actually provided
      const fields = {};
      for (const key of ['name', 'email', 'phone', 'jobTitle', 'bio']) {
        if (req.body[key] !== undefined) fields[key] = req.body[key];
      }

      // Base64 images are uploaded to Cloudinary; URLs are stored as-is
      if (req.body.profileImage && req.body.profileImage.startsWith('data:image')) {
        const upload = await cloudinary.uploader.upload(req.body.profileImage, {
          folder: 'courses4me/profiles',
          width: 500,
          height: 500,
          crop: 'fill'
        });
        fields.profileImage = upload.secure_url;
      } else if (req.body.profileImage) {
        fields.profileImage = req.body.profileImage;
      }

      const user = await UserModel.findById(req.user.id);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });

      const changed = [];
      if (req.body.name && req.body.name !== user.name) changed.push('Name');
      if (req.body.email && req.body.email !== user.email) changed.push('Email');
      if (req.body.phone && req.body.phone !== user.phone) changed.push('Phone');

      await UserModel.update(user.id, fields);
      if (changed.length) {
        await UserModel.addActivity(user.id, { action: 'Profile Update', details: `Updated: ${changed.join(', ')}` });
      }

      const row = await UserModel.findById(user.id);
      res.status(200).json({ success: true, data: await userWithActivity(row) });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Get user counts by role
  // @route   GET /api/auth/counts
  // @access  Private/Admin
  async getUserCounts(req, res, next) {
    try {
      res.status(200).json({ success: true, counts: await UserModel.countByRole() });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Update password
  // @route   PUT /api/auth/update-password
  // @access  Private
  async updatePassword(req, res, next) {
    try {
      const { currentPassword, newPassword } = req.body;
      const user = await UserModel.findById(req.user.id);

      if (!(await UserModel.verifyPassword(currentPassword, user.password_hash))) {
        return res.status(401).json({ success: false, message: 'Current password is incorrect' });
      }

      await UserModel.setPassword(user.id, await UserModel.hashPassword(newPassword));
      await UserModel.addActivity(user.id, { action: 'Password Change', details: 'User manually updated their password from settings' });
      audit.record(req, { action: audit.ACTIONS.PASSWORD_CHANGED, userId: user.id });
      notifyPasswordChanged(user, req);

      res.status(200).json({ success: true, message: 'Password updated successfully' });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Get all users (Admin only)
  // @route   GET /api/auth/users
  // @access  Private/Admin
  async getUsers(req, res, next) {
    try {
      const rows = await UserModel.findAll(req.query);

      const ids = rows.map(r => r.id);
      const [activity, stats] = await Promise.all([
        UserModel.getActivityForUsers(ids),
        bookingStatsFor(rows)
      ]);

      const data = rows.map(row => UserModel.toPublic(row, {
        activityHistory: activity[row.id] || [],
        ...stats[row.id]
      }));

      res.status(200).json({ success: true, count: data.length, data });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Update user status (Admin only)
  // @route   PUT /api/auth/users/:id/status
  // @access  Private/Admin
  async updateUserStatus(req, res, next) {
    try {
      const { status, reason } = req.body;
      const user = await UserModel.findById(req.params.id);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });

      await UserModel.update(user.id, { status, statusReason: reason || '' });
      await UserModel.addActivity(user.id, {
        action: 'Status Change',
        details: `Status changed from ${user.status} to ${status}.`,
        reason: reason || 'N/A',
        adminName: req.user.name
      });
      audit.record(req, { action: audit.ACTIONS.USER_STATUS_CHANGED, userId: user.id, actorId: req.user.id, details: `${user.status} -> ${status}` });

      const row = await UserModel.findById(user.id);
      res.status(200).json({ success: true, message: `User status updated to ${status}`, data: await userWithActivity(row) });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Clear user activity history (Admin only)
  // @route   DELETE /api/auth/users/:id/history
  // @access  Private/Admin
  async clearUserHistory(req, res, next) {
    try {
      const user = await UserModel.findById(req.params.id);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });

      await UserModel.clearActivity(user.id);
      await UserModel.update(user.id, { statusReason: '' });
      await UserModel.addActivity(user.id, {
        action: 'History Cleared',
        details: 'All previous activity history and status reasons were cleared by admin.',
        adminName: req.user.name
      });
      audit.record(req, { action: audit.ACTIONS.USER_HISTORY_CLEARED, userId: user.id, actorId: req.user.id });

      const row = await UserModel.findById(user.id);
      res.status(200).json({ success: true, message: 'User history cleared successfully', data: await userWithActivity(row) });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = AuthController;
