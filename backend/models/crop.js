// backend/models/crop.js
const mongoose = require("mongoose");

// Setter that accepts Array, JSON string, or newline/semicolon/pipe separated string
const arrayOrStringSetter = (v) => {
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === "string") {
        const trimmed = v.trim();
        if (!trimmed) return [];
        if (trimmed.startsWith("[")) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed)) return parsed.map(String);
            } catch (e) {
                // fall through to splitting
            }
        }
        return trimmed
            .split(/\r?\n|;|\|/)
            .map((s) => s.trim())
            .filter(Boolean);
    }
    return [];
};

const growthPhaseSchema = new mongoose.Schema(
    {
        name: String, // Germination / Vegetative / Flowering / Fruiting-Ripening

        // changed to arrays to accept multiple lines / bullets
        wateringSchedule: {
            type: [String],
            default: [],
            set: arrayOrStringSetter,
        },

        fertilizerSchedule: {
            type: [String],
            default: [],
            set: arrayOrStringSetter,
        },

        weatherPrecautions: {
            type: [String],
            default: [],
            set: arrayOrStringSetter,
        },

        issuesToCheck: {
            type: [String],
            default: [],
            set: arrayOrStringSetter,
        },

        feedbackQuestions: {
            type: [String],
            default: [],
        },
    },
    { _id: false }
);

const feedbackSchema = new mongoose.Schema(
    {
        date: Date,
        leafColor: String,
        plantHeight: String,
        soilMoisture: String,
        notes: String,
    },
    { _id: false }
);

const gpsSchema = new mongoose.Schema(
    {
        lat: Number,
        lng: Number,
    },
    { _id: false }
);

const lifecycleSchema = new mongoose.Schema(
    {
        // these can be multi-line / bullet lists — accept arrays
        soilPreparation: {
            type: [String],
            default: [],
            set: arrayOrStringSetter,
        },

        sowingGuidelines: {
            type: [String],
            default: [],
            set: arrayOrStringSetter,
        },

        growthPhases: {
            type: [growthPhaseSchema],
            default: [],
        },

        weatherAdjustments: {
            type: [String],
            default: [],
            set: arrayOrStringSetter,
        },

        harvestWindow: {
            type: [String],
            default: [],
            set: arrayOrStringSetter,
        },
    },
    { _id: false }
);

const cropSchema = new mongoose.Schema(
    {
        gps: gpsSchema,
        landArea: String,
        previousCrop: String,
        uncultivatedDuration: String,
        soilType: String,
        soilImagePath: String,
        notes: String,
        startDate: Date,

        recommendedCrops: [String],
        selectedCrop: String,

        lifecycle: lifecycleSchema,

        currentStage: String,
        todaysAction: String,
        weatherTips: String,

        feedbackHistory: [feedbackSchema],
    },
    { timestamps: true }
);

const Crop = mongoose.model("Crop", cropSchema);

module.exports = Crop;