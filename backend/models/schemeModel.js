// models/schemeModel.js
const mongoose = require('mongoose');

const governmentSchemeSchema = new mongoose.Schema(
    {
        schemeName: { type: String, required: true },
        region: { type: String, enum: ['central', 'kerala', 'delhi'], required: true },
        department: { type: String, default: 'Agriculture / Allied Department' },
        category: { type: String, default: 'general' },

        // PDF storage (in /public/pdfs)
        pdfFileName: { type: String, required: true }, // e.g. 'pm-kisan.pdf'

        // Optional: official link & info
        applicationUrl: { type: String },
        contactInfo: { type: String, default: 'Contact your nearest Krishi Bhavan / Agriculture Officer.' },

        isActive: { type: Boolean, default: true },
        isVerified: { type: Boolean, default: true }
    },
    { timestamps: true }
);

const GovernmentScheme = mongoose.model('GovernmentScheme', governmentSchemeSchema);
module.exports = { GovernmentScheme };
