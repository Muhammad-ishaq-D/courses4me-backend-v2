const { Joi, id, optionalString } = require('./common');

// POST /reviews
const create = Joi.object({
  bookingId: id.required()
    .messages({ 'any.required': 'bookingId and rating are required.' }),
  rating: Joi.number().integer().min(1).max(5).required()
    .messages({
      'any.required': 'bookingId and rating are required.',
      'number.min': 'Rating must be between 1 and 5.',
      'number.max': 'Rating must be between 1 and 5.'
    }),
  comment: optionalString(1000)
});

module.exports = { create };
