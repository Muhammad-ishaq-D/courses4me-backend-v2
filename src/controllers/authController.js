const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const Booking = require('../models/Booking');
const cloudinary = require('../config/cloudinary');
const notifyAdmins = require('../utils/notifyAdmins');

const ADMIN_ROLES = ['admin', 'editor'];

// Hash of user-agent + IP, used to recognize devices an admin has logged in from before.
const getDeviceFingerprint = (req) => {
    const userAgent = req.headers['user-agent'] || 'unknown';
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    const fingerprint = crypto.createHash('sha256').update(`${userAgent}|${ip}`).digest('hex');
    return { fingerprint, userAgent, ip };
};

// @desc    Authenticate user & get token
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
    const { email, password } = req.body;

    try {
        // Check for user
        const user = await User.findOne({ email: email?.toLowerCase().trim() }).select('+password');

        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        // Detect social-only accounts (no password set)
        if (!user.password) {
            const providers = [];
            if (user.googleId) providers.push('Google');
            if (user.facebookId) providers.push('Facebook');
            const providerList = providers.join(' or ');
            return res.status(401).json({
                success: false,
                message: `This account was created via ${providerList || 'a social provider'}. Please sign in using ${providerList || 'that method'}, or use "Forgot Password" to create an email password.`,
                socialProvider: providers[0]?.toLowerCase() || null,
            });
        }

        // Check if password matches
        const isMatch = await user.matchPassword(password);

        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        // Check if account is active
        if (user.status === 'suspended' || user.status === 'blocked') {
            return res.status(403).json({ 
                success: false, 
                message: `Your account has been ${user.status}. Reason: ${user.statusReason || 'Please contact support.'}` 
            });
        }

        // Update last login
        user.lastLogin = Date.now();
        user.lastActive = Date.now();
        user.activityHistory.push({
            action: 'Login',
            details: 'User logged in via email/password'
        });

        // Admin/editor new-device detection (customer logins aren't tracked here)
        if (ADMIN_ROLES.includes(user.role)) {
            // Block admins from logging into the customer portal
            if (!req.originalUrl.includes('/admin/')) {
                return res.status(403).json({
                    success: false,
                    message: 'Admin accounts cannot log into the customer portal. Please use the admin dashboard.'
                });
            }

            const { fingerprint, userAgent, ip } = getDeviceFingerprint(req);
            const isKnownDevice = user.knownDevices.some(d => d.fingerprint === fingerprint);

            if (!isKnownDevice) {
                user.knownDevices.push({ fingerprint, userAgent, ip });
                // Cap history so the array doesn't grow unbounded
                if (user.knownDevices.length > 20) {
                    user.knownDevices = user.knownDevices.slice(-20);
                }

                try {
                    await notifyAdmins({
                        settingKey: 'loginAlert',
                        title: 'Admin Login - New Device',
                        message: `${user.name} (${user.email}) logged in from a new device (IP: ${ip}).`,
                        type: 'system'
                    });
                } catch (notifErr) {
                    console.error('Notification Error (Admin Login Alert):', notifErr);
                }
            }
        }

        await user.save({ validateBeforeSave: false });

        // Create token
        const token = jwt.sign({ id: user._id, role: user.role, tokenVersion: user.tokenVersion }, process.env.JWT_SECRET, {
            expiresIn: '30d'
        });

        res.status(200).json({
            success: true,
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                phone: user.phone,
                dob: user.dob,
                profileImage: user.profileImage
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Check if email exists
// @route   POST /api/auth/check-email
// @access  Public
exports.checkEmail = async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });
    
    try {
        const normalizedEmail = email.trim();
        // Escape regex special characters
        const escapedEmail = normalizedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // Search in User collection (any role) and Booking collection
        const userInAuth = await User.findOne({ 
            email: { $regex: new RegExp(`^${escapedEmail}$`, 'i') }
        });

        const userInBookings = await Booking.findOne({ 
            "customerDetails.email": { $regex: new RegExp(`^${escapedEmail}$`, 'i') } 
        });

        res.status(200).json({
            success: true,
            exists: !!(userInAuth || userInBookings)
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Register user (for testing/initial setup)
// @route   POST /api/auth/register
// @access  Public
exports.register = async (req, res) => {
    const { name, email, password, role } = req.body;

    try {
        const normalizedEmail = email?.toLowerCase().trim();
        const userExists = await User.findOne({ email: normalizedEmail });

        if (userExists) {
            // Detect if account was created via social provider
            const providers = [];
            if (userExists.googleId) providers.push('Google');
            if (userExists.facebookId) providers.push('Facebook');

            if (providers.length > 0 && !userExists.password) {
                // Social-only account — guide user to login via social or set a password
                return res.status(400).json({
                    success: false,
                    message: `An account with this email already exists via ${providers.join('/')}. Please sign in using that method, or use "Forgot Password" to set an email/password.`,
                    socialProvider: providers[0]?.toLowerCase() || null,
                });
            }

            return res.status(400).json({ success: false, message: 'An account with this email already exists. Please sign in.' });
        }

        const user = await User.create({
            name,
            email: normalizedEmail,
            password,
            role,
            activityHistory: [{
                action: 'Registration',
                details: `Account created with role: ${role}`
            }]
        });

        const notifyAdmins = require('../utils/notifyAdmins');
        await notifyAdmins({
            settingKey: 'userRegistration',
            title: 'New User Registration',
            message: `${user.name} (${user.email}) just created an account.`,
            type: 'user'
        });

        res.status(201).json({
            success: true,
            message: 'User registered successfully'
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        res.status(200).json({
            success: true,
            data: user
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Update user profile
// @route   PUT /api/auth/updatedetails
// @access  Private
exports.updateDetails = async (req, res) => {
    try {
        // Only update fields that were actually provided — otherwise a partial
        // update (e.g. changing just the profile photo) would overwrite required
        // fields like name/email with undefined and fail validation on save.
        const fieldsToUpdate = {};
        ['name', 'email', 'phone', 'jobTitle', 'bio'].forEach((field) => {
            if (req.body[field] !== undefined) {
                fieldsToUpdate[field] = req.body[field];
            }
        });

        // Handle profile image upload to Cloudinary if provided as base64
        if (req.body.profileImage && req.body.profileImage.startsWith('data:image')) {
            const uploadResponse = await cloudinary.uploader.upload(req.body.profileImage, {
                folder: 'courses4me/profiles',
                width: 500,
                height: 500,
                crop: 'fill'
            });
            fieldsToUpdate.profileImage = uploadResponse.secure_url;
        } else if (req.body.profileImage) {
            // If it's already a URL, just keep it
            fieldsToUpdate.profileImage = req.body.profileImage;
        }

        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        // Check if important fields changed to log it
        const changedFields = [];
        if (req.body.name && req.body.name !== user.name) changedFields.push('Name');
        if (req.body.email && req.body.email !== user.email) changedFields.push('Email');
        if (req.body.phone && req.body.phone !== user.phone) changedFields.push('Phone');

        Object.assign(user, fieldsToUpdate);
        
        if (changedFields.length > 0) {
            user.activityHistory.push({
                action: 'Profile Update',
                details: `Updated: ${changedFields.join(', ')}`
            });
        }

        await user.save();

        res.status(200).json({
            success: true,
            data: user
        });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get user counts by role
// @route   GET /api/auth/counts
// @access  Private/Admin
exports.getUserCounts = async (req, res) => {
    try {
        const customerCount = await User.countDocuments({ role: 'customer' });
        const adminCount = await User.countDocuments({ role: 'admin' });
        const editorCount = await User.countDocuments({ role: 'editor' });

        res.status(200).json({
            success: true,
            counts: {
                customer: customerCount,
                admin: adminCount,
                editor: editorCount,
                total: customerCount + adminCount + editorCount
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
// @desc    Update password
// @route   PUT /api/auth/update-password
// @access  Private
exports.updatePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        const user = await User.findById(req.user.id).select('+password');

        // Check current password
        if (!(await user.matchPassword(currentPassword))) {
            return res.status(401).json({ success: false, message: 'Current password is incorrect' });
        }

        user.password = newPassword;
        user.tokenVersion = (user.tokenVersion || 0) + 1;
        user.activityHistory.push({
            action: 'Password Change',
            details: 'User manually updated their password from settings'
        });
        await user.save();

        res.status(200).json({
            success: true,
            message: 'Password updated successfully'
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get all users (Admin only)
// @route   GET /api/auth/users
// @access  Private/Admin
exports.getUsers = async (req, res) => {
    try {
        const { search, status, role } = req.query;
        let query = {};

        if (status) query.status = status;
        if (role) query.role = role;
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } }
            ];
        }

        const users = await User.find(query).sort({ createdAt: -1 });

        // Enrich users with booking stats
        const usersWithStats = await Promise.all(users.map(async (user) => {
            // Case-insensitive email search for broader matching
            const userBookings = await Booking.find({ 
                $or: [
                    { user: user._id },
                    { "customerDetails.email": { $regex: new RegExp(`^${user.email}$`, 'i') } }
                ]
            });

            // Calculate completed courses
            const now = new Date();
            const completedCount = userBookings.filter(b => {
                const endDate = b.session?.endDate || b.endDate;
                return endDate && new Date(endDate) < now;
            }).length;

            // Calculate total spent
            const totalSpent = userBookings.reduce((sum, b) => sum + (b.totalAmount || 0), 0);

            return {
                ...user.toObject(),
                // Fallback for lastLogin/lastActive to createdAt for existing users
                lastLogin: user.lastLogin || user.createdAt,
                lastActive: user.lastActive || user.createdAt,
                totalBookings: userBookings.length,
                bookingCount: userBookings.length, // Matching frontend expectation
                totalSpent: totalSpent,            // Matching frontend expectation
                completedCourses: completedCount,
                attendanceStatus: userBookings.some(b => b.attendance?.some(a => a.status === 'Present')) ? 'Regular' : 'New'
            };
        }));

        res.status(200).json({
            success: true,
            count: usersWithStats.length,
            data: usersWithStats
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Update user status (Admin only)
// @route   PUT /api/auth/users/:id/status
// @access  Private/Admin
exports.updateUserStatus = async (req, res) => {
    try {
        const { status, reason } = req.body;
        const user = await User.findById(req.params.id);

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const oldStatus = user.status;
        user.status = status;
        user.statusReason = reason || '';
        
        user.activityHistory.push({
            action: 'Status Change',
            details: `Status changed from ${oldStatus} to ${status}.`,
            reason: reason || 'N/A',
            adminName: req.user.name,
            timestamp: Date.now()
        });

        await user.save();

        res.status(200).json({
            success: true,
            message: `User status updated to ${status}`,
            data: user
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Clear user activity history (Admin only)
// @route   DELETE /api/auth/users/:id/history
// @access  Private/Admin
exports.clearUserHistory = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Clear history and statusReason
        user.activityHistory = [];
        user.statusReason = '';
        
        // Add a log that it was cleared
        user.activityHistory.push({
            action: 'History Cleared',
            details: 'All previous activity history and status reasons were cleared by admin.',
            adminName: req.user.name,
            timestamp: Date.now()
        });

        await user.save();

        res.status(200).json({
            success: true,
            message: 'User history cleared successfully',
            data: user
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
