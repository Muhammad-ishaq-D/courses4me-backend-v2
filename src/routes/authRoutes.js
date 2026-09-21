const express = require('express');
const passport = require('passport');
const AuthController = require('../controllers/authController');
const { protect, authorize } = require('../middlewares/authMiddleware');
const { validate } = require('../middlewares/validateMiddleware');
const validators = require('../validators');
const { signToken } = require('../services/tokenService');

const router = express.Router();
const auth = validators.auth;

// ── Public ────────────────────────────────────────────────────────────────
router.post('/login', validate(auth.login), AuthController.login);
router.post('/register', validate(auth.register), AuthController.register);
router.post('/check-email', validate(auth.checkEmail), AuthController.checkEmail);
// Password reset is handled per app: portalAuthRoutes.js and adminAuthRoutes.js

// ── Own profile ───────────────────────────────────────────────────────────
router.get('/me', protect, AuthController.getMe);
router.get('/profile', protect, AuthController.getMe);
router.put('/updatedetails', protect, validate(auth.updateDetails), AuthController.updateDetails);
router.put('/profile', protect, validate(auth.updateDetails), AuthController.updateDetails);
router.put('/update-password', protect, validate(auth.updatePassword), AuthController.updatePassword);

// ── Admin user management ─────────────────────────────────────────────────
const adminOnly = [protect, authorize('admin')];
router.get('/counts', ...adminOnly, AuthController.getUserCounts);
router.get('/users', ...adminOnly, validate(auth.listUsers, 'query'), AuthController.getUsers);
router.put('/users/:id/status', ...adminOnly, validate(auth.idParam, 'params'), validate(auth.updateUserStatus), AuthController.updateUserStatus);
router.delete('/users/:id/history', ...adminOnly, validate(auth.idParam, 'params'), AuthController.clearUserHistory);

// ── Social login (browser redirect flow) ──────────────────────────────────
// ?redirect=/path is carried through OAuth in `state` and appended to FRONTEND_URL
// on the way back, with the JWT in ?token=.
const encodeState = (redirect) => (redirect ? Buffer.from(JSON.stringify({ redirect })).toString('base64') : undefined);

const redirectWithToken = (req, res) => {
  const token = signToken(req.user);
  let redirectUrl = `${process.env.FRONTEND_URL}/dashboard`;

  if (req.query.state) {
    try {
      const state = JSON.parse(Buffer.from(req.query.state, 'base64').toString());
      if (state.redirect && typeof state.redirect === 'string') {
        // Only same-site paths: prevents open redirects
        const path = state.redirect.startsWith('/') ? state.redirect : `/${state.redirect}`;
        if (!path.startsWith('//')) redirectUrl = `${process.env.FRONTEND_URL}${path}`;
      }
    } catch (e) {
      // malformed state: fall through to the dashboard
    }
  }

  const separator = redirectUrl.includes('?') ? '&' : '?';
  res.redirect(`${redirectUrl}${separator}token=${token}`);
};

const failureRedirect = () => `${process.env.FRONTEND_URL}/signin`;

router.get('/google', (req, res, next) => {
  passport.authenticate('google', { scope: ['profile', 'email'], state: encodeState(req.query.redirect) })(req, res, next);
});
router.get('/google/callback', (req, res, next) => {
  passport.authenticate('google', { session: false, failureRedirect: failureRedirect() })(req, res, next);
}, redirectWithToken);

router.get('/facebook', (req, res, next) => {
  passport.authenticate('facebook', { scope: ['email'], state: encodeState(req.query.redirect) })(req, res, next);
});
router.get('/facebook/callback', (req, res, next) => {
  passport.authenticate('facebook', { session: false, failureRedirect: failureRedirect() })(req, res, next);
}, redirectWithToken);

module.exports = router;
