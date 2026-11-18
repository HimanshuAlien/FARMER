const express = require("express");
const router = express.Router();

let latest = { temperature: 0, humidity: 0, soil: 0, smoke: 0, smokePpm: 52 };

// Quick probe endpoint for ESP8266 auto-discovery
router.get("/ping", (req, res) => {
    res.json({ status: "ok", device: "kerala-advisory-server" });
});

router.post("/", (req, res) => {
    const data = req.body || {};
    const isSmoke = data.smoke == 1 || data.smoke === true || data.smoke === "1";
    
    latest = {
        temperature: Number(data.temperature) || 0,
        humidity: Number(data.humidity) || 0,
        soil: Number(data.soil) || 0,
        smoke: isSmoke ? 1 : 0,
        smokePpm: data.smokePpm !== undefined ? Number(data.smokePpm) : (isSmoke ? 780 : 54),
        timestamp: new Date().toISOString()
    };

    req.app.get("io").emit("sensor", latest);   // broadcast live socket
    res.json({ success: true, received: latest });
});

router.get("/latest", (req, res) => {
    res.json(latest);
});

module.exports = router;
