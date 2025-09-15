const mongoose = require('mongoose');

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
    }
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
