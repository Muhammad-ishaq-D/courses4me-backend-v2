const cron = require('node-cron');
const Booking = require('../models/Booking');
const Course = require('../models/Course');
const License = require('../models/License');
const sendEmail = require('../utils/sendEmail');
const isEmailTemplateActive = require('../utils/isEmailTemplateActive');

const initBookingCron = () => {
    // Run every minute
    cron.schedule('* * * * *', async () => {
        try {
            const expirationTime = new Date(Date.now() - 60 * 60 * 1000); // 60 minutes ago (1 hour)

            // Find all pending bookings older than 60 minutes
            const expiredBookings = await Booking.find({
                status: 'PENDING',
                createdAt: { $lt: expirationTime }
            }).populate('user', 'status');

            if (expiredBookings.length > 0) {
                console.log(`[Cron] Found ${expiredBookings.length} expired pending bookings. Processing...`);

                for (const booking of expiredBookings) {
                    try {
                        // 1. Send Cancellation Email (skip inactive accounts)
                        if (booking.customerDetails && booking.customerDetails.email && booking.user?.status !== 'inactive' && (await isEmailTemplateActive('bookingCancellation'))) {
                            try {
                                const emailHtml = `
                                    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 12px; background-color: #ffffff;">
                                        <div style="text-align: center; margin-bottom: 20px;">
                                            <h1 style="color: #d9534f; margin: 0;">Booking Cancelled</h1>
                                            <p style="color: #666; font-size: 16px;">Payment Time Expired</p>
                                        </div>
                                        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                                            <p style="color: #333;">Dear ${booking.customerDetails.firstName},</p>
                                            <p style="color: #666;">We noticed that the payment for your booking (Reference: <strong>${booking.bookingReference}</strong>) was not completed within the allowed time (1 hour).</p>
                                            <p style="color: #666;">As a result, your booking has been automatically cancelled to free up the seat for other students.</p>
                                            <p style="color: #666; margin-top: 20px;">If you still wish to attend, please feel free to create a new booking on our website!</p>
                                        </div>
                                        <div style="text-align: center; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px;">
                                            <p style="color: #888; font-size: 14px;">If you have any questions, please contact our support team.</p>
                                        </div>
                                    </div>
                                `;

                                await sendEmail({
                                    email: booking.customerDetails.email,
                                    subject: `Booking Cancelled - Payment Timeout (${booking.bookingReference})`,
                                    message: `Your booking ${booking.bookingReference} has been cancelled because payment was not completed within 1 hour. Please book again if you still wish to attend.`,
                                    html: emailHtml
                                });
                            } catch (emailErr) {
                                console.error(`[Cron] Error sending cancellation email for booking ${booking._id}:`, emailErr);
                            }
                        }

                        // 2. Restore seat inventory
                        if (booking.session && booking.session.scheduleId) {
                            const CourseLocationDate = require('../models/CourseLocationDate');
                            const scheduleRecord = await CourseLocationDate.findById(booking.session.scheduleId);
                            if (scheduleRecord) {
                                scheduleRecord.bookedSeats = Math.max(0, scheduleRecord.bookedSeats - 1);
                                await scheduleRecord.save();
                                console.log(`[Cron] Restored 1 seat (bookedSeats decremented) for CourseLocationDate ${booking.session.scheduleId}`);
                            } else {
                                // Fallback to embedded locations (used for Licenses or older courses)
                                let courseModel = booking.courseModel === 'License' ? License : Course;
                                const course = await courseModel.findById(booking.course);
                                
                                if (course && course.locations) {
                                    let updated = false;
                                    for (const loc of (course.locations || [])) {
                                        const schedule = loc.schedules.id ? loc.schedules.id(booking.session.scheduleId) : loc.schedules.find(s => s._id.toString() === booking.session.scheduleId.toString());
                                        if (schedule) {
                                            schedule.seatsAvailable += 1;
                                            
                                            // Update availabilityStatus dynamically based on new count
                                            if (schedule.seatsAvailable > 5) {
                                                schedule.availabilityStatus = 'Available';
                                            } else if (schedule.seatsAvailable > 0) {
                                                schedule.availabilityStatus = 'Selling Fast';
                                            }
                                            updated = true;
                                            break;
                                        }
                                    }
                                    if (updated) {
                                        await course.save();
                                        console.log(`[Cron] Restored 1 seat for course ${course.title}, schedule ${booking.session.scheduleId}`);
                                    }
                                }
                            }
                        }

                        // 3. Mark the booking as EXPIRED
                        booking.status = 'EXPIRED';
                        booking.lifecycleStatus = 'Cancelled';
                        await booking.save();
                        console.log(`[Cron] Marked booking ${booking._id} (Ref: ${booking.bookingReference}) as EXPIRED`);
                    } catch (innerErr) {
                        console.error(`[Cron] Error processing individual expired booking ${booking._id}:`, innerErr);
                        // Make sure to mark the booking as EXPIRED even if seat restoration fails
                        try {
                            booking.status = 'EXPIRED';
                            booking.lifecycleStatus = 'Cancelled';
                            await booking.save();
                            console.log(`[Cron] Force marked booking ${booking._id} as EXPIRED after failure.`);
                        } catch(saveErr) {
                            console.error(`[Cron] Failed to force expire booking ${booking._id}:`, saveErr);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('[Cron] Error processing expired bookings:', error);
        }
    });
    console.log('[Cron] Booking expiration cron job initialized.');
};

module.exports = initBookingCron;
