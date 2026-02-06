const express = require("express");
const router = express.Router();

router.use(express.json());

router.post("/advice", (req, res) => {
    const { temperature, humidity, soil } = req.body || {};

    // Artificial delay (2 seconds)
    setTimeout(() => {

        if (temperature == null || humidity == null || soil == null) {
            return res.json({
                advice:
                    "📡 Waiting for complete sensor data...\n\n" +
                    "Please ensure soil moisture, temperature, and humidity sensors are active."
            });
        }

        let advice = "🌱 Field Analysis Report\n";
        advice += "---------------------------\n\n";

        /* ---------- SOIL ANALYSIS ---------- */
        advice += "🟤 Soil Moisture Status:\n";

        if (soil < 300) {
            advice +=
                "• Soil is extremely dry.\n" +
                "  ➜ Start irrigation immediately to prevent crop damage.\n\n";
        } else if (soil < 450) {
            advice +=
                "• Soil moisture is low.\n" +
                "  ➜ Light irrigation is recommended.\n\n";
        } else if (soil > 900) {
            advice +=
                "• Soil is heavily over-watered.\n" +
                "  ➜ Stop irrigation and improve field drainage.\n\n";
        } else if (soil > 750) {
            advice +=
                "• Soil moisture is higher than required.\n" +
                "  ➜ Avoid watering for the next 1–2 days.\n\n";
        } else {
            advice +=
                "• Soil moisture level is ideal.\n" +
                "  ➜ No irrigation required at this time.\n\n";
        }

        /* ---------- TEMPERATURE ANALYSIS ---------- */
        advice += "🌡 Temperature Condition:\n";

        if (temperature > 40) {
            advice +=
                "• Extremely high temperature detected.\n" +
                "  ➜ Water crops only during early morning or evening.\n" +
                "  ➜ Use shade nets if possible.\n\n";
        } else if (temperature > 34) {
            advice +=
                "• High temperature conditions.\n" +
                "  ➜ Apply mulching to reduce moisture loss.\n\n";
        } else if (temperature < 12) {
            advice +=
                "• Very low temperature detected.\n" +
                "  ➜ Cover crops to protect from cold stress.\n\n";
        } else if (temperature < 18) {
            advice +=
                "• Slightly low temperature.\n" +
                "  ➜ Monitor crops for slow growth.\n\n";
        } else {
            advice +=
                "• Temperature is suitable for healthy crop growth.\n\n";
        }

        /* ---------- HUMIDITY ANALYSIS ---------- */
        advice += "💧 Humidity Level:\n";

        if (humidity < 35) {
            advice +=
                "• Low humidity detected.\n" +
                "  ➜ Risk of plant stress.\n" +
                "  ➜ Use mulching or light irrigation.\n\n";
        } else if (humidity > 90) {
            advice +=
                "• Extremely high humidity.\n" +
                "  ➜ High risk of fungal diseases.\n" +
                "  ➜ Ensure good air circulation.\n\n";
        } else if (humidity > 80) {
            advice +=
                "• High humidity level.\n" +
                "  ➜ Avoid over-watering and monitor disease symptoms.\n\n";
        } else {
            advice +=
                "• Humidity is within the healthy range.\n\n";
        }

        /* ---------- FINAL SUMMARY ---------- */
        advice +=
            "✅ Overall Field Status:\n" +
            "Your field conditions are being continuously monitored.\n" +
            "Follow the above recommendations for best crop health.";

        res.json({ advice });

    }, 2000); // ⏳ 2 seconds delay
});

module.exports = router;
