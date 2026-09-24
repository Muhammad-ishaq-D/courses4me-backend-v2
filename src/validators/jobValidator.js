const { Joi, id, email, optionalString } = require('./common');

const TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship', 'Remote'];
const CATEGORIES = [
  'SIA Training', 'First Aid', 'Health & Safety', 'Specialist',
  'Security Officer', 'Door Supervisor', 'Event Security', 'CCTV Operator', 'Close Protection',
  'First Aider', 'Paediatric First Aider',
  'Safety Inspector', 'Risk Assessor',
  'Security Manager'
];
const LISTING_STATUSES = ['Active', 'Paused', 'Closed'];
const APPLICATION_STATUSES = ['Pending', 'Shortlisted', 'Interview', 'Rejected', 'Accepted'];

// The admin form sends the requirements as an array, or as one comma-separated
// line; both end up as a list.
const requirements = Joi.alternatives().try(
  Joi.array().items(Joi.string().trim().max(1000).allow('')).max(100),
  Joi.string().allow('').custom((value) => {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      // not JSON: fall through to the comma-separated form
    }
    return trimmed.split(',').map(r => r.trim()).filter(Boolean);
  })
);

const listingBase = {
  title: Joi.string().trim().min(3).max(255),
  company: Joi.string().trim().min(1).max(255),
  location: Joi.string().trim().min(1).max(255),
  type: Joi.string().valid(...TYPES),
  category: Joi.string().valid(...CATEGORIES),
  career: optionalString(150),
  salary: Joi.string().trim().min(1).max(150),
  description: Joi.string().trim().min(1),
  requirements,
  status: Joi.string().valid(...LISTING_STATUSES),
  isFeatured: Joi.boolean()
};

const createListing = Joi.object({
  ...listingBase,
  title: listingBase.title.required(),
  company: listingBase.company.required(),
  location: listingBase.location.required(),
  category: listingBase.category.required(),
  salary: listingBase.salary.required(),
  description: listingBase.description.required()
});

const updateListing = Joi.object(listingBase).min(1);

// GET /jobs (query)
const listListings = Joi.object({
  category: Joi.string().valid(...CATEGORIES).allow(''),
  type: Joi.string().valid(...TYPES).allow(''),
  status: Joi.string().valid(...LISTING_STATUSES).allow(''),
  search: optionalString(255)
});

// POST /jobs/apply/:id
const apply = Joi.object({
  firstName: Joi.string().trim().min(1).max(100).required(),
  lastName: Joi.string().trim().min(1).max(100).required(),
  email: email.required(),
  phone: Joi.string().trim().min(1).max(30).required(),
  address: Joi.string().trim().min(1).max(500).required(),
  city: Joi.string().trim().min(1).max(120).required(),
  postcode: Joi.string().trim().min(1).max(20).required(),
  license: Joi.string().trim().min(1).max(150).required(),
  experience: Joi.string().trim().min(1).max(150).required(),
  availability: Joi.string().trim().min(1).max(150).required(),
  cover: Joi.string().trim().min(1).required(),
  cvFile: optionalString(500),
  // Optional: a guest can create an account while applying
  password: Joi.string().min(8).max(128).allow(null, '')
});

// GET /jobs/applications (query)
const listApplications = Joi.object({
  status: Joi.string().valid(...APPLICATION_STATUSES).allow(''),
  search: optionalString(190)
});

// PUT /jobs/applications/:id/status
const updateApplicationStatus = Joi.object({
  status: Joi.string().valid(...APPLICATION_STATUSES).required()
    .messages({ 'any.only': 'Invalid application status', 'any.required': 'Invalid application status' }),
  reason: optionalString(2000)
});

const idParam = Joi.object({ id: id.required() });

module.exports = {
  TYPES,
  CATEGORIES,
  LISTING_STATUSES,
  APPLICATION_STATUSES,
  createListing,
  updateListing,
  listListings,
  apply,
  listApplications,
  updateApplicationStatus,
  idParam
};
