const { Joi, id, optionalString } = require('./common');

const CATEGORIES = ['SIA Training', 'First Aid', 'Health & Safety', 'Specialist'];
const STATUSES = ['Published', 'Draft', 'Archived'];
const AVAILABILITY = ['Available', 'Selling Fast', 'Sold Out'];

const money = Joi.number().min(0).precision(2);
const optionalMoney = money.allow(null, '');
const stringList = Joi.array().items(Joi.string().trim().max(1000).allow('')).max(100);

const schedule = Joi.object({
  time: optionalString(100),
  startDate: Joi.date().iso().required(),
  endDate: Joi.date().iso().min(Joi.ref('startDate')).required(),
  price: money.required(),
  seatsAvailable: Joi.number().integer().min(0).default(20),
  availabilityStatus: Joi.string().valid(...AVAILABILITY).default('Available')
});

const venue = Joi.object({
  name: Joi.string().trim().min(1).max(255).required(),
  schedules: Joi.array().items(schedule).max(200).default([])
});

const pricing = Joi.object({
  basePrice: money,
  salePrice: optionalMoney,
  originalPrice: optionalMoney
});

const instructor = Joi.object({
  name: optionalString(150),
  title: optionalString(150),
  bio: optionalString(5000),
  photo: Joi.string().max(10 * 1024 * 1024).allow(null, '')
});

const base = {
  title: Joi.string().trim().min(3).max(255),
  licenseType: optionalString(150),
  category: Joi.string().valid(...CATEGORIES),
  subtitle: optionalString(255),
  shortDescription: Joi.string().trim().min(1).max(5000),
  fullDescription: Joi.string().trim().min(1),
  thumbnail: Joi.string().max(10 * 1024 * 1024).allow(null, ''),
  salary: optionalString(100),
  duration: optionalString(100),
  valid: optionalString(100),
  experience: optionalString(100),
  trainingCount: optionalString(100),
  rating: optionalString(20),
  highlights: stringList,
  learningPoints: stringList,
  requirements: stringList,
  applicationSteps: Joi.array().items(Joi.object({
    title: optionalString(255),
    desc: optionalString(2000),
    description: optionalString(2000)
  })).max(50),
  // The fee table prints as written, e.g. "£220" or "Included"
  pricingBreakdown: Joi.array().items(Joi.object({
    label: optionalString(255),
    price: optionalString(100)
  })).max(50),
  renewalInfo: optionalString(5000),
  pricing,
  locations: Joi.array().items(venue).max(100),
  instructor,
  relatedCourses: Joi.array().items(Joi.alternatives().try(id, Joi.string().trim().pattern(/^\d+$/))).max(50),
  status: Joi.string().valid(...STATUSES),
  isPopular: Joi.boolean(),
  icon: optionalString(60),
  iconColor: optionalString(60),
  holderName: optionalString(150),
  email: Joi.string().trim().lowercase().email({ tlds: { allow: false } }).max(190).allow(null, ''),
  licenseAuthority: optionalString(190),
  expiryDate: Joi.date().iso().allow(null, '')
};

// Required on create: what the admin form marks mandatory.
const create = Joi.object({
  ...base,
  title: base.title.required(),
  category: base.category.required(),
  shortDescription: base.shortDescription.required(),
  fullDescription: base.fullDescription.required(),
  pricing: pricing.keys({ basePrice: money.required() }).required()
});

const update = Joi.object(base).min(1);

// GET /licenses (query)
const list = Joi.object({
  category: Joi.string().valid(...CATEGORIES).allow(''),
  status: Joi.string().valid(...STATUSES).allow(''),
  search: optionalString(255),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(10)
});

const idParam = Joi.object({ id: id.required() });

module.exports = { CATEGORIES, STATUSES, create, update, list, idParam };
