const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const auth = require('../middleware/auth');
const axios = require('axios');

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// -------------------------
// Gemini Initialization
// -------------------------
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// -------------------------
// Government API Resources
// -------------------------
const GOV_APIS = {
    primary: 'https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070',
    secondary: 'https://api.data.gov.in/resource/35985678-0d79-46b4-9f84-2f8d2c38c0c5'
};

// -------------------------
// Normalize government record
// -------------------------
function normalizeRecord(item) {
    const commodity = item.commodity || item.Commodity || 'Unknown';
    const state = item.state || item.State || 'Unknown';
    const district = item.district || item.District || 'Unknown';
    const market = item.market || item.Market || 'Local Market';

    const minPrice = parseFloat(item.min_price || item.Min_Price || item.Min_x0020_Price || 0) || 0;
    const maxPrice = parseFloat(item.max_price || item.Max_Price || item.Max_x0020_Price || 0) || 0;
    const modalPrice = parseFloat(item.modal_price || item.Modal_Price || item.Modal_x0020_Price || 0) || 0;

    const arrivalDate =
        item.arrival_date ||
        item.Arrival_Date ||
        new Date().toISOString().split('T')[0];

    return {
        commodity,
        market,
        state,
        district,
        min_price: minPrice,
        max_price: maxPrice || minPrice || modalPrice,
        modal_price: modalPrice || minPrice || maxPrice,
        arrival_date: arrivalDate
    };
}

// -------------------------
// Stats calculator
// -------------------------
function calculateStats(records) {
    const valid = records.filter(r => r.modal_price > 0);
    if (!valid.length) {
        return {
            totalCommodities: 0,
            totalMarkets: 0,
            avgModalPrice: 0,
            priceChange: 0
        };
    }

    const avg =
        valid.reduce((sum, r) => sum + r.modal_price, 0) / valid.length;

    return {
        totalCommodities: valid.length,
        totalMarkets: [...new Set(valid.map(r => r.market))].length,
        avgModalPrice: Number(avg.toFixed(1)),
        priceChange: 0
    };
}

// -------------------------
// CSV Helpers
// -------------------------
const CSV_PATH = path.join(__dirname, '../data/PRICE.csv');

function findField(row, candidates) {
    for (const c of candidates) {
        if (row[c] !== undefined) return row[c];
    }
    const keys = Object.keys(row);
    for (const k of keys) {
        for (const c of candidates) {
            if (k.toLowerCase().includes(c.toLowerCase())) return row[k];
        }
    }
    return undefined;
}

// -------------------------
// CSV Loader (ALL STATES)
// -------------------------
async function loadFromCSV({ state, district } = {}) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(CSV_PATH)) {
            return reject(new Error('CSV fallback not found'));
        }

        const results = [];
        fs.createReadStream(CSV_PATH)
            .pipe(csv())
            .on('data', row => {
                try {
                    const rowState = String(findField(row, ['State', 'state']) || '').trim();
                    const rowDistrict = String(findField(row, ['District', 'district']) || '').trim();

                    if (state && rowState.toLowerCase() !== state.toLowerCase()) return;
                    if (district && rowDistrict.toLowerCase() !== district.toLowerCase()) return;

                    const commodity = findField(row, ['Commodity', 'commodity']) || '';
                    const market = findField(row, ['Market', 'market']) || '';

                    const min_price = Number(findField(row, ['Min_Price', 'Min_x0020_Price']) || 0);
                    const max_price = Number(findField(row, ['Max_Price', 'Max_x0020_Price']) || 0);
                    const modal_price = Number(findField(row, ['Modal_Price', 'Modal_x0020_Price']) || 0);

                    results.push({
                        commodity,
                        market,
                        state: rowState,
                        district: rowDistrict,
                        min_price,
                        max_price: max_price || min_price || modal_price,
                        modal_price: modal_price || min_price || max_price,
                        arrival_date: findField(row, ['Arrival_Date']) || ''
                    });
                } catch { }
            })
            .on('end', () => resolve(results))
            .on('error', reject);
    });
}

// -------------------------
// Core Loader (Gov API + CSV)
// -------------------------
async function loadMarketData({ state, district, limit }) {
    const apiKey = process.env.GOV_API_KEY;
    const finalLimit = limit && Number(limit) > 0 ? Number(limit) : 5000;

    let records = [];

    const fetchDataset = async (url) => {
        if (!apiKey) return [];
        const params = {
            'api-key': apiKey,
            format: 'json',
            limit: finalLimit,
            offset: 0
        };
        if (state) params['filters[state]'] = state.toUpperCase();
        if (district) params['filters[district]'] = district;

        const res = await axios.get(url, { params, timeout: 15000 });
        if (!res.data || !Array.isArray(res.data.records)) return [];
        return res.data.records.map(normalizeRecord);
    };

    try { records = await fetchDataset(GOV_APIS.primary); } catch { }
    if (!records.length) {
        try { records = await fetchDataset(GOV_APIS.secondary); } catch { }
    }
    if (!records.length) {
        records = await loadFromCSV({ state, district });
    }
    if (!records.length) {
        throw new Error('No market data found');
    }
    return records;
}

// -------------------------
// ROUTE: Live Prices (ALL INDIA)
// -------------------------
router.get('/live-prices', auth, async (req, res) => {
    try {
        const { state, district, limit } = req.query;
        const records = await loadMarketData({ state, district, limit });
        const stats = calculateStats(records);

        res.json({
            success: true,
            filters: { state, district },
            vegetables: records,
            stats,
            totalRecords: records.length
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Failed to load market data',
            error: err.message
        });
    }
});

// -------------------------
// ROUTE: Search
// -------------------------
router.get('/search/:term', auth, async (req, res) => {
    try {
        const term = req.params.term.toLowerCase();
        const { state, district } = req.query;

        const records = await loadMarketData({ state, district, limit: 5000 });
        const filtered = records.filter(r =>
            r.commodity.toLowerCase().includes(term) ||
            r.market.toLowerCase().includes(term) ||
            r.district.toLowerCase().includes(term)
        );

        res.json({
            success: true,
            searchTerm: term,
            filters: { state, district },
            results: filtered,
            count: filtered.length
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Search failed',
            error: err.message
        });
    }
});

// -------------------------
// ROUTE: AI Recommendations (UNCHANGED LOGIC)
// -------------------------
router.post('/ai-recommendations', auth, async (req, res) => {
    try {
        const {
            vegetable,
            currentPrice,
            minPrice,
            maxPrice,
            market,
            district,
            state,
            date,
            lang = 'en'
        } = req.body;

        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        const prompt = `
You are an expert agricultural market advisor for Indian farmers.

LOCATION:
State: ${state || 'India'}
District: ${district || 'Unknown'}

Crop: ${vegetable}
Current Price: ₹${currentPrice}
Range: ₹${minPrice} - ₹${maxPrice}
Market: ${market}
Date: ${date || 'Today'}

Give practical SELL/HOLD/MONITOR advice.
`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();

        res.json({
            success: true,
            recommendation: text,
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'AI recommendation failed',
            error: err.message
        });
    }
});

module.exports = router;
