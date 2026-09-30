const rateLimit = require('express-rate-limit');

// Per-IP limits on credential endpoints. Disabled under jest so API tests can
// exercise a flow more times than a real client ever would.
const base = {
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test'
};

// Read-only catalogue requests: what the public pages load, and what search
// engines request when they render those pages from shared crawler IPs.
const PUBLIC_READ = /^\/(courses|licenses|blogs|locations|course-locations|jobs)(\/|$)/;
const isPublicRead = (req) => req.method === 'GET' && PUBLIC_READ.test(req.path);

// Catalogue reads get their own, much higher ceiling per IP.
exports.publicReadLimiter = rateLimit({
  ...base,
  skip: (req) => base.skip() || !isPublicRead(req),
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.PUBLIC_READ_RATE_LIMIT) || 3000,
  message: { success: false, message: 'Too many requests, please slow down' }
});

// Whole-API ceiling per IP for everything else; the credential endpoints below
// are much tighter.
exports.apiLimiter = rateLimit({
  ...base,
  skip: (req) => base.skip() || isPublicRead(req),
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.API_RATE_LIMIT) || 300,
  message: { success: false, message: 'Too many requests, please slow down' }
});

exports.loginLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many login attempts, please try again after 15 minutes' }
});

exports.forgotPasswordLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many password reset requests, please try again after an hour' }
});

exports.verifyOtpLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { success: false, message: 'Too many verification attempts, please try again later' }
});

exports.resetPasswordLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { success: false, message: 'Too many reset attempts, please try again later' }
});
