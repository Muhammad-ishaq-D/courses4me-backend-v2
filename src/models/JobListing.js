const mongoose = require('mongoose');

const jobListingSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, 'Job title is required'],
        trim: true
    },
    company: {
        type: String,
        required: [true, 'Company name is required'],
        trim: true
    },
    location: {
        type: String,
        required: [true, 'Location is required'],
        trim: true
    },
    type: {
        type: String,
        enum: ['Full-time', 'Part-time', 'Contract', 'Internship', 'Remote'],
        default: 'Full-time'
    },
    category: {
        type: String,
        required: [true, 'Job category is required'],
        enum: [
            'SIA Training', 'First Aid', 'Health & Safety', 'Specialist',
            'Security Officer', 'Door Supervisor', 'Event Security', 'CCTV Operator', 'Close Protection',
            'First Aider', 'Paediatric First Aider',
            'Safety Inspector', 'Risk Assessor',
            'Security Manager'
        ],
        default: 'SIA Training'
    },
    // The specific career this job maps to (e.g. "Door Supervisor"). Kept as a free
    // string (not enum) so it can hold any career that exists on the portal without
    // schema churn. The admin form supplies the canonical list of careers per category.
    career: {
        type: String,
        trim: true,
        default: ''
    },
    salary: {
        type: String,
        required: [true, 'Salary range is required'],
        trim: true
    },
    description: {
        type: String,
        required: [true, 'Job description is required']
    },
    requirements: {
        type: [String],
        default: []
    },
    status: {
        type: String,
        enum: ['Active', 'Paused', 'Closed'],
        default: 'Active'
    },
    isFeatured: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('JobListing', jobListingSchema);
