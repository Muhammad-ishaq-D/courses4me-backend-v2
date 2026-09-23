const sendEmail = require('../utils/sendEmail');
const isEmailTemplateActive = require('../utils/isEmailTemplateActive');
const logger = require('../utils/logger');

/**
 * Every customer email the bookings module sends. Each function resolves even
 * when delivery fails — a booking must never be lost because of the mail
 * server — and respects the Settings > Email Templates toggles.
 */
const BRAND = '#F8510C';
const SITE = () => process.env.FRONTEND_URL || 'https://courses4me.co.uk';

const frame = (inner) => `
  <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 12px; background-color: #ffffff;">
    ${inner}
    <div style="text-align: center; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px;">
      <p style="color: #888; font-size: 14px;">If you have any questions, please contact our support team.</p>
      <p style="color: #888; font-size: 14px;">&copy; ${new Date().getFullYear()} Courses4Me. All rights reserved.</p>
    </div>
  </div>`;

const row = (label, value, strong = false) => `
  <tr>
    <td style="padding: 8px 0; color: #666; font-weight: bold;">${label}:</td>
    <td style="padding: 8px 0; color: ${strong ? BRAND : '#333'}; text-align: right; ${strong ? 'font-weight: bold; font-size: 18px;' : ''}">${value}</td>
  </tr>`;

const ukDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB') : 'TBD');
const longDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' }) : 'TBD');
const fmtTime = (timeStr) => {
  if (!timeStr) return '';
  const [h, m] = String(timeStr).split(':');
  let hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  return `${hour}:${m} ${ampm}`;
};

/** Never let an email failure escape into the request. */
async function deliver(label, options) {
  try {
    await sendEmail(options);
    logger.debug(`[bookingEmail] sent ${label} to ${options.email}`);
  } catch (err) {
    logger.error(`[bookingEmail] ${label} failed for ${options.email}: ${err.message}`);
  }
}

/** The weekly grid shown when the session runs on a flexible timetable. */
function weeklyTimingsHtml(weeklyTimings) {
  if (!weeklyTimings || !weeklyTimings.length) return '';
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const rows = days.map(day => {
    const config = weeklyTimings.find(t => t.day === day);
    const isOff = !config || config.is_off;
    const timeStr = isOff ? 'Off' : `${fmtTime(config.start_time || '09:00')} - ${fmtTime(config.end_time || '17:00')}`;
    return `<tr>
        <td style="padding: 4px 0; color: #666; text-transform: capitalize; font-size: 13px;">${day}</td>
        <td style="padding: 4px 0; color: #333; text-align: right; font-size: 13px;">${timeStr}</td>
      </tr>`;
  }).join('');
  return `<tr><td colspan="2" style="padding: 10px 0;">
      <div style="background-color: #f1f5f9; padding: 12px; border-radius: 6px;">
        <strong style="color: #475569; font-size: 13px; display: block; margin-bottom: 8px;">Weekly Schedule:</strong>
        <table style="width: 100%; border-collapse: collapse;">${rows}</table>
      </div>
    </td></tr>`;
}

