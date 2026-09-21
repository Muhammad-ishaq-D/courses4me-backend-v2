const { Joi, id, email, optionalString, password } = require('./common');

const USER_ROLES = ['admin', 'editor', 'customer'];
const USER_STATUSES = ['active', 'inactive', 'suspended', 'blocked', 'pending verification'];

// POST /auth/login, /admin/auth/login
const login = Joi.object({
  email: email.required(),
  password: Joi.string().min(1).max(128).required()
});

// POST /auth/register — public signup creates customers only
const register = Joi.object({
  name: Joi.string().trim().min(2).max(150).required(),
  email: email.required(),
  password: password.required(),
  role: Joi.string().valid('customer').default('customer')
});

// POST /auth/check-email
const checkEmail = Joi.object({
  email: email.required()
});

// PUT /auth/updatedetails, /auth/profile
// profileImage may be a URL or a data:image base64 string (uploaded to Cloudinary).
const updateDetails = Joi.object({
  name: Joi.string().trim().min(2).max(150),
  email,
  phone: optionalString(30),
  jobTitle: optionalString(150),
  bio: optionalString(5000),
  profileImage: Joi.string().max(10 * 1024 * 1024).allow(null, '')
});

// PUT /auth/update-password
const updatePassword = Joi.object({
  currentPassword: Joi.string().min(1).max(128).required(),
  newPassword: password.required()
});

// POST /admin/auth/forgot-password, /portal/auth/forgot-password
const forgotPassword = Joi.object({
  email: email.required()
});

// POST /admin/auth/verify-otp — accepts `code` (admin panel) or `otp`
const verifyOtp = Joi.object({
  code: Joi.string().trim().pattern(/^\d{6}$/),
  otp: Joi.string().trim().pattern(/^\d{6}$/)
}).or('code', 'otp').messages({ 'object.missing': 'Verification code is required' });

// POST /admin/auth/reset-password, /portal/auth/reset-password
// `token`/`password` are the legacy portal field names, still accepted.
const resetPassword = Joi.object({
  resetToken: Joi.string().trim().hex().length(64),
  token: Joi.string().trim().hex().length(64),
  newPassword: password,
  password
})
  .or('resetToken', 'token')
  .or('newPassword', 'password')
  .messages({ 'object.missing': 'Reset token and new password are required' });

// GET /auth/users (query)
const listUsers = Joi.object({
  search: optionalString(190),
  status: Joi.string().valid(...USER_STATUSES).allow(''),
  role: Joi.string().valid(...USER_ROLES).allow('')
});

// PUT /auth/users/:id/status
const updateUserStatus = Joi.object({
  status: Joi.string().valid(...USER_STATUSES).required(),
  reason: optionalString(500)
});

// :id route params
const idParam = Joi.object({ id: id.required() });

module.exports = {
  USER_ROLES,
  USER_STATUSES,
  login,
  register,
  checkEmail,
  updateDetails,
  updatePassword,
  forgotPassword,
  verifyOtp,
  resetPassword,
  listUsers,
  updateUserStatus,
  idParam
};
