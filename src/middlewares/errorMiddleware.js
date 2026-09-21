const multer = require('multer');
const logger = require('../utils/logger');

// Global error handling middleware
function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode || err.status || 500;
  let message = err.message || 'Internal Server Error';

  // Client-side mistakes that libraries report as generic errors
  if (err instanceof multer.MulterError) {
    statusCode = 400;
    message = err.code === 'LIMIT_FILE_SIZE'
      ? 'File is too large. Maximum upload size is 5 MB.'
      : `Upload rejected: ${err.message}`;
  } else if (err.type === 'entity.too.large') {
    statusCode = 413;
    message = 'Payload too large. Please use a smaller image.';
  } else if (err.type === 'entity.parse.failed') {
    statusCode = 400;
    message = 'Malformed JSON body.';
  } else if (err.code === 'ER_DUP_ENTRY') {
    // Unique-key violations are conflicts, not server faults
    statusCode = 409;
    message = err.publicMessage || 'A record with these details already exists.';
  }

  if (statusCode >= 500) {
    logger.error(`[Error Handler] [${req.id || '-'}] [${req.method}] ${req.originalUrl} - Status ${statusCode}:`, err);
    // Never leak driver/SQL messages to clients in production
    if (process.env.NODE_ENV === 'production') message = 'Internal Server Error';
  } else {
    logger.debug(`[Error Handler] [${req.id || '-'}] [${req.method}] ${req.originalUrl} - Status ${statusCode}: ${message}`);
  }

  // If the response already started we cannot touch headers or send a body.
  if (res.headersSent) {
    return next(err);
  }

  // CORS headers on error responses so the browser sees the real status
  // instead of reporting a CORS failure.
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  const response = { success: false, message };
  if (req.id) response.requestId = req.id;
  if (err.error_code) response.error_code = err.error_code;
  if (err.data !== undefined) response.data = err.data;
  if (process.env.NODE_ENV === 'development') response.stack = err.stack;

  res.status(statusCode).json(response);
}

// 404 Route Not Found middleware
function notFoundHandler(req, res, next) {
  const error = new Error(`Route Not Found - ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
}

/** Build an error carrying an HTTP status (and optional machine-readable code). */
function httpError(statusCode, message, error_code) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (error_code) err.error_code = error_code;
  return err;
}

module.exports = { errorHandler, notFoundHandler, httpError };
