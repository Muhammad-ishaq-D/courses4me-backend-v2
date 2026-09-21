const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const passport = require('passport');
require('./config/passport');
const authRoutes = require('./routes/authRoutes');
const courseRoutes = require('./routes/courseRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const stripeRoutes = require('./routes/stripeRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const licenseRoutes = require('./routes/licenseRoutes');
const jobRoutes = require('./routes/jobRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const locationRoutes = require('./routes/locationRoutes');
const courseLocationRoutes = require('./routes/courseLocationRoutes');
const courseLocationDateRoutes = require('./routes/courseLocationDateRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const portalAuthRoutes = require('./routes/portalAuthRoutes');
const adminAuthRoutes = require('./routes/adminAuthRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const app = express();



// Passport middleware
app.use(passport.initialize());

// CORS Configuration - MUST be first before any routes
const allowedOrigins = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:3000",
    "https://admin.courses4me.co.uk",
    "https://courses4me.co.uk"
];

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, Postman, server-to-server)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    credentials: true,
    optionsSuccessStatus: 200
}));

app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Stripe webhook route needs raw body
app.use('/api/stripe', stripeRoutes);

// Body parsers with increased limits for base64 images
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Health check
app.get('/health', (req, res) => res.status(200).send('Backend is running'));

const { loginLimiter, forgotPasswordLimiter, verifyOtpLimiter, resetPasswordLimiter } = require('./middlewares/rateLimiters');

// Apply rate limiters to specific paths
app.use('/api/auth/login', loginLimiter);
app.use('/api/admin/auth/login', loginLimiter);
app.use('/api/auth/forgot-password', forgotPasswordLimiter);
app.use('/api/auth/reset-password', resetPasswordLimiter);

app.use('/api/admin/auth/forgot-password', forgotPasswordLimiter);
app.use('/api/admin/auth/verify-otp', verifyOtpLimiter);
app.use('/api/admin/auth/reset-password', resetPasswordLimiter);

app.use('/api/portal/auth/forgot-password', forgotPasswordLimiter);
app.use('/api/portal/auth/reset-password', resetPasswordLimiter);

// Routes

if (process.env.NODE_ENV === 'development') {
    app.use(morgan('dev'));
}

app.use('/api/auth', authRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/licenses', licenseRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/course-locations', courseLocationRoutes);
app.use('/api/course-location-dates', courseLocationDateRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/portal/auth', portalAuthRoutes);
app.use('/api/admin/auth', adminAuthRoutes);
app.use('/api/reviews', reviewRoutes);



// Basic error handler
app.use((err, req, res, next) => {
    console.error('Error Stack:', err.stack);

    // Handle specific Express errors
    if (err.type === 'entity.too.large') {
        return res.status(413).json({
            success: false,
            message: 'Payload too large. Please use a smaller image.'
        });
    }

    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Something went wrong on the server!'
    });
});

module.exports = app;
