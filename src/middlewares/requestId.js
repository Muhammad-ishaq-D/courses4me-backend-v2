const crypto = require('crypto');

/**
 * Gives every request an id, echoed as X-Request-Id, so a client-reported
 * error can be matched to the server log and the audit trail. An incoming
 * X-Request-Id from the reverse proxy is honoured when it looks like one.
 */
const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

function requestId(req, res, next) {
  const incoming = req.headers['x-request-id'];
  req.id = typeof incoming === 'string' && SAFE_ID.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

module.exports = requestId;
