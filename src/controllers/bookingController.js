const db = require('../config/db');
const BookingModel = require('../models/bookingModel');
const UserModel = require('../models/userModel');
const notifyAdmins = require('../utils/notifyAdmins');
const logger = require('../utils/logger');
const seats = require('../services/seatService');
const emails = require('../services/bookingEmailService');
const stripeService = require('../services/stripeService');
const { calculateLifecycleStatus, findCourse, expandBooking, expandBookings } = require('../services/bookingService');

const RESCHEDULE_FEE_PENCE = 7000;
const MAX_RESCHEDULES = 2;
const RESCHEDULE_NOTICE_HOURS = 48;
const RESCHEDULE_WINDOW_MONTHS = 6;

// The bookings page sends friendly labels; the column stores the codes.
const STATUS_LABELS = { Confirmed: 'PAID', Pending: 'PENDING', Cancelled: 'CANCELLED', Expired: 'EXPIRED' };
const STATUS_PRIORITY = { PAID: 0, PENDING: 1, EXPIRED: 2, CANCELLED: 3 };

/** Start of the session, at the hour the day actually begins. */
function sessionStartsAt(schedule) {
  const startsAt = new Date(`${String(schedule.startDate).slice(0, 10)}T00:00:00.000Z`);
  let startTime = '09:00';

  if (schedule.source === seats.SOURCES.SCHEDULED) {
    if (schedule.timingsType === 'flexible' && schedule.weeklyTimings?.length) {
      const day = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][startsAt.getUTCDay()];
      const config = schedule.weeklyTimings.find(t => t.day === day);
      if (config && !config.is_off && config.start_time) startTime = config.start_time;
    } else if (schedule.startTime) {
      startTime = schedule.startTime;
    }
  } else if (schedule.time) {
    startTime = String(schedule.time).split('-')[0].trim();
  }

  const match = String(startTime).match(/(\d{1,2}):(\d{2})/);
  if (match) startsAt.setUTCHours(Number(match[1]), Number(match[2]), 0, 0);
  return startsAt;
}

/** How the session is described on the booking and in emails. */
function sessionTimeLabel(schedule) {
  if (schedule.source !== seats.SOURCES.SCHEDULED) return schedule.time;
  if (schedule.timingsType === 'flexible') return 'Varies by day';
  return `${String(schedule.startTime || '09:00:00').slice(0, 5)} - ${String(schedule.endTime || '17:00:00').slice(0, 5)}`;
}

