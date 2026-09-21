const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_EXPIRES_IN = '30d';
// Pinning issuer, audience and algorithm means a token minted by another
// service (or with a different algorithm) is rejected even if it were signed
// with the same secret.
const JWT_ISSUER = 'courses4me-api';
const JWT_AUDIENCE = 'courses4me';
const JWT_ALGORITHM = 'HS256';

/** JWT payload is { id, role, tokenVersion }; a version mismatch invalidates the token. */
function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, tokenVersion: user.token_version ?? user.tokenVersion ?? 0 },
    process.env.JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN, issuer: JWT_ISSUER, audience: JWT_AUDIENCE, algorithm: JWT_ALGORITHM }
  );
}

/** Throws on an invalid, expired or foreign token. */
function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET, {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    algorithms: [JWT_ALGORITHM]
  });
}

/** Client IP honouring the first hop of X-Forwarded-For (app sets trust proxy). */
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.ip || 'unknown';
}

/** Hash of user-agent + IP, used to recognise devices an admin has logged in from before. */
function deviceFingerprint(req) {
  const userAgent = req.headers['user-agent'] || 'unknown';
  const ip = clientIp(req);
  const fingerprint = crypto.createHash('sha256').update(`${userAgent}|${ip}`).digest('hex');
  return { fingerprint, userAgent: userAgent.slice(0, 500), ip };
}

module.exports = { signToken, verifyToken, clientIp, deviceFingerprint, JWT_EXPIRES_IN };
