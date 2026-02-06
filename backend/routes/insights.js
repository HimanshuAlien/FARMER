// routes/insights.js
require('dotenv').config();
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const util = require('util');
const fetch = global.fetch || require('node-fetch');
const ee = require('@google/earthengine');

const DEFAULT_LOOKBACK_MONTHS = 3;
const DEFAULT_LOW_NDVI_THRESHOLD = 0.35;
const SERVICE_ACCOUNT_KEY_PATH = process.env.EE_SERVICE_ACCOUNT_KEY || path.join(__dirname, '..', 'service-account.json');

let eeInitialized = false;
let eeInitializing = false;

async function initEarthEngine() {
    if (eeInitialized) return;
    if (eeInitializing) {
        for (let i = 0; i < 50; i++) {
            if (eeInitialized) return;
            await new Promise(r => setTimeout(r, 200));
        }
        throw new Error('Timeout waiting for Earth Engine init');
    }
    eeInitializing = true;

    try {
        if (!fs.existsSync(SERVICE_ACCOUNT_KEY_PATH)) {
            throw new Error(`Service account key not found at ${SERVICE_ACCOUNT_KEY_PATH}`);
        }
        const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_KEY_PATH, 'utf8'));

        return new Promise((resolve, reject) => {
            ee.data.authenticateViaPrivateKey(serviceAccount, (authErr) => {
                if (authErr) {
                    eeInitializing = false;
                    return reject(authErr);
                }
                ee.initialize(null, null, (initErr) => {
                    if (initErr) {
                        eeInitializing = false;
                        return reject(initErr);
                    }
                    eeInitialized = true;
                    eeInitializing = false;
                    resolve();
                });
            });
        });
    } catch (error) {
        eeInitializing = false;
        throw error;
    }
}

function eeEvaluatePromise(obj) {
    return new Promise((resolve, reject) => {
        try {
            obj.evaluate((a, b) => {
                if (a && (a instanceof Error || a.error || a.message)) return reject(a);
                if (b && (b instanceof Error || b.error || b.message)) return reject(b);
                if ((a === undefined || a === null) && (b !== undefined)) return resolve(b);
                if ((b === undefined || b === null) && (a !== undefined)) return resolve(a);
                return resolve(b !== undefined && b !== null ? b : a);
            });
        } catch (ex) {
            reject(ex);
        }
    });
}

function toEeGeometry(obj) {
    if (!obj) throw new Error('Missing geometry.');
    let geometry;
    if (obj.type === 'Feature') geometry = obj.geometry;
    else if (obj.type === 'FeatureCollection') {
        if (obj.features && obj.features.length > 0) geometry = obj.features[0].geometry;
        else throw new Error('FeatureCollection contains no features');
    } else geometry = obj.geometry || obj;
    if (!geometry || !geometry.coordinates) throw new Error('Invalid geometry: missing coordinates');
    if (geometry.type === 'Polygon') return ee.Geometry.Polygon(geometry.coordinates);
    if (geometry.type === 'MultiPolygon') return ee.Geometry.MultiPolygon(geometry.coordinates);
    throw new Error(`Unsupported geometry type: ${geometry.type}`);
}

function safeNumber(val) {
    if (val === null || val === undefined) return null;
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
}

// ----------------- IMPROVED: Real EE-based heatmap sampling -----------------
async function sampleNdviHeatmapPoints(geom, ndviImage, numPoints = 300) {
    try {
        // Sample NDVI values at random points within geometry
        const randomPoints = ee.FeatureCollection.randomPoints({
            region: geom,
            points: numPoints,
            seed: 42
        });

        const sampled = ndviImage.sampleRegions({
            collection: randomPoints,
            properties: [],
            scale: 10,
            geometries: true
        });

        const results = await eeEvaluatePromise(sampled);
        if (!results || !results.features) return [];

        return results.features.map(feat => {
            const coords = feat.geometry.coordinates;
            const ndviVal = feat.properties.NDVI;
            if (!coords || ndviVal === null || ndviVal === undefined) return null;

            // Normalize NDVI 0-1 for heatmap intensity, clamp 0.1-1.0
            const intensity = Math.max(0.1, Math.min(1.0, (ndviVal + 0.2) / 1.1));
            return [coords[1], coords[0], Number(intensity.toFixed(3))]; // [lat, lng, intensity]
        }).filter(Boolean);
    } catch (ex) {
        console.warn('EE heatmap sampling failed:', ex);
        return [];
    }
}

