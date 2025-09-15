const mongoose = require('mongoose');

const querySchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    question: {
        type: String,
        required: true,
        trim: true
    },
    response: {
        type: String,
        default: ''
    },
    category: {
        type: String,
        enum: ['farming', 'disease', 'weather', 'market', 'general'],
        default: 'general'
    },
    language: {
        type: String,
        default: 'en'
    },
    resolved: {
        type: Boolean,
        default: false
    },
    rating: {
        type: Number,
        min: 1,
        max: 5
    }
}, { timestamps: true });

// Index for better performance
querySchema.index({ userId: 1, createdAt: -1 });
querySchema.index({ createdAt: -1 });

module.exports = mongoose.model('Query', querySchema);
