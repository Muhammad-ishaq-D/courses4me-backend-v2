const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Please add a name']
    },
    email: {
        type: String,
        required: [true, 'Please add an email'],
        unique: true,
        match: [
            /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
            'Please add a valid email'
        ]
    },
    password: {
        type: String,
        minlength: 8,
        maxlength: 128,
        select: false,
        validate: {
            validator: function(v) {
                // If social auth isn't used, ensure password is provided and isn't just whitespace
                if (!this.googleId && !this.facebookId) {
                    return typeof v === 'string' && v.trim().length >= 8;
                }
                return true;
            },
            message: 'Password must be a valid string, not empty, and at least 8 characters long.'
        },
        required: function() {
            return !this.googleId && !this.facebookId;
        }
    },
    googleId: {
        type: String,
        unique: true,
        sparse: true
    },
    facebookId: {
        type: String,
        unique: true,
        sparse: true
    },
    phone: {
        type: String
    },
    dob: {
        type: String
    },
    billingAddress: {
        postcode: String,
        line1: String,
        line2: String,
        city: String
    },
    role: {
        type: String,
        enum: ['admin', 'editor', 'customer'],
        default: 'customer'
    },
    jobTitle: {
        type: String
    },
    bio: {
        type: String
    },
    profileImage: {
        type: String
    },
    tokenVersion: {
        type: Number,
        default: 0
    },
    status: {
        type: String,
        enum: ['active', 'inactive', 'suspended', 'blocked', 'pending verification'],
        default: 'active'
    },
    statusReason: {
        type: String
    },
    lastLogin: {
        type: Date
    },
    lastActive: {
        type: Date
    },
    // Fingerprints (hash of user-agent + IP) of devices this admin/editor has
    // logged in from before, so we can detect and alert on new devices.
    knownDevices: [{
        fingerprint: String,
        userAgent: String,
        ip: String,
        firstSeenAt: {
            type: Date,
            default: Date.now
        }
    }],
    activityHistory: [{
        action: {
            type: String,
            required: true
        },
        details: String,
        reason: String,
        adminName: String,
        timestamp: {
            type: Date,
            default: Date.now
        }
    }],
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Encrypt password using bcrypt
userSchema.pre('save', async function() {
    if (!this.isModified('password')) {
        return;
    }

    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
});

// Match user entered password to hashed password in database
userSchema.methods.matchPassword = async function(enteredPassword) {
    if (!this.password) return false;
    return await bcrypt.compare(enteredPassword, this.password);
};



module.exports = mongoose.model('User', userSchema);