// ----------------- simple point-in-polygon + sampler (fallback only) -----------------
function pointInPolygon(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 0.0) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function generatePointsInPolygonGeoJSON(feature, count = 300) {
    const geom = feature.type === 'Feature' ? feature.geometry : (feature.geometry || feature);
    const coords = (geom.type === 'Polygon') ? geom.coordinates[0] : (geom.type === 'MultiPolygon' ? geom.coordinates[0][0] : []);
    if (!coords || coords.length === 0) return [];

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    coords.forEach(([lng, lat]) => {
        if (lng < minX) minX = lng;
        if (lng > maxX) maxX = lng;
        if (lat < minY) minY = lat;
        if (lat > maxY) maxY = lat;
    });

    const pts = [];
    let trial = 0;
    while (pts.length < count && trial < count * 10) {
        trial++;
        const rx = minX + Math.random() * (maxX - minX);
        const ry = minY + Math.random() * (maxY - minY);
        if (pointInPolygon(rx, ry, coords)) pts.push([ry, rx]);
    }
    return pts;
}

// ----------------- IMPROVED NDVI helper with accurate heatmap -----------------
async function computeNdviStatsAndHeat(polygonFeature, options = {}) {
    await initEarthEngine();
    if (!polygonFeature) throw new Error('Missing polygon for NDVI compute');
    const threshold = (typeof options.threshold === 'number') ? options.threshold : DEFAULT_LOW_NDVI_THRESHOLD;
    const end = options.endDate ? ee.Date(options.endDate) : ee.Date(Date.now());
    const start = options.startDate ? ee.Date(options.startDate) : end.advance(-DEFAULT_LOOKBACK_MONTHS, 'month');

    const geom = toEeGeometry(polygonFeature);

    function buildS2Collection(collectionFilterOptions = {}) {
        let coll = ee.ImageCollection('COPERNICUS/S2_SR')
            .filterBounds(geom)
            .filterDate(start, end);

        if (collectionFilterOptions.cloudFilter) {
            const cloudThreshold = collectionFilterOptions.cloudThreshold || 20;
            coll = coll.filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', cloudThreshold));
        }

        coll = coll.map(function (img) {
            var ndvi = img.normalizedDifference(['B8', 'B4']).rename('NDVI');
            return img.addBands(ndvi).copyProperties(img, ['system:time_start']);
        });

        return coll;
    }

    let s2 = buildS2Collection({ cloudFilter: true, cloudThreshold: 20 });
    let imageCountRaw = await eeEvaluatePromise(s2.size());
    let imageCount = safeNumber(imageCountRaw) || 0;
    let usedFallbackNoCloudFilter = false;

    if (imageCount === 0) {
        s2 = buildS2Collection({ cloudFilter: false });
        imageCountRaw = await eeEvaluatePromise(s2.size());
        imageCount = safeNumber(imageCountRaw) || 0;
        usedFallbackNoCloudFilter = imageCount > 0;
    }

    if (imageCount === 0) {
        return { available: false, message: 'No Sentinel-2 images found for area/date range' };
    }

    const ndviMedian = s2.select('NDVI').median().clip(geom);

    const meanRaw = await eeEvaluatePromise(
        ndviMedian.reduceRegion({ reducer: ee.Reducer.mean(), geometry: geom, scale: 10, maxPixels: 1e9 }).get('NDVI')
    );
    const meanNdvi = safeNumber(meanRaw);

    const pixelArea = ee.Image.pixelArea();
    const lowMask = ndviMedian.lt(threshold);

    const lowAreaRaw = await eeEvaluatePromise(
        lowMask.multiply(pixelArea).reduceRegion({ reducer: ee.Reducer.sum(), geometry: geom, scale: 10, maxPixels: 1e9 }).get('NDVI')
    );
    const totalAreaRaw = await eeEvaluatePromise(
        pixelArea.reduceRegion({ reducer: ee.Reducer.sum(), geometry: geom, scale: 10, maxPixels: 1e9 }).get('area')
    );

    const lowArea = safeNumber(lowAreaRaw) || 0;
    const totalArea = safeNumber(totalAreaRaw) || 0;
    const lowPercent = totalArea > 0 ? Number(((100 * lowArea) / totalArea).toFixed(2)) : 0;

    // PRIORITY 1: Try real EE sampling first
    let heatmap_points = [];
    try {
        heatmap_points = await sampleNdviHeatmapPoints(geom, ndviMedian, 300);
        if (heatmap_points.length > 10) {
            console.log(`✅ Generated ${heatmap_points.length} accurate EE heatmap points`);
        } else {
            console.warn('EE sampling returned too few points, using fallback');
            // Fallback to client-side sampling
            const basePoints = generatePointsInPolygonGeoJSON(polygonFeature, 300);
            heatmap_points = basePoints.map(p => {
                const intensity = Math.max(0.1, Math.min(1.0, (meanNdvi || 0.5 + 0.2) / 1.1));
                return [p[0], p[1], Number(intensity.toFixed(3))];
            });
        }
    } catch (ex) {
        console.warn('EE heatmap failed, using approximate fallback:', ex.message);
        const basePoints = generatePointsInPolygonGeoJSON(polygonFeature, 300);
        heatmap_points = basePoints.map(p => {
            const intensity = Math.max(0.1, Math.min(1.0, (meanNdvi || 0.5 + 0.2) / 1.1));
            return [p[0], p[1], Number(intensity.toFixed(3))];
        });
    }

    return {
        available: true,
        meanNdvi,
        lowPercent,
        imageCount,
        cloudWarning: usedFallbackNoCloudFilter,
        areaSqm: totalArea,
        heatmap_points
    };
}

