const BookingModel = require('../models/bookingModel');
const UserModel = require('../models/userModel');
const logger = require('../utils/logger');
const seats = require('./seatService');
const emails = require('./bookingEmailService');
const { expandBooking } = require('./bookingService');

/** A booking must be paid for within this many minutes of being made. */
const PAYMENT_WINDOW_MINUTES = Math.max(1, parseInt(process.env.BOOKING_PAYMENT_WINDOW_MINUTES, 10) || 60);

/**
 * Cancels bookings whose payment window has passed: the seat goes back on
 * sale and the customer is told they can book again. One failure does not
 * stop the rest of the batch.
 *
 * Returns how many bookings were expired.
 */
async function expirePendingBookings() {
  const rows = await BookingModel.findExpiredPending(PAYMENT_WINDOW_MINUTES);
  if (!rows.length) return 0;

  logger.info(`[bookings] expiring ${rows.length} unpaid booking(s)`);
  let expired = 0;

  for (const row of rows) {
    try {
      await BookingModel.update(row.id, { status: 'EXPIRED', lifecycleStatus: 'Cancelled' });
      await seats.releaseSeat({ source: row.session_schedule_source, id: row.session_schedule_id });

      const user = await UserModel.findById(row.user_id);
      const booking = await expandBooking(await BookingModel.findById(row.id), { withChildren: false });
      await emails.bookingExpired({ booking, userStatus: user?.status });

      expired += 1;
      logger.info(`[bookings] ${row.booking_reference} expired and its seat released`);
    } catch (err) {
      logger.error(`[bookings] could not expire ${row.booking_reference}: ${err.message}`);
    }
  }
  return expired;
}

module.exports = { expirePendingBookings, PAYMENT_WINDOW_MINUTES };
