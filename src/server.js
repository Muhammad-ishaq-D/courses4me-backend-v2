const dotenv = require('dotenv');

// Load environment variables before requiring other modules
dotenv.config({ quiet: true });

const logger = require('./utils/logger');
const db = require('./config/db');
const app = require('./app');

const PORT = process.env.PORT || 5000;

// Start listening immediately so the host never sees a 503 while the DB pool
// warms up; the connection check runs alongside.
const server = app.listen(PORT, () => {
  logger.info('==================================================');
  logger.info(` Courses4Me Backend v2 running on port ${PORT}`);
  logger.info(`  Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`  Started At: ${new Date().toISOString()}`);
  logger.info(`  Process ID: ${process.pid}`);
  logger.info(`  Health Check URL: http://localhost:${PORT}/health`);
  logger.info('==================================================');

  db.checkConnection().then(() => {
    const CronService = require('./services/cronService');
    CronService.init();
  });
});

// Errors that mean the process can never serve traffic. Anything else is
// treated as recoverable so a single bad request or a dropped DB socket
// cannot take the whole API offline.
const FATAL_CODES = ['EADDRINUSE', 'EACCES'];
const isFatal = (err) => FATAL_CODES.includes(err && err.code);

process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION:', err && err.name, err && err.message);
  logger.error(err && err.stack);
  if (isFatal(err)) {
    logger.error('Error is unrecoverable. Shutting down server...');
    process.exit(1);
  }
  logger.error('Error is recoverable. Server is staying up.');
});

process.on('unhandledRejection', (reason) => {
  logger.error('UNHANDLED REJECTION:', reason && reason.message ? reason.message : reason);
  logger.error(reason && reason.stack);
  logger.error('Server is staying up.');
});

// Graceful shutdown when the host restarts or redeploys the app
const shutdown = (signal) => {
  logger.info(`${signal} received. Closing server gracefully...`);
  server.close(() => {
    db.destroy().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 10000).unref(); // never hang on open sockets
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
