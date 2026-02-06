// models/Marker.js
const mongoose = require('mongoose');

const MarkerSchema = new mongoose.Schema({
    title: { type: String, default: '' },
    description: { type: String, default: '' },
    lat: { type: Number, required: true },
    lon: { type: Number, required: true },
    meta: { type: Object, default: {} }, // icon, color, anything
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

MarkerSchema.pre('save', function (next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('Marker', MarkerSchema);
