const logger = require('../utils/logger');
const BookingModel = require('../models/bookingModel');

/**
 * Everything that talks to Stripe. The client is created on first use so the
 * app still boots (and the rest of the API still works) without Stripe keys.
 */
let client = null;
function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    const err = new Error('Stripe is not configured (STRIPE_SECRET_KEY is missing)');
    err.statusCode = 503;
    throw err;
  }
  if (!client) client = require('stripe')(process.env.STRIPE_SECRET_KEY);
  return client;
}

const site = () => process.env.FRONTEND_URL || 'https://courses4me.co.uk';
/** Stripe works in the smallest currency unit. */
const toPence = (amount) => Math.round(Number(amount) * 100);

const StripeService = {
  isConfigured: () => Boolean(process.env.STRIPE_SECRET_KEY),

  /** Hosted checkout page for a booking. */
  async createCheckoutSession({ booking, courseTitle }) {
    const session = await stripe().checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'gbp',
          product_data: {
            name: courseTitle,
            description: `Course booking at ${booking.session.locationName}`
          },
          unit_amount: toPence(booking.totalAmount)
        },
        quantity: 1
      }],
      mode: 'payment',
      success_url: `${site()}/booking-success?session_id={CHECKOUT_SESSION_ID}&bookingRef=${booking.bookingReference}`,
      cancel_url: `${site()}/booking-cancelled?bookingId=${booking.id}`,
      metadata: { bookingId: String(booking.id) }
    });
    return session;
  },

  /** Payment intent for the embedded card form. */
  async createPaymentIntent({ booking }) {
    return stripe().paymentIntents.create({
      amount: toPence(booking.totalAmount),
      currency: 'gbp',
      payment_method_types: ['card'],
      metadata: { bookingId: String(booking.id) }
    });
  },

  /** Checkout page for the rescheduling fee; returns the URL or null. */
  async createRescheduleCheckout({ booking, courseTitle, amountPence }) {
    try {
      const session = await stripe().checkout.sessions.create({
        payment_method_types: ['card'],
        metadata: { bookingId: String(booking.id), action: 'reschedulePayment' },
        line_items: [{
          price_data: {
            currency: 'gbp',
            product_data: { name: `Rescheduling Fee for ${courseTitle || 'Course'}` },
            unit_amount: amountPence
          },
          quantity: 1
        }],
        mode: 'payment',
        success_url: `${site()}/payment-success?bookingRef=${booking.bookingReference}`,
        cancel_url: `${site()}/payment-cancelled`
      });
      return session.url;
    } catch (err) {
      logger.error('[stripe] could not create the reschedule payment link:', err.message);
      return null;
    }
  },

  /**
   * Asks Stripe whether a pending booking was in fact paid, and marks it paid
   * when it was. Used wherever a booking is read back, because a webhook can
   * be delayed or lost. Returns true when the booking was updated.
   */
  async confirmCheckoutSession(row) {
    if (!row?.stripe_session_id || !StripeService.isConfigured()) return false;
    try {
      const session = await stripe().checkout.sessions.retrieve(row.stripe_session_id);
      if (session.payment_status !== 'paid') return false;
      await BookingModel.update(row.id, {
        status: 'PAID',
        paymentStatus: 'Paid',
        paymentIntentId: session.payment_intent || row.payment_intent_id
      });
      logger.info(`[stripe] booking ${row.id} confirmed as paid from its checkout session`);
      return true;
    } catch (err) {
      logger.error(`[stripe] could not verify the session of booking ${row.id}: ${err.message}`);
      return false;
    }
  },

  /** The payment intent behind a checkout session, or null. */
  async paymentIntentOfSession(sessionId) {
    try {
      const session = await stripe().checkout.sessions.retrieve(sessionId);
      return session.payment_intent || null;
    } catch (err) {
      logger.error('[stripe] could not read the checkout session:', err.message);
      return null;
    }
  },

  /** Refunds a payment. Never throws: the caller reports the failure. */
  async refund({ paymentIntentId, amountPence, reason }) {
    try {
      const payload = { payment_intent: paymentIntentId };
      if (amountPence !== undefined) payload.amount = amountPence;
      if (reason) payload.reason = reason;
      const refund = await stripe().refunds.create(payload);
      return { ok: true, id: refund.id };
    } catch (err) {
      logger.error('[stripe] refund failed:', err.message);
      return { ok: false, error: err.message };
    }
  },

  /** Verifies the webhook signature; throws when it does not match. */
  constructWebhookEvent(rawBody, signature) {
    return stripe().webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  }
};

module.exports = StripeService;
