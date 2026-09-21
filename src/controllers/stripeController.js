const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Booking = require('../models/Booking');
const Course = require('../models/Course');
const isEmailTemplateActive = require('../utils/isEmailTemplateActive');

exports.createCheckoutSession = async (req, res) => {
    try {
        const { bookingId } = req.params;

        const booking = await Booking.findById(bookingId).populate('course');
        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }
        if (booking.status === 'EXPIRED') {
            return res.status(400).json({ success: false, message: 'This booking has expired because payment was not completed within 1 hour. Please create a new booking.' });
        }
        if (booking.status === 'CANCELLED') {
            return res.status(400).json({ success: false, message: 'This booking has been cancelled.' });
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'gbp',
                        product_data: {
                            name: booking.course.title,
                            description: `Course booking at ${booking.session.location}`,
                        },
                        unit_amount: booking.totalAmount * 100, // Stripe expects amount in cents
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: `${process.env.FRONTEND_URL}/booking-success?session_id={CHECKOUT_SESSION_ID}&bookingRef=${booking.bookingReference}`,
            cancel_url: `${process.env.FRONTEND_URL}/booking-cancelled?bookingId=${bookingId}`,
            metadata: {
                bookingId: bookingId.toString(),
            },
        });

        booking.stripeSessionId = session.id;
        await booking.save();

        res.status(200).json({
            success: true,
            url: session.url
        });
    } catch (error) {
        console.error('Stripe Checkout Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Create a PaymentIntent for embedded Stripe Elements flow
exports.createPaymentIntent = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const booking = await Booking.findById(bookingId).populate('course');
        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }
        if (booking.status === 'PAID' || booking.status === 'Completed') {
            return res.status(400).json({ success: false, message: 'This booking has already been paid for.' });
        }
        if (booking.status === 'EXPIRED') {
            return res.status(400).json({ success: false, message: 'This booking has expired because payment was not completed within 1 hour. Please create a new booking.' });
        }
        if (booking.status === 'CANCELLED') {
            return res.status(400).json({ success: false, message: 'This booking has been cancelled.' });
        }
        // Calculate amount in cents
        const amount = booking.totalAmount * 100;
        // Create PaymentIntent
        const paymentIntent = await stripe.paymentIntents.create({
            amount,
            currency: 'gbp',
            payment_method_types: ['card'],
            metadata: { bookingId: bookingId.toString() },
        });
        // Save clientSecret to booking for reference if needed
        booking.paymentIntentId = paymentIntent.id;
        await booking.save();
        res.status(200).json({
            success: true,
            clientSecret: paymentIntent.client_secret,
            bookingReference: booking.bookingReference
        });
    } catch (error) {
        console.error('Stripe PaymentIntent Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

exports.handleWebhook = async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    const sendPaymentEmail = async (bookingId, paymentIntentId) => {
        try {
            let booking = await Booking.findById(bookingId).populate('course');
            if (!booking) {
                console.error(`Booking ${bookingId} not found in webhook handler.`);
                return;
            }

            if (booking.status === 'EXPIRED') {
                console.log(`Booking ${bookingId} was EXPIRED. Checking if seat is still available...`);
                let seatAvailable = false;
                let selectedSchedule = null;
                const CourseLocationDate = require('../models/CourseLocationDate');

                if (booking.session && booking.session.scheduleId) {
                    const scheduleRecord = await CourseLocationDate.findById(booking.session.scheduleId);
                    if (scheduleRecord) {
                        const available = Math.max(0, scheduleRecord.availableSeats - scheduleRecord.bookedSeats);
                        if (available > 0) {
                            seatAvailable = true;
                            selectedSchedule = scheduleRecord;
                        }
                    } else if (booking.course) {
                        // Fallback to embedded locations
                        const course = booking.course;
                        for (const loc of (course.locations || [])) {
                            const schedule = loc.schedules.id ? loc.schedules.id(booking.session.scheduleId) : loc.schedules.find(s => s._id.toString() === booking.session.scheduleId.toString());
                            if (schedule && schedule.seatsAvailable > 0) {
                                seatAvailable = true;
                                selectedSchedule = schedule;
                                break;
                            }
                        }
                    }
                }

                if (!seatAvailable) {
                    console.log(`Course/Schedule is sold out. Automatically refunding Stripe payment for expired booking ${bookingId}...`);
                    if (paymentIntentId) {
                        try {
                            await stripe.refunds.create({
                                payment_intent: paymentIntentId,
                                reason: 'duplicate'
                            });
                            console.log(`Successfully refunded payment for expired booking ${bookingId}`);
                        } catch (refundErr) {
                            console.error(`Failed to automatically refund expired booking ${bookingId}:`, refundErr);
                        }
                    }

                    // Update booking status to show it was refunded due to late payment timeout
                    booking.status = 'EXPIRED';
                    booking.paymentStatus = 'Refunded';
                    booking.additionalInfo = (booking.additionalInfo || '') + '\n[System] Late payment received after expiration, but course was sold out. Automatically refunded.';
                    await booking.save();

                    // Send email to student
                    const sendEmail = require('../utils/sendEmail');
                    const emailHtml = `
                        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 12px; background-color: #ffffff;">
                            <div style="text-align: center; margin-bottom: 20px;">
                                <h1 style="color: #d9534f; margin: 0;">Payment Refunded</h1>
                                <p style="color: #666; font-size: 16px;">Booking Timeout & Sold Out</p>
                            </div>
                            <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                                <p style="color: #333;">Dear ${booking.customerDetails?.firstName || 'Student'},</p>
                                <p style="color: #666;">We received your payment for booking (Reference: <strong>${booking.bookingReference}</strong>) after the 1-hour completion window had expired.</p>
                                <p style="color: #666;">Unfortunately, the course schedule has since sold out and we could not secure your seat.</p>
                                <p style="color: #d9534f; font-weight: bold; margin-top: 15px;">A full refund has been automatically issued to your payment method.</p>
                                <p style="color: #666; margin-top: 20px;">If you have any questions, please contact our support team.</p>
                            </div>
                        </div>
                    `;

                    try {
                        await sendEmail({
                            email: booking.customerDetails.email,
                            subject: `Refund Confirmation - Booking Expired (${booking.bookingReference})`,
                            message: `Your payment was refunded because the booking session expired and the course is sold out.`,
                            html: emailHtml
                        });
                    } catch (emailErr) {
                        console.error('Error sending refund email:', emailErr);
                    }
                    return;
                } else {
                    // Seat is available! Deduct seat again and proceed
                    console.log(`Seat is available for expired booking ${bookingId}. Re-securing seat.`);
                    if (selectedSchedule.constructor.modelName === 'CourseLocationDate') {
                        selectedSchedule.bookedSeats += 1;
                        await selectedSchedule.save();
                    } else if (booking.course) {
                        selectedSchedule.seatsAvailable -= 1;
                        if (selectedSchedule.seatsAvailable === 0) {
                            selectedSchedule.availabilityStatus = 'Sold Out';
                        } else if (selectedSchedule.seatsAvailable <= 5) {
                            selectedSchedule.availabilityStatus = 'Selling Fast';
                        }
                        await booking.course.save();
                    }
                }
            }

            // Standard status update to PAID
            booking.paymentStatus = 'Paid';
            booking.status = 'PAID';
            if (paymentIntentId) {
                booking.paymentIntentId = paymentIntentId;
            }
            await booking.save();

            if (booking && booking.customerDetails && booking.customerDetails.email) {
                if (await isEmailTemplateActive('paymentReceipt')) {
                    const sendEmail = require('../utils/sendEmail');
                    const emailHtml = `
                        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 12px; background-color: #ffffff;">
                            <div style="text-align: center; margin-bottom: 20px;">
                                <h1 style="color: #F8510C; margin: 0;">Payment Successful!</h1>
                                <p style="color: #666; font-size: 16px;">We have received your payment for the booking.</p>
                            </div>
                            <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                                <h3 style="margin-top: 0; color: #333; border-bottom: 2px solid #F8510C; padding-bottom: 8px;">Payment Details</h3>
                                <table style="width: 100%; border-collapse: collapse;">
                                    <tr>
                                        <td style="padding: 8px 0; color: #666; font-weight: bold;">Reference:</td>
                                        <td style="padding: 8px 0; color: #333; text-align: right;">${booking.bookingReference}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 8px 0; color: #666; font-weight: bold;">Course:</td>
                                        <td style="padding: 8px 0; color: #333; text-align: right;">${booking.course ? booking.course.title : 'Course'}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 8px 0; color: #666; font-weight: bold;">Total Paid:</td>
                                        <td style="padding: 8px 0; color: #F8510C; font-weight: bold; text-align: right;">£${booking.totalAmount}</td>
                                    </tr>
                                </table>
                            </div>

                            <div style="background-color: #fcf8e3; border-left: 4px solid #f0ad4e; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                                <p style="margin: 0; color: #8a6d3b; font-size: 13px; line-height: 1.5; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
                                    <strong>Refund Policy Notice:</strong> This booking is eligible for a full refund within <strong>7 days</strong> of booking, provided the course start date is in the future. No refunds will be accepted after this 7-day period. You can request a refund directly from your student dashboard.
                                </p>
                            </div>
                        </div>
                    `;
                    await sendEmail({
                        email: booking.customerDetails.email,
                        subject: `Payment Confirmation - ${booking.bookingReference}`,
                        message: `We have successfully received your payment of £${booking.totalAmount} for booking ${booking.bookingReference}.`,
                        html: emailHtml
                    });
                    console.log(`Payment email sent for booking ${bookingId}`);
                } else {
                    console.log(`Payment email skipped for booking ${bookingId} — paymentReceipt template disabled.`);
                }

                // Notify Admins about the payment success (independently gated by the paymentReceived notification setting)
                const notifyAdmins = require('../utils/notifyAdmins');
                await notifyAdmins({
                    settingKey: 'paymentReceived',
                    title: 'Payment Received',
                    message: `Payment of £${booking.totalAmount} received for booking ${booking.bookingReference} by ${booking.customerDetails.firstName} ${booking.customerDetails.lastName}.`,
                    type: 'payment'
                });
            }
        } catch (error) {
            console.error('Error sending payment confirmation email:', error);
        }
    };

    const sendPaymentFailureEmail = async (bookingId, intent) => {
        try {
            const booking = await Booking.findById(bookingId)
                .populate('course')
                .populate('user', 'status');
            if (!booking) {
                console.error(`Booking ${bookingId} not found in webhook handler (payment failed).`);
                return;
            }

            // Ignore stale failure events for bookings that already moved on (paid/cancelled/expired)
            if (booking.status !== 'PENDING') return;

            booking.paymentStatus = 'Failed';
            await booking.save();

            const failureReason = intent.last_payment_error?.message || 'Your payment could not be processed.';

            if (booking.customerDetails?.email && booking.user?.status !== 'inactive') {
                const emailHtml = `
                    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 12px; background-color: #ffffff;">
                        <div style="text-align: center; margin-bottom: 20px;">
                            <h1 style="color: #d9534f; margin: 0;">Payment Failed</h1>
                            <p style="color: #666; font-size: 16px;">We couldn't process your payment</p>
                        </div>
                        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                            <p style="color: #333;">Dear ${booking.customerDetails.firstName || 'Student'},</p>
                            <p style="color: #666;">Your payment for booking (Reference: <strong>${booking.bookingReference}</strong>) could not be completed.</p>
                            <p style="color: #d9534f; font-weight: bold; margin-top: 10px;">Reason: ${failureReason}</p>
                            <p style="color: #666; margin-top: 20px;">Your seat is still reserved for a short while — please try your payment again to secure your booking.</p>
                        </div>
                        <div style="text-align: center; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px;">
                            <p style="color: #888; font-size: 14px;">If you have any questions, please contact our support team.</p>
                        </div>
                    </div>
                `;

                try {
                    await sendEmail({
                        email: booking.customerDetails.email,
                        subject: `Payment Failed - ${booking.bookingReference}`,
                        message: `Your payment for booking ${booking.bookingReference} could not be processed. Reason: ${failureReason}. Please try again to secure your seat.`,
                        html: emailHtml
                    });
                } catch (emailErr) {
                    console.error('Payment Failure Email Error:', emailErr);
                }
            }

            // Notify Admins about the payment failure (gated by "Failed Payment Alerts" setting)
            const notifyAdmins = require('../utils/notifyAdmins');
            await notifyAdmins({
                settingKey: 'paymentAlerts',
                title: 'Payment Failed',
                message: `Payment failed for booking ${booking.bookingReference} (${booking.course?.title || 'Course'}) by ${booking.customerDetails?.firstName || ''} ${booking.customerDetails?.lastName || ''}. Reason: ${failureReason}`,
                type: 'payment'
            });
        } catch (error) {
            console.error('Error handling payment failure webhook:', error);
        }
    };

    const handleReschedulePayment = async (bookingId, paymentIntentId) => {
        try {
            const booking = await Booking.findById(bookingId).populate('course');
            if (!booking || !booking.pendingReschedule || !booking.pendingReschedule.newStartDate) {
                console.error(`Booking ${bookingId} not found or no pending reschedule in webhook handler.`);
                return;
            }

            // Apply the pending reschedule
            booking.rescheduleHistory.push({
                previousStartDate: booking.session.startDate,
                newStartDate: booking.pendingReschedule.newStartDate,
                previousEndDate: booking.session.endDate,
                newEndDate: booking.pendingReschedule.newEndDate,
                reason: booking.pendingReschedule.reason
            });
            booking.session.startDate = booking.pendingReschedule.newStartDate;
            booking.session.endDate = booking.pendingReschedule.newEndDate;
            booking.lifecycleStatus = 'Upcoming';
            
            // Clear pending reschedule
            booking.pendingReschedule = undefined;
            await booking.save();

            const sendEmail = require('../utils/sendEmail');
            const emailHtml = `
                <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 12px; background-color: #ffffff;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <h1 style="color: #4ade80; margin: 0;">Reschedule Confirmed!</h1>
                        <p style="color: #666; font-size: 16px;">We have received your rescheduling fee payment.</p>
                    </div>
                    <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                        <h3 style="margin-top: 0; color: #333; border-bottom: 2px solid #4ade80; padding-bottom: 8px;">New Course Dates</h3>
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr>
                                <td style="padding: 8px 0; color: #666; font-weight: bold;">Reference:</td>
                                <td style="padding: 8px 0; color: #333; text-align: right;">${booking.bookingReference}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #666; font-weight: bold;">New Start Date:</td>
                                <td style="padding: 8px 0; color: #333; text-align: right;">${new Date(booking.session.startDate).toLocaleDateString('en-GB')}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #666; font-weight: bold;">New End Date:</td>
                                <td style="padding: 8px 0; color: #333; text-align: right;">${new Date(booking.session.endDate).toLocaleDateString('en-GB')}</td>
                            </tr>
                        </table>
                    </div>
                </div>
            `;
            await sendEmail({
                email: booking.customerDetails?.email,
                subject: `Reschedule Confirmation - ${booking.bookingReference}`,
                message: `Your course has been successfully rescheduled.`,
                html: emailHtml
            });

            console.log(`Booking ${bookingId} reschedule payment handled.`);
        } catch (error) {
            console.error('Error handling reschedule payment:', error);
        }
    };

    // Handle both Checkout Session and PaymentIntent events
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const bookingId = session.metadata.bookingId;
        const action = session.metadata.action;
        const paymentIntentId = session.payment_intent;
        if (action === 'reschedulePayment') {
            await handleReschedulePayment(bookingId, paymentIntentId);
        } else {
            await sendPaymentEmail(bookingId, paymentIntentId);
        }
        console.log(`Booking ${bookingId} confirmed via Stripe webhook (checkout).`);
    } else if (event.type === 'payment_intent.succeeded') {
        const intent = event.data.object;
        const bookingId = intent.metadata.bookingId;
        const action = intent.metadata.action;
        const paymentIntentId = intent.id;
        if (bookingId) {
            if (action === 'reschedulePayment') {
                await handleReschedulePayment(bookingId, paymentIntentId);
            } else {
                await sendPaymentEmail(bookingId, paymentIntentId);
            }
            console.log(`Booking ${bookingId} confirmed via Stripe webhook (payment_intent).`);
        }
    } else if (event.type === 'payment_intent.payment_failed') {
        const intent = event.data.object;
        const bookingId = intent.metadata?.bookingId;
        if (bookingId) {
            await sendPaymentFailureEmail(bookingId, intent);
            console.log(`Booking ${bookingId} payment failed via Stripe webhook.`);
        }
    }

    res.json({ received: true });
};
