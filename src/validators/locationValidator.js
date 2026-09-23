const { Joi, id, optionalString } = require('./common');

const FACILITIES = ['wifi', 'projector', 'whiteboard', 'catering', 'toilets', 'disabled_access', 'prayer_room', 'air_conditioning'];
const STATUSES = ['Active', 'Inactive'];

const imageUrl = Joi.string().max(500).allow(null, '');

const base = {
  name: Joi.string().trim().min(2).max(255),
  venueName: optionalString(255),
  addressLine1: Joi.string().trim().min(2).max(255),
  addressLine2: optionalString(255),
  city: Joi.string().trim().min(2).max(120),
  postcode: Joi.string().trim().min(3).max(20),
  country: optionalString(100),
  mapsUrl: optionalString(1000),
  parking: Joi.boolean(),
  parkingNotes: optionalString(2000),
  accessibility: optionalString(2000),
  transport: optionalString(2000),
  facilities: Joi.array().items(Joi.string().valid(...FACILITIES)).max(FACILITIES.length),
  mainImage: imageUrl,
  gallery: Joi.array().items(Joi.string().max(500).allow('')).max(50),
  localMarketOverview: optionalString(5000),
  localVenues: optionalString(5000),
  surroundingAreas: optionalString(5000),
  status: Joi.string().valid(...STATUSES)
};

const create = Joi.object({
  ...base,
  name: base.name.required(),
  addressLine1: base.addressLine1.required(),
  city: base.city.required(),
  postcode: base.postcode.required()
});

const update = Joi.object(base).min(1);

// PATCH /locations/:id/status — omitting the status flips it
const setStatus = Joi.object({ status: Joi.string().valid(...STATUSES) });

// GET /locations (query)
const list = Joi.object({
  search: optionalString(255),
  status: Joi.string().valid(...STATUSES).allow(''),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(20)
});

const idParam = Joi.object({ id: id.required() });

module.exports = { FACILITIES, STATUSES, create, update, setStatus, list, idParam };
