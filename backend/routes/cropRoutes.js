// backend/routes/cropRoutes.js
const express = require("express");
const multer = require("multer");
const dotenv = require("dotenv");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Crop = require("../models/crop");
const fs = require('fs');
const path = require('path');

dotenv.config();

const router = express.Router();

// Configure multer for memory storage (Base64 Soil Images)
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

router.use(express.json());

// ---- GEMINI SETUP ----
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function cleanJsonText(text) {
    return text.replace(/```json/g, "").replace(/```/g, "").trim();
}

// ---------- AI HELPERS ----------

async function aiRecommendCrops(fieldData) {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `
You are an agricultural planning assistant for small farmers.

Based on the following field information:

- Soil type: ${fieldData.soilType}
- Previous crop: ${fieldData.previousCrop || "unknown"}
- Land area: ${fieldData.landArea || "unknown"}
- Time uncultivated: ${fieldData.uncultivatedDuration || "unknown"}
- GPS: ${fieldData.gps?.lat || "unknown"}, ${fieldData.gps?.lng || "unknown"}
- Notes: ${fieldData.notes || "none"}

Recommend the TOP 5 most suitable crops for the coming season.

Return ONLY valid JSON as:
["Crop name 1", "Crop name 2", ...]
`;

    const result = await model.generateContent(prompt);
    const raw = result.response.text();
    return JSON.parse(cleanJsonText(raw));
}

async function aiGenerateLifecycle(selectedCrop, cropDoc) {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `
You are an expert agronomist helping a small farmer.

Farmer field context:
${JSON.stringify(
        {
            gps: cropDoc.gps,
            landArea: cropDoc.landArea,
            soilType: cropDoc.soilType,
            previousCrop: cropDoc.previousCrop,
            uncultivatedDuration: cropDoc.uncultivatedDuration,
            notes: cropDoc.notes,
            startDate: cropDoc.startDate,
        },
        null,
        2
    )}

Design a customized lifecycle plan for the crop: "${selectedCrop}".

IMPORTANT STYLE RULES:
- Use very clear and short sentences.
- Prefer bullet-style text (each line is one short action or tip).
- For all text fields, give at most 4 bullet points, each under 140 characters.
- Avoid long paragraphs.

Return STRICT JSON with this structure:
{
  "soilPreparation": "bullet-style text (max 4 short lines)",
  "sowingGuidelines": "bullet-style text (max 4 short lines)",
  "growthPhases": [
    {
      "name": "Germination (approx. X days)",
      "wateringSchedule": "max 3 bullet-style lines",
      "fertilizerSchedule": "max 3 bullet-style lines",
      "weatherPrecautions": "max 3 bullet-style lines",
      "issuesToCheck": "max 3 bullet-style lines",
      "feedbackQuestions": ["short question 1", "short question 2"]
    },
    ... (similarly for Vegetative, Flowering, Fruiting/Ripening)
  ],
  "weatherAdjustments": "max 4 short lines",
  "harvestWindow": "max 4 short lines"
}
`;

    const result = await model.generateContent(prompt);
    const raw = result.response.text();
    return JSON.parse(cleanJsonText(raw));
}

async function getWeather(lat, lng) {
    if (lat == null || lng == null) {
        return null;
    }
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&forecast_days=1&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return res.json();
}

async function aiDailyActions(cropDoc, weather) {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `
You are helping a farmer manage the crop "${cropDoc.selectedCrop || "Unknown"}".
Current growth stage: ${cropDoc.currentStage || "Unknown"}
Today's weather forecast: ${JSON.stringify(weather || {}, null, 2)}

Return STRICT JSON:
{
  "todaysAction": "bullets separated by line breaks",
  "weatherTips": "bullets separated by line breaks"
}
`;

    const result = await model.generateContent(prompt);
    const raw = result.response.text();
    return JSON.parse(cleanJsonText(raw));
}

async function aiAnalyzeFeedback(cropDoc, feedback, weather) {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    // ... logic remains same, just ensure it returns JSON
    const prompt = `Analyze feedback for ${cropDoc.selectedCrop} at stage ${cropDoc.currentStage}. Feedback: ${JSON.stringify(feedback)}. Weather: ${JSON.stringify(weather)}. Decide if stage should change. Return JSON: {todaysAction, weatherTips, newStage}`;

    const result = await model.generateContent(prompt);
    const raw = result.response.text();
    return JSON.parse(cleanJsonText(raw));
}

