const mongoose = require('mongoose');

const passwordResetSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    otpHash: {
      type: String,
      required: true
    },
    otpExpiresAt: {
      type: Date,
      required: true
    },
    attempts: {
      type: Number,
      default: 0
    },
    lastSentAt: {
      type: Date,
      required: true
    },
    otpConsumedAt: {
      type: Date,
      default: null
    },
    resetTokenHash: {
      type: String,
      default: null
    },
    resetTokenExpiresAt: {
      type: Date,
      default: null
    },
    resetTokenConsumedAt: {
      type: Date,
      default: null
    },
    requestIp: {
      type: String,
      default: null
    },
    userAgent: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// TTL index to automatically clean up expired documents after 24 hours
passwordResetSchema.index({ otpExpiresAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('PasswordReset', passwordResetSchema);
