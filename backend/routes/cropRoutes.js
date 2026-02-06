// backend/routes/cropRoutes.js
const express = require("express");
const multer = require("multer");
const dotenv = require("dotenv");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Crop = require("../models/crop");

dotenv.config();

const router = express.Router();
const upload = multer({ dest: "uploads/" });
router.use(express.json());
// ---- GEMINI SETUP ----
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function cleanJsonText(text) {
    return text.replace(/```json/g, "").replace(/```/g, "").trim();
}

// ---------- AI HELPERS (all inside this file) ----------

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
    {
      "name": "Vegetative (approx. X days)",
      "wateringSchedule": "...",
      "fertilizerSchedule": "...",
      "weatherPrecautions": "...",
      "issuesToCheck": "...",
      "feedbackQuestions": ["...", "..."]
    },
    {
      "name": "Flowering (approx. X days)",
      "wateringSchedule": "...",
      "fertilizerSchedule": "...",
      "weatherPrecautions": "...",
      "issuesToCheck": "...",
      "feedbackQuestions": ["...", "..."]
    },
    {
      "name": "Fruiting/Ripening (approx. X days)",
      "wateringSchedule": "...",
      "fertilizerSchedule": "...",
      "weatherPrecautions": "...",
      "issuesToCheck": "...",
      "feedbackQuestions": ["...", "..."]
    }
  ],
  "weatherAdjustments": "max 4 short lines on adjusting for heat, rain, dry spells",
  "harvestWindow": "max 4 short lines describing best harvest period and key checks"
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
    const res = await fetch(url); // Node 18+ global fetch
    if (!res.ok) return null;
    return res.json();
}

async function aiDailyActions(cropDoc, weather) {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `
You are helping a farmer manage the crop "${cropDoc.selectedCrop || "Unknown"}".

Lifecycle plan:
${JSON.stringify(cropDoc.lifecycle || {}, null, 2)}

Current growth stage: ${cropDoc.currentStage || "Unknown"}

Latest feedback:
${JSON.stringify(
        cropDoc.feedbackHistory?.[cropDoc.feedbackHistory.length - 1] || {},
        null,
        2
    )}

Today's weather forecast:
${JSON.stringify(weather || {}, null, 2)}

STYLE:
- Output should be easy to scan on a mobile screen.
- Use very short, direct bullet-style lines, not long paragraphs.
- Use at most 4 lines for todaysAction and 3 lines for weatherTips.

Return STRICT JSON:
{
  "todaysAction": "each bullet separated by line breaks",
  "weatherTips": "each bullet separated by line breaks"
}
`;

    const result = await model.generateContent(prompt);
    const raw = result.response.text();
    return JSON.parse(cleanJsonText(raw));
}


async function aiAnalyzeFeedback(cropDoc, feedback, weather) {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `
You are an agronomist.

Crop: ${cropDoc.selectedCrop}
Current stage: ${cropDoc.currentStage || "Unknown"}

Lifecycle:
${JSON.stringify(cropDoc.lifecycle || {}, null, 2)}

Latest feedback from farmer:
${JSON.stringify(feedback, null, 2)}

Weather today:
${JSON.stringify(weather || {}, null, 2)}

TASK:
1. Interpret the feedback.
2. Decide if the crop stage should stay the same or move to the next logical phase.
   Valid stage names:
   - "Germination"
   - "Vegetative"
   - "Flowering"
   - "Fruiting/Ripening"
3. Suggest today's actions & weather tips in very short bullet-style lines (max 4 actions, 3 tips).

Return STRICT JSON:
{
  "todaysAction": "short bullet-style lines separated by line breaks",
  "weatherTips": "short bullet-style lines separated by line breaks",
  "newStage": "Germination | Vegetative | Flowering | Fruiting/Ripening | ${cropDoc.currentStage || "keep existing"
        }"
}
`;

    const result = await model.generateContent(prompt);
    const raw = result.response.text();
    return JSON.parse(cleanJsonText(raw));
}

async function aiAnswerQuestion(cropDoc, question, weather) {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `
You are an assistant for a farmer with basic literacy.

Crop: ${cropDoc.selectedCrop || "unknown"}

Lifecycle plan:
${JSON.stringify(cropDoc.lifecycle || {}, null, 2)}

Location: ${cropDoc.gps?.lat || "?"}, ${cropDoc.gps?.lng || "?"}

Recent feedback history:
${JSON.stringify(cropDoc.feedbackHistory || [], null, 2)}

Today's weather:
${JSON.stringify(weather || {}, null, 2)}

Farmer's question:
"${question}"

INSTRUCTIONS:
- Always answer using this farmer's context (their crop, stage, weather, feedback).
- If the answer is uncertain, say so.
- Use simple words.
- Answer in max 5 bullet-style lines, each line short and practical.
- Avoid long paragraphs and avoid repeating the entire lifecycle.

Return STRICT JSON:
{
  "answer": "short bullet-style lines separated by line breaks"
}
`;

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

// Get one crop (and refresh daily actions via AI + weather)
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

// Create new crop plan + get AI recommendations
router.post("/", upload.single("soilImage"), async (req, res) => {
    try {
        const gps = req.body.gps ? JSON.parse(req.body.gps) : { lat: null, lng: null };

        const crop = new Crop({
            gps,
            landArea: req.body.landArea,
            previousCrop: req.body.previousCrop,
            uncultivatedDuration: req.body.uncultivatedDuration,
            soilType: req.body.soilType,
            soilImagePath: req.file ? req.file.path : null,
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
        console.log("Select route body:", req.body); // 👈 debug log

        if (!req.body || !req.body.crop) {
            return res.status(400).json({ error: "crop is required in body" });
        }

        const crop = await Crop.findById(req.params.id);
        if (!crop) return res.status(404).json({ error: "Crop not found" });

        const selected = req.body.crop;
        crop.selectedCrop = selected;

        // AI lifecycle
        const lifecycle = await aiGenerateLifecycle(selected, crop);
        crop.lifecycle = lifecycle;

        // Start at first phase if present
        const firstPhase =
            lifecycle.growthPhases && lifecycle.growthPhases[0];
        crop.currentStage = firstPhase?.name || "Germination";

        // Initial daily actions with weather
        const weather = await getWeather(crop.gps?.lat, crop.gps?.lng);
        try {
            const daily = await aiDailyActions(crop, weather);
            crop.todaysAction = daily.todaysAction;
            crop.weatherTips = daily.weatherTips;
        } catch (e) {
            console.error("Initial daily AI error:", e);
        }

        await crop.save();
        res.json(crop);
    } catch (err) {
        console.error("Error in /:id/select:", err);
        res.status(500).json({ error: "Failed to select crop and create lifecycle" });
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

        if (analysis.newStage && analysis.newStage.trim()) {
            crop.currentStage = analysis.newStage.trim();
        }

        await crop.save();
        res.json(crop);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to process feedback" });
    }
});

// Ask AI generic question (e.g. "Why are my leaves yellow?")
router.post("/:id/ask", async (req, res) => {
    try {
        const crop = await Crop.findById(req.params.id);
        if (!crop) return res.status(404).json({ error: "Crop not found" });

        const { question } = req.body;
        if (!question) return res.status(400).json({ error: "Question is required" });

        const weather = await getWeather(crop.gps?.lat, crop.gps?.lng);
        const answerObj = await aiAnswerQuestion(crop, question, weather);

        res.json({ answer: answerObj.answer });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to answer question" });
    }
});

module.exports = router;