async function aiAnswerQuestion(cropDoc, question, weather) {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = `As an agronomist, answer for ${cropDoc.selectedCrop}: ${question}. Context: ${JSON.stringify(cropDoc)}. Weather: ${JSON.stringify(weather)}. Return JSON: {answer}`;

    const result = await model.generateContent(prompt);
    const raw = result.response.text();
    return JSON.parse(cleanJsonText(raw));
}

// ---------------- ROUTES ----------------

// List all crop plans
router.get("/", async (req, res) => {
    try {
        const crops = await Crop.find().sort({ createdAt: -1 });
        res.json(crops);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to list crops" });
    }
});

// Get one crop
router.get("/:id", async (req, res) => {
    try {
        const crop = await Crop.findById(req.params.id);
        if (!crop) return res.status(404).json({ error: "Crop not found" });

        if (crop.selectedCrop && crop.lifecycle) {
            const weather = await getWeather(crop.gps?.lat, crop.gps?.lng);
            try {
                const daily = await aiDailyActions(crop, weather);
                crop.todaysAction = daily.todaysAction;
                crop.weatherTips = daily.weatherTips;
                await crop.save();
            } catch (e) {
                console.error("Daily AI error:", e);
            }
        }

        res.json(crop);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch crop" });
    }
});

// Create new crop plan (Memory -> Base64 -> MongoDB)
router.post("/", upload.single("soilImage"), async (req, res) => {
    try {
        const gps = req.body.gps ? JSON.parse(req.body.gps) : { lat: null, lng: null };

        let soilimageBase64 = null;
        if (req.file) {
            soilimageBase64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
        }

        const crop = new Crop({
            gps,
            landArea: req.body.landArea,
            previousCrop: req.body.previousCrop,
            uncultivatedDuration: req.body.uncultivatedDuration,
            soilType: req.body.soilType,
            soilImagePath: soilimageBase64, // Store Base64 directly
            notes: req.body.notes,
            startDate: req.body.startDate ? new Date(req.body.startDate) : null,
        });

        const recommended = await aiRecommendCrops(crop);
        crop.recommendedCrops = recommended;

        await crop.save();
        res.json(crop);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to create crop plan" });
    }
});

// Select a crop and generate lifecycle
router.post("/:id/select", async (req, res) => {
    try {
        if (!req.body || !req.body.crop) {
            return res.status(400).json({ error: "crop is required" });
        }

        const crop = await Crop.findById(req.params.id);
        if (!crop) return res.status(404).json({ error: "Crop not found" });

        crop.selectedCrop = req.body.crop;
        const lifecycle = await aiGenerateLifecycle(req.body.crop, crop);
        crop.lifecycle = lifecycle;

        const firstPhase = lifecycle.growthPhases && lifecycle.growthPhases[0];
        crop.currentStage = firstPhase?.name || "Germination";

        const weather = await getWeather(crop.gps?.lat, crop.gps?.lng);
        try {
            const daily = await aiDailyActions(crop, weather);
            crop.todaysAction = daily.todaysAction;
            crop.weatherTips = daily.weatherTips;
        } catch (e) { console.error(e); }

        await crop.save();
        res.json(crop);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to select crop" });
    }
});

// Feedback route
router.post("/:id/feedback", async (req, res) => {
    try {
        const crop = await Crop.findById(req.params.id);
        if (!crop) return res.status(404).json({ error: "Crop not found" });

        const feedback = {
            date: req.body.date ? new Date(req.body.date) : new Date(),
            leafColor: req.body.leafColor,
            plantHeight: req.body.plantHeight,
            soilMoisture: req.body.soilMoisture,
            notes: req.body.notes,
        };

        crop.feedbackHistory.push(feedback);

        const weather = await getWeather(crop.gps?.lat, crop.gps?.lng);
        const analysis = await aiAnalyzeFeedback(crop, feedback, weather);

        crop.todaysAction = analysis.todaysAction;
        crop.weatherTips = analysis.weatherTips;

        if (analysis.newStage) {
            crop.currentStage = analysis.newStage.trim();
        }

        await crop.save();
        res.json(crop);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to process feedback" });
    }
});

router.post("/:id/ask", async (req, res) => {
    try {
        const crop = await Crop.findById(req.params.id);
        if (!crop) return res.status(404).json({ error: "Crop not found" });

        const weather = await getWeather(crop.gps?.lat, crop.gps?.lng);
        const answerObj = await aiAnswerQuestion(crop, req.body.question, weather);

        res.json({ answer: answerObj.answer });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to answer question" });
    }
});

module.exports = router;