const BookingEmailService = {
  /** Sent right after a booking is made; skipped for inactive accounts. */
  async bookingConfirmation({ booking, course, locationName, weeklyTimings, userStatus }) {
    if (userStatus === 'inactive') return;
    if (!(await isEmailTemplateActive('bookingConfirmation'))) return;

    const pendingNotice = booking.paymentStatus === 'Pending' ? `
      <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
        <p style="color: #856404; margin: 0; font-size: 14px;">
          <strong>Action Required:</strong> Your payment is currently pending. Please complete your payment within <strong>60 minutes</strong>, or your booking will be automatically cancelled.
        </p>
      </div>` : '';

    await deliver('booking confirmation', {
      email: booking.customerDetails.email,
      subject: `Booking Confirmation - ${course.title} (${booking.bookingReference})`,
      message: `Thank you for your booking! Reference: ${booking.bookingReference}. Course: ${course.title}. Total: £${booking.totalAmount}. Payment Status: ${String(booking.paymentStatus).toUpperCase()}.`,
      html: frame(`
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="color: ${BRAND}; margin: 0;">Booking Confirmed!</h1>
          <p style="color: #666; font-size: 16px;">Thank you for choosing Courses4Me</p>
        </div>
        ${pendingNotice}
        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h3 style="margin-top: 0; color: #333; border-bottom: 2px solid ${BRAND}; padding-bottom: 8px;">Booking Details</h3>
          <table style="width: 100%; border-collapse: collapse;">
            ${row('Reference', booking.bookingReference)}
            ${row('Course', course.title)}
            ${row('Location', locationName)}
            ${row('Date', ukDate(booking.session.startDate))}
            ${row('Time', booking.session.time)}
            ${weeklyTimingsHtml(weeklyTimings)}
            ${row('Total Amount', `£${booking.totalAmount}`, true)}
            ${row('Payment Status', String(booking.paymentStatus).toUpperCase())}
          </table>
        </div>`)
    });
  },

  /** Sent by the Stripe webhook once the payment lands. */
  async paymentReceipt({ booking, course }) {
    if (!(await isEmailTemplateActive('paymentReceipt'))) return;
    await deliver('payment receipt', {
      email: booking.customerDetails.email,
      subject: `Payment Received - ${booking.bookingReference}`,
      message: `We have received your payment of £${booking.totalAmount} for booking ${booking.bookingReference}.`,
      html: frame(`
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="color: ${BRAND}; margin: 0;">Payment Successful!</h1>
          <p style="color: #666; font-size: 16px;">We have received your payment for the booking.</p>
        </div>
        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <table style="width: 100%; border-collapse: collapse;">
            ${row('Reference', booking.bookingReference)}
            ${row('Course', course?.title || 'Your course')}
            ${row('Date', ukDate(booking.session.startDate))}
            ${row('Amount Paid', `£${booking.totalAmount}`, true)}
          </table>
        </div>`)
    });
  },

  /** Sent when Stripe reports the payment failed. */
  async paymentFailed({ booking, course, reason }) {
    await deliver('payment failure', {
      email: booking.customerDetails.email,
      subject: `Payment Failed - ${booking.bookingReference}`,
      message: `Your payment for booking ${booking.bookingReference} could not be processed. ${reason || ''}`,
      html: frame(`
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="color: #d9534f; margin: 0;">Payment Failed</h1>
        </div>
        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px;">
          <p style="color: #333;">Dear ${booking.customerDetails.firstName},</p>
          <p style="color: #666;">We could not process your payment for <strong>${course?.title || 'your course'}</strong> (Reference: <strong>${booking.bookingReference}</strong>).</p>
          ${reason ? `<p style="color: #666;"><strong>Reason:</strong> ${reason}</p>` : ''}
          <p style="color: #666; margin-top: 20px;">Your seat is held until the payment window closes. Please try again from your booking page.</p>
          <div style="text-align: center; margin-top: 20px;">
            <a href="${SITE()}/dashboard" style="display: inline-block; background-color: ${BRAND}; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600;">Complete Payment</a>
          </div>
        </div>`)
    });
  },

  /** Sent by the expiry job when the payment window closes. */
  async bookingExpired({ booking, userStatus }) {
    if (userStatus === 'inactive') return;
    if (!(await isEmailTemplateActive('bookingCancellation'))) return;
    await deliver('booking expiry', {
      email: booking.customerDetails.email,
      subject: `Booking Cancelled - Payment Timeout (${booking.bookingReference})`,
      message: `Your booking ${booking.bookingReference} has been cancelled because payment was not completed within 1 hour. Please book again if you still wish to attend.`,
      html: frame(`
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="color: #d9534f; margin: 0;">Booking Cancelled</h1>
          <p style="color: #666; font-size: 16px;">Payment Time Expired</p>
        </div>
        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <p style="color: #333;">Dear ${booking.customerDetails.firstName},</p>
          <p style="color: #666;">We noticed that the payment for your booking (Reference: <strong>${booking.bookingReference}</strong>) was not completed within the allowed time (1 hour).</p>
          <p style="color: #666;">As a result, your booking has been automatically cancelled to free up the seat for other students.</p>
          <p style="color: #666; margin-top: 20px;">If you still wish to attend, please feel free to create a new booking on our website!</p>
        </div>`)
    });
  },

  /** Sent when a late payment arrives and the seat has already gone. */
  async expiredAndRefunded({ booking }) {
    await deliver('expired booking refund', {
      email: booking.customerDetails.email,
      subject: `Refund Confirmation - Booking Expired (${booking.bookingReference})`,
      message: 'Your payment was refunded because the booking session expired and the course is sold out.',
      html: frame(`
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="color: #d9534f; margin: 0;">Payment Refunded</h1>
          <p style="color: #666; font-size: 16px;">Booking Timeout &amp; Sold Out</p>
        </div>
        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px;">
          <p style="color: #333;">Dear ${booking.customerDetails.firstName || 'Student'},</p>
          <p style="color: #666;">We received your payment for booking (Reference: <strong>${booking.bookingReference}</strong>) after the 1-hour completion window had expired.</p>
          <p style="color: #666;">Unfortunately, the course schedule has since sold out and we could not secure your seat.</p>
          <p style="color: #d9534f; font-weight: bold; margin-top: 15px;">A full refund has been automatically issued to your payment method.</p>
        </div>`)
    });
  },

  /** Sent after an admin extends, reschedules, postpones, cancels or completes. */
  async lifecycleUpdate({ booking, course, action, newStartDate, newEndDate, userEmail, userName, userStatus }) {
    if (!userEmail || userStatus === 'inactive') return;
    const templateKey = action === 'cancel' ? 'bookingCancellation' : action === 'complete' ? 'courseCompletion' : null;
    if (templateKey && !(await isEmailTemplateActive(templateKey))) return;

    const actionText = action.charAt(0).toUpperCase() + action.slice(1);
    let details = '';
    if (action === 'extend') {
      details = row('New End Date', longDate(newEndDate));
    } else if (action === 'reschedule') {
      details = row('New Start Date', longDate(newStartDate)) + row('New End Date', longDate(newEndDate));
    }

    const completion = action === 'complete' ? `
      <div style="background-color: #ecfdf5; padding: 20px; border-radius: 8px; text-align: center; margin-top: 20px;">
        <h4 style="color: #111827; font-size: 18px; font-weight: 700; margin: 0 0 10px 0;">Congratulations on your completion!</h4>
        <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin-bottom: 20px;">
          Your certificate for <strong>${course?.title || 'this course'}</strong> is now ready to be downloaded.
        </p>
        <a href="${SITE()}/dashboard" style="display: inline-block; background-color: #10b981; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">Get Your Certificate</a>
      </div>` : `
      <p style="color: #4b5563; font-size: 15px; line-height: 1.6;">
        You can view your updated schedule and course details at any time by logging into your student dashboard.
      </p>`;

    await deliver('lifecycle update', {
      email: userEmail,
      subject: `Course Update: ${course?.title || 'Your Course'} (${actionText})`,
      message: `Your course has been updated to ${actionText}.`,
      html: frame(`
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="color: ${BRAND}; margin: 0;">Course ${actionText}</h1>
        </div>
        <p style="color: #333;">Hello ${userName || 'Student'},</p>
        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            ${row('Course', course?.title || 'Your course')}
            ${row('Reference', booking.bookingReference)}
            ${details}
          </table>
        </div>
        ${completion}`)
    });
  },

  /** Confirms to the student that a refund request was received. */
  async refundRequested({ booking, course }) {
    await deliver('refund request', {
      email: booking.customerDetails.email,
      subject: `Refund Request Received - ${booking.bookingReference}`,
      message: `Your refund request for booking ${booking.bookingReference} has been received and is under review.`,
      html: frame(`
        <h2 style="color: ${BRAND}; text-align: center;">Refund Request Received</h2>
        <p>Hello ${booking.customerDetails.firstName},</p>
        <p>We have received your refund request for the course <strong>${course?.title || 'Course'}</strong> (Booking Ref: <strong>${booking.bookingReference}</strong>).</p>
        <p>Our administration team will review your request shortly in accordance with our refund policy. We will notify you via email as soon as a decision is made.</p>`)
    });
  },

  /** Tells the student the outcome of their refund request. */
  async refundProcessed({ booking, course, approved, amount, adminNotes, partial }) {
    const title = approved
      ? (partial ? 'Partial Refund Request Approved' : 'Refund Request Approved')
      : 'Refund Request Declined';
    const notes = adminNotes
      ? `<div style="background-color: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0;"><h4 style="margin-top: 0;">Admin Notes:</h4><p style="margin-bottom: 0; color: #555;">${adminNotes}</p></div>`
      : '';

    await deliver('refund decision', {
      email: booking.customerDetails.email,
      subject: `${title} - ${booking.bookingReference}`,
      message: approved
        ? `Your refund of £${amount} for booking ${booking.bookingReference} has been approved and issued to your original payment method.`
        : `Your refund request for booking ${booking.bookingReference} was not approved.`,
      html: frame(`
        <h2 style="color: ${approved ? BRAND : '#d9534f'}; text-align: center;">${title}</h2>
        <p>Hello ${booking.customerDetails.firstName},</p>
        <p>Your refund request for <strong>${course?.title || 'Course'}</strong> (Booking Ref: <strong>${booking.bookingReference}</strong>) has been
           ${approved ? 'approved' : 'reviewed and could not be approved'}.</p>
        ${approved ? `<div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse;">${row('Amount Refunded', `£${amount}`, true)}</table>
          <p style="color: #666; font-size: 14px; margin-bottom: 0;">Refunds usually reach your account within 5 to 10 working days.</p>
        </div>` : ''}
        ${notes}`)
    });
  },

  /** Confirms a rescheduling fee payment and the new dates. */
  async rescheduleConfirmed({ booking, course, newStartDate, newEndDate }) {
    await deliver('reschedule confirmation', {
      email: booking.customerDetails.email,
      subject: `Reschedule Confirmation - ${booking.bookingReference}`,
      message: 'Your course has been successfully rescheduled.',
      html: frame(`
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="color: ${BRAND}; margin: 0;">Course Rescheduled</h1>
        </div>
        <p style="color: #333;">Hello ${booking.customerDetails.firstName},</p>
        <p style="color: #666;">Your rescheduling fee has been received and your course dates are now confirmed.</p>
        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            ${row('Course', course?.title || 'Your course')}
            ${row('Reference', booking.bookingReference)}
            ${row('New Start Date', longDate(newStartDate))}
            ${row('New End Date', longDate(newEndDate))}
          </table>
        </div>`)
    });
  }
};

module.exports = BookingEmailService;
