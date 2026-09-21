const express = require('express');
const router = express.Router();
const {
    createCheckoutSession,
    createPaymentIntent,
    handleWebhook
} = require('../controllers/stripeController');

router.post('/create-checkout-session/:bookingId', createCheckoutSession);
router.post('/create-payment-intent/:bookingId', createPaymentIntent);
router.post('/webhook', express.raw({ type: '*/*' }), handleWebhook);

module.exports = router;
