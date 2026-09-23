const { Joi, id, email, optionalString } = require('./common');

const STATUSES = ['PENDING', 'PAID', 'EXPIRED', 'CANCELLED'];
const PAYMENT_STATUSES = ['Pending', 'Paid', 'Failed', 'Refunded'];
const PAYMENT_METHODS = ['card', 'paypal', 'instalments', 'klarna'];
const LIFECYCLE_ACTIONS = ['extend', 'reschedule', 'postpone', 'cancel', 'complete', 'resume'];
const USER_STATUSES = ['active', 'inactive', 'suspended', 'blocked', 'pending verification'];

const money = Joi.number().min(0).precision(2);

// POST /bookings — the checkout payload
const create = Joi.object({
  courseId: id.required(),
  session: Joi.object({
    scheduleId: Joi.alternatives().try(id, Joi.string().trim().pattern(/^\d+$/)).allow(null, ''),
    location: optionalString(255),
    startDate: Joi.date().iso().allow(null, ''),
    endDate: Joi.date().iso().allow(null, ''),
    time: optionalString(100),
    price: money.allow(null, '')
  }).required(),
  customerDetails: Joi.object({
    firstName: Joi.string().trim().min(1).max(100).required(),
    lastName: Joi.string().trim().min(1).max(100).required(),
    email: email.required(),
    // Sent from a phone field that may contain spaces
    phone: Joi.string().trim().custom(v => String(v).replace(/\s/g, '')).pattern(/^(\+)?\d{9,13}$/).required()
      .messages({ 'string.pattern.base': 'must be a valid phone number' }),
    dob: optionalString(30),
    // Optional: a guest can set a password while booking
    password: Joi.string().min(8).max(128).allow(null, '')
  }).required(),
  billingAddress: Joi.object({
    postcode: Joi.string().trim().min(3).max(10).required(),
    line1: Joi.string().trim().min(1).max(255).required(),
    line2: optionalString(255),
    city: Joi.string().trim().min(1).max(100).required()
  }).required(),
  packageName: optionalString(150),
  options: Joi.object({ easyApply: Joi.boolean() }),
  paymentMethod: Joi.string().valid(...PAYMENT_METHODS),
  additionalInfo: optionalString(5000),
  totalAmount: money.required()
});

// GET /bookings (query)
const list = Joi.object({
  status: optionalString(50),
  paymentStatus: optionalString(50),
  fromDate: Joi.date().iso().allow(''),
  toDate: Joi.date().iso().allow(''),
  search: optionalString(190)
});

// PUT /bookings/:id
const update = Joi.object({
  status: Joi.string().valid(...STATUSES),
  paymentStatus: Joi.string().valid(...PAYMENT_STATUSES)
}).min(1);

// PUT /bookings/:id/lifecycle
const lifecycle = Joi.object({
  action: Joi.string().valid(...LIFECYCLE_ACTIONS).required(),
  newStartDate: Joi.date().iso().allow(null, ''),
  newEndDate: Joi.date().iso().allow(null, ''),
  reason: optionalString(1000),
  forceBypass48h: Joi.boolean()
});

// POST /bookings/:id/refund/request
const refundRequest = Joi.object({
  reason: Joi.string().trim().min(1).max(2000).required()
    .messages({ 'any.required': 'Please provide a reason for the refund request.', 'string.empty': 'Please provide a reason for the refund request.' })
});

// POST /bookings/:id/refund/process
const refundProcess = Joi.object({
  action: Joi.string().valid('approve', 'reject').required()
    .messages({ 'any.only': 'Invalid action. Must be approve or reject.', 'any.required': 'Invalid action. Must be approve or reject.' }),
  adminNotes: optionalString(2000),
  refundType: Joi.string().valid('full', 'partial'),
  deductionAmount: money.allow(null, '')
});

// GET /bookings/users (query)
const listCustomers = Joi.object({
  status: optionalString(50),
  fromDate: Joi.date().iso().allow(''),
  toDate: Joi.date().iso().allow(''),
  search: optionalString(190)
});

// PUT /bookings/users/:id — the fields the admin table can edit
const updateCustomer = Joi.object({
  name: Joi.string().trim().min(2).max(150),
  email,
  phone: optionalString(30),
  dob: optionalString(30),
  jobTitle: optionalString(150),
  bio: optionalString(5000),
  status: Joi.string().valid(...USER_STATUSES),
  statusReason: optionalString(500),
  billingAddress: Joi.object({
    postcode: optionalString(20),
    line1: optionalString(255),
    line2: optionalString(255),
    city: optionalString(100)
  })
}).min(1);

// POST /bookings/users/bulk-delete
const bulkDelete = Joi.object({
  ids: Joi.array().items(id).min(1).required()
    .messages({ 'any.required': 'Please provide user IDs', 'array.min': 'Please provide user IDs' })
});

const idParam = Joi.object({ id: id.required() });
const courseIdParam = Joi.object({ courseId: id.required() });
const bookingIdParam = Joi.object({ bookingId: id.required() });
const referenceParam = Joi.object({ ref: Joi.string().trim().max(20).required() });

module.exports = {
  STATUSES,
  PAYMENT_STATUSES,
  PAYMENT_METHODS,
  LIFECYCLE_ACTIONS,
  create,
  list,
  update,
  lifecycle,
  refundRequest,
  refundProcess,
  listCustomers,
  updateCustomer,
  bulkDelete,
  idParam,
  courseIdParam,
  bookingIdParam,
  referenceParam
};