// ----------------- /ndvi route -----------------
router.post('/ndvi', async (req, res) => {
    try {
        const body = req.body || {};
        const polygon = body.polygon;
        if (!polygon) return res.status(400).json({ success: false, error: 'Missing polygon in request body' });
        if (!polygon.geometry || !polygon.geometry.type || !polygon.geometry.coordinates) {
            return res.status(400).json({ success: false, error: 'Invalid polygon geometry structure', expected: 'GeoJSON Feature with Polygon geometry', received: polygon });
        }

        const threshold = (typeof body.threshold === 'number') ? body.threshold : DEFAULT_LOW_NDVI_THRESHOLD;
        const startDateStr = body.start_date || null;
        const endDateStr = body.end_date || null;

        const stats = await computeNdviStatsAndHeat(polygon, { threshold, startDate: startDateStr, endDate: endDateStr });
        if (!stats.available) {
            return res.status(404).json({ success: false, error: stats.message });
        }

        let recommendation = 'No data available.';
        if (stats.meanNdvi === null) recommendation = 'No valid NDVI data found. Try different date range or larger area.';
        else if (stats.meanNdvi < 0.2) recommendation = `🚨 CRITICAL: Very poor crop health (NDVI ${stats.meanNdvi.toFixed(2)}). Immediate action needed - check irrigation, pests, or soil issues.`;
        else if (stats.meanNdvi < 0.4) recommendation = `⚠️ Poor crop health (NDVI ${stats.meanNdvi.toFixed(2)}). ${stats.lowPercent}% area stressed. Check water supply and apply fertilizer.`;
        else if (stats.meanNdvi < 0.6) recommendation = `📈 Fair crop health (NDVI ${stats.meanNdvi.toFixed(2)}). Monitor closely, especially ${stats.lowPercent}% low NDVI areas.`;
        else recommendation = `✅ Good crop health (NDVI ${stats.meanNdvi.toFixed(2)}). Continue current practices and regular monitoring.`;

        res.json({
            success: true,
            vis_params: { min: -0.2, max: 0.9, palette: ['#d73027', '#f46d43', '#fdae61', '#fee08b', '#d9ef8b', '#a6d96a', '#66bd63', '#1a9850'] },
            mean_ndvi: stats.meanNdvi,
            low_ndvi_percent: stats.lowPercent,
            recommendation,
            image_count: stats.imageCount,
            area_ha: stats.areaSqm > 0 ? (stats.areaSqm / 10000).toFixed(2) : null,
            cloud_warning: stats.cloudWarning || false,
            heatmap_points: stats.heatmap_points,
            processed_at: new Date().toISOString()
        });

    } catch (err) {
        res.status(500).json({ success: false, error: 'NDVI processing failed', details: err && err.stack ? err.stack : String(err) });
    }
});

