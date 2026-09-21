const mongoose = require('mongoose');

const jobApplicationSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    jobId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'JobListing',
        required: [true, 'Job listing reference is required']
    },
    jobTitle: {
        type: String,
        required: [true, 'Job title is required']
    },
    firstName: {
        type: String,
        required: [true, 'First name is required'],
        trim: true
    },
    lastName: {
        type: String,
        required: [true, 'Last name is required'],
        trim: true
    },
    applicantName: {
        type: String
    },
    email: {
        type: String,
        required: [true, 'Email address is required'],
        trim: true,
        lowercase: true
    },
    phone: {
        type: String,
        required: [true, 'Phone number is required'],
        trim: true
    },
    address: {
        type: String,
        required: [true, 'Address is required'],
        trim: true
    },
    city: {
        type: String,
        required: [true, 'City is required'],
        trim: true
    },
    postcode: {
        type: String,
        required: [true, 'Postcode is required'],
        trim: true
    },
    license: {
        type: String,
        required: [true, 'License is required'],
        trim: true
    },
    experience: {
        type: String,
        required: [true, 'Experience is required'],
        trim: true
    },
    availability: {
        type: String,
        required: [true, 'Availability is required'],
        trim: true
    },
    cover: {
        type: String,
        required: [true, 'Cover letter is required']
    },
    cvFile: {
        type: String,
        default: 'cv_resume.pdf'
    },
    status: {
        type: String,
        enum: ['Pending', 'Shortlisted', 'Interview', 'Rejected', 'Accepted'],
        default: 'Pending'
    },
    applicationReference: {
        type: String,
        unique: true,
        sparse: true
    }
}, {
    timestamps: true
});

// Virtual/pre-save hook to populate applicantName and reference
jobApplicationSchema.pre('save', function () {
    this.applicantName = `${this.firstName} ${this.lastName}`;
    if (!this.applicationReference) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let ref = 'REF-';
        for (let i = 0; i < 7; i++) {
            ref += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        this.applicationReference = ref;
    }
});

module.exports = mongoose.model('JobApplication', jobApplicationSchema);
