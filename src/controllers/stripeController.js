const BookingModel = require('../models/bookingModel');
const notifyAdmins = require('../utils/notifyAdmins');
const logger = require('../utils/logger');
const seats = require('../services/seatService');
const emails = require('../services/bookingEmailService');
const stripeService = require('../services/stripeService');
const { findCourse, expandBooking } = require('../services/bookingService');

/** Bookings in these states can no longer be paid for. */
function blockedReason(row) {
  if (row.status === 'EXPIRED') {
    return 'This booking has expired because payment was not completed within 1 hour. Please create a new booking.';
  }
  if (row.status === 'CANCELLED') return 'This booking has been cancelled.';
  return null;
}

const StripeController = {
  // @desc    Hosted checkout page for a booking
  // @route   POST /api/stripe/create-checkout-session/:bookingId
  // @access  Public
  async createCheckoutSession(req, res, next) {
    try {
      const row = await BookingModel.findById(req.params.bookingId);
      if (!row) return res.status(404).json({ success: false, message: 'Booking not found' });

      const blocked = blockedReason(row);
      if (blocked) return res.status(400).json({ success: false, message: blocked });

      const booking = await expandBooking(row, { withChildren: false });
      const course = await findCourse(row.course_id, row.course_type);

      const session = await stripeService.createCheckoutSession({ booking, courseTitle: course?.title || 'Course booking' });
      await BookingModel.update(row.id, { stripeSessionId: session.id });

      res.status(200).json({ success: true, url: session.url });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Payment intent for the embedded card form
  // @route   POST /api/stripe/create-payment-intent/:bookingId
  // @access  Public
  async createPaymentIntent(req, res, next) {
    try {
      const row = await BookingModel.findById(req.params.bookingId);
      if (!row) return res.status(404).json({ success: false, message: 'Booking not found' });

      if (row.status === 'PAID') {
        return res.status(400).json({ success: false, message: 'This booking has already been paid for.' });
      }
      const blocked = blockedReason(row);
      if (blocked) return res.status(400).json({ success: false, message: blocked });

      const booking = await expandBooking(row, { withChildren: false });
      const intent = await stripeService.createPaymentIntent({ booking });
      await BookingModel.update(row.id, { paymentIntentId: intent.id });

      res.status(200).json({
        success: true,
        clientSecret: intent.client_secret,
        bookingReference: row.booking_reference
      });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Stripe webhook (raw body, signature verified)
  // @route   POST /api/stripe/webhook
  // @access  Public
  async handleWebhook(req, res) {
    let event;
    try {
      event = stripeService.constructWebhookEvent(req.body, req.headers['stripe-signature']);
    } catch (err) {
      logger.error('[stripe] webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        await route(session.metadata?.bookingId, session.metadata?.action, session.payment_intent);
      } else if (event.type === 'payment_intent.succeeded') {
        const intent = event.data.object;
        await route(intent.metadata?.bookingId, intent.metadata?.action, intent.id);
      } else if (event.type === 'payment_intent.payment_failed') {
        const intent = event.data.object;
        if (intent.metadata?.bookingId) {
          await handlePaymentFailed(intent.metadata.bookingId, intent);
        }
      }
    } catch (err) {
      // Stripe retries on a non-2xx, and the payment is already taken, so the
      // failure is recorded and acknowledged rather than replayed forever.
      logger.error(`[stripe] webhook ${event.type} could not be handled:`, err.message);
    }

    res.json({ received: true });
  }
};

/** Sends a paid event to the right handler. */
async function route(bookingId, action, paymentIntentId) {
  if (!bookingId) return;
  if (action === 'reschedulePayment') return handleReschedulePaid(bookingId, paymentIntentId);
  return handlePaymentSucceeded(bookingId, paymentIntentId);
}

/**
 * Marks a booking paid. A payment that arrives after the booking expired only
 * counts if the seat is still free; otherwise it is refunded automatically.
 */
async function handlePaymentSucceeded(bookingId, paymentIntentId) {
  const row = await BookingModel.findById(bookingId);
  if (!row) {
    logger.error(`[stripe] webhook refers to booking ${bookingId}, which does not exist`);
    return;
  }

  if (row.status === 'EXPIRED') {
    const remaining = await seats.seatsRemaining({ source: row.session_schedule_source, id: row.session_schedule_id });

    if (!remaining) {
      logger.info(`[stripe] late payment for expired booking ${bookingId}; the session is sold out, refunding`);
      if (paymentIntentId) await stripeService.refund({ paymentIntentId, reason: 'duplicate' });

      await BookingModel.update(row.id, {
        status: 'EXPIRED',
        paymentStatus: 'Refunded',
        additionalInfo: `${row.additional_info || ''}\n[System] Late payment received after expiration, but course was sold out. Automatically refunded.`
      });
      const refunded = await expandBooking(await BookingModel.findById(row.id), { withChildren: false });
      await emails.expiredAndRefunded({ booking: refunded });
      return;
    }

    logger.info(`[stripe] late payment for expired booking ${bookingId}; a seat is free, re-securing it`);
    await seats.reserveSeat({ source: row.session_schedule_source, id: row.session_schedule_id });
  }

  await BookingModel.update(row.id, {
    status: 'PAID',
    paymentStatus: 'Paid',
    ...(paymentIntentId ? { paymentIntentId } : {})
  });

  const booking = await expandBooking(await BookingModel.findById(row.id), { withChildren: false });
  const course = await findCourse(row.course_id, row.course_type);
  await emails.paymentReceipt({ booking, course });
  logger.info(`[stripe] booking ${bookingId} marked paid`);
}

/** Applies the new dates once the rescheduling fee is paid. */
async function handleReschedulePaid(bookingId, paymentIntentId) {
  const row = await BookingModel.findById(bookingId);
  if (!row || !row.pending_reschedule_start_date) {
    logger.error(`[stripe] booking ${bookingId} has no reschedule awaiting payment`);
    return;
  }

  await BookingModel.addReschedule(row.id, {
    previousStartDate: row.session_start_date,
    newStartDate: row.pending_reschedule_start_date,
    previousEndDate: row.session_end_date,
    newEndDate: row.pending_reschedule_end_date,
    reason: row.pending_reschedule_reason
  });
  await BookingModel.update(row.id, {
    session: { startDate: row.pending_reschedule_start_date, endDate: row.pending_reschedule_end_date },
    lifecycleStatus: 'Upcoming',
    pendingReschedule: null,
    ...(paymentIntentId ? { paymentIntentId } : {})
  });

  const booking = await expandBooking(await BookingModel.findById(row.id), { withChildren: false });
  const course = await findCourse(row.course_id, row.course_type);
  await emails.rescheduleConfirmed({
    booking,
    course,
    newStartDate: row.pending_reschedule_start_date,
    newEndDate: row.pending_reschedule_end_date
  });
  logger.info(`[stripe] booking ${bookingId} rescheduled after the fee was paid`);
}

/** Records a failed payment, tells the student and alerts the admins. */
async function handlePaymentFailed(bookingId, intent) {
  const row = await BookingModel.findById(bookingId);
  if (!row) return;

  await BookingModel.update(row.id, { paymentStatus: 'Failed' });

  const booking = await expandBooking(await BookingModel.findById(row.id), { withChildren: false });
  const course = await findCourse(row.course_id, row.course_type);
  const reason = intent?.last_payment_error?.message || 'The payment was declined.';

  await emails.paymentFailed({ booking, course, reason });
  await notifyAdmins({
    settingKey: 'paymentAlerts',
    title: 'Payment Failed',
    message: `Payment failed for booking ${booking.bookingReference} (${course?.title || 'Course'}) by ${booking.customerDetails.firstName} ${booking.customerDetails.lastName}. Reason: ${reason}`,
    type: 'payment'
  });
  logger.info(`[stripe] booking ${bookingId} payment failed`);
}

module.exports = StripeController;