// ----------------- centroid helper -----------------
function computeCentroidFromGeoJSON(feature) {
    try {
        const geom = feature.type === 'Feature' ? feature.geometry : (feature.geometry || feature);
        const coords = (geom.type === 'Polygon') ? geom.coordinates[0] : (geom.type === 'MultiPolygon' ? geom.coordinates[0][0] : []);
        if (!coords || coords.length === 0) return null;
        let sumX = 0, sumY = 0;
        coords.forEach(([lng, lat]) => { sumX += lng; sumY += lat; });
        return { lon: sumX / coords.length, lat: sumY / coords.length };
    } catch (ex) {
        return null;
    }
}

// ----------------- enrichment (minimal wrappers) -----------------
async function fetchClimateData(lat, lon) {
    try {
        const base = process.env.NASA_POWER_BASE || 'https://power.larc.nasa.gov';
        const params = [
            'parameters=PRECTOT_TOT,T2M',
            'community=AG',
            `longitude=${lon}`,
            `latitude=${lat}`,
            'format=JSON'
        ].join('&');
        const url = `${base}/api/temporal/climatology/point?${params}`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`NASA POWER fetch failed ${resp.status}`);
        const json = await resp.json();
        return { raw: json };
    } catch (ex) {
        return null;
    }
}

async function fetchSoilData(lat, lon) {
    try {
        const base = process.env.SOILGRIDS_BASE || 'https://rest.soilgrids.org';
        const url = `${base}/soilgrids/v2.0/properties/query?lon=${lon}&lat=${lat}`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`SoilGrids fetch failed ${resp.status}`);
        const json = await resp.json();
        return { raw: json };
    } catch (ex) {
        return null;
    }
}

// ----------------- UPDATED Gemini call with SOIL NUTRIENTS -----------------
async function callGeminiRecommend(facts) {
    const key = process.env.GOOGLE_API_KEY;
    if (!key) throw new Error('Missing GOOGLE_API_KEY');
    const url = `https://generativelanguage.googleapis.com/v1beta2/models/gemini-2.5-flash:generateText?key=${encodeURIComponent(key)}`;

    const system = `You are an expert agronomist. Given precise site facts (centroid lat/lon, mean NDVI, recent rainfall/temperature summaries, soil info), produce a JSON object containing up to 6 recommended crops for the next major season. 

EACH recommendation must include:
- crop (string)
- rank (1 = best)
- suitability_score (int 0-100) 
- reason (1-2 sentences)
- soil_requirements (ph_min, ph_max, texture)
- soil_nutrients (N: nitrogen status "low/medium/high", P: phosphorus "low/medium/high", K: potassium "low/medium/high", organic_matter "low/medium/high")
- water_requirement ('rainfed'|'irrigated'|'mixed')
- planting_window (start_month, end_month)
- action (short practical tip)
- confidence (0-1)

ANALYZE soil data carefully: if soil data available, provide SPECIFIC nutrient recommendations (N/P/K/OM status). Base nutrient status on soil test data or typical values for location/soil type.

Return JSON only (no extra text).`;

    const user = `Site facts:\n${JSON.stringify(facts, null, 2)}\n\nReturn JSON exactly using the schema described.`;
    const body = { prompt: system + '\n\n' + user, temperature: 0.1, maxOutputTokens: 1200 };

    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!resp.ok) {
        const txt = await resp.text().catch(() => null);
        throw new Error(`Gemini API error ${resp.status}: ${txt || resp.statusText}`);
    }

    const json = await resp.json();

    let text = null;
    if (json?.candidates && json.candidates.length > 0 && json.candidates[0].content) {
        text = json.candidates[0].content;
    } else if (json?.output?.content) {
        text = Array.isArray(json.output.content) ? json.output.content.map(c => c.text || c).join('') : (json.output.content.text || JSON.stringify(json.output.content));
    } else {
        text = JSON.stringify(json);
    }

    try {
        const s = text.indexOf('{') >= 0 && text.lastIndexOf('}') > text.indexOf('{') ? text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1) : text;
        return JSON.parse(s);
    } catch (ex) {
        throw new Error('Failed to parse Gemini output as JSON: ' + (ex.message || ex) + ' -- raw:' + (text ? text.slice(0, 1000) : '[empty]'));
    }
}
// ----------------- Fertilizer Dose Helper (ADDED) -----------------
function calculateFertilizerDose(soilNutrients, areaHa) {
    const area = Number(areaHa) > 0 ? Number(areaHa) : 1;

    const base = {
        low: { N: 120, P: 60, K: 40 },
        medium: { N: 90, P: 45, K: 30 },
        high: { N: 60, P: 30, K: 20 }
    };

    const nLevel = soilNutrients?.N || 'medium';
    const pLevel = soilNutrients?.P || 'medium';
    const kLevel = soilNutrients?.K || 'medium';

    return {
        unit: 'kg/ha',
        N: Math.round((base[nLevel]?.N || 90) * area),
        P2O5: Math.round((base[pLevel]?.P || 45) * area),
        K2O: Math.round((base[kLevel]?.K || 30) * area),
        recommendation:
            `Apply ${Math.round((base[nLevel]?.N || 90))} kg N, ` +
            `${Math.round((base[pLevel]?.P || 45))} kg P₂O₅, ` +
            `${Math.round((base[kLevel]?.K || 30))} kg K₂O per hectare`
    };
}

