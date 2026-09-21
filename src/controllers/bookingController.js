const Booking = require('../models/Booking');
const User = require('../models/User');
const Course = require('../models/Course');
const Notification = require('../models/Notification');
const sendEmail = require('../utils/sendEmail');
const notifyAdmins = require('../utils/notifyAdmins');
const isEmailTemplateActive = require('../utils/isEmailTemplateActive');

// Helper to calculate dynamic lifecycle status
const calculateLifecycleStatus = (booking) => {
    // If manually set to terminal/overridden states, respect them
    if (['Cancelled', 'Postponed'].includes(booking.lifecycleStatus)) {
        return booking.lifecycleStatus;
    }

    const now = new Date();
    const start = new Date(booking.session.startDate);
    const end = new Date(booking.session.endDate);

    if (now < start) {
        return 'Upcoming';
    } else if (now >= start && now <= end) {
        // If it was extended and we are in the extended period
        if (booking.extensionHistory && booking.extensionHistory.length > 0) {
            return 'Extended';
        }
        return 'Ongoing';
    } else {
        return 'Completed';
    }
};

// @desc    Create new booking
// @route   POST /api/bookings
// @access  Public
exports.createBooking = async (req, res, next) => {
    console.log('--- ENTERING CREATE BOOKING ---');
    try {
        const {
            courseId,
            session, // Expecting session object with location, startDate
            customerDetails,
            billingAddress,
            packageName,
            options,
            paymentMethod,
            additionalInfo,
            totalAmount
        } = req.body;

        // 1. Find the course or license and check schedule availability
        console.log('1. Starting createBooking, body:', JSON.stringify(req.body).substring(0, 500));
        let course = await Course.findById(courseId);
        let courseModel = 'Course';
        if (!course) {
            const License = require('../models/License');
            course = await License.findById(courseId);
            courseModel = 'License';
        }
        if (!course) {
            console.log('Course/License not found:', courseId);
            return res.status(404).json({ success: false, message: 'Course/License not found' });
        }

        console.log('2. Course found, looking for schedule...');
        let selectedSchedule = null;
        let selectedLocation = null;

        // Try to find the schedule in the new CourseLocationDate collection first
        if (session.scheduleId) {
            const CourseLocationDate = require('../models/CourseLocationDate');
            const CourseLocation = require('../models/CourseLocation');
            const scheduleRecord = await CourseLocationDate.findById(session.scheduleId);

            if (scheduleRecord) {
                const courseLocation = await CourseLocation.findById(scheduleRecord.courseLocationId).populate('locationId');
                if (courseLocation && courseLocation.courseId.toString() === courseId.toString()) {
                    selectedSchedule = scheduleRecord;
                    selectedSchedule.price = courseLocation.price; // Inherit price from CourseLocation link

                    // Format for backward compatibility with booking logic
                    selectedSchedule.seatsAvailable = Math.max(0, scheduleRecord.availableSeats - scheduleRecord.bookedSeats);

                    selectedLocation = courseLocation.locationId;
                }
            }
        }

        // Fallback to embedded locations (used for Licenses or older courses)
        if (!selectedSchedule && course.locations && course.locations.length > 0) {
            for (const loc of course.locations) {
                const schedule = loc.schedules.find(s =>
                    (session.scheduleId && s._id.toString() === session.scheduleId.toString()) ||
                    (new Date(s.startDate).getTime() === new Date(session.startDate).getTime() &&
                        session.location === loc.name)
                );

                if (schedule) {
                    selectedSchedule = schedule;
                    selectedLocation = loc;
                    break;
                }
            }
        }

        if (!selectedSchedule) {
            console.log('Schedule not found for course:', courseId);
            return res.status(400).json({ success: false, message: 'Schedule not found for this course' });
        }

        // Determine exact start time for the course
        let exactStartDateTime = new Date(selectedSchedule.startDate);
        let startTimeStr = '09:00'; // Default start time

        if (selectedSchedule.constructor.modelName === 'CourseLocationDate') {
            if (selectedSchedule.timingsType === 'flexible' && selectedSchedule.weeklyTimings) {
                const dayOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][exactStartDateTime.getDay()];
                if (selectedSchedule.weeklyTimings[dayOfWeek] && !selectedSchedule.weeklyTimings[dayOfWeek].isOff) {
                    startTimeStr = selectedSchedule.weeklyTimings[dayOfWeek].startTime || '09:00';
                }
            } else if (selectedSchedule.startTime) {
                startTimeStr = selectedSchedule.startTime;
            }
        } else if (selectedSchedule.time) {
            const timeParts = selectedSchedule.time.split('-');
            if (timeParts.length > 0) {
                startTimeStr = timeParts[0].trim();
            }
        }

        const timeMatch = startTimeStr.match(/(\d{1,2}):(\d{2})/);
        if (timeMatch) {
            // Apply the parsed hours and minutes
            exactStartDateTime.setHours(parseInt(timeMatch[1], 10), parseInt(timeMatch[2], 10), 0, 0);
        } else {
            exactStartDateTime.setHours(0, 0, 0, 0);
        }

        // Prevent booking for courses that have already started (even 1 minute past start time)
        if (new Date() > exactStartDateTime) {
            return res.status(400).json({ success: false, message: 'Cannot book a course schedule that has already started.' });
        }

        console.log('3. Schedule found. Resolving user before seat deduction...');
        const cleanEmail = customerDetails.email ? customerDetails.email.trim() : '';
        let user = await User.findOne({ email: cleanEmail });
        const userPassword = customerDetails.password || Math.random().toString(36).slice(-8);
        let isBrandNewUser = false;

        // 3.5 Check for existing booking BEFORE touching seats
        console.log('3.5 Checking for existing active bookings...');
        if (user) {
            const existingBooking = await Booking.findOne({
                user: user._id,
                course: courseId,
                status: { $in: ['PENDING', 'PAID'] }
            });

            if (existingBooking) {
                console.log('Duplicate booking prevented for user:', user._id);

                let message = '';
                if (existingBooking.status === 'PAID') {
                    message = 'You are already enrolled in this course.';
                } else {
                    if (existingBooking.session?.scheduleId?.toString() === selectedSchedule._id.toString()) {
                        message = 'You already have a pending booking for this specific schedule. Please complete your payment.';
                    } else {
                        message = 'You have a pending booking for a different date. Please complete your payment or cancel your existing booking before selecting a new schedule.';
                    }
                }

                return res.status(400).json({
                    success: false,
                    message: message,
                    existingBookingId: existingBooking._id,
                    existingBookingStatus: existingBooking.status
                });
            }
        }

        // Only deduct a seat now that we know this is a fresh booking
        console.log('4. Updating seats...');
        let remainingSeats;
        if (selectedSchedule.constructor.modelName === 'CourseLocationDate') {
            selectedSchedule.bookedSeats += 1;
            await selectedSchedule.save();
            remainingSeats = Math.max(0, selectedSchedule.availableSeats - selectedSchedule.bookedSeats);
            console.log('5. CourseLocationDate saved.');
        } else {
            selectedSchedule.seatsAvailable -= 1;
            if (selectedSchedule.seatsAvailable === 0) {
                selectedSchedule.availabilityStatus = 'Sold Out';
            } else if (selectedSchedule.seatsAvailable <= 5) {
                selectedSchedule.availabilityStatus = 'Selling Fast';
            }
            await course.save();
            remainingSeats = selectedSchedule.seatsAvailable;
            console.log('5. Course saved.');
        }

        if (remainingSeats <= 5) {
            try {
                await notifyAdmins({
                    settingKey: 'seatAvailability',
                    title: 'Low Seat Availability',
                    message: `Only ${remainingSeats} seat${remainingSeats === 1 ? '' : 's'} left for ${course.title}${selectedLocation?.name ? ` at ${selectedLocation.name}` : ''}.`,
                    type: 'booking'
                });
            } catch (notifErr) {
                console.error('Notification Error (Low Seat Availability):', notifErr);
            }
        }

        console.log('5.5 Handling user details...');
        if (!user) {
            console.log('Creating new user...');
            isBrandNewUser = true;
            user = await User.create({
                name: `${customerDetails.firstName} ${customerDetails.lastName}`,
                email: cleanEmail,
                phone: customerDetails.phone,
                dob: customerDetails.dob,
                billingAddress: billingAddress,
                password: userPassword,
                role: 'customer',
                activityHistory: [{
                    action: 'Registration',
                    details: 'Account automatically created during first course booking'
                }]
            });

            try {
                await notifyAdmins({
                    settingKey: 'userRegistration',
                    title: 'New User Registration',
                    message: `${user.name} (${user.email}) just created an account.`,
                    type: 'user'
                });
            } catch (notifErr) {
                console.error('Notification Error (New User Registration):', notifErr);
            }
        } else {
            console.log('Updating existing user...');
            user.name = `${customerDetails.firstName} ${customerDetails.lastName}`;
            user.phone = customerDetails.phone;
            user.dob = customerDetails.dob;
            user.billingAddress = billingAddress;
            if (customerDetails.password) {
                user.password = customerDetails.password;
            }
            await user.save({ validateBeforeSave: false });
        }
        console.log('6. User handled.');

        console.log('7. Creating booking record...');
        const isNewScheduleModel = selectedSchedule.constructor.modelName === 'CourseLocationDate';
        const locationName = selectedLocation?.name || session.location || 'Online';
        const sessionTime = isNewScheduleModel
            ? (selectedSchedule.timingsType === 'flexible'
                ? 'Varies by day'
                : `${selectedSchedule.startTime || '09:00'} - ${selectedSchedule.endTime || '17:00'}`)
            : selectedSchedule.time;
        const sessionPrice = isNewScheduleModel
            ? (selectedSchedule.price || totalAmount)
            : (selectedSchedule.price || totalAmount);

        const booking = await Booking.create({
            user: user._id,
            course: courseId,
            courseModel: courseModel,
            session: {
                locationName,
                branchName: locationName,
                scheduleId: selectedSchedule._id,
                startDate: selectedSchedule.startDate,
                endDate: selectedSchedule.endDate,
                time: sessionTime,
                price: sessionPrice
            },
            customerDetails: {
                firstName: customerDetails.firstName,
                lastName: customerDetails.lastName,
                email: cleanEmail,
                phone: customerDetails.phone,
                dob: customerDetails.dob
            },
            billingAddress,
            packageName,
            options: {
                easyApply: options?.easyApply || false
            },
            paymentMethod,
            additionalInfo,
            totalAmount,
            status: 'PENDING',
            paymentStatus: 'Pending'
        });
        console.log('8. Booking created successfully:', booking._id);

        // Log activity in user history
        try {
            user.activityHistory.push({
                action: 'Course Booking',
                details: `Booked: ${course.title} (Ref: ${booking.bookingReference})`
            });
            await user.save({ validateBeforeSave: false });
        } catch (logErr) {
            console.error('Activity Log Error:', logErr);
        }

        // 9. Notify Admins
        try {
            await notifyAdmins({
                settingKey: 'bookingAlerts',
                title: 'New Course Booking',
                message: `New booking for ${course.title} by ${customerDetails.firstName} ${customerDetails.lastName} (Payment: ${paymentMethod === 'card' ? 'Pending' : paymentMethod})`,
                type: 'booking'
            });
            console.log('9. Notified admins of new booking (if enabled).');
        } catch (notifErr) {
            console.error('Notification Error:', notifErr);
            // Don't fail the booking if notification fails
        }

        // 10. Send Confirmation Email to Customer (skip inactive accounts)
        try {
            if (user.status === 'inactive') {
                console.log('10. Skipped confirmation email — user is inactive.');
            } else if (!(await isEmailTemplateActive('bookingConfirmation'))) {
                console.log('10. Skipped confirmation email — bookingConfirmation template disabled.');
            } else {
                // We use userPassword from earlier to show the temporary password.
                // If customerDetails.password is NOT provided, it means they were a guest and a password was generated.

                const fmtTime = (timeStr) => {
                    if (!timeStr) return "";
                    const [h, m] = timeStr.split(":");
                    let hour = parseInt(h, 10);
                    const ampm = hour >= 12 ? "PM" : "AM";
                    hour = hour % 12 || 12;
                    return `${hour}:${m} ${ampm}`;
                };

                let flexibleTimingsHtml = '';
                if (isNewScheduleModel && selectedSchedule.timingsType === 'flexible' && selectedSchedule.weeklyTimings) {
                    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
                    let rows = '';
                    days.forEach(day => {
                        const config = selectedSchedule.weeklyTimings[day];
                        const isOff = !config || config.isOff;
                        const timeStr = isOff ? 'Off' : `${fmtTime(config.startTime || '09:00')} - ${fmtTime(config.endTime || '17:00')}`;
                        rows += `
                            <tr>
                                <td style="padding: 4px 0; color: #666; text-transform: capitalize; font-size: 13px;">${day}</td>
                                <td style="padding: 4px 0; color: #333; text-align: right; font-size: 13px;">${timeStr}</td>
                            </tr>
                        `;
                    });
                    flexibleTimingsHtml = `
                        <tr>
                            <td colspan="2" style="padding: 10px 0;">
                                <div style="background-color: #f1f5f9; padding: 12px; border-radius: 6px;">
                                    <strong style="color: #475569; font-size: 13px; display: block; margin-bottom: 8px;">Weekly Schedule:</strong>
                                    <table style="width: 100%; border-collapse: collapse;">
                                        ${rows}
                                    </table>
                                </div>
                            </td>
                        </tr>
                    `;
                }

                const emailHtml = `
                <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 12px; background-color: #ffffff;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <h1 style="color: #F8510C; margin: 0;">Booking Confirmed!</h1>
                        <p style="color: #666; font-size: 16px;">Thank you for choosing Courses4Me</p>
                    </div>

                    ${booking.paymentStatus === 'Pending' ? `
                    <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
                        <p style="color: #856404; margin: 0; font-size: 14px;">
                            <strong>Action Required:</strong> Your payment is currently pending. Please complete your payment within <strong>60 minutes</strong>, or your booking will be automatically cancelled.
                        </p>
                    </div>
                    ` : ''}
                    
                    <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                        <h3 style="margin-top: 0; color: #333; border-bottom: 2px solid #F8510C; padding-bottom: 8px;">Booking Details</h3>
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr>
                                <td style="padding: 8px 0; color: #666; font-weight: bold;">Reference:</td>
                                <td style="padding: 8px 0; color: #333; text-align: right;">${booking.bookingReference}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #666; font-weight: bold;">Course:</td>
                                <td style="padding: 8px 0; color: #333; text-align: right;">${course.title}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #666; font-weight: bold;">Location:</td>
                                <td style="padding: 8px 0; color: #333; text-align: right;">${selectedLocation.name}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #666; font-weight: bold;">Date:</td>
                                <td style="padding: 8px 0; color: #333; text-align: right;">${new Date(selectedSchedule.startDate).toLocaleDateString('en-GB')}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #666; font-weight: bold;">Time:</td>
                                <td style="padding: 8px 0; color: #333; text-align: right;">${sessionTime}</td>
                            </tr>
                            ${flexibleTimingsHtml}
                            <tr>
                                <td style="padding: 8px 0; color: #666; font-weight: bold; border-top: 1px solid #ddd;">Total Amount:</td>
                                <td style="padding: 8px 0; color: #F8510C; font-weight: bold; font-size: 18px; text-align: right; border-top: 1px solid #ddd;">£${totalAmount}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #666; font-weight: bold;">Payment Status:</td>
                                <td style="padding: 8px 0; color: #333; text-align: right;">${booking.paymentStatus.toUpperCase()}</td>
                            </tr>
                        </table>
                    </div>

                    <!-- Account Created block temporarily removed to bypass Gmail spam heuristics -->

                    <div style="text-align: center; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px;">
                        <p style="color: #888; font-size: 14px;">If you have any questions, please contact our support team.</p>
                        <p style="color: #888; font-size: 14px;">&copy; ${new Date().getFullYear()} Courses4Me. All rights reserved.</p>
                    </div>
                </div>
            `;

                await sendEmail({
                    email: cleanEmail,
                    subject: `Booking Confirmation - ${course.title} (${booking.bookingReference})`,
                    message: `Thank you for your booking! Reference: ${booking.bookingReference}. Course: ${course.title}. Total: £${totalAmount}. Payment Status: ${booking.paymentStatus.toUpperCase()}.`,
                    html: emailHtml
                });
                console.log('10. Confirmation email sent to user.');
            }
        } catch (emailErr) {
            console.error('Email Sending Error:', emailErr);
            const fs = require('fs');
            fs.writeFileSync('email_error_log.txt', JSON.stringify(emailErr, Object.getOwnPropertyNames(emailErr), 2));
            // Don't fail the booking if email fails
        }

        res.status(201).json({
            success: true,
            data: booking
        });
    } catch (error) {
        console.error('Create Booking Error EXCEPTION:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get all bookings (Admin only)
// @route   GET /api/bookings
// @access  Private/Admin
exports.getBookings = async (req, res, next) => {
    try {
        const { status, paymentStatus, fromDate, toDate, search } = req.query;
        let query = {};

        // Filtering
        if (status && status !== 'All Booking Status') {
            if (status === 'Confirmed') {
                query.status = 'PAID';
            } else if (status === 'Pending') {
                query.status = 'PENDING';
            } else if (status === 'Cancelled') {
                query.status = 'CANCELLED';
            } else if (status === 'Expired') {
                query.status = 'EXPIRED';
            } else {
                query.status = status.toUpperCase();
            }
        }
        if (paymentStatus && paymentStatus !== 'All Payments') {
            if (paymentStatus === 'Refund Requested') {
                query['refundRequest.status'] = 'Requested';
            } else {
                query.paymentStatus = paymentStatus;
            }
        }

        // Date range
        if (fromDate || toDate) {
            query.createdAt = {};
            if (fromDate) query.createdAt.$gte = new Date(fromDate);
            if (toDate) query.createdAt.$lte = new Date(toDate + 'T23:59:59.999Z');
        }

        let bookings = await Booking.find(query)
            .populate('user', 'name email role')
            .populate('course', 'title category')
            .sort({ createdAt: -1 });

        // Search term (on populated fields or customerDetails)
        if (search) {
            const searchLower = search.toLowerCase();
            bookings = bookings.filter(b =>
                b.customerDetails.firstName.toLowerCase().includes(searchLower) ||
                b.customerDetails.lastName.toLowerCase().includes(searchLower) ||
                b.customerDetails.email.toLowerCase().includes(searchLower) ||
                b._id.toString().includes(searchLower) ||
                (b.course && b.course.title.toLowerCase().includes(searchLower))
            );
        }

        // Deduplicate: if a user has both PAID and PENDING for the same course,
        // only show the PAID one. Keep the most relevant booking per user+course.
        const STATUS_PRIORITY = { 'PAID': 0, 'PENDING': 1, 'EXPIRED': 2, 'CANCELLED': 3 };
        const bookingMap = new Map();
        for (const b of bookings) {
            const userId = b.user?._id?.toString() || b.customerDetails?.email || 'unknown';
            const courseId = b.course?._id?.toString() || b.course?.toString() || 'unknown';
            const key = `${userId}::${courseId}`;
            const existing = bookingMap.get(key);
            if (!existing) {
                bookingMap.set(key, b);
            } else {
                // Keep the one with higher priority (lower number)
                const existingPriority = STATUS_PRIORITY[existing.status] ?? 99;
                const newPriority = STATUS_PRIORITY[b.status] ?? 99;
                if (newPriority < existingPriority) {
                    bookingMap.set(key, b);
                }
            }
        }
        const deduplicatedBookings = Array.from(bookingMap.values()).map(b => {
            const dynamicStatus = calculateLifecycleStatus(b);
            const bObj = b.toObject ? b.toObject() : { ...b };
            bObj.lifecycleStatus = dynamicStatus;
            return bObj;
        });

        res.status(200).json({
            success: true,
            count: deduplicatedBookings.length,
            data: deduplicatedBookings
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get all users (Admin only)
// @route   GET /api/bookings/users
// @access  Private/Admin
exports.getCustomers = async (req, res, next) => {
    try {
        const { status, fromDate, toDate, search } = req.query;
        let query = {};

        // Filtering
        // Note: The UI has status for users (Active/Inactive), 
        // we might not have that property yet, so we can mock or use a default.

        // Date range
        if (fromDate || toDate) {
            query.createdAt = {};
            if (fromDate) query.createdAt.$gte = new Date(fromDate);
            if (toDate) query.createdAt.$lte = new Date(toDate);
        }

        let customers = await User.find(query).sort({ createdAt: -1 }).lean();

        // Search
        if (search) {
            const searchLower = search.toLowerCase();
            customers = customers.filter(c =>
                c.name.toLowerCase().includes(searchLower) ||
                c.email.toLowerCase().includes(searchLower)
            );
        }

        // Aggregate stats
        const customerData = await Promise.all(customers.map(async (customer) => {
            const bookings = await Booking.find({ user: customer._id });
            const totalSpent = bookings.reduce((sum, b) => sum + (b.paymentStatus === 'Paid' ? b.totalAmount : 0), 0);

            return {
                ...customer,
                bookingCount: bookings.length,
                totalSpent,
                status: 'Active' // Default for now
            };
        }));

        res.status(200).json({
            success: true,
            count: customerData.length,
            data: customerData
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get single booking
// @route   GET /api/bookings/:id
// @access  Private
exports.getBookingById = async (req, res, next) => {
    try {
        const booking = await Booking.findById(req.params.id)
            .populate('user', 'name email')
            .populate('course', 'title');

        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        res.status(200).json({
            success: true,
            data: booking
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get single user/customer
// @route   GET /api/bookings/users/:id
// @access  Private/Admin
exports.getUserById = async (req, res, next) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const bookings = await Booking.find({ user: user._id }).populate('course', 'title');
        const totalSpent = bookings.reduce((sum, b) => sum + (b.paymentStatus === 'Paid' ? b.totalAmount : 0), 0);

        res.status(200).json({
            success: true,
            data: {
                ...user._doc,
                bookings,
                totalSpent,
                bookingCount: bookings.length
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Update user/customer
// @route   PUT /api/bookings/users/:id
// @access  Private/Admin
exports.updateUser = async (req, res, next) => {
    try {
        const user = await User.findByIdAndUpdate(req.params.id, req.body, {
            new: true,
            runValidators: true
        });

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.status(200).json({
            success: true,
            data: user
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Delete user/customer
// @route   DELETE /api/bookings/users/:id
// @access  Private/Admin
exports.deleteUser = async (req, res, next) => {
    try {
        const user = await User.findById(req.params.id);

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Optional: Delete all bookings for this user too
        await Booking.deleteMany({ user: req.params.id });
        await user.deleteOne();

        res.status(200).json({
            success: true,
            message: 'User and their bookings removed'
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Bulk delete users/customers
// @route   POST /api/bookings/users/bulk-delete
// @access  Private/Admin
exports.deleteUsers = async (req, res, next) => {
    try {
        const { ids } = req.body;

        if (!ids || !ids.length) {
            return res.status(400).json({ success: false, message: 'Please provide user IDs' });
        }

        await Booking.deleteMany({ user: { $in: ids } });
        await User.deleteMany({ _id: { $in: ids } });

        res.status(200).json({
            success: true,
            message: `${ids.length} users and their bookings removed`
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
// @desc    Update booking status
// @route   PUT /api/bookings/:id
// @access  Private/Admin
exports.updateBooking = async (req, res, next) => {
    try {
        const { status, paymentStatus } = req.body;

        const booking = await Booking.findById(req.params.id);
        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        if (status) booking.status = status;
        if (paymentStatus) booking.paymentStatus = paymentStatus;

        await booking.save();

        res.status(200).json({
            success: true,
            data: booking
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Delete booking
// @route   DELETE /api/bookings/:id
// @access  Private/Admin
exports.deleteBooking = async (req, res, next) => {
    try {
        const booking = await Booking.findByIdAndDelete(req.params.id);

        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        res.status(200).json({
            success: true,
            data: {}
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get booking by reference
// @route   GET /api/bookings/reference/:ref
// @access  Public
exports.getBookingByReference = async (req, res, next) => {
    try {
        const booking = await Booking.findOne({ bookingReference: req.params.ref })
            .populate('user', 'name email')
            .populate('course', 'title category pricing');

        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        // Auto-verify with Stripe if it's still pending (Fallback for webhook delays/failures)
        if (booking.status === 'PENDING' && booking.stripeSessionId) {
            try {
                const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
                const session = await stripe.checkout.sessions.retrieve(booking.stripeSessionId);

                if (session.payment_status === 'paid') {
                    booking.status = 'PAID';
                    booking.paymentStatus = 'Paid';
                    booking.paymentIntentId = session.payment_intent || booking.paymentIntentId;
                    await booking.save();
                }
            } catch (stripeErr) {
                console.error('Error verifying Stripe session on fetch:', stripeErr);
            }
        }

        res.status(200).json({
            success: true,
            data: booking
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get user's enrolled courses for dashboard
// @route   GET /api/courses/user/enrolled
// @access  Private
exports.getUserEnrolledCourses = async (req, res, next) => {
    try {
        const bookings = await Booking.find({ user: req.user._id })
            .populate('course', 'title category thumbnail')
            .sort({ createdAt: -1 });

        // Auto-verify any PENDING bookings with Stripe (Fallback for webhook delays/failures)
        let needsSave = false;
        for (let b of bookings) {
            if (b.status === 'PENDING' && b.stripeSessionId) {
                try {
                    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
                    const session = await stripe.checkout.sessions.retrieve(b.stripeSessionId);

                    if (session.payment_status === 'paid') {
                        b.status = 'PAID';
                        b.paymentStatus = 'Paid';
                        b.paymentIntentId = session.payment_intent || b.paymentIntentId;
                        await b.save();
                        needsSave = true;
                    }
                } catch (stripeErr) {
                    console.error('Error verifying Stripe session in dashboard:', stripeErr);
                }
            }
        }

        const mappedBookings = bookings.map(b => {
            const dynamicStatus = calculateLifecycleStatus(b);
            return {
                id: b._id,
                title: b.course?.title || 'Unknown Course',
                category: b.course?.category,
                thumbnail: b.course?.thumbnail,
                startDate: b.session?.startDate,
                endDate: b.session?.endDate,
                date: b.session?.startDate ? new Date(b.session.startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'TBD',
                endDateFormatted: b.session?.endDate ? new Date(b.session.endDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'TBD',
                time: b.session?.time || 'TBD',
                location: b.session?.locationName || 'TBD',
                bookingStatus: b.status,
                lifecycleStatus: dynamicStatus,
                progress: b.progress || 0,
                attendance: b.attendance || [],
                certificates: b.certificates || [],
                score: b.additionalInfo?.score || 0,
                paymentStatus: b.paymentStatus,
                refundRequest: b.refundRequest,
                createdAt: b.createdAt
            };
        });

        const upcoming = mappedBookings.filter(b => b.lifecycleStatus === 'Upcoming' && b.bookingStatus === 'PAID');
        const ongoing = mappedBookings.filter(b => ['Ongoing', 'Extended'].includes(b.lifecycleStatus) && b.bookingStatus === 'PAID');
        const completed = mappedBookings.filter(b => b.lifecycleStatus === 'Completed' && b.bookingStatus === 'PAID');
        const postponed = mappedBookings.filter(b => b.lifecycleStatus === 'Postponed' && b.bookingStatus === 'PAID');
        const cancelled = mappedBookings.filter(b => b.lifecycleStatus === 'Cancelled' || b.bookingStatus === 'CANCELLED');

        // Find pending bookings (where payment is not complete)
        // Original booking object createdAt is not in mappedBookings yet, we need to map it or we can just fetch it directly.
        // Wait, mappedBookings doesn't have createdAt. Let me map it first or just map it from bookings.
        const pendingBookings = bookings.filter(b => b.status === 'PENDING').map(b => ({
            id: b._id,
            title: b.course?.title || 'Unknown Course',
            courseId: b.course?._id,
            createdAt: b.createdAt
        }));

        const stats = {
            upcomingCount: upcoming.length,
            ongoingCount: ongoing.length,
            completedCount: completed.length,
            certificateCount: mappedBookings.reduce((acc, b) => acc + (b.certificates?.length || 0), 0),
            avgScore: completed.length > 0 ? Math.round(completed.reduce((acc, curr) => acc + curr.score, 0) / completed.length) : 0
        };

        res.status(200).json({
            success: true,
            pendingBookings,
            upcoming,
            ongoing,

            completed,
            postponed,
            cancelled,
            stats
        });
    } catch (error) {
        console.error('getUserEnrolledCourses Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Update course lifecycle (Admin actions)
// @route   PUT /api/bookings/:id/lifecycle
// @access  Private/Admin
exports.updateLifecycle = async (req, res, next) => {
    try {
        const { action, newStartDate, newEndDate, reason, forceBypass48h } = req.body;
        const booking = await Booking.findById(req.params.id).populate('course', 'title');

        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        switch (action) {
            case 'extend':
                if (!newEndDate) return res.status(400).json({ success: false, message: 'New end date required' });
                booking.extensionHistory.push({
                    previousEndDate: booking.session.endDate,
                    newEndDate,
                    reason
                });
                if (!booking.originalEndDate) booking.originalEndDate = booking.session.endDate;
                booking.session.endDate = newEndDate;
                booking.lifecycleStatus = 'Extended';
                break;

            case 'reschedule':
                if (!newStartDate || !newEndDate) return res.status(400).json({ success: false, message: 'New start and end dates required' });

                // Check 6-month limit
                const originalStartDate = new Date(booking.session.startDate);
                const maxAllowedDate = new Date(originalStartDate);
                maxAllowedDate.setMonth(maxAllowedDate.getMonth() + 6);
                if (new Date(newStartDate) > maxAllowedDate) {
                    return res.status(400).json({ success: false, message: 'Rescheduling is only permitted within six months of the original course date.' });
                }

                const hoursUntilCourse = (new Date(booking.session.startDate) - new Date()) / (1000 * 60 * 60);
                if (hoursUntilCourse < 48 && !forceBypass48h) {
                    return res.status(400).json({ success: false, message: 'Rescheduling requires at least 48 hours notice. Use force bypass to override.' });
                }

                // Check maximum two reschedules
                if (booking.rescheduleHistory.length >= 2) {
                    return res.status(400).json({ success: false, message: 'Maximum of two rescheduling requests permitted per booking.' });
                }

                if (forceBypass48h) {
                    booking.rescheduleHistory.push({
                        previousStartDate: booking.session.startDate,
                        newStartDate,
                        previousEndDate: booking.session.endDate,
                        newEndDate,
                        reason
                    });
                    booking.session.startDate = newStartDate;
                    booking.session.endDate = newEndDate;
                    booking.lifecycleStatus = 'Upcoming';
                } else {
                    let paymentLink = null;
                    try {
                        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
                        const stripeSession = await stripe.checkout.sessions.create({
                            payment_method_types: ['card'],
                            metadata: {
                                bookingId: booking._id.toString(),
                                action: 'reschedulePayment'
                            },
                            line_items: [{
                                price_data: {
                                    currency: 'gbp',
                                    product_data: { name: `Rescheduling Fee for ${booking.course?.title || 'Course'}` },
                                    unit_amount: 7000,
                                },
                                quantity: 1,
                            }],
                            mode: 'payment',
                            success_url: `${process.env.FRONTEND_URL || 'https://courses4me.co.uk'}/payment-success?bookingRef=${booking.bookingReference}`,
                            cancel_url: `${process.env.FRONTEND_URL || 'https://courses4me.co.uk'}/payment-cancelled`,
                        });
                        paymentLink = stripeSession.url;
                    } catch (stripeErr) {
                        console.error('Error generating Stripe payment link for reschedule fee:', stripeErr);
                    }

                    booking.pendingReschedule = {
                        newStartDate,
                        newEndDate,
                        reason,
                        status: 'Awaiting Payment'
                    };

                    req.generatedPaymentLink = paymentLink;
                    // Do NOT update session.startDate here
                }
                break;

            case 'postpone':
                booking.lifecycleStatus = 'Postponed';
                break;

            case 'cancel':
                booking.lifecycleStatus = 'Cancelled';
                booking.status = 'CANCELLED';
                break;

            case 'complete':
                booking.lifecycleStatus = 'Completed';
                break;

            case 'resume':
                booking.lifecycleStatus = 'Upcoming'; // Will be recalculated automatically
                break;

            default:
                return res.status(400).json({ success: false, message: 'Invalid lifecycle action' });
        }

        const userForLog = await User.findById(booking.user);
        if (userForLog) {
            userForLog.activityHistory.push({
                action: 'Booking Lifecycle Update',
                details: `Action: ${action.charAt(0).toUpperCase() + action.slice(1)}. Reason: ${reason || 'N/A'} (Ref: ${booking.bookingReference})`
            });
            await userForLog.save({ validateBeforeSave: false });
        }

        await booking.save();

        try {
            const userEmail = userForLog?.email || booking.customerDetails?.email;
            const userName = userForLog?.name || booking.customerDetails?.firstName || 'Student';

            // 'cancel' and 'complete' actions map to dedicated email templates that can be toggled off;
            // other lifecycle actions (extend/reschedule/postpone/resume) aren't gated by a template.
            const lifecycleTemplateKey = action === 'cancel' ? 'bookingCancellation' : action === 'complete' ? 'courseCompletion' : null;
            const lifecycleTemplateActive = lifecycleTemplateKey ? await isEmailTemplateActive(lifecycleTemplateKey) : true;

            if (userEmail && userForLog?.status !== 'inactive' && lifecycleTemplateActive) {
                const actionText = action.charAt(0).toUpperCase() + action.slice(1);
                let detailsHtml = '';

                if (action === 'extend') {
                    detailsHtml = `
                        <tr>
                            <td style="padding: 12px 0; color: #6b7280; font-weight: 600; border-bottom: 1px solid #f3f4f6;">New End Date:</td>
                            <td style="padding: 12px 0; color: #111827; text-align: right; border-bottom: 1px solid #f3f4f6; font-weight: 500;">${new Date(newEndDate).toLocaleDateString('en-GB', { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' })}</td>
                        </tr>
                    `;
                } else if (action === 'reschedule') {
                    detailsHtml = `
                        <tr>
                            <td style="padding: 12px 0; color: #6b7280; font-weight: 600; border-bottom: 1px solid #f3f4f6;">New Start Date:</td>
                            <td style="padding: 12px 0; color: #111827; text-align: right; border-bottom: 1px solid #f3f4f6; font-weight: 500;">${new Date(newStartDate).toLocaleDateString('en-GB', { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' })}</td>
                        </tr>
                        <tr>
                            <td style="padding: 12px 0; color: #6b7280; font-weight: 600; border-bottom: 1px solid #f3f4f6;">New End Date:</td>
                            <td style="padding: 12px 0; color: #111827; text-align: right; border-bottom: 1px solid #f3f4f6; font-weight: 500;">${new Date(newEndDate).toLocaleDateString('en-GB', { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' })}</td>
                        </tr>
                    `;

                    if (req.generatedPaymentLink) {
                        detailsHtml += `
                        <tr>
                            <td colspan="2" style="padding: 20px 0 10px; text-align: center;">
                                <p style="color: #ef4444; font-weight: bold; margin-bottom: 10px;">Please pay the £70 rescheduling fee to confirm your new dates.</p>
                                <a href="${req.generatedPaymentLink}" style="display: inline-block; background-color: #F15A24; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: 600;">Pay Rescheduling Fee (£70)</a>
                            </td>
                        </tr>
                        `;
                    }
                }

                if (reason) {
                    detailsHtml += `
                        <tr>
                            <td style="padding: 12px 0; color: #6b7280; font-weight: 600; vertical-align: top;">Notes:</td>
                            <td style="padding: 12px 0; color: #111827; text-align: right; font-weight: 500;">${reason}</td>
                        </tr>
                    `;
                }

                // Determine banner color based on action type
                const getActionColor = (act) => {
                    switch (act.toLowerCase()) {
                        case 'extend': return '##F8510C'; // 
                        case 'reschedule': return '#F15A24'; // Blue
                        case 'postpone': return '#f59e0b'; // Amber
                        case 'cancel': return '#ef4444'; // Red
                        case 'complete': return '#10b981'; // Green
                        default: return '#F15A24'; // Brand Orange
                    }
                };

                const actionColor = getActionColor(action);

                const emailHtml = `
                    <div style="font-family: 'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 0; border: 1px solid #e5e7eb; border-radius: 16px; background-color: #ffffff; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);">
                        
                        <!-- Header Banner -->
                        <div style="background-color: ${actionColor}; padding: 35px 20px; text-align: center;">
                            <h1 style="color: #ffffff; margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.5px;">Course Update</h1>
                            <p style="color: rgba(255, 255, 255, 0.9); margin: 10px 0 0 0; font-size: 15px; font-weight: 500;">Important information regarding your training</p>
                        </div>

                        <!-- Body Content -->
                        <div style="padding: 35px 40px;">
                            <p style="color: #111827; font-size: 16px; margin-top: 0; font-weight: 600;">Hello ${userName},</p>
                            <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin-top: 15px;">
                                There has been an update to your enrollment for <strong style="color: #111827; font-weight: 600;">${booking.course?.title || 'Unknown Course'}</strong>. 
                                Please review the changes below.
                            </p>

                            <!-- Details Card -->
                            <div style="background-color: #f9fafb; border: 1px solid #f3f4f6; border-radius: 12px; padding: 25px; margin: 30px 0;">
                                <h3 style="margin: 0 0 20px 0; color: #111827; font-size: 13px; text-transform: uppercase; letter-spacing: 1.2px; border-bottom: 2px solid ${actionColor}; padding-bottom: 8px; display: inline-block;">Update Details</h3>
                                
                                <table style="width: 100%; border-collapse: collapse; font-size: 15px;">
                                    <tr>
                                        <td style="padding: 12px 0; color: #6b7280; font-weight: 600; border-bottom: 1px solid #f3f4f6; width: 35%;">Action taken:</td>
                                        <td style="padding: 12px 0; text-align: right; border-bottom: 1px solid #f3f4f6;">
                                            <span style="background-color: ${actionColor}15; color: ${actionColor}; padding: 6px 14px; border-radius: 8px; font-weight: 700; font-size: 13px; display: inline-block;">${actionText}</span>
                                        </td>
                                    </tr>
                                    ${detailsHtml}
                                </table>
                            </div>

                            ${action.toLowerCase() === 'complete' ? `
                            <div style="margin-top: 25px; padding-top: 25px; border-top: 1px solid #e5e7eb; text-align: center;">
                                <h4 style="color: #111827; font-size: 18px; font-weight: 700; margin: 0 0 10px 0;">Congratulations on your completion!</h4>
                                <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin-bottom: 20px;">
                                    Your certificate for <strong>${booking.course?.title || 'this course'}</strong> is now ready to be downloaded.
                                </p>
                                <a href="${process.env.FRONTEND_URL || 'https://courses4me.co.uk'}/dashboard" style="display: inline-block; background-color: #10b981; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">Get Your Certificate</a>
                                <p style="color: #6b7280; font-size: 13px; margin-top: 15px;">Log in to your student dashboard to view and download it.</p>
                            </div>
                            ` : `
                            <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin-bottom: 0;">
                                You can view your updated schedule and course details at any time by logging into your student dashboard.
                            </p>
                            `}
                        </div>

                        <!-- Footer -->
                        <div style="background-color: #f9fafb; padding: 30px 40px; text-align: center; border-top: 1px solid #e5e7eb;">
                            <p style="color: #6b7280; font-size: 14px; margin: 0 0 12px 0;">Need assistance? We're here to help.</p>
                            <a href="https://courses4me.co.uk/contact" style="color: #F15A24; text-decoration: none; font-weight: 600; font-size: 14px;">Contact Support Team</a>
                            <p style="color: #9ca3af; font-size: 13px; margin: 25px 0 0 0;">&copy; ${new Date().getFullYear()} Courses4Me. All rights reserved.</p>
                        </div>
                    </div>
                `;

                await sendEmail({
                    email: userEmail,
                    subject: `Course Update: ${booking.course?.title || 'Your Course'} (${actionText})`,
                    message: `Your course has been updated to ${actionText}.`,
                    html: emailHtml
                });
            }
        } catch (emailErr) {
            console.error('Lifecycle Update Email Sending Error:', emailErr);
        }

        res.status(200).json({
            success: true,
            data: booking,
            lifecycleStatus: calculateLifecycleStatus(booking)
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get current user's booking status for a specific course
// @route   GET /api/bookings/my-status/:courseId
// @access  Private
exports.getMyBookingStatus = async (req, res, next) => {
    try {
        const { courseId } = req.params;
        const userId = req.user._id;

        const bookings = await Booking.find({ user: userId, course: courseId }).sort({ createdAt: -1 });

        const bookedSchedules = bookings
            .filter(b => ['PENDING', 'PAID'].includes(b.status))
            .map(b => ({
                scheduleId: b.session?.scheduleId?.toString(),
                status: b.status,
                bookingId: b._id,
                bookingReference: b.bookingReference,
                billingAddress: b.billingAddress
            }))
            .filter(b => b.scheduleId);

        if (!bookings || bookings.length === 0) {
            return res.status(200).json({ success: true, status: 'NONE', bookedSchedules: [] });
        }

        const hasPaid = bookings.find(b => b.status === 'PAID');
        if (hasPaid) {
            return res.status(200).json({ success: true, status: 'PAID', bookingId: hasPaid._id, bookedSchedules });
        }

        const hasPending = bookings.find(b => b.status === 'PENDING');
        if (hasPending) {
            return res.status(200).json({ success: true, status: 'PENDING', bookingId: hasPending._id, createdAt: hasPending.createdAt, bookedSchedules });
        }

        return res.status(200).json({ success: true, status: bookings[0].status, bookedSchedules });
    } catch (error) {
        console.error('getMyBookingStatus Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Request refund for a booking
// @route   POST /api/bookings/:id/refund/request
// @access  Private
exports.requestRefund = async (req, res, next) => {
    try {
        const { reason } = req.body;
        if (!reason) {
            return res.status(400).json({ success: false, message: 'Please provide a reason for the refund request.' });
        }

        const booking = await Booking.findById(req.params.id).populate('course');
        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found.' });
        }

        // Validate ownership
        if (booking.user.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Not authorized to request refund for this booking.' });
        }

        // Verify paid status
        if (booking.status !== 'PAID') {
            return res.status(400).json({ success: false, message: 'Only paid bookings can be refunded.' });
        }

        // Verify course start date is in the future
        const now = new Date();
        const startDate = new Date(booking.session.startDate);
        if (startDate <= now) {
            return res.status(400).json({ success: false, message: 'Refunds are only permitted for upcoming courses.' });
        }


        // Update refundRequest status
        booking.refundRequest = {
            status: 'Requested',
            reason,
            requestedAt: new Date()
        };

        if (req.file) {
            booking.refundRequest.proofUrl = req.file.path;
        }

        await booking.save();

        // Send email to student
        try {
            const emailHtml = `
                <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 12px; background-color: #ffffff;">
                    <h2 style="color: #F8510C; text-align: center;">Refund Request Received</h2>
                    <p>Hello ${booking.customerDetails.firstName},</p>
                    <p>We have received your refund request for the course <strong>${booking.course?.title || 'Course'}</strong> (Booking Ref: <strong>${booking.bookingReference}</strong>).</p>
                    <p>Our administration team will review your request shortly in accordance with our refund policy. We will notify you via email as soon as a decision is made.</p>
                    <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
                    <p style="font-size: 12px; color: #888; text-align: center;">This is an automated confirmation of your request.</p>
                </div>
            `;
            await sendEmail({
                email: booking.customerDetails.email,
                subject: `Refund Request Received - ${booking.bookingReference}`,
                message: `Your refund request for booking ${booking.bookingReference} has been received and is under review.`,
                html: emailHtml
            });
        } catch (emailErr) {
            console.error('Refund Request Confirmation Email Error:', emailErr);
        }

        // Create notification for administrators
        try {
            const admins = await User.find({ role: { $in: ['admin', 'editor'] } });
            const notifications = admins.map(admin => ({
                user: admin._id,
                title: 'Refund Request',
                message: `Refund requested for ${booking.course?.title || 'Course'} by ${booking.customerDetails.firstName} ${booking.customerDetails.lastName} (Ref: ${booking.bookingReference}).`,
                type: 'payment'
            }));
            await Notification.insertMany(notifications);
        } catch (notifErr) {
            console.error('Notification Error (Refund Request):', notifErr);
        }

        res.status(200).json({ success: true, message: 'Refund request submitted successfully.', data: booking });
    } catch (error) {
        console.error('requestRefund error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Process refund (Approve/Reject)
// @route   POST /api/bookings/:id/refund/process
// @access  Private/Admin
exports.processRefund = async (req, res, next) => {
    try {
        const { action, adminNotes, refundType, deductionAmount } = req.body;
        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({ success: false, message: 'Invalid action. Must be approve or reject.' });
        }

        const booking = await Booking.findById(req.params.id).populate('course');
        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found.' });
        }

        if (!booking.refundRequest || booking.refundRequest.status !== 'Requested') {
            return res.status(400).json({ success: false, message: 'No active refund request found for this booking.' });
        }

        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

        if (action === 'approve') {
            let paymentIntentId = booking.paymentIntentId;

            // Resilience fallback: retrieve payment intent from Checkout Session if missing
            if (!paymentIntentId && booking.stripeSessionId) {
                try {
                    const session = await stripe.checkout.sessions.retrieve(booking.stripeSessionId);
                    paymentIntentId = session.payment_intent;
                    if (paymentIntentId) {
                        booking.paymentIntentId = paymentIntentId;
                        await booking.save();
                    }
                } catch (stripeSessionErr) {
                    console.error('Stripe Session Retrieve Error during Refund:', stripeSessionErr);
                }
            }

            if (!paymentIntentId) {
                return res.status(400).json({
                    success: false,
                    message: 'Stripe Payment Intent ID or Session ID is missing. Automatic refund cannot be executed.'
                });
            }

            // Execute Stripe refund
            let stripeRefund;
            try {
                const refundPayload = { payment_intent: paymentIntentId };

                if (refundType === 'partial' && deductionAmount) {
                    const amountToRefund = Math.max(0, booking.totalAmount - deductionAmount);
                    if (amountToRefund === 0) {
                        return res.status(400).json({ success: false, message: 'Deduction amount equals or exceeds total amount. Cannot process zero refund.' });
                    }
                    refundPayload.amount = Math.round(amountToRefund * 100); // Stripe expects amount in cents/pence
                }

                stripeRefund = await stripe.refunds.create(refundPayload);
            } catch (stripeRefundErr) {
                console.error('Stripe Refund execution error:', stripeRefundErr);
                return res.status(400).json({
                    success: false,
                    message: `Stripe Refund Execution Failed: ${stripeRefundErr.message}`
                });
            }

            // Update database booking state
            booking.paymentStatus = 'Refunded';
            booking.lifecycleStatus = 'Cancelled';
            booking.status = 'CANCELLED';
            booking.refundRequest.status = 'Approved';
            booking.refundRequest.processedAt = new Date();
            booking.refundRequest.adminNotes = adminNotes || '';
            booking.refundRequest.refundId = stripeRefund.id;

            await booking.save();

            const refundText = refundType === 'partial' ? 'Partial Refund Request Approved' : 'Refund Request Approved';

            // Send confirmation email to student
            try {
                const emailHtml = `
                    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 12px; background-color: #ffffff;">
                        <h2 style="color: #2e7d32; text-align: center;">${refundText}</h2>
                        <p>Hello ${booking.customerDetails.firstName},</p>
                        <p>We are writing to confirm that your refund request for <strong>${booking.course?.title || 'Course'}</strong> (Booking Ref: <strong>${booking.bookingReference}</strong>) has been approved.</p>
                        <p>A ${refundType === 'partial' ? 'partial' : 'full'} refund of <strong>£${refundType === 'partial' ? Math.max(0, booking.totalAmount - deductionAmount) : booking.totalAmount}</strong> has been issued to your original payment method. Please allow 5-10 business days for the funds to appear in your account.</p>
                        ${adminNotes ? `<div style="background-color: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0;"><h4 style="margin-top: 0;">Admin Notes:</h4><p style="margin-bottom: 0; color: #555;">${adminNotes}</p></div>` : ''}
                        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
                        <p style="font-size: 12px; color: #888; text-align: center;">Thank you for your patience. If you have any further questions, please contact support.</p>
                    </div>
                `;
                await sendEmail({
                    email: booking.customerDetails.email,
                    subject: `Refund Request Approved - ${booking.bookingReference}`,
                    message: `Your refund request for booking ${booking.bookingReference} has been approved and a refund of £${booking.totalAmount} has been processed.`,
                    html: emailHtml
                });
            } catch (emailErr) {
                console.error('Refund Approval Email Error:', emailErr);
            }

            res.status(200).json({ success: true, message: 'Refund approved and executed successfully.', data: booking });
        } else {
            // Rejection flow
            booking.refundRequest.status = 'Rejected';
            booking.refundRequest.processedAt = new Date();
            booking.refundRequest.adminNotes = adminNotes || '';

            await booking.save();

            // Send rejection email to student
            try {
                const emailHtml = `
                    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 12px; background-color: #ffffff;">
                        <h2 style="color: #c62828; text-align: center;">Refund Request Rejected</h2>
                        <p>Hello ${booking.customerDetails.firstName},</p>
                        <p>We have reviewed your refund request for the course <strong>${booking.course?.title || 'Course'}</strong> (Booking Ref: <strong>${booking.bookingReference}</strong>).</p>
                        <p>Regrettably, your request has been declined. Below are the details regarding this decision:</p>
                        <div style="background-color: #fdf2f2; border-left: 4px solid #c62828; padding: 15px; border-radius: 4px; margin: 20px 0;">
                            <p style="margin: 0; color: #c62828; font-weight: bold;">Reason / Notes:</p>
                            <p style="margin: 5px 0 0 0; color: #555;">${adminNotes || 'Does not meet eligibility criteria.'}</p>
                        </div>
                        <p>If you would like to discuss this further, please contact our support team at 08006894621.</p>
                        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
                        <p style="font-size: 12px; color: #888; text-align: center;">Courses4Me Support Team</p>
                    </div>
                `;
                await sendEmail({
                    email: booking.customerDetails.email,
                    subject: `Refund Request Update - ${booking.bookingReference}`,
                    message: `Your refund request for booking ${booking.bookingReference} has been reviewed. Notes: ${adminNotes || 'Does not meet eligibility criteria.'}`,
                    html: emailHtml
                });
            } catch (emailErr) {
                console.error('Refund Rejection Email Error:', emailErr);
            }

            res.status(200).json({ success: true, message: 'Refund request rejected successfully.', data: booking });
        }
    } catch (error) {
        console.error('processRefund error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};
