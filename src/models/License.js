const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema({
    time: {
        type: String,
        default: '09:00 - 17:00'
    },
    startDate: {
        type: Date,
        required: [true, 'Schedule start date is required']
    },
    endDate: {
        type: Date,
        required: [true, 'Schedule end date is required']
    },
    price: {
        type: Number,
        required: [true, 'Schedule price is required']
    },
    seatsAvailable: {
        type: Number,
        default: 20
    },
    availabilityStatus: {
        type: String,
        enum: ['Available', 'Selling Fast', 'Sold Out'],
        default: 'Available'
    }
});

const locationSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Location name is required']
    },
    schedules: [scheduleSchema]
});

const licenseSchema = new mongoose.Schema({
    // Product Description / Store Listing Fields
    title: {
        type: String,
        required: [true, 'License title is required'],
        trim: true
    },
    licenseType: {
        type: String,
        required: [true, 'License type is required'],
        default: 'Security Guard'
    },
    category: {
        type: String,
        required: [true, 'License category is required'],
        enum: ['SIA Training', 'First Aid', 'Health & Safety', 'Specialist'],
        default: 'SIA Training'
    },
    subtitle: {
        type: String,
        trim: true
    },
    shortDescription: {
        type: String,
        required: [true, 'Short description is required']
    },
    fullDescription: {
        type: String,
        required: [true, 'Full description is required']
    },
    thumbnail: {
        type: String // Base64 or Image URL
    },
    
    // Listing Specs / Portal side details
    salary: {
        type: String
    },
    duration: {
        type: String
    },
    valid: {
        type: String
    },
    experience: {
        type: String,
        default: '5 Years'
    },
    trainingCount: {
        type: String,
        default: '12 Courses'
    },
    rating: {
        type: String,
        default: '4.9/5'
    },
    
    // Rich details lists
    highlights: [String],
    learningPoints: [String],
    requirements: [String],
    applicationSteps: [
        {
            title: String,
            desc: String
        }
    ],
    pricingBreakdown: [
        {
            label: String,
            price: String
        }
    ],
    renewalInfo: {
        type: String
    },
    
    // Pricing
    pricing: {
        basePrice: {
            type: Number,
            required: [true, 'Base price is required']
        },
        salePrice: {
            type: Number
        },
        originalPrice: {
            type: Number
        }
    },
    
    // Locations and Instructor
    locations: [locationSchema],
    instructor: {
        name: { type: String },
        title: { type: String },
        bio: { type: String },
        photo: { type: String }
    },
    

    
    // Connected Courses
    relatedCourses: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Course'
    }],
    
    // Status and Popular badge
    status: {
        type: String,
        enum: ['Published', 'Draft', 'Archived'],
        default: 'Draft'
    },
    isPopular: {
        type: Boolean,
        default: false
    },
    
    // Portal styling support
    icon: {
        type: String,
        default: 'shield'
    },
    iconColor: {
        type: String,
        default: 'bg-blue-600'
    },

    // Individual Credential / Admin Tracking Fields
    licenseNumber: {
        type: String,
        default: () => 'SIA-' + Math.floor(10000000 + Math.random() * 90000000)
    },
    holderName: {
        type: String,
        default: 'John Smith'
    },
    email: {
        type: String,
        default: 'holder.email@gmail.com'
    },
    licenseAuthority: {
        type: String,
        default: 'SIA (Security Industry Authority)'
    },
    holderId: {
        type: String,
        default: () => 'LH-' + Math.floor(100 + Math.random() * 900)
    },
    expiryDate: {
        type: Date,
        default: () => new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000) // 3 years from creation
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

module.exports = mongoose.model('License', licenseSchema);
