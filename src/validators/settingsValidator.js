const { Joi, optionalString } = require('./common');

// The Settings page owns the shape of `general`, so its keys are accepted as
// given, with sane limits on each value.
const general = Joi.object()
  .pattern(Joi.string().max(60), Joi.alternatives().try(Joi.string().allow('').max(500), Joi.number(), Joi.boolean(), null))
  .max(40);

// A map of alert toggles, e.g. { bookingAlerts: true }.
const notifications = Joi.object().pattern(Joi.string().max(60), Joi.boolean()).max(40);

const emailTemplates = Joi.array().items(Joi.object({
  key: Joi.string().trim().min(1).max(60).required(),
  title: optionalString(150),
  description: optionalString(500),
  isActive: Joi.boolean().default(true)
})).max(50);

const update = Joi.object({ general, notifications, emailTemplates }).min(1);

module.exports = { update };
