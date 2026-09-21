// Runs before every test file. Tests must never reach a live database, so the
// secrets are fixed here and src/config/db is mocked per test file
// (see tests/helpers/mockDb.js).
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.OTP_SECRET = 'test-otp-secret';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.ADMIN_FRONTEND_URL = 'http://localhost:5174';
process.env.DB_HOST = '127.0.0.1';
process.env.DB_NAME = 'courses4me_test_never_connected';
