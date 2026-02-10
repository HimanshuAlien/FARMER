// models/Query.js
const mongoose = require('mongoose');

const querySchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',         // Farmer who asked
        required: true
    },
    question: {
        type: String,
        required: true,
        trim: true
    },
    response: {
        type: String,        // AI response
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

    // =========================
    // 🔹 NEW: ai_result subdocument — classifier output stored here
    // =========================
    ai_result: {
        risk_level: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'], default: 'LOW' },
        risk_score: { type: Number, default: 0 }, // 0..1
        explanation: { type: String, default: '' },
        createdAt: { type: Date, default: Date.now }
    },

    // --- Existing farmer resolution flag ---
    resolved: {
        type: Boolean,
        default: false       // true when farmer marks as resolved
    },
    rating: {
        type: Number,
        min: 1,
        max: 5
    },

    // --- Existing: who finally resolved it (for analytics) ---
    resolvedBy: {
        type: String,
        enum: ['farmer', 'officer', 'system', null],
        default: null
    },

    escalated: {
        type: Boolean,
        default: false       // mirror of escalation.isEscalated
    },
    status: {
        type: String,
        enum: ['normal', 'escalated', 'in_review', 'resolved', 'resolved_by_officer'],
        default: 'normal'
    },
    escalationStatus: {
        type: String,
        enum: ['pending', 'escalated', 'in_review', 'resolved_by_officer', null],
        default: null
    },
    escalationReason: {
        type: String,
        trim: true
    },
    escalationNotes: {
        type: String,
        trim: true
    },
    escalatedAt: {
        type: Date
    },
    resolvedAt: {
        type: Date
    },

    officerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    officerResponse: {
        type: String,
        trim: true,
        default: ''
    },
    officerUpdatedAt: {
        type: Date
    },

    // =========================
    // 🔹 Your original nested block (kept for future use)
    // =========================
    escalation: {
        isEscalated: {
            type: Boolean,
            default: false    // true when farmer clicks "Need officer help"
        },
        status: {
            type: String,
            enum: ['pending', 'assigned', 'in_review', 'replied', 'closed'],
            default: 'pending'
        },
        reason: {
            type: String,
            trim: true        // optional text: "AI answer not clear" etc.
        },
        requestedAt: {
            type: Date
        },
        requestedBy: {
            type: mongoose.Schema.Types.ObjectId, // usually same as userId
            ref: 'User'
        },

        // Officer side
        officerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'       // Officer user (role: 'officer')
        },
        officerReply: {
            type: String,     // Officer’s detailed answer
            default: ''
        },
        officerNotes: {
            type: String,     // internal notes (optional)
            default: ''
        },
        repliedAt: {
            type: Date        // when officer replied
        }
    }

}, { timestamps: true });

// Indexes for better query performance
querySchema.index({ userId: 1, createdAt: -1 });
querySchema.index({ createdAt: -1 });

// For officer dashboard: list escalated queries quickly
querySchema.index({ escalated: 1, resolved: 1 }); // flat fields used by routes
querySchema.index({ 'escalation.isEscalated': 1, createdAt: -1 });
querySchema.index({ 'escalation.officerId': 1, 'escalation.status': 1 });

// Optimization for stats and officer views
querySchema.index({ userId: 1, resolved: 1 });
querySchema.index({ userId: 1, category: 1 });
querySchema.index({ escalated: 1, resolved: 1, escalatedAt: -1 });

module.exports = mongoose.model('Query', querySchema);
