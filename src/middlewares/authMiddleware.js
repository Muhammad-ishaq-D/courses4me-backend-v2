const { verifyToken } = require('../services/tokenService');
const UserModel = require('../models/userModel');

const BLOCKED_STATUSES = ['suspended', 'blocked'];

function extractToken(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

/**
 * Verifies the JWT, loads the user, and rejects tokens whose tokenVersion no
 * longer matches (password changed / reset) or whose account is suspended or
 * blocked. On success req.user is the public user shape (see userModel.toPublic).
 */
async function protect(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorized to access this route' });
  }

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Not authorized to access this route' });
  }

  try {
    const row = await UserModel.findById(decoded.id);
    if (!row) {
      return res.status(401).json({ success: false, message: 'User no longer exists' });
    }
    if ((decoded.tokenVersion ?? 0) !== row.token_version) {
      return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
    }
    if (BLOCKED_STATUSES.includes(row.status)) {
      return res.status(403).json({
        success: false,
        message: `Your account has been ${row.status}. Reason: ${row.status_reason || 'Please contact support.'}`
      });
    }
    req.user = UserModel.toPublic(row);
    next();
  } catch (error) {
    next(error);
  }
}

/** Grant access to specific roles. Usage: authorize('admin', 'editor') */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authorized to access this route' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `User role ${req.user.role} is not authorized to access this route`
      });
    }
    next();
  };
}

/** Populates req.user when a valid token is present, but never rejects. */
async function optionalProtect(req, res, next) {
  const token = extractToken(req);
  if (!token) return next();
  try {
    const decoded = verifyToken(token);
    const row = await UserModel.findById(decoded.id);
    if (row && (decoded.tokenVersion ?? 0) === row.token_version) {
      req.user = UserModel.toPublic(row);
    }
  } catch (error) {
    // invalid token: continue anonymously
  }
  next();
}

module.exports = { protect, authorize, optionalProtect };
