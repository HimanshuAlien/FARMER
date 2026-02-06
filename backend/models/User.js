// backend/models/User.js
const mongoose = require('mongoose');

const EmergencyContactSchema = new mongoose.Schema({
    id: { type: String }, // client-side id for temporary operations
    name: { type: String, trim: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    relation: { type: String, trim: true },
    verified: { type: Boolean, default: false },
    consent_for_contact: { type: Boolean, default: false }, // did user allow contacting this person?
    verifiedAt: { type: Date },
    otpHash: { type: String },       // hashed OTP while pending verification
    otpExpiresAt: { type: Date }     // expiry time for OTP
}, { _id: false });

const UserSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        minlength: 3
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    password: {
        type: String,
        required: true,
        minlength: 6
    },
    // ADD THIS: User role field
    role: {
        type: String,
        enum: ['farmer', 'officer', 'admin'],
        default: 'farmer'
    },
    // Officer profile details (if role is 'officer')
    officerProfile: {
        designation: { type: String, trim: true },
        department: { type: String, trim: true },
        officeName: { type: String, trim: true },
        officeCode: { type: String, trim: true },
        district: { type: String, trim: true },
        blockName: { type: String, trim: true },
        phoneOffice: { type: String, trim: true }
    },
    // Profile fields (optional)
    phone: {
        type: String,
        trim: true
    },
    farmSize: {
        type: Number,
        min: 0
    },
    location: {
        type: String,
        trim: true
    },
    farmDescription: {
        type: String,
        trim: true
    },
    primaryCrops: {
        type: String,
        trim: true
    },
    farmingType: {
        type: String,
        enum: ['organic', 'conventional', 'mixed', ''],
        default: ''
    },
    experience: {
        type: Number,
        min: 0
    },
    soilType: {
        type: String,
        enum: ['clay', 'sandy', 'loamy', 'red', 'black', ''],
        default: ''
    },
    profileImage: {
        type: String,
        default: ''
    },
    language: {
        type: String,
        default: 'en'
    },
    emailPreferences: {
        dailyWeather: { type: Boolean, default: true },
        emergencyAlerts: { type: Boolean, default: true },
        weeklyReports: { type: Boolean, default: true },
        lastEmailSent: { type: Date }
    },

    // --- NEW: Emergency contacts (consent-first, OTP-verified)
    emergency_contacts: {
        type: [EmergencyContactSchema],
        default: []
    },

    // --- NEW: simple audit of consent actions (optional, useful)
    consent_logs: [{
        action: { type: String }, // e.g., 'contact_added','contact_verified','contact_removed'
        detail: { type: Object },
        at: { type: Date, default: Date.now }
    }]
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
