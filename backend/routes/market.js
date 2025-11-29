const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const auth = require('../middleware/auth');
const axios = require('axios');

// -------------------------
// Gemini Initialization
// -------------------------
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// -------------------------
// Government API Resources
// (Agmarknet-style datasets)
// -------------------------
const GOV_APIS = {
    primary: 'https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070',
    secondary: 'https://api.data.gov.in/resource/35985678-0d79-46b4-9f84-2f8d2c38c0c5'
};

// -------------------------
// Helper: Normalize raw gov record
// into our internal structure
// -------------------------
function normalizeRecord(item) {
    const commodity = item.commodity || item.Commodity || 'Unknown';
    const state = item.state || item.State || '';
    const district = item.district || item.District || 'Unknown';
    const market = item.market || item.Market || 'Local Market';

    const minPrice = parseFloat(item.min_price || item.Min_Price || 0) || 0;
    const maxPrice = parseFloat(item.max_price || item.Max_Price || 0) || 0;
    const modalPrice = parseFloat(item.modal_price || item.Modal_Price || 0) || 0;

    const arrivalDate =
        item.arrival_date ||
        item.Arrival_Date ||
        new Date().toISOString().split('T')[0];

    return {
        commodity,
        market,
        state: state || 'Kerala',
        district,
        min_price: minPrice,
        max_price: maxPrice || minPrice || modalPrice,
        modal_price: modalPrice || minPrice || maxPrice,
        arrival_date: arrivalDate
        // no category, no veg/fruit limits – ANY commodity from Kerala
    };
}

// -------------------------
// Helper: Calculate stats
// -------------------------
function calculateStats(records) {
    if (!records.length) {
        return {
            totalCommodities: 0,
            totalMarkets: 0,
            avgModalPrice: 0,
            priceChange: 0 // keep 0 for now; real change needs historic store
        };
    }

    const valid = records.filter(r => r.modal_price > 0);
    const totalCommodities = valid.length;
    const totalMarkets = [...new Set(valid.map(r => r.market))].length;
    const avg = (
        valid.reduce((sum, r) => sum + r.modal_price, 0) / totalCommodities
    ).toFixed(1);

    return {
        totalCommodities,
        totalMarkets,
        avgModalPrice: parseFloat(avg),
        priceChange: 0 // placeholder, but NOT random or fake
    };
}

// -------------------------
// Core: Load Kerala market data
// from Gov APIs. NO local fallback.
// If both fail, we throw.
// -------------------------
async function loadKeralaMarketData(limit) {
    const apiKey = process.env.GOV_API_KEY;
    if (!apiKey) {
        throw new Error('GOV_API_KEY not configured');
    }

    const finalLimit = limit && Number.isFinite(Number(limit)) && Number(limit) > 0
        ? Number(limit)
        : 5000; // practically "unlimited" for SIH use

    let records = [];

    // Helper to call a particular dataset
    const fetchDataset = async (url) => {
        const res = await axios.get(url, {
            params: {
                'api-key': apiKey,
                format: 'json',
                limit: finalLimit,
                offset: 0,
                'filters[state]': 'KERALA'
            },
            timeout: 15000
        });

        if (!res.data || !Array.isArray(res.data.records)) {
            return [];
        }

        return res.data.records
            .map(normalizeRecord)
            .filter(r => (r.state || '').toLowerCase() === 'kerala');
    };

    // Try primary dataset
    try {
        console.log('Fetching Kerala data from primary government API...');
        records = await fetchDataset(GOV_APIS.primary);
    } catch (err) {
        console.log('Primary gov API error:', err.message);
    }

    // If primary returned nothing, try secondary (still official data, NOT dummy)
    if (!records.length) {
        try {
            console.log('Primary empty. Fetching Kerala data from secondary government API...');
            records = await fetchDataset(GOV_APIS.secondary);
        } catch (err) {
            console.log('Secondary gov API error:', err.message);
        }
    }

    if (!records.length) {
        throw new Error('No Kerala records available from government APIs');
    }

    return records;
}

// -------------------------
// ROUTE: Live prices for Kerala
// GET /api/market/live-prices?limit=5000
// -------------------------
router.get('/live-prices', auth, async (req, res) => {
    try {
        const limit = req.query.limit ? Number(req.query.limit) : undefined;

        const records = await loadKeralaMarketData(limit);
        const stats = calculateStats(records);

        console.log(`✅ Returning ${records.length} Kerala records from gov APIs`);

        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            vegetables: records, // keep key name for frontend compatibility
            stats,
            source: 'government-api-kerala',
            totalRecords: records.length
        });
    } catch (error) {
        console.error('Live prices error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to load live Kerala market data from government APIs',
            error: error.message
        });
    }
});

