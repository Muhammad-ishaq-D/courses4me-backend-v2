const cron = require('node-cron');
const Booking = require('../models/Booking');
const User = require('../models/User');
const Settings = require('../models/Settings');
const notifyAdmins = require('../utils/notifyAdmins');

const buildWeeklyDigest = async () => {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const dateFilter = { createdAt: { $gte: weekAgo } };

    const bookingsInRange = await Booking.countDocuments(dateFilter);
    const newUsersInRange = await User.countDocuments({ ...dateFilter, role: 'customer' });

    const revenueAgg = await Booking.aggregate([
        { $match: { ...dateFilter, paymentStatus: 'Paid' } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);
    const revenueInRange = revenueAgg.length > 0 ? revenueAgg[0].total : 0;

    const topCourseAgg = await Booking.aggregate([
        { $match: dateFilter },
        {
            $lookup: {
                from: 'courses',
                localField: 'course',
                foreignField: '_id',
                as: 'courseDetails'
            }
        },
        { $unwind: { path: '$courseDetails', preserveNullAndEmptyArrays: true } },
        {
            $group: {
                _id: '$course',
                title: { $first: '$courseDetails.title' },
                bookings: { $sum: 1 }
            }
        },
        { $sort: { bookings: -1 } },
        { $limit: 1 }
    ]);
    const topCourse = topCourseAgg[0];

    return { bookingsInRange, newUsersInRange, revenueInRange, topCourse };
};

const runWeeklyReport = async () => {
    try {
        const settings = await Settings.findOne();
        if (settings?.notifications?.weeklyReport === false) {
            console.log('[Cron] Weekly report skipped — disabled in Settings.');
            return;
        }

        const { bookingsInRange, newUsersInRange, revenueInRange, topCourse } = await buildWeeklyDigest();

        const message = `Last 7 days: £${revenueInRange.toFixed(2)} revenue, ${bookingsInRange} booking${bookingsInRange === 1 ? '' : 's'}, ${newUsersInRange} new customer${newUsersInRange === 1 ? '' : 's'}.` +
            (topCourse ? ` Top course: ${topCourse.title || 'Unknown'} (${topCourse.bookings} bookings).` : '');

        await notifyAdmins({
            settingKey: 'weeklyReport',
            title: 'Weekly Summary Report',
            message,
            type: 'system'
        });
        console.log('[Cron] Weekly report notification sent to admins.');
    } catch (error) {
        console.error('[Cron] Error generating weekly report:', error);
    }
};

const initWeeklyReportCron = () => {
    // Every Monday at 08:00
    cron.schedule('0 8 * * 1', runWeeklyReport);
    console.log('[Cron] Weekly report cron job initialized.');
};

module.exports = initWeeklyReportCron;
