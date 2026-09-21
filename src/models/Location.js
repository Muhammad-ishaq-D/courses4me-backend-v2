const mongoose = require('mongoose');

const FACILITIES = ['wifi', 'projector', 'whiteboard', 'catering', 'toilets', 'disabled_access', 'prayer_room', 'air_conditioning'];

const locationSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Location name is required'],
        trim: true
    },
    venueName: {
        type: String,
        trim: true
    },
    addressLine1: {
        type: String,
        required: [true, 'Address is required'],
        trim: true
    },
    addressLine2: {
        type: String,
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
        trim: true,
        uppercase: true
    },
    country: {
        type: String,
        default: 'United Kingdom',
        trim: true
    },
    mapsUrl: {
        type: String,
        trim: true
    },
    parking: {
        type: Boolean,
        default: false
    },
    parkingNotes: {
        type: String,
        trim: true
    },
    accessibility: {
        type: String,
        trim: true
    },
    transport: {
        type: String,
        trim: true
    },
    facilities: [{
        type: String,
        enum: FACILITIES
    }],
    mainImage: { type: String },
    gallery: [String],
    localMarketOverview: { type: String, trim: true },
    localVenues: { type: String, trim: true },
    surroundingAreas: { type: String, trim: true },
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

locationSchema.index({ name: 'text', city: 'text', postcode: 1 });

module.exports = mongoose.model('Location', locationSchema);
