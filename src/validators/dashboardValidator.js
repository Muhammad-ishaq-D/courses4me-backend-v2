const { Joi, id } = require('./common');

// GET /dashboard (query) — the page filters by a date range
const stats = Joi.object({
  startDate: Joi.date().iso().allow(''),
  endDate: Joi.date().iso().allow('')
});

const idParam = Joi.object({ id: id.required() });

module.exports = { stats, idParam };