const BookingController = {
  // @desc    Create new booking
  // @route   POST /api/bookings
  // @access  Public
  async create(req, res, next) {
    try {
      const { courseId, session, customerDetails, billingAddress, packageName, options, paymentMethod, additionalInfo, totalAmount } = req.body;

      // 1. The course, or the licence with the same id
      let course = await findCourse(courseId, 'Course');
      let courseType = 'Course';
      if (!course) {
        course = await findCourse(courseId, 'License');
        courseType = 'License';
      }
      if (!course) {
        return res.status(404).json({ success: false, message: 'Course/License not found' });
      }

      // 2. The session the customer picked
      const schedule = await seats.resolveSchedule({
        scheduleId: session.scheduleId,
        courseId,
        startDate: session.startDate,
        locationName: session.location
      });
      if (!schedule) {
        return res.status(400).json({ success: false, message: 'Schedule not found for this course' });
      }

      if (new Date() > sessionStartsAt(schedule)) {
        return res.status(400).json({ success: false, message: 'Cannot book a course schedule that has already started.' });
      }

      // 3. The customer's account, and any booking they already hold
      const cleanEmail = String(customerDetails.email || '').trim();
      let user = await UserModel.findByEmail(cleanEmail);

      if (user) {
        const existing = await BookingModel.findActiveForUserCourse(user.id, courseId);
        if (existing) {
          let message;
          if (existing.status === 'PAID') {
            message = 'You are already enrolled in this course.';
          } else if (String(existing.session_schedule_id) === String(schedule.id) && existing.session_schedule_source === schedule.source) {
            message = 'You already have a pending booking for this specific schedule. Please complete your payment.';
          } else {
            message = 'You have a pending booking for a different date. Please complete your payment or cancel your existing booking before selecting a new schedule.';
          }
          return res.status(400).json({
            success: false,
            message,
            existingBookingId: String(existing.id),
            existingBookingStatus: existing.status
          });
        }
      }

      // 4. Take the seat and write the booking together, so a failure leaves
      //    neither a held seat nor a booking behind.
      let bookingId;
      let remainingSeats;
      try {
        ({ bookingId, remainingSeats } = await db.withTransaction(async (trx) => {
          const left = await seats.reserveSeat(schedule, trx);
          if (left === null) {
            const soldOut = new Error('This schedule is now sold out. Please choose another date.');
            soldOut.statusCode = 400;
            throw soldOut;
          }

          if (!user) {
            const id = await UserModel.create({
              name: `${customerDetails.firstName} ${customerDetails.lastName}`,
              email: cleanEmail,
              phone: customerDetails.phone,
              dob: customerDetails.dob,
              billingAddress,
              role: 'customer',
              passwordHash: await UserModel.hashPassword(customerDetails.password || require('crypto').randomBytes(9).toString('base64url'))
            });
            user = await UserModel.findById(id);
          } else {
            const patch = {
              name: `${customerDetails.firstName} ${customerDetails.lastName}`,
              phone: customerDetails.phone,
              dob: customerDetails.dob,
              billingAddress
            };
            if (customerDetails.password) patch.passwordHash = await UserModel.hashPassword(customerDetails.password);
            await UserModel.update(user.id, patch);
          }

          const id = await BookingModel.create({
            userId: user.id,
            courseId,
            courseType,
            packageName,
            session: {
              locationName: schedule.locationName || session.location || 'Online',
              branchName: schedule.locationName || session.location || 'Online',
              scheduleId: schedule.id,
              scheduleSource: schedule.source,
              startDate: schedule.startDate,
              endDate: schedule.endDate,
              time: sessionTimeLabel(schedule),
              price: schedule.price ?? totalAmount
            },
            customerDetails: { ...customerDetails, email: cleanEmail },
            billingAddress,
            options: { easyApply: options?.easyApply || false },
            paymentMethod,
            additionalInfo,
            totalAmount,
            status: 'PENDING',
            paymentStatus: 'Pending'
          }, trx);

          return { bookingId: id, remainingSeats: left };
        }));
      } catch (error) {
        if (error.statusCode === 400) {
          return res.status(400).json({ success: false, message: error.message });
        }
        throw error;
      }

      const row = await BookingModel.findById(bookingId);
      const booking = await expandBooking(row);

      // 5. Follow-ups: none of them may fail the booking
      const isNewUser = !user.created_at || Date.now() - new Date(user.created_at).getTime() < 5000;
      await UserModel.addActivity(user.id, {
        action: 'Course Booking',
        details: `Booked: ${course.title} (Ref: ${booking.bookingReference})`
      }).catch(err => logger.error('Activity log error:', err.message));

      if (isNewUser) {
        await notifyAdmins({
          settingKey: 'userRegistration',
          title: 'New User Registration',
          message: `${user.name} (${user.email}) just created an account.`,
          type: 'user'
        });
      }
      if (remainingSeats <= 5) {
        await notifyAdmins({
          settingKey: 'seatAvailability',
          title: 'Low Seat Availability',
          message: `Only ${remainingSeats} seat${remainingSeats === 1 ? '' : 's'} left for ${course.title}${schedule.locationName ? ` at ${schedule.locationName}` : ''}.`,
          type: 'booking'
        });
      }
      await notifyAdmins({
        settingKey: 'bookingAlerts',
        title: 'New Course Booking',
        message: `New booking for ${course.title} by ${customerDetails.firstName} ${customerDetails.lastName} (Payment: ${paymentMethod === 'card' ? 'Pending' : paymentMethod})`,
        type: 'booking'
      });

      await emails.bookingConfirmation({
        booking,
        course,
        locationName: schedule.locationName,
        weeklyTimings: schedule.weeklyTimings,
        userStatus: user.status
      });

      res.status(201).json({ success: true, data: booking });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Get all bookings
  // @route   GET /api/bookings
  // @access  Private/Admin
  async getAll(req, res, next) {
    try {
      const { status, paymentStatus, fromDate, toDate, search } = req.query;

      const filters = { fromDate, toDate };
      if (status && status !== 'All Booking Status') {
        filters.status = STATUS_LABELS[status] || String(status).toUpperCase();
      }
      if (paymentStatus && paymentStatus !== 'All Payments') {
        if (paymentStatus === 'Refund Requested') filters.refundRequested = true;
        else filters.paymentStatus = paymentStatus;
      }

      const rows = await BookingModel.findAll(filters);
      let bookings = await expandBookings(rows);

      if (search) {
        const needle = String(search).toLowerCase();
        bookings = bookings.filter(b =>
          b.customerDetails.firstName.toLowerCase().includes(needle) ||
          b.customerDetails.lastName.toLowerCase().includes(needle) ||
          b.customerDetails.email.toLowerCase().includes(needle) ||
          b._id.includes(needle) ||
          (b.course && b.course.title.toLowerCase().includes(needle))
        );
      }

      // One row per customer and course: a paid booking hides an older pending one.
      const byUserCourse = new Map();
      for (const b of bookings) {
        const key = `${b.user?._id || b.customerDetails.email}::${b.course?._id || 'unknown'}`;
        const existing = byUserCourse.get(key);
        if (!existing || (STATUS_PRIORITY[b.status] ?? 99) < (STATUS_PRIORITY[existing.status] ?? 99)) {
          byUserCourse.set(key, b);
        }
      }
      const data = Array.from(byUserCourse.values());

      res.status(200).json({ success: true, count: data.length, data });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Get single booking
  // @route   GET /api/bookings/:id
  // @access  Private/Admin
  async getById(req, res, next) {
    try {
      const row = await BookingModel.findById(req.params.id);
      if (!row) return res.status(404).json({ success: false, message: 'Booking not found' });
      res.status(200).json({ success: true, data: await expandBooking(row) });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Get booking by reference
  // @route   GET /api/bookings/reference/:ref
  // @access  Public
  async getByReference(req, res, next) {
    try {
      let row = await BookingModel.findByReference(req.params.ref);
      if (!row) return res.status(404).json({ success: false, message: 'Booking not found' });

      // The webhook can be late or lost; confirm with Stripe before answering.
      if (row.status === 'PENDING' && row.stripe_session_id) {
        const paid = await stripeService.confirmCheckoutSession(row);
        if (paid) row = await BookingModel.findById(row.id);
      }

      res.status(200).json({ success: true, data: await expandBooking(row) });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Update booking status
  // @route   PUT /api/bookings/:id
  // @access  Private/Admin
  async update(req, res, next) {
    try {
      const row = await BookingModel.findById(req.params.id);
      if (!row) return res.status(404).json({ success: false, message: 'Booking not found' });

      const { status, paymentStatus } = req.body;
      await BookingModel.update(row.id, { status, paymentStatus });

      const updated = await BookingModel.findById(row.id);
      res.status(200).json({ success: true, data: await expandBooking(updated) });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Delete booking
  // @route   DELETE /api/bookings/:id
  // @access  Private/Admin
  async delete(req, res, next) {
    try {
      const deleted = await BookingModel.delete(req.params.id);
      if (!deleted) return res.status(404).json({ success: false, message: 'Booking not found' });
      res.status(200).json({ success: true, data: {} });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Enrolled courses for the student dashboard
  // @route   GET /api/courses/user/enrolled
  // @access  Private
  async getUserEnrolledCourses(req, res, next) {
    try {
      const rows = await BookingModel.findByUser(req.user.id);

      // The webhook can be late or lost; confirm pending payments with Stripe.
      for (const row of rows) {
        if (row.status === 'PENDING' && row.stripe_session_id) await stripeService.confirmCheckoutSession(row);
      }
      const bookings = await expandBookings(await BookingModel.findByUser(req.user.id));

      const mapped = bookings.map(b => ({
        id: b._id,
        title: b.course?.title || 'Unknown Course',
        category: b.course?.category,
        thumbnail: b.course?.thumbnail,
        startDate: b.session.startDate,
        endDate: b.session.endDate,
        date: b.session.startDate ? new Date(b.session.startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'TBD',
        endDateFormatted: b.session.endDate ? new Date(b.session.endDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'TBD',
        time: b.session.time || 'TBD',
        location: b.session.locationName || 'TBD',
        bookingStatus: b.status,
        lifecycleStatus: b.lifecycleStatus,
        progress: b.progress || 0,
        attendance: b.attendance,
        certificates: b.certificates,
        score: 0,
        paymentStatus: b.paymentStatus,
        refundRequest: b.refundRequest,
        createdAt: b.createdAt
      }));

      const paid = (b) => b.bookingStatus === 'PAID';
      const upcoming = mapped.filter(b => b.lifecycleStatus === 'Upcoming' && paid(b));
      const ongoing = mapped.filter(b => ['Ongoing', 'Extended'].includes(b.lifecycleStatus) && paid(b));
      const completed = mapped.filter(b => b.lifecycleStatus === 'Completed' && paid(b));
      const postponed = mapped.filter(b => b.lifecycleStatus === 'Postponed' && paid(b));
      const cancelled = mapped.filter(b => b.lifecycleStatus === 'Cancelled' || b.bookingStatus === 'CANCELLED');

      const pendingBookings = bookings
        .filter(b => b.status === 'PENDING')
        .map(b => ({ id: b._id, title: b.course?.title || 'Unknown Course', courseId: b.course?._id, createdAt: b.createdAt }));

      res.status(200).json({
        success: true,
        pendingBookings,
        upcoming,
        ongoing,
        completed,
        postponed,
        cancelled,
        stats: {
          upcomingCount: upcoming.length,
          ongoingCount: ongoing.length,
          completedCount: completed.length,
          certificateCount: mapped.reduce((acc, b) => acc + (b.certificates?.length || 0), 0),
          avgScore: completed.length > 0 ? Math.round(completed.reduce((acc, b) => acc + b.score, 0) / completed.length) : 0
        }
      });
    } catch (error) {
      next(error);
    }
  },

  // @desc    The current user's booking state for one course
  // @route   GET /api/bookings/my-status/:courseId
  // @access  Private
  async getMyBookingStatus(req, res, next) {
    try {
      const rows = await BookingModel.findByUserAndCourse(req.user.id, req.params.courseId);
      const bookings = await expandBookings(rows, { withChildren: false });

      const bookedSchedules = bookings
        .filter(b => ['PENDING', 'PAID'].includes(b.status))
        .map(b => ({
          scheduleId: b.session.scheduleId,
          status: b.status,
          bookingId: b._id,
          bookingReference: b.bookingReference,
          billingAddress: b.billingAddress
        }))
        .filter(b => b.scheduleId);

      if (!bookings.length) {
        return res.status(200).json({ success: true, status: 'NONE', bookedSchedules: [] });
      }

      const paid = bookings.find(b => b.status === 'PAID');
      if (paid) {
        return res.status(200).json({ success: true, status: 'PAID', bookingId: paid._id, bookedSchedules });
      }

      const pending = bookings.find(b => b.status === 'PENDING');
      if (pending) {
        return res.status(200).json({ success: true, status: 'PENDING', bookingId: pending._id, createdAt: pending.createdAt, bookedSchedules });
      }

      res.status(200).json({ success: true, status: bookings[0].status, bookedSchedules });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Admin lifecycle actions on a booking
  // @route   PUT /api/bookings/:id/lifecycle
  // @access  Private/Admin
  async updateLifecycle(req, res, next) {
    try {
      const { action, newStartDate, newEndDate, reason, forceBypass48h } = req.body;
      const row = await BookingModel.findById(req.params.id);
      if (!row) return res.status(404).json({ success: false, message: 'Booking not found' });

      const booking = await expandBooking(row);
      const course = await findCourse(row.course_id, row.course_type);
      const patch = {};
      let paymentLink = null;

      switch (action) {
        case 'extend': {
          if (!newEndDate) return res.status(400).json({ success: false, message: 'New end date required' });
          await BookingModel.addExtension(row.id, { previousEndDate: row.session_end_date, newEndDate, reason });
          if (!row.original_end_date) patch.originalEndDate = row.session_end_date;
          patch.session = { endDate: newEndDate };
          patch.lifecycleStatus = 'Extended';
          break;
        }

        case 'reschedule': {
          if (!newStartDate || !newEndDate) {
            return res.status(400).json({ success: false, message: 'New start and end dates required' });
          }

          const maxAllowed = new Date(row.session_start_date);
          maxAllowed.setMonth(maxAllowed.getMonth() + RESCHEDULE_WINDOW_MONTHS);
          if (new Date(newStartDate) > maxAllowed) {
            return res.status(400).json({ success: false, message: 'Rescheduling is only permitted within six months of the original course date.' });
          }

          const hoursUntilCourse = (new Date(row.session_start_date) - new Date()) / (1000 * 60 * 60);
          if (hoursUntilCourse < RESCHEDULE_NOTICE_HOURS && !forceBypass48h) {
            return res.status(400).json({ success: false, message: 'Rescheduling requires at least 48 hours notice. Use force bypass to override.' });
          }

          if (await BookingModel.countReschedules(row.id) >= MAX_RESCHEDULES) {
            return res.status(400).json({ success: false, message: 'Maximum of two rescheduling requests permitted per booking.' });
          }

          if (forceBypass48h) {
            await BookingModel.addReschedule(row.id, {
              previousStartDate: row.session_start_date,
              newStartDate,
              previousEndDate: row.session_end_date,
              newEndDate,
              reason
            });
            patch.session = { startDate: newStartDate, endDate: newEndDate };
            patch.lifecycleStatus = 'Upcoming';
          } else {
            // The student pays the fee first; the webhook applies the new dates.
            paymentLink = await stripeService.createRescheduleCheckout({
              booking,
              courseTitle: course?.title,
              amountPence: RESCHEDULE_FEE_PENCE
            });
            patch.pendingReschedule = { newStartDate, newEndDate, reason, status: 'Awaiting Payment' };
          }
          break;
        }

        case 'postpone':
          patch.lifecycleStatus = 'Postponed';
          break;

        case 'cancel':
          patch.lifecycleStatus = 'Cancelled';
          patch.status = 'CANCELLED';
          break;

        case 'complete':
          patch.lifecycleStatus = 'Completed';
          break;

        case 'resume':
          patch.lifecycleStatus = 'Upcoming';
          break;

        default:
          return res.status(400).json({ success: false, message: 'Invalid lifecycle action' });
      }

      await BookingModel.update(row.id, patch);

      const userRow = await UserModel.findById(row.user_id);
      if (userRow) {
        await UserModel.addActivity(userRow.id, {
          action: 'Booking Lifecycle Update',
          details: `Action: ${action.charAt(0).toUpperCase() + action.slice(1)}. Reason: ${reason || 'N/A'} (Ref: ${row.booking_reference})`
        });
      }

      const updated = await expandBooking(await BookingModel.findById(row.id));

      await emails.lifecycleUpdate({
        booking: updated,
        course,
        action,
        newStartDate,
        newEndDate,
        userEmail: userRow?.email || updated.customerDetails.email,
        userName: userRow?.name || updated.customerDetails.firstName,
        userStatus: userRow?.status
      });

      res.status(200).json({
        success: true,
        data: updated,
        lifecycleStatus: calculateLifecycleStatus(updated),
        ...(paymentLink ? { paymentLink } : {})
      });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Request a refund
  // @route   POST /api/bookings/:id/refund/request
  // @access  Private
  async requestRefund(req, res, next) {
    try {
      const { reason } = req.body;
      const row = await BookingModel.findById(req.params.id);
      if (!row) return res.status(404).json({ success: false, message: 'Booking not found.' });

      if (String(row.user_id) !== String(req.user.id)) {
        return res.status(403).json({ success: false, message: 'Not authorized to request refund for this booking.' });
      }
      if (row.status !== 'PAID') {
        return res.status(400).json({ success: false, message: 'Only paid bookings can be refunded.' });
      }
      if (new Date(row.session_start_date) <= new Date()) {
        return res.status(400).json({ success: false, message: 'Refunds are only permitted for upcoming courses.' });
      }

      await BookingModel.update(row.id, {
        refundRequest: {
          status: 'Requested',
          reason,
          requestedAt: new Date(),
          ...(req.file?.path ? { proofUrl: req.file.path } : {})
        }
      });

      const booking = await expandBooking(await BookingModel.findById(row.id));
      const course = await findCourse(row.course_id, row.course_type);

      await emails.refundRequested({ booking, course });
      await notifyAdmins({
        title: 'Refund Request',
        message: `Refund requested for ${course?.title || 'Course'} by ${booking.customerDetails.firstName} ${booking.customerDetails.lastName} (Ref: ${booking.bookingReference}).`,
        type: 'payment'
      });

      res.status(200).json({ success: true, message: 'Refund request submitted successfully.', data: booking });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Approve or reject a refund request
  // @route   POST /api/bookings/:id/refund/process
  // @access  Private/Admin
  async processRefund(req, res, next) {
    try {
      const { action, adminNotes, refundType, deductionAmount } = req.body;
      const row = await BookingModel.findById(req.params.id);
      if (!row) return res.status(404).json({ success: false, message: 'Booking not found.' });

      if (row.refund_status !== 'Requested') {
        return res.status(400).json({ success: false, message: 'No active refund request found for this booking.' });
      }

      const course = await findCourse(row.course_id, row.course_type);

      if (action === 'reject') {
        await BookingModel.update(row.id, {
          refundRequest: { status: 'Rejected', processedAt: new Date(), adminNotes: adminNotes || '' }
        });
        const booking = await expandBooking(await BookingModel.findById(row.id));
        await emails.refundProcessed({ booking, course, approved: false, adminNotes });
        return res.status(200).json({ success: true, message: 'Refund request rejected.', data: booking });
      }

      // Approving: the money moves at Stripe first, then the booking is updated.
      let paymentIntentId = row.payment_intent_id;
      if (!paymentIntentId && row.stripe_session_id) {
        paymentIntentId = await stripeService.paymentIntentOfSession(row.stripe_session_id);
        if (paymentIntentId) await BookingModel.update(row.id, { paymentIntentId });
      }
      if (!paymentIntentId) {
        return res.status(400).json({ success: false, message: 'No Stripe payment found for this booking, so it cannot be refunded automatically.' });
      }

      const total = Number(row.total_amount);
      let amount = total;
      if (refundType === 'partial' && deductionAmount) {
        amount = Math.max(0, total - Number(deductionAmount));
        if (amount === 0) {
          return res.status(400).json({ success: false, message: 'Deduction amount equals or exceeds total amount. Cannot process zero refund.' });
        }
      }

      const refund = await stripeService.refund({
        paymentIntentId,
        amountPence: refundType === 'partial' ? Math.round(amount * 100) : undefined
      });
      if (!refund.ok) {
        return res.status(400).json({ success: false, message: `Stripe refund failed: ${refund.error}` });
      }

      await BookingModel.update(row.id, {
        paymentStatus: 'Refunded',
        status: 'CANCELLED',
        lifecycleStatus: 'Cancelled',
        refundRequest: {
          status: 'Approved',
          processedAt: new Date(),
          adminNotes: adminNotes || '',
          refundId: refund.id
        }
      });
      // The seat goes back on sale.
      await seats.releaseSeat({ source: row.session_schedule_source, id: row.session_schedule_id });

      const booking = await expandBooking(await BookingModel.findById(row.id));
      await emails.refundProcessed({ booking, course, approved: true, amount, adminNotes, partial: refundType === 'partial' });

      res.status(200).json({ success: true, message: 'Refund processed successfully.', data: booking });
    } catch (error) {
      next(error);
    }
  },

  // ── customers (the admin users table lives under /bookings) ──────────────

  // @desc    List customers with their booking totals
  // @route   GET /api/bookings/users
  // @access  Private/Admin
  async getCustomers(req, res, next) {
    try {
      const { fromDate, toDate, search } = req.query;
      const rows = await UserModel.findAll({});

      let customers = rows;
      if (fromDate) customers = customers.filter(c => new Date(c.created_at) >= new Date(fromDate));
      if (toDate) customers = customers.filter(c => new Date(c.created_at) <= new Date(toDate));
      if (search) {
        const needle = String(search).toLowerCase();
        customers = customers.filter(c => c.name.toLowerCase().includes(needle) || c.email.toLowerCase().includes(needle));
      }

      const stats = await BookingModel.statsByUser(customers.map(c => c.id));
      const data = customers.map(c => UserModel.toPublic(c, {
        bookingCount: stats[c.id]?.bookingCount || 0,
        totalSpent: stats[c.id]?.totalSpent || 0,
        status: 'Active'
      }));

      res.status(200).json({ success: true, count: data.length, data });
    } catch (error) {
      next(error);
    }
  },

  // @desc    One customer with their bookings
  // @route   GET /api/bookings/users/:id
  // @access  Private/Admin
  async getUserById(req, res, next) {
    try {
      const row = await UserModel.findById(req.params.id);
      if (!row) return res.status(404).json({ success: false, message: 'User not found' });

      const bookings = await expandBookings(await BookingModel.findByUser(row.id), { withChildren: false });
      const totalSpent = bookings.reduce((sum, b) => sum + (b.paymentStatus === 'Paid' ? Number(b.totalAmount) : 0), 0);

      res.status(200).json({
        success: true,
        data: UserModel.toPublic(row, { bookings, totalSpent, bookingCount: bookings.length })
      });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Update a customer
  // @route   PUT /api/bookings/users/:id
  // @access  Private/Admin
  async updateUser(req, res, next) {
    try {
      const row = await UserModel.findById(req.params.id);
      if (!row) return res.status(404).json({ success: false, message: 'User not found' });

      await UserModel.update(row.id, req.body);
      const updated = await UserModel.findById(row.id);
      res.status(200).json({ success: true, data: UserModel.toPublic(updated) });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Delete a customer and their bookings
  // @route   DELETE /api/bookings/users/:id
  // @access  Private/Admin
  async deleteUser(req, res, next) {
    try {
      const row = await UserModel.findById(req.params.id);
      if (!row) return res.status(404).json({ success: false, message: 'User not found' });

      // Bookings go with the account (ON DELETE CASCADE), removed here so the
      // count reported back is accurate.
      await BookingModel.deleteForUsers([row.id]);
      await db.query('DELETE FROM users WHERE id = ?', [row.id]);

      res.status(200).json({ success: true, message: 'User and their bookings removed' });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Delete several customers
  // @route   POST /api/bookings/users/bulk-delete
  // @access  Private/Admin
  async deleteUsers(req, res, next) {
    try {
      const { ids } = req.body;
      await BookingModel.deleteForUsers(ids);
      await db.query('DELETE FROM users WHERE id IN (?)', [ids]);
      res.status(200).json({ success: true, message: `${ids.length} users and their bookings removed` });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = BookingController;