// -------------------------
// ROUTE: Search within Kerala data
// GET /api/market/search/:term
// Uses the same gov data as live-prices
// -------------------------
router.get('/search/:term', auth, async (req, res) => {
    try {
        const searchTerm = (req.params.term || '').toLowerCase().trim();
        console.log(`Searching Kerala gov data for: "${searchTerm}"`);

        // For search, pull a big chunk and filter locally
        const records = await loadKeralaMarketData(5000);

        const filtered = records.filter(item => {
            if (!searchTerm) return true; // empty term returns all

            const commodity = (item.commodity || '').toLowerCase();
            const market = (item.market || '').toLowerCase();
            const district = (item.district || '').toLowerCase();

            return (
                commodity.includes(searchTerm) ||
                market.includes(searchTerm) ||
                district.includes(searchTerm)
            );
        });

        console.log(`Found ${filtered.length} matching records`);

        res.json({
            success: true,
            searchTerm,
            results: filtered,
            count: filtered.length,
            timestamp: new Date().toISOString(),
            source: 'government-api-kerala'
        });
    } catch (error) {
        console.error('Search error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Search failed on Kerala government data',
            error: error.message
        });
    }
});

// -------------------------
// ROUTE: AI recommendations
// POST /api/market/ai-recommendations
// body: { vegetable, currentPrice, minPrice, maxPrice, market, district, date, lang }
// lang: 'en' | 'ml'
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
            date,
            lang = 'en' // 'en' or 'ml' from your i18n toggle
        } = req.body;

        if (
            vegetable == null ||
            currentPrice == null ||
            minPrice == null ||
            maxPrice == null ||
            market == null
        ) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields for AI recommendations'
            });
        }

        console.log(
            `AI advisory for ${vegetable} at ₹${currentPrice} in ${market}, ${district || 'Kerala'} [lang=${lang}]`
        );

        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        const minVal = Number(minPrice);
        const maxVal = Number(maxPrice);
        const curVal = Number(currentPrice);

        let pricePosition = 50;
        if (maxVal > minVal) {
            pricePosition = ((curVal - minVal) / (maxVal - minVal)) * 100;
        }
        const pricePositionRounded = Number(pricePosition.toFixed(1));

        // Structured decision logic for frontend (Sell / Hold / Monitor)
        let decision = 'MONITOR';
        let actionLabel = 'MONITOR_MARKET';

        if (pricePositionRounded >= 70) {
            decision = 'SELL';
            actionLabel = 'SELL_TODAY';
        } else if (pricePositionRounded <= 30) {
            decision = 'HOLD';
            actionLabel = 'CONSIDER_HOLDING';
        }

        const trend =
            pricePositionRounded >= 70
                ? 'HIGH'
                : pricePositionRounded <= 30
                    ? 'LOW'
                    : 'MODERATE';

        const basePrompt = `
You are an expert agricultural market advisor for small and marginal farmers in Kerala.

MARKET DATA:
- Crop / Commodity: ${vegetable}
- Current Market Price: ₹${curVal} per unit
- Price Range Today: ₹${minVal} - ₹${maxVal}
- Price Position in Range: ${pricePositionRounded.toFixed(1)}%
- Market: ${market}${district ? `, District: ${district}` : ''}
- State: Kerala
- Date: ${date || 'Today'}

Give very practical guidance for the farmer:

1. IMMEDIATE DECISION: Should the farmer SELL today, HOLD for a few days, or AVOID SELLING if possible?
2. REASONING: Explain based on where today's price sits in the range and likely behaviour.
3. RISK: Mention risks like price fall, storage cost, spoilage, demand.
4. SIMPLE ACTION PLAN: For example, what part of the stock to sell now and what part to hold (if storage is available).
5. NEXT 2–3 DAYS: What should the farmer watch for (rain, arrivals, festival demand etc.)?

Use clear, farmer-friendly language. Keep it around 150–170 words.
`.trim();

        const languageInstruction =
            lang === 'ml'
                ? `
IMPORTANT:
Respond in simple Malayalam that a Kerala farmer can easily understand.
Avoid English words where possible, except for prices and market names.
Use short bullet points and small paragraphs.
`.trim()
                : `
IMPORTANT:
Respond in simple English that a Kerala farmer with basic education can follow.
Use short bullet points and small paragraphs.
`.trim();

        const prompt = `${basePrompt}\n\n${languageInstruction}`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        let aiAdvice = response.text();

        aiAdvice = aiAdvice
            .replace(/\*\*/g, '') // remove bold markers
            .replace(/\*/g, '•')  // standard bullet
            .replace(/\n{2,}/g, '\n')
            .trim();

        console.log('✅ AI advisory generated');

        res.json({
            success: true,
            recommendation: aiAdvice,
            decision: {
                label: decision,            // 'SELL' | 'HOLD' | 'MONITOR'
                actionLabel,                // 'SELL_TODAY' | 'CONSIDER_HOLDING' | 'MONITOR_MARKET'
                pricePosition: pricePositionRounded,
                trend                       // 'HIGH' | 'LOW' | 'MODERATE'
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('AI recommendations error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to generate AI recommendations',
            error: error.message
        });
    }
});

module.exports = router;
