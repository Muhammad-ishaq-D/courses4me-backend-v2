const { body, validationResult } = require('express-validator');

/**
 * Middleware to handle validation results and return errors if any.
 */
const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        console.log('Request Body:', JSON.stringify(req.body, null, 2));
        console.log('Validation Errors:', JSON.stringify(errors.array(), null, 2));
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: errors.array().map(err => ({
                field: err.path,
                message: err.msg
            }))
        });
    }
    next();
};

// Auth validation moved to src/validators/authValidator.js (Joi). The rules
// below belong to modules not yet migrated to MySQL.

// ─── BOOKING VALIDATORS ───

exports.validateBooking = [
    body('customerDetails.firstName').trim().notEmpty().withMessage('First name is required'),
    body('customerDetails.lastName').trim().notEmpty().withMessage('Last name is required'),
    body('customerDetails.email').trim().isEmail().withMessage('Valid email is required'),
    body('customerDetails.phone').trim().customSanitizer(value => value ? value.replace(/\s/g, '') : '').matches(/^(\+)?\d{9,13}$/).withMessage('Valid phone number is required'),
    body('billingAddress.postcode').trim().notEmpty().withMessage('Postcode is required').isLength({ min: 3, max: 10 }).withMessage('Invalid postcode length'),
    body('billingAddress.line1').trim().notEmpty().withMessage('Address line 1 is required'),
    body('billingAddress.city').trim().notEmpty().withMessage('City is required'),
    body('courseId').isMongoId().withMessage('Invalid course ID'),
    handleValidationErrors
];

// ─── COURSE VALIDATORS ───

exports.validateCourse = [
    body('title').trim().notEmpty().withMessage('Course title is required').isLength({ min: 3 }).withMessage('Title too short'),
    body('category').trim().notEmpty().withMessage('Category is required'),
    body('shortDescription').trim().notEmpty().withMessage('Short description is required').isLength({ min: 20 }).withMessage('Description too short'),
    body('pricing.basePrice').isNumeric().withMessage('Base price must be a number'),
    handleValidationErrors
];

// ─── LICENSE VALIDATORS ───

exports.validateLicense = [
    body('title').trim().notEmpty().withMessage('License title is required'),
    body('category').trim().notEmpty().withMessage('Category is required'),
    body('shortDescription').trim().notEmpty().withMessage('Short description is required'),
    body('pricing.basePrice').isNumeric().withMessage('Base price must be a number'),
    handleValidationErrors
];