// ----------------- /recommend-crops route -----------------
router.post('/recommend-crops', async (req, res) => {
    try {
        const body = req.body || {};
        if (!body.polygon && !(body.centroid && body.centroid.lat && body.centroid.lon)) {
            return res.status(400).json({ success: false, error: 'Missing polygon or centroid in request body' });
        }

        await initEarthEngine();

        let centroid = body.centroid;
        if (!centroid && body.polygon) centroid = computeCentroidFromGeoJSON(body.polygon);
        if (!centroid) return res.status(400).json({ success: false, error: 'Unable to compute centroid' });

        let ndviStats = null;
        try {
            ndviStats = await computeNdviStatsAndHeat(body.polygon, { threshold: DEFAULT_LOW_NDVI_THRESHOLD });
            if (!ndviStats.available) ndviStats = { available: false };
        } catch (ex) {
            ndviStats = { available: false };
        }

        let climate = null, soil = null;
        try {
            [climate, soil] = await Promise.all([
                fetchClimateData(centroid.lat, centroid.lon).catch(() => null),
                fetchSoilData(centroid.lat, centroid.lon).catch(() => null)
            ]);
        } catch (ex) {
            climate = null; soil = null;
        }

        const facts = {
            centroid,
            mean_ndvi: ndviStats.available ? ndviStats.meanNdvi : (body.mean_ndvi ?? null),
            ndvi_low_percent: ndviStats.available ? ndviStats.lowPercent : null,
            image_count: ndviStats.available ? ndviStats.imageCount : null,
            area_ha: ndviStats.available && ndviStats.areaSqm ? Number((ndviStats.areaSqm / 10000).toFixed(2)) : null,
            climate,
            soil,
            user_soil_input: body.soil || null,
            water_availability: body.water_availability || null
        };

        let aiOut = null;
        try {
            aiOut = await callGeminiRecommend(facts);
            if (!aiOut || !aiOut.recommendations || !Array.isArray(aiOut.recommendations)) throw new Error('AI returned unexpected schema');
            aiOut.recommendations = aiOut.recommendations.slice(0, 6).map((r, idx) => {
                return {
                    crop: r.crop || `Unknown-${idx + 1}`,
                    rank: Number.isFinite(r.rank) ? r.rank : (idx + 1),
                    suitability_score: Math.min(100, Math.max(0, parseInt(r.suitability_score || 0))),
                    reason: r.reason || '',
                    soil_requirements: r.soil_requirements || { ph_min: null, ph_max: null, texture: null },
                    soil_nutrients: r.soil_nutrients || { N: 'medium', P: 'medium', K: 'medium', organic_matter: 'medium' },
                    water_requirement: r.water_requirement || 'rainfed',
                    planting_window: r.planting_window || { start_month: null, end_month: null },
                    action: r.action || '',
                    confidence: typeof r.confidence === 'number' ? Math.max(0, Math.min(1, r.confidence)) : (r.confidence ? Number(r.confidence) : 0.5),

                    // -------- ADDED (fertilizer calculation) --------
                    fertilizer_dose: calculateFertilizerDose(
                        r.soil_nutrients,
                        facts.area_ha
                    )
                };
            });
        } catch (ex) {
            const mean = facts.mean_ndvi;
            const fallback = [];
            if (mean === null || mean === undefined) {
                fallback.push({
                    crop: 'Sorghum', rank: 1, suitability_score: 60,
                    reason: 'Conservative drought-tolerant option (no NDVI available)',
                    soil_requirements: { ph_min: 5.0, ph_max: 8.5, texture: 'loam' },
                    soil_nutrients: { N: 'low', P: 'medium', K: 'medium', organic_matter: 'medium' },
                    water_requirement: 'rainfed',
                    planting_window: { start_month: 'June', end_month: 'July' },
                    action: 'Use drought-tolerant variety',
                    confidence: 0.45,

                    // -------- ADDED --------
                    fertilizer_dose: calculateFertilizerDose(
                        { N: 'low', P: 'medium', K: 'medium' },
                        facts.area_ha
                    )
                });
            } else if (mean < 0.3) {
                fallback.push({
                    crop: 'Pearl millet', rank: 1, suitability_score: 70,
                    reason: `Low NDVI (${mean.toFixed(2)}). Recommend drought-tolerant cereals.`,
                    soil_requirements: { ph_min: 5.0, ph_max: 8.5, texture: 'sandy-loam' },
                    soil_nutrients: { N: 'low', P: 'low', K: 'medium', organic_matter: 'low' },
                    water_requirement: 'rainfed',
                    planting_window: { start_month: 'June', end_month: 'August' },
                    action: 'Low input, wide spacing',
                    confidence: 0.55,

                    // -------- ADDED --------
                    fertilizer_dose: calculateFertilizerDose(
                        { N: 'low', P: 'low', K: 'medium' },
                        facts.area_ha
                    )
                });
            } else if (mean < 0.5) {
                fallback.push({
                    crop: 'Groundnut', rank: 1, suitability_score: 72,
                    reason: `Moderate NDVI (${mean.toFixed(2)}). Legumes may improve soil and yield.`,
                    soil_requirements: { ph_min: 5.5, ph_max: 7.5, texture: 'loam' },
                    soil_nutrients: { N: 'medium', P: 'low', K: 'medium', organic_matter: 'medium' },
                    water_requirement: 'rainfed',
                    planting_window: { start_month: 'June', end_month: 'July' },
                    action: 'Apply P fertilizer at sowing',
                    confidence: 0.6,

                    // -------- ADDED --------
                    fertilizer_dose: calculateFertilizerDose(
                        { N: 'medium', P: 'low', K: 'medium' },
                        facts.area_ha
                    )
                });
            } else {
                fallback.push({
                    crop: 'Maize', rank: 1, suitability_score: 85,
                    reason: `Good NDVI (${mean.toFixed(2)}). High biomass supports cereals.`,
                    soil_requirements: { ph_min: 5.5, ph_max: 7.5, texture: 'loam' },
                    soil_nutrients: { N: 'high', P: 'medium', K: 'high', organic_matter: 'high' },
                    water_requirement: 'irrigated',
                    planting_window: { start_month: 'June', end_month: 'July' },
                    action: 'Apply N at planting 60 kg/ha',
                    confidence: 0.8,

                    // -------- ADDED --------
                    fertilizer_dose: calculateFertilizerDose(
                        { N: 'high', P: 'medium', K: 'high' },
                        facts.area_ha
                    )
                });
            }
            return res.json({
                success: true,
                recommendations: fallback,
                notes: 'Fallback recommendations used due to AI/enrichment failure.',
                source_data: { climate: !!climate, soil: !!soil, ai: false },
                generated_at: new Date().toISOString()
            });
        }

        return res.json({
            success: true,
            recommendations: aiOut.recommendations,
            notes: aiOut.notes || null,
            source_data: { climate: !!climate, soil: !!soil, ai: 'gemini-2.5-flash' },
            generated_at: new Date().toISOString()
        });

    } catch (err) {
        res.status(500).json({ success: false, error: 'Recommendation processing failed', details: err && err.stack ? err.stack : String(err) });
    }
});

router.get('/', (req, res) => {
    res.json({ success: true, message: 'Satellite Insights API - POST /ndvi and POST /recommend-crops' });
});

module.exports = router;
