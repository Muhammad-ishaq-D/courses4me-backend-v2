const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Protect routes
exports.protect = async (req, res, next) => {
    let token;

    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith('Bearer')
    ) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Not authorized to access this route'
        });
    }

    try {
        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        req.user = await User.findById(decoded.id);

        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'User no longer exists'
            });
        }

        if (decoded.tokenVersion !== req.user.tokenVersion) {
            return res.status(401).json({
                success: false,
                message: 'Session expired. Please log in again.'
            });
        }

        // Check if user account is active
        if (req.user.status === 'suspended' || req.user.status === 'blocked') {
            return res.status(403).json({
                success: false,
                message: `Your account has been ${req.user.status}. Reason: ${req.user.statusReason || 'Please contact support.'}`
            });
        }

        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: 'Not authorized to access this route'
        });
    }
};

// Grant access to specific roles
exports.authorize = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: `User role ${req.user.role} is not authorized to access this route`
            });
        }
        next();
    };
};

// Optional protect middleware (populates req.user if token exists, but doesn't require it)
exports.optionalProtect = async (req, res, next) => {
    let token;

    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith('Bearer')
    ) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return next();
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id);
        
        if (user && decoded.tokenVersion === user.tokenVersion) {
            req.user = user;
        }
        next();
    } catch (error) {
        // Even if token is invalid, we continue without req.user
        next();
    }
};
