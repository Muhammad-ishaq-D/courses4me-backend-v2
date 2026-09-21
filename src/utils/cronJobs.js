const cron = require('node-cron');
const Booking = require('../models/Booking');
const sendEmail = require('./sendEmail');

const startCronJobs = () => {
    // Run every hour to check for expired pending bookings
    cron.schedule('0 * * * *', async () => {
        console.log('[CRON] Running check for expired pending bookings...');
        try {
            // Find bookings that are PENDING and created more than 24 hours ago
            const expirationTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
            
            const expiredBookings = await Booking.find({
                status: 'PENDING',
                createdAt: { $lt: expirationTime }
            }).populate('course').populate('user');

            if (expiredBookings.length > 0) {
                console.log(`[CRON] Found ${expiredBookings.length} expired pending bookings. Cleaning up...`);
                
                for (const booking of expiredBookings) {
                    const cleanEmail = booking.customerDetails?.email || booking.user?.email;
                    
                    if (cleanEmail) {
                        const emailHtml = `
                            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 12px; background-color: #ffffff;">
                                <div style="text-align: center; margin-bottom: 20px;">
                                    <h1 style="color: #EF4444; margin: 0;">Booking Expired</h1>
                                    <p style="color: #666; font-size: 16px;">Your pending booking has timed out.</p>
                                </div>
                                <div style="background-color: #FEF2F2; padding: 20px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #EF4444;">
                                    <p style="margin: 0; color: #555; font-size: 15px; line-height: 1.5;">
                                        Unfortunately, we did not receive payment for your booking of <strong>${booking.course?.title || 'the course'}</strong> within the required timeframe (24 hours).
                                    </p>
                                    <p style="margin: 15px 0 0 0; color: #555; font-size: 15px; line-height: 1.5;">
                                        Your booking reference <strong>${booking.bookingReference}</strong> has been automatically cancelled to free up the seat for other students.
                                    </p>
                                </div>
                                <div style="text-align: center; margin-top: 25px;">
                                    <p style="color: #333; font-size: 15px; font-weight: bold;">Still want to attend?</p>
                                    <p style="color: #666; font-size: 14px; margin-bottom: 20px;">You can easily re-book your spot on our website.</p>
                                    <a href="${process.env.FRONTEND_URL || 'https://courses4me.co.uk'}" style="display: inline-block; padding: 12px 24px; background-color: #F8510C; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 15px;">Book Again</a>
                                </div>
                            </div>
                        `;

                        try {
                            await sendEmail({
                                email: cleanEmail,
                                subject: `Booking Expired - ${booking.bookingReference}`,
                                message: `Your pending booking ${booking.bookingReference} for ${booking.course?.title || 'the course'} has expired because we did not receive payment in time. Please visit our website to book again.`,
                                html: emailHtml
                            });
                        } catch (emailErr) {
                            console.error(`[CRON] Failed to send expiration email to ${cleanEmail}:`, emailErr);
                        }
                    }

                    // Mark the booking as EXPIRED
                    booking.status = 'EXPIRED';
                    booking.lifecycleStatus = 'Cancelled';
                    await booking.save();
                    console.log(`[CRON] Marked expired booking ${booking._id} (Ref: ${booking.bookingReference}) as EXPIRED`);
                }
            } else {
                console.log('[CRON] No expired pending bookings found.');
            }
        } catch (error) {
            console.error('[CRON] Error during expired bookings check:', error);
        }
    });
};

module.exports = startCronJobs;
