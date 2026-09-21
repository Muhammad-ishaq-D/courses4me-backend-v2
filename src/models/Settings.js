const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
    general: {
        type: mongoose.Schema.Types.Mixed,
        default: () => ({
            siteName: "courses4me",
            siteUrl: "https://www.courses4me.co.uk",
            supportEmail: "support@courses4me.co.uk",
            phoneNumber: "+44 20 7123 4567",
            companyRegistration: "12345678",
            vatNumber: "GB 123 456 789"
        })
    },
    notifications: {
        type: mongoose.Schema.Types.Mixed,
        default: () => ({
            bookingAlerts: true,
            paymentReceived: true,
            paymentAlerts: true,
            seatAvailability: true,
            userRegistration: false,
            courseReview: true,
            weeklyReport: true,
            loginAlert: true
        })
    },
    emailTemplates: {
        type: [mongoose.Schema.Types.Mixed],
        default: () => ([
            { key: "bookingConfirmation", title: "Booking Confirmation", description: "Sent immediately after a successful booking", isActive: true },
            { key: "bookingReminder", title: "Booking Reminder", description: "Sent 48 hours before course start date", isActive: true },
            { key: "paymentReceipt", title: "Payment Receipt", description: "Sent after successful payment", isActive: true },
            { key: "bookingCancellation", title: "Booking Cancellation", description: "Sent when a booking is cancelled", isActive: true },
            { key: "courseCompletion", title: "Course Completion", description: "Sent after course is marked complete", isActive: false },
            { key: "passwordReset", title: "Password Reset", description: "Triggered by customer password reset request", isActive: true }
        ])
    }
}, { timestamps: true });

module.exports = mongoose.model('Settings', settingsSchema);
