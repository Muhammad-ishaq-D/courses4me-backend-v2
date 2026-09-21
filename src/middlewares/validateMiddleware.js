const Joi = require('joi');

/**
 * Validates req[source] against a Joi schema and replaces it with the
 * validated value. Unknown keys are stripped, so controllers that spread the
 * body into an INSERT/UPDATE can only ever write whitelisted columns.
 *
 * Usage: router.post('/login', validate(validators.auth.login), AuthController.login)
 *        router.get('/users', validate(validators.auth.listUsers, 'query'), ...)
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const { value, error } = schema.validate(req[source] || {}, {
      abortEarly: false,
      stripUnknown: true,
      convert: true
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: error.details.map(d => ({
          field: d.path.join('.'),
          message: d.message.replace(/"/g, '')
        }))
      });
    }

    if (source === 'query') {
      // Express 5 exposes req.query as a prototype getter; define an own
      // property so downstream handlers read the validated, coerced values.
      Object.defineProperty(req, 'query', { value, writable: true, configurable: true, enumerable: true });
    } else {
      req[source] = value;
    }
    next();
  };
}

module.exports = { validate, Joi };
