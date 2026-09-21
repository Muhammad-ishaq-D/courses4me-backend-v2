const dotenv = require('dotenv');
const connectDB = require('./config/db');
const startCronJobs = require('./utils/cronJobs');

// Load env vars
dotenv.config();

if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is required');
}

if (!process.env.OTP_SECRET) {
    throw new Error('OTP_SECRET is required');
}

// Connect to database
connectDB();

// Initialize cron jobs
startCronJobs();

const app = require('./app');

const PORT = process.env.PORT || 5000;

console.log('Environment Debugging:');
console.log('Available Env Keys:', Object.keys(process.env).join(', '));
if (process.env.MONGODB_URI) {
    console.log('MONGODB_URI is present in environment.');
} else {
    console.warn('CRITICAL WARNING: MONGODB_URI is MISSING from environment!');
}

// Start server immediately so it doesn't 503 while connecting to DB
const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Attempting to connect to MongoDB...');

    // Connect to database AFTER starting server
    connectDB().then(() => {
        console.log('Database connection logic finished.');
        const initBookingCron = require('./services/bookingCron');
        initBookingCron();
        const initWeeklyReportCron = require('./services/weeklyReportCron');
        initWeeklyReportCron();
    });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
    console.error(`UNHANDLED REJECTION: ${err.message}`);
    if (err.stack) console.error(err.stack);
    // Don't exit process in production unless absolutely necessary
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error(`UNCAUGHT EXCEPTION: ${err.message}`);
    if (err.stack) console.error(err.stack);
});
