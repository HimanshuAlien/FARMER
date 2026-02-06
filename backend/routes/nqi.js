const express = require("express");
const router = express.Router();
const { GoogleGenerativeAI } = require("@google/generative-ai");


if (!process.env.GEMINI_API_KEY) {
    console.error("❌ GEMINI_API_KEY NOT FOUND IN ENV");
} const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
function extractJSON(text) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
        throw new Error("No JSON found in Gemini response");
    }
    return JSON.parse(match[0]);
}
router.post("/analyze", async (req, res) => {
    console.log("✅ /api/nqi/analyze HIT");
    console.log("📥 INPUT:", req.body);

    try {
        const { ndvi, moisture, temp, humidity, location } = req.body;

        if (
            ndvi === undefined ||
            moisture === undefined ||
            temp === undefined ||
            humidity === undefined
        ) {
            return res.status(400).json({
                success: false,
                error: "Missing required fields"
            });
        }

        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash"
        });


        const prompt = `
You are an Agricultural Nutrition Quality Intelligence (NQI) system.

INPUT DATA:
- NDVI: ${ndvi}
- Soil Moisture (%): ${moisture}
- Temperature (°C): ${temp}
- Humidity (%): ${humidity}
- Location Coordinates: ${location}

TASKS:
1. Calculate an overall Nutrition Quality Index (NQI) score (0–100).
2. Classify nutrition risk as SAFE, WARNING, or DANGEROUS.
3. Estimate environmental danger based on location and conditions.
4. Provide a nutrition risk value (0–100, higher = more risk).
5. Identify potential HUMAN HEALTH IMPACTS caused by current nutrition quality.
6. Provide explanation, prevention steps, and actionable suggestions.

STRICT RULES:
- Output ONLY valid JSON.
- No markdown.
- No extra text.
- No medical diagnosis claims.
- Use risk-based, advisory language.

RESPONSE FORMAT (EXACT JSON):
{
  "nqiScore": number,
  "riskStatus": "SAFE | WARNING | DANGEROUS",
  "chartRisk": number,
  "environmentalDanger": {
    "level": "SAFE | MODERATE | HIGH",
    "color": "green | yellow | red",
    "message": string
  },
  "aiExplanation": {
    "explanation": string,
    "prevention": string,
    "suggestions": string
  },
  "healthImpact": [
    string,
    string,
    string
  ]
}
`;
        const result = await model.generateContent(prompt);
        const rawText = result.response.text();

        console.log("🤖 RAW GEMINI RESPONSE:\n", rawText);


        let aiData;
        try {
            aiData = extractJSON(rawText);
        } catch (err) {
            console.error("❌ JSON PARSE FAILED");
            console.error(rawText);
            return res.status(500).json({
                success: false,
                error: "AI response parsing failed",
                raw: rawText
            });
        }


        return res.json({
            success: true,
            data: {
                ...aiData,
                nqiCode: `NQI-${aiData.nqiScore}`
            }
        });

    } catch (err) {
        console.error("❌ NQI ROUTE ERROR:", err);
        return res.status(500).json({
            success: false,
            error: "Internal NQI analysis error"
        });
    }
});

module.exports = router;
