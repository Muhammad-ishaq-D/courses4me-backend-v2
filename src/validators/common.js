const Joi = require('joi');

// Shared building blocks. Everything is coerced (Joi convert: true) because
// query strings and multipart forms send numbers/booleans as strings.
const id = Joi.number().integer().positive();
const optionalId = id.allow(null, '');
const email = Joi.string().trim().lowercase().email({ tlds: { allow: false } }).max(190);
const optionalString = (max) => Joi.string().trim().max(max).allow(null, '');
const optionalDate = Joi.date().iso().allow(null, '');
const optionalBool = Joi.alternatives()
  .try(Joi.boolean(), Joi.number().valid(0, 1), Joi.string().valid('0', '1', 'true', 'false'))
  .allow(null, '');

// Password policy (unchanged from v1): 8–128 chars, one uppercase, one digit,
// one symbol, never whitespace-only.
const password = Joi.string()
  .min(8)
  .max(128)
  .pattern(/[A-Z]/, 'uppercase letter')
  .pattern(/[0-9]/, 'number')
  .pattern(/[^A-Za-z0-9]/, 'special character')
  .custom((value, helpers) => (value.trim().length < 8 ? helpers.error('string.min') : value))
  .messages({
    'string.min': 'Password must be at least 8 characters',
    'string.max': 'Password must be at most 128 characters',
    'string.pattern.name': 'Password must contain at least one {#name}'
  });

module.exports = { Joi, id, optionalId, email, optionalString, optionalDate, optionalBool, password };
