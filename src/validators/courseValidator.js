const { Joi, id, optionalString } = require('./common');

const CATEGORIES = ['SIA Training', 'Specialist', 'First Aid', 'Health & Safety', 'Hospitality'];
const STATUSES = ['Published', 'Draft', 'Archived'];
const AVAILABILITY = ['Available', 'Selling Fast', 'Sold Out'];

const money = Joi.number().min(0).precision(2);
const optionalMoney = money.allow(null, '');
// Lists arrive as arrays of strings; blank entries are dropped by the model.
const stringList = Joi.array().items(Joi.string().trim().max(1000).allow('')).max(100);

const schedule = Joi.object({
  time: Joi.string().trim().max(100).required(),
  startDate: Joi.date().iso().required(),
  endDate: Joi.date().iso().min(Joi.ref('startDate')).required(),
  price: money.required(),
  seatsAvailable: Joi.number().integer().min(0).default(20),
  availabilityStatus: Joi.string().valid(...AVAILABILITY).default('Available')
});

const venue = Joi.object({
  name: Joi.string().trim().min(1).max(255).required(),
  address: optionalString(500),
  postcode: Joi.string().trim().min(3).max(20).required(),
  // Resolved from the postcode server-side; accepted so a round-tripped
  // payload is not rejected.
  latitude: Joi.number().min(-90).max(90).allow(null, ''),
  longitude: Joi.number().min(-180).max(180).allow(null, ''),
  parkingMain: optionalString(255),
  parkingSub: optionalString(255),
  commuteMain: optionalString(255),
  commuteSub: optionalString(255),
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

const guarantee = Joi.object({
  title: optionalString(150),
  description: optionalString(500)
});

const base = {
  title: Joi.string().trim().min(3).max(255),
  category: Joi.string().valid(...CATEGORIES),
  subtitle: optionalString(255),
  level: optionalString(50),
  duration: Joi.string().trim().max(100),
  reviewsCount: optionalString(50),
  bookedCount: optionalString(50),
  passRate: optionalString(50),
  shortDescription: Joi.string().trim().min(20).max(5000),
  fullDescription: Joi.string().trim().min(1),
  highlights: stringList,
  learningPoints: stringList,
  targetAudience: stringList,
  requirements: stringList,
  guarantee,
  // A Cloudinary URL, or a base64 data URI when the admin panel posts inline.
  thumbnail: Joi.string().max(10 * 1024 * 1024).allow(null, ''),
  pricing,
  locations: Joi.array().items(venue).max(100),
  locationId: id.allow(null, ''),
  centerId: optionalString(64),
  centerName: optionalString(255),
  instructor,
  status: Joi.string().valid(...STATUSES),
  isPopular: Joi.boolean()
};

// Required on create: what the admin form marks mandatory.
const create = Joi.object({
  ...base,
  title: base.title.required(),
  category: base.category.required(),
  duration: base.duration.required(),
  shortDescription: base.shortDescription.required(),
  fullDescription: base.fullDescription.required(),
  pricing: pricing.keys({ basePrice: money.required() }).required()
});

const update = Joi.object(base).min(1);

// GET /courses (query)
const list = Joi.object({
  category: Joi.string().valid(...CATEGORIES).allow(''),
  status: Joi.string().valid(...STATUSES).allow(''),
  search: optionalString(255),
  location: optionalString(255),
  // The admin table sends these; the listing is not paginated.
  page: Joi.any().strip(),
  limit: Joi.any().strip()
});

const idParam = Joi.object({ id: id.required() });

module.exports = { CATEGORIES, STATUSES, create, update, list, idParam };
