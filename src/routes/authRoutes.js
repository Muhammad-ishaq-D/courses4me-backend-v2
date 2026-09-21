const express = require('express');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const { login, register, checkEmail, getUserCounts, getMe, updateDetails, updatePassword, getUsers, updateUserStatus, clearUserHistory } = require('../controllers/authController');
const { validateLogin, validateSignup } = require('../middlewares/validators');
const { protect, authorize } = require('../middlewares/authMiddleware');

const router = express.Router();

router.post('/login', validateLogin, login);
router.post('/register', validateSignup, register);
router.post('/check-email', checkEmail);
// Password reset is handled separately per app: see portalAuthRoutes.js and adminAuthRoutes.js

router.get('/me', protect, getMe);
router.get('/profile', protect, getMe);
router.put('/updatedetails', protect, updateDetails);
router.put('/profile', protect, updateDetails);
router.put('/update-password', protect, updatePassword);
router.get('/counts', protect, authorize('admin'), getUserCounts);

// Admin User Management
router.get('/users', protect, authorize('admin'), getUsers);
router.put('/users/:id/status', protect, authorize('admin'), updateUserStatus);
router.delete('/users/:id/history', protect, authorize('admin'), clearUserHistory);

// Social Auth Routes
router.get('/google', (req, res, next) => {
    const { redirect } = req.query;
    // Encode redirect URL in state to carry it through the OAuth flow
    const state = redirect ? Buffer.from(JSON.stringify({ redirect })).toString('base64') : undefined;
    passport.authenticate('google', { scope: ['profile', 'email'], state })(req, res, next);
});

router.get('/google/callback', passport.authenticate('google', { session: false, failureRedirect: `${process.env.FRONTEND_URL}/signin` }), (req, res) => {
    const token = req.user.getSignedJwtToken ? req.user.getSignedJwtToken() : jwt.sign({ id: req.user._id, tokenVersion: req.user.tokenVersion }, process.env.JWT_SECRET, { expiresIn: '30d' });
    
    let redirectUrl = `${process.env.FRONTEND_URL}/dashboard`;
    
    // Check for redirect in state
    if (req.query.state) {
        try {
            const state = JSON.parse(Buffer.from(req.query.state, 'base64').toString());
            if (state.redirect) {
                // Ensure redirect starts with / to prevent open redirect vulnerabilities
                const path = state.redirect.startsWith('/') ? state.redirect : `/${state.redirect}`;
                redirectUrl = `${process.env.FRONTEND_URL}${path}`;
            }
        } catch (e) {
            console.error('Failed to parse state', e);
        }
    }
    
    const separator = redirectUrl.includes('?') ? '&' : '?';
    res.redirect(`${redirectUrl}${separator}token=${token}`);
});

router.get('/facebook', (req, res, next) => {
    const { redirect } = req.query;
    const state = redirect ? Buffer.from(JSON.stringify({ redirect })).toString('base64') : undefined;
    passport.authenticate('facebook', { scope: ['email'], state })(req, res, next);
});

router.get('/facebook/callback', passport.authenticate('facebook', { session: false, failureRedirect: `${process.env.FRONTEND_URL}/signin` }), (req, res) => {
    const token = req.user.getSignedJwtToken ? req.user.getSignedJwtToken() : jwt.sign({ id: req.user._id, tokenVersion: req.user.tokenVersion }, process.env.JWT_SECRET, { expiresIn: '30d' });
    
    let redirectUrl = `${process.env.FRONTEND_URL}/dashboard`;
    
    if (req.query.state) {
        try {
            const state = JSON.parse(Buffer.from(req.query.state, 'base64').toString());
            if (state.redirect) {
                const path = state.redirect.startsWith('/') ? state.redirect : `/${state.redirect}`;
                redirectUrl = `${process.env.FRONTEND_URL}${path}`;
            }
        } catch (e) {
            console.error('Failed to parse state', e);
        }
    }

    const separator = redirectUrl.includes('?') ? '&' : '?';
    res.redirect(`${redirectUrl}${separator}token=${token}`);
});

module.exports = router;
