const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const passport = require('passport');

// Enforce required environment variables on startup
for (const key of ['JWT_SECRET', 'OTP_SECRET']) {
  if (!process.env[key]) {
    console.error(`FATAL ERROR: ${key} environment variable is missing.`);
    process.exit(1);
  }
}

require('./config/passport');

// ── Route imports ─────────────────────────────────────────────────────────
// Routes are mounted as their module comes online.
const authRoutes = require('./routes/authRoutes');
const adminAuthRoutes = require('./routes/adminAuthRoutes');
const portalAuthRoutes = require('./routes/portalAuthRoutes');
const courseRoutes = require('./routes/courseRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const stripeRoutes = require('./routes/stripeRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
// const licenseRoutes = require('./routes/licenseRoutes');
// const jobRoutes = require('./routes/jobRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const locationRoutes = require('./routes/locationRoutes');
const courseLocationRoutes = require('./routes/courseLocationRoutes');
const courseLocationDateRoutes = require('./routes/courseLocationDateRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
// const reviewRoutes = require('./routes/reviewRoutes');

const { errorHandler, notFoundHandler } = require('./middlewares/errorMiddleware');
const { apiLimiter, loginLimiter, forgotPasswordLimiter, verifyOtpLimiter, resetPasswordLimiter } = require('./middlewares/rateLimiters');
const requestId = require('./middlewares/requestId');
const db = require('./config/db');

const app = express();

// Trust the reverse proxy (Hostinger / Nginx / Passenger) for rate limiting & IP detection
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Every request gets an X-Request-Id for log / audit correlation
app.use(requestId);

// ── CORS ──────────────────────────────────────────────────────────────────
const isOriginAllowed = (origin) => {
  if (!origin) return true; // non-browser clients: Postman, mobile apps, server-to-server

  const cleanOrigin = origin.replace(/\/+$/, '');
  const allowedOrigins = [
    'https://courses4me.co.uk',
    'https://www.courses4me.co.uk',
    'https://admin.courses4me.co.uk'
  ];
  for (const key of ['FRONTEND_URL', 'ADMIN_FRONTEND_URL']) {
    if (process.env[key]) allowedOrigins.push(process.env[key].replace(/\/+$/, ''));
  }
  if (allowedOrigins.includes(cleanOrigin)) return true;
  if (/^https:\/\/([a-z0-9-]+\.)?courses4me\.co\.uk$/.test(cleanOrigin)) return true;

  // Explicit extra origins (comma-separated), honoured in any NODE_ENV, e.g.
  //   DEV_ORIGINS=http://localhost:5173,http://localhost:5174
  const devOrigins = (process.env.DEV_ORIGINS || '').split(',').map(o => o.trim().replace(/\/+$/, '')).filter(Boolean);
  if (devOrigins.includes(cleanOrigin)) return true;

  // Outside production, any localhost port
  if (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(cleanOrigin)) {
    return true;
  }
  return false;
};

app.use((req, res, next) => { res.header('Vary', 'Origin'); next(); });
app.use(cors({
  origin: (origin, callback) => callback(null, isOriginAllowed(origin)),
  credentials: true,
  optionsSuccessStatus: 204,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
}));

// ── Security & parsing ────────────────────────────────────────────────────
app.use(helmet({
  // JSON API: no HTML is served, so a CSP would only add noise
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  referrerPolicy: { policy: 'no-referrer' },
  // Only meaningful behind HTTPS; the production host terminates TLS
  hsts: process.env.NODE_ENV === 'production' ? { maxAge: 15552000, includeSubDomains: true } : false
}));
app.use(passport.initialize());

// Stripe webhooks need the raw body, so that router is mounted before express.json()
app.use('/api/stripe', stripeRoutes);

// Body limits: profile updates and the course form may carry base64 images,
// everything else is small JSON
const PROFILE_ROUTES = ['/api/auth/updatedetails', '/api/auth/profile'];
app.use(PROFILE_ROUTES, express.json({ limit: '10mb' }));
app.use('/api/courses', express.json({ limit: '25mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));

if (process.env.NODE_ENV !== 'test') {
  morgan.token('id', (req) => req.id);
  app.use(morgan(process.env.NODE_ENV === 'production'
    ? ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :response-time ms id=:id'
    : ':method :url :status :response-time ms - :res[content-length] id=:id'));
}

// ── Health ────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.status(200).json({ success: true, name: 'Courses4Me API', status: 'online', version: '2.0.0', timestamp: new Date() });
});
// Always 200 so the host never restarts the app over a DB blip; the `db`
// field tells monitoring whether queries are currently succeeding.
app.get('/health', async (req, res) => {
  let dbStatus = 'up';
  try {
    await Promise.race([
      db.raw('SELECT 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
    ]);
  } catch (err) {
    dbStatus = 'down';
  }
  res.status(200).json({ success: true, message: 'Courses4Me API backend is healthy and running.', db: dbStatus, timestamp: new Date() });
});
app.get(['/favicon.ico', '/robots.txt'], (req, res) => res.status(204).end());

// ── Rate limits (per IP): a ceiling on the whole API, tighter on credentials ─
app.use('/api', apiLimiter);
app.use('/api/auth/login', loginLimiter);
app.use('/api/admin/auth/login', loginLimiter);
app.use('/api/admin/auth/forgot-password', forgotPasswordLimiter);
app.use('/api/admin/auth/verify-otp', verifyOtpLimiter);
app.use('/api/admin/auth/reset-password', resetPasswordLimiter);
app.use('/api/portal/auth/forgot-password', forgotPasswordLimiter);
app.use('/api/portal/auth/reset-password', resetPasswordLimiter);

// ── API routes ────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/admin/auth', adminAuthRoutes);
app.use('/api/portal/auth', portalAuthRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/notifications', notificationRoutes);
// app.use('/api/licenses', licenseRoutes);
// app.use('/api/jobs', jobRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/course-locations', courseLocationRoutes);
app.use('/api/course-location-dates', courseLocationDateRoutes);
app.use('/api/settings', settingsRoutes);
// app.use('/api/reviews', reviewRoutes);

// 404 for unknown paths, then the central error handler
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
