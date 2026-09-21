const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    course: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: 'courseModel',
        required: true
    },
    courseModel: {
        type: String,
        required: true,
        enum: ['Course', 'License'],
        default: 'Course'
    },
    bookingReference: {
        type: String,
        unique: true
    },
    packageName: {
        type: String,
        required: true,
        default: 'Standard'
    },
    session: {
        locationName: String, // Region
        branchName: String,   // Sub-location
        scheduleId: String,   // Selected Timing ID
        startDate: Date,
        endDate: Date,
        time: String,
        price: Number
    },
    customerDetails: {
        firstName: { type: String, required: true },
        lastName: { type: String, required: true },
        email: { type: String, required: true },
        phone: { type: String, required: true },
        dob: { type: String }
    },
    billingAddress: {
        postcode: String,
        line1: String,
        line2: String,
        city: String
    },
    options: {
        easyApply: { type: Boolean, default: false }
    },
    additionalInfo: {
        type: String
    },
    totalAmount: {
        type: Number,
        required: true
    },
    currency: {
        type: String,
        default: 'GBP'
    },
    paymentMethod: {
        type: String,
        enum: ['card', 'paypal', 'instalments', 'klarna'],
        default: 'card'
    },
    paymentStatus: {
        type: String,
        enum: ['Pending', 'Paid', 'Failed', 'Refunded'],
        default: 'Pending'
    },
    stripeSessionId: {
        type: String
    },
    paymentIntentId: {
        type: String
    },
    status: {
        type: String,
        enum: ['PENDING', 'PAID', 'EXPIRED', 'CANCELLED'],
        default: 'PENDING'
    },
    lifecycleStatus: {
        type: String,
        enum: ['Upcoming', 'Ongoing', 'Completed', 'Postponed', 'Cancelled', 'Extended'],
        default: 'Upcoming'
    },
    originalEndDate: {
        type: Date
    },
    extensionHistory: [{
        previousEndDate: Date,
        newEndDate: Date,
        reason: String,
        updatedAt: { type: Date, default: Date.now }
    }],
    pendingReschedule: {
        // Declared as a sub-schema with `default: undefined` so the field stays absent
        // until a reschedule is actually requested. As a plain nested path, Mongoose
        // re-applied the `status`/`createdAt` defaults on every load and every booking
        // looked like it had a reschedule awaiting payment.
        type: new mongoose.Schema({
            newStartDate: Date,
            newEndDate: Date,
            reason: String,
            status: { type: String, enum: ['Awaiting Payment', 'Paid'], default: 'Awaiting Payment' },
            createdAt: { type: Date, default: Date.now }
        }, { _id: false }),
        default: undefined
    },
    rescheduleHistory: [{
        previousStartDate: Date,
        newStartDate: Date,
        previousEndDate: Date,
        newEndDate: Date,
        reason: String,
        updatedAt: { type: Date, default: Date.now }
    }],
    attendance: [{
        date: Date,
        status: { type: String, enum: ['Present', 'Absent', 'Late'], default: 'Present' }
    }],
    progress: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },
    certificates: [{
        name: String,
        url: String,
        issuedAt: { type: Date, default: Date.now }
    }],
    refundRequest: {
        status: {
            type: String,
            enum: ['None', 'Requested', 'Approved', 'Rejected'],
            default: 'None'
        },
        reason: String,
        requestedAt: Date,
        processedAt: Date,
        adminNotes: String,
        refundId: String,
        proofUrl: String
    },
    bookingDate: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Generate a random booking reference before saving
bookingSchema.pre('save', async function() {
    if (!this.bookingReference) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let ref = 'GL-';
        for (let i = 0; i < 6; i++) {
            ref += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        this.bookingReference = ref;
    }
});

module.exports = mongoose.model('Booking', bookingSchema);
