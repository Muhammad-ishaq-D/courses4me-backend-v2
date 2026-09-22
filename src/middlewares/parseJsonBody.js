/**
 * Turns the given body fields back into objects when they arrive as JSON
 * strings, which is how they are sent by a multipart form that also uploads
 * files. A value that will not parse is left untouched for the validator to
 * reject.
 *
 * Usage: router.post('/', parseJsonBody(['pricing', 'locations']), validate(schema), handler)
 */
function parseJsonBody(fields) {
  return (req, res, next) => {
    for (const field of fields) {
      if (typeof req.body?.[field] === 'string') {
        try {
          req.body[field] = JSON.parse(req.body[field]);
        } catch (e) {
          // not JSON: leave as-is
        }
      }
    }
    next();
  };
}

module.exports = parseJsonBody;
