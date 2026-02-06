const express = require("express");
const router = express.Router();

let latest = { temperature: 0, humidity: 0, soil: 0 };

router.post("/", (req, res) => {
    latest = req.body;        // store live value
    req.app.get("io").emit("sensor", latest);   // broadcast
    res.json({ success: true });
});

router.get("/latest", (req, res) => {
    res.json(latest);
});

module.exports = router;
