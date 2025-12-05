// routes/insights.js
const express = require("express");
const fetch = require("node-fetch");

const router = express.Router();

const AGRO_API_KEY = process.env.AGRO_API_KEY;

async function createRemotePolygon(geoJson, name) {
    const url = `http://api.agromonitoring.com/agro/1.0/polygons?appid=${AGRO_API_KEY}`;
    const body = {
        name: name || "kerala-field",
        geo_json: geoJson
    };

    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const text = await res.text();
        console.error("Polygon create error:", res.status, text);
        throw new Error("Failed to create polygon at Agromonitoring");
    }

    const json = await res.json();
    return json.id;
}

async function getSatelliteData(polyId) {
    const nowSec = Math.floor(Date.now() / 1000);
    const end = nowSec - 3600; // 1 hour before now
    const start = end - 7 * 24 * 60 * 60;

    const ndviUrl = `http://api.agromonitoring.com/agro/1.0/ndvi/history?polyid=${polyId}&start=${start}&end=${end}&appid=${AGRO_API_KEY}`;
    const soilUrl = `http://api.agromonitoring.com/agro/1.0/soil?polyid=${polyId}&appid=${AGRO_API_KEY}`;

    const [ndviRes, soilRes] = await Promise.all([fetch(ndviUrl), fetch(soilUrl)]);

    if (!ndviRes.ok) {
        const txt = await ndviRes.text();
        console.error("NDVI error:", ndviRes.status, txt);
        throw new Error("Failed to fetch NDVI history");
    }

    const ndviArr = await ndviRes.json();
    let ndviMean = null;
    let lastPass = null;

    if (Array.isArray(ndviArr) && ndviArr.length > 0) {
        const latest = ndviArr[ndviArr.length - 1];
        if (latest.data && typeof latest.data.mean === "number") {
            ndviMean = latest.data.mean;
        }
        if (latest.dt) {
            lastPass = new Date(latest.dt * 1000).toISOString();
        }
    }

    if (!soilRes.ok) {
        const txt = await soilRes.text();
        console.error("Soil error:", soilRes.status, txt);
        throw new Error("Failed to fetch soil data");
    }

    const soilJson = await soilRes.json();
    console.log("RAW SOIL RESPONSE:", soilJson); // Added for debugging

    const soilMoisture =
        soilJson && soilJson.moisture != null ? soilJson.moisture : null;

    const soilTemp =
        soilJson && soilJson.t0 != null ? soilJson.t0 : null; // Kelvin

    return { ndviMean, soilMoisture, soilTemp, lastPass };
}

router.post("/analyze", async (req, res) => {
    try {
        const { polygon, crop, sowingDate, fieldType } = req.body || {};

        if (!polygon) {
            return res.status(400).json({ error: "Polygon GeoJSON is required" });
        }

        const polyId = await createRemotePolygon(
            polygon,
            crop ? `field-${crop}` : "kerala-field"
        );

        const { ndviMean, soilMoisture, soilTemp, lastPass } =
            await getSatelliteData(polyId);

        res.json({
            ndvi: ndviMean,
            soilMoisture,
            soilTemp,
            lastPass,
            meta: { crop, sowingDate, fieldType }
        });
    } catch (err) {
        console.error("INSIGHTS ERROR:", err.message);
        res.status(500).json({ error: err.message || "Satellite analysis failed" });
    }
});

module.exports = router;

