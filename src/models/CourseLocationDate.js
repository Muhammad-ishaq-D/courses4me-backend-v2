const mongoose = require('mongoose');

const courseLocationDateSchema = new mongoose.Schema({
    courseLocationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CourseLocation',
        required: [true, 'Course location ID is required']
    },
    startDate: {
        type: Date,
        required: [true, 'Start date is required']
    },
    endDate: {
        type: Date,
        required: [true, 'End date is required']
    },
    startTime: {
        type: String,
        required: [true, 'Start time is required'],
        default: '09:00'
    },
    endTime: {
        type: String,
        required: [true, 'End time is required'],
        default: '17:00'
    },
    availableSeats: {
        type: Number,
        required: [true, 'Available seats is required'],
        min: [0, 'Cannot have negative seats']
    },
    bookedSeats: {
        type: Number,
        default: 0,
        min: 0
    },
    timingsType: {
        type: String,
        enum: ['same', 'flexible'],
        default: 'same'
    },
    weeklyTimings: {
        monday: { isOff: Boolean, startTime: String, endTime: String },
        tuesday: { isOff: Boolean, startTime: String, endTime: String },
        wednesday: { isOff: Boolean, startTime: String, endTime: String },
        thursday: { isOff: Boolean, startTime: String, endTime: String },
        friday: { isOff: Boolean, startTime: String, endTime: String },
        saturday: { isOff: Boolean, startTime: String, endTime: String },
        sunday: { isOff: Boolean, startTime: String, endTime: String }
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

courseLocationDateSchema.virtual('seatsRemaining').get(function () {
    return Math.max(0, this.availableSeats - this.bookedSeats);
});

courseLocationDateSchema.virtual('availabilityStatus').get(function () {
    const remaining = this.availableSeats - this.bookedSeats;
    if (remaining <= 0) return 'Sold Out';
    if (remaining <= 5) return 'Selling Fast';
    return 'Available';
});

module.exports = mongoose.model('CourseLocationDate', courseLocationDateSchema);
