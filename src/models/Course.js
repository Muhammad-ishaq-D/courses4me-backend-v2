const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema({
    time: {
        type: String,
        required: [true, 'Schedule timing is required']
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
    address: {
        type: String,
        trim: true
    },
    postcode: {
        type: String,
        trim: true,
        required: [true, 'Location postcode is required']
    },
    latitude: {
        type: Number
    },
    longitude: {
        type: Number
    },
    parkingMain: {
        type: String,
        trim: true
    },
    parkingSub: {
        type: String,
        trim: true
    },
    commuteMain: {
        type: String,
        trim: true
    },
    commuteSub: {
        type: String,
        trim: true
    },
    schedules: [scheduleSchema]
});

const courseSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, 'Course title is required'],
        trim: true
    },
    category: {
        type: String,
        required: [true, 'Course category is required'],
        enum: ['SIA Training', 'Specialist', 'First Aid', 'Health & Safety', 'Hospitality']
    },
    subtitle: {
        type: String,
        trim: true
    },
    level: {
        type: String,
        default: 'Level 2'
    },
    duration: {
        type: String,
        required: [true, 'Course duration is required']
    },
    reviewsCount: {
        type: String,
        default: '1,000+'
    },
    bookedCount: {
        type: String,
        default: '500+'
    },
    passRate: {
        type: String,
        default: '98%'
    },
    shortDescription: {
        type: String,
        required: [true, 'Short description is required']
    },
    fullDescription: {
        type: String,
        required: [true, 'Full description is required']
    },
    highlights: [String],
    learningPoints: [String],
    targetAudience: [String],
    requirements: [String],
    guarantee: {
        title: { type: String, default: 'Training Guarantee' },
        description: { type: String, default: "Free exam retakes if you don't pass first time" }
    },
    thumbnail: {
        type: String // URL or file path
    },
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
    locations: [locationSchema],
    locationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Location'
    },
    centerId: {
        type: String  // MongoDB subdocument _id stored as string
    },
    centerName: {
        type: String  // Denormalised for quick display without joins
    },
    instructor: {
        name: {
            type: String
        },
        title: {
            type: String
        },
        bio: {
            type: String
        },
        photo: {
            type: String
        }
    },

    status: {
        type: String,
        enum: ['Published', 'Draft', 'Archived'],
        default: 'Draft'
    },
    isPopular: {
        type: Boolean,
        default: false
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Virtual for backward compatibility with components expecting flat 'sessions'
courseSchema.virtual('sessions').get(function() {
    const flatSessions = [];
    if (this.locations) {
        this.locations.forEach(loc => {
            if (loc.schedules) {
                loc.schedules.forEach(sch => {
                    flatSessions.push({
                        _id: sch._id,
                        location: loc.name,
                        time: sch.time,
                        startDate: sch.startDate,
                        endDate: sch.endDate,
                        price: sch.price,
                        availabilityStatus: sch.availabilityStatus,
                        seatsAvailable: sch.seatsAvailable
                    });
                });
            }
        });
    }
    return flatSessions;
});

module.exports = mongoose.model('Course', courseSchema);
