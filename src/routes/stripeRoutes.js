const express = require('express');
const StripeController = require('../controllers/stripeController');
const { validate } = require('../middlewares/validateMiddleware');
const validators = require('../validators');

const router = express.Router();
const booking = validators.booking;

// The webhook needs the untouched request body to verify Stripe's signature,
// so this router is mounted before the JSON body parser.
router.post('/webhook', express.raw({ type: '*/*' }), StripeController.handleWebhook);

router.post('/create-checkout-session/:bookingId', express.json(), validate(booking.bookingIdParam, 'params'), StripeController.createCheckoutSession);
router.post('/create-payment-intent/:bookingId', express.json(), validate(booking.bookingIdParam, 'params'), StripeController.createPaymentIntent);

module.exports = router;
