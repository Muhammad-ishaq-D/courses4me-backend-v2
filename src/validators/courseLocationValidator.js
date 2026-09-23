const { Joi, id, optionalString } = require('./common');

const STATUSES = ['Active', 'Inactive'];
const TIMINGS_TYPES = ['same', 'flexible'];
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const money = Joi.number().min(0).precision(2);
// Times come from <input type="time">: "09:00", or blank when the day is off.
const time = Joi.string().trim().pattern(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/).allow(null, '')
  .messages({ 'string.pattern.base': 'must be a time in HH:MM format' });

const dayTimings = Joi.object({
  isOff: Joi.boolean().default(false),
  startTime: time,
  endTime: time
});

const weeklyTimings = Joi.object(Object.fromEntries(DAYS.map(d => [d, dayTimings])));

const dateBase = {
  startDate: Joi.date().iso(),
  endDate: Joi.date().iso().min(Joi.ref('startDate')),
  startTime: time,
  endTime: time,
  availableSeats: Joi.number().integer().min(0),
  timingsType: Joi.string().valid(...TIMINGS_TYPES),
  weeklyTimings
};

// A date inside a link payload: an existing row carries its id.
const nestedDate = Joi.object({
  ...dateBase,
  _id: Joi.alternatives().try(id, Joi.string().trim().pattern(/^\d+$/)),
  id: Joi.alternatives().try(id, Joi.string().trim().pattern(/^\d+$/)),
  startDate: dateBase.startDate.required(),
  endDate: dateBase.endDate.required(),
  availableSeats: dateBase.availableSeats.required()
});

const createDate = Joi.object({
  ...dateBase,
  startDate: dateBase.startDate.required(),
  endDate: dateBase.endDate.required(),
  availableSeats: dateBase.availableSeats.required()
});

const updateDate = Joi.object(dateBase).min(1);

const linkBase = {
  price: money,
  vatIncluded: Joi.boolean(),
  depositRequired: Joi.boolean(),
  depositAmount: money.allow(null, ''),
  whatsIncluded: optionalString(5000),
  status: Joi.string().valid(...STATUSES),
  dates: Joi.array().items(nestedDate).max(200)
};

const create = Joi.object({
  ...linkBase,
  locationId: id.required(),
  price: money.required()
});

const update = Joi.object(linkBase).min(1);

const list = Joi.object({ activeOnly: Joi.string().valid('true', 'false').allow('') });

const idParam = Joi.object({ id: id.required() });
const courseIdParam = Joi.object({ courseId: id.required() });

module.exports = { STATUSES, TIMINGS_TYPES, DAYS, create, update, createDate, updateDate, list, idParam, courseIdParam };
