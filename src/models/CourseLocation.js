const mongoose = require('mongoose');

const courseLocationSchema = new mongoose.Schema({
    courseId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Course',
        required: [true, 'Course ID is required']
    },
    locationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Location',
        required: [true, 'Location ID is required']
    },
    price: {
        type: Number,
        required: [true, 'Price is required'],
        min: [0, 'Price cannot be negative']
    },
    vatIncluded: { type: Boolean, default: false },
    depositRequired: { type: Boolean, default: false },
    depositAmount: { type: Number, default: 0 },
    whatsIncluded: { type: String, trim: true },
    status: {
        type: String,
        enum: ['Active', 'Inactive'],
        default: 'Active'
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Unique pair — one location can only be linked once per course
courseLocationSchema.index({ courseId: 1, locationId: 1 }, { unique: true });

module.exports = mongoose.model('CourseLocation', courseLocationSchema);
