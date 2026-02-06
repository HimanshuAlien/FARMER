const express = require('express');
const router = express.Router();
const axios = require('axios');
const auth = require('../middleware/auth');
const Groq = require('groq-sdk');

// Groq client (FREE LLaMA 3.1)
const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY // set in .env
});

// ================= WEATHER ROUTE =================
router.get('/current/:location', auth, async (req, res) => {
    try {
        const { location } = req.params;
        console.log(`Getting weather for: ${location}`);

        let weatherData;

        try {
            // 1) Geocoding
            const geoResponse = await axios.get('https://geocoding-api.open-meteo.com/v1/search', {
                params: {
                    name: location,
                    count: 1,
                    language: 'en'
                },
                timeout: 5000
            });

            if (geoResponse.data.results && geoResponse.data.results.length > 0) {
                const coords = geoResponse.data.results[0];
                console.log(`Found coordinates: ${coords.latitude}, ${coords.longitude}`);

                // 2) Forecast from Open-Meteo
                const weatherResponse = await axios.get('https://api.open-meteo.com/v1/forecast', {
                    params: {
                        latitude: coords.latitude,
                        longitude: coords.longitude,
                        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,surface_pressure,wind_speed_10m',
                        daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum',
                        timezone: 'auto',
                        forecast_days: 5
                    },
                    timeout: 10000
                });

                const data = weatherResponse.data;

                weatherData = {
                    current: {
                        temp: Math.round(data.current.temperature_2m),
                        humidity: data.current.relative_humidity_2m,
                        pressure: Math.round(data.current.surface_pressure),
                        wind_speed: Math.round(data.current.wind_speed_10m * 3.6),
                        feels_like: Math.round(data.current.apparent_temperature),
                        weather_code: data.current.weather_code,
                        visibility: 10
                    },
                    location: {
                        name: coords.name,
                        country: coords.country,
                        lat: coords.latitude,
                        lon: coords.longitude
                    },
                    forecast: {
                        time: data.daily.time,
                        weather_code: data.daily.weather_code,
                        temperature_2m_max: data.daily.temperature_2m_max,
                        temperature_2m_min: data.daily.temperature_2m_min,
                        precipitation_sum: data.daily.precipitation_sum
                    }
                };

                console.log('Real weather data loaded successfully');
            } else {
                throw new Error('Location not found');
            }

        } catch (apiError) {
            console.log('Primary API failed, trying LIVE fallback for Kochi, Kerala:', apiError.message);

            // 🔁 NEW: LIVE fallback for Kochi, Kerala (no static mock data)
            try {
                const fallbackLat = 9.9312;
                const fallbackLon = 76.2673;

                const weatherResponse = await axios.get('https://api.open-meteo.com/v1/forecast', {
                    params: {
                        latitude: fallbackLat,
                        longitude: fallbackLon,
                        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,surface_pressure,wind_speed_10m',
                        daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum',
                        timezone: 'auto',
                        forecast_days: 5
                    },
                    timeout: 10000
                });

                const data = weatherResponse.data;

                weatherData = {
                    current: {
                        temp: Math.round(data.current.temperature_2m),
                        humidity: data.current.relative_humidity_2m,
                        pressure: Math.round(data.current.surface_pressure),
                        wind_speed: Math.round(data.current.wind_speed_10m * 3.6),
                        feels_like: Math.round(data.current.apparent_temperature),
                        weather_code: data.current.weather_code,
                        visibility: 10
                    },
                    location: {
                        name: 'Kochi',
                        country: 'India',
                        lat: fallbackLat,
                        lon: fallbackLon
                    },
                    forecast: {
                        time: data.daily.time,
                        weather_code: data.daily.weather_code,
                        temperature_2m_max: data.daily.temperature_2m_max,
                        temperature_2m_min: data.daily.temperature_2m_min,
                        precipitation_sum: data.daily.precipitation_sum
                    }
                };

                console.log('Fallback LIVE weather for Kochi loaded successfully');
            } catch (fallbackError) {
                console.log('Fallback LIVE weather for Kochi also failed:', fallbackError.message);
                throw fallbackError; // let outer catch handle & return 500
            }
        }

        // Alerts + local advice
        weatherData.alerts = generateWeatherAlerts(weatherData.current);
        weatherData.farmingAdvice = generateFarmingAdvice(weatherData.current);

        console.log('Sending weather data:', JSON.stringify(weatherData, null, 2));
        res.json(weatherData);

    } catch (error) {
        console.error('Weather route error:', error);
        res.status(500).json({
            message: 'Failed to get weather data',
            error: error.message
        });
    }
});
// ====== MARKERS (Mongo) ======
const Marker = require('../models/Marker'); // adjust path if needed

// Get all markers
router.get('/pointers', auth, async (req, res) => {
    try {
        // optional: ?mine=true to return only user's markers
        const q = {};
        if (req.query.mine === 'true' && req.user && req.user.id) q.createdBy = req.user.id;
        const markers = await Marker.find(q).lean().exec();
        res.json({ markers });
    } catch (err) {
        console.error('Get pointers error', err);
        res.status(500).json({ message: 'Failed to load pointers', error: err.message });
    }
});

// Create pointer
router.post('/pointers', auth, async (req, res) => {
    try {
        const { lat, lon, title = '', description = '', meta = {} } = req.body;
        if (typeof lat !== 'number' || typeof lon !== 'number') {
            return res.status(400).json({ message: 'lat and lon required as numbers' });
        }
        const marker = new Marker({
            lat, lon, title, description, meta,
            createdBy: req.user?.id || undefined
        });
        await marker.save();
        res.status(201).json({ marker });
    } catch (err) {
        console.error('Create pointer error', err);
        res.status(500).json({ message: 'Failed to save pointer', error: err.message });
    }
});

// Delete pointer
router.delete('/pointers/:id', auth, async (req, res) => {
    try {
        const id = req.params.id;
        const marker = await Marker.findById(id).exec();
        if (!marker) return res.status(404).json({ message: 'Pointer not found' });

        // optional ownership check:
        if (marker.createdBy && req.user && req.user.id && marker.createdBy.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Not allowed to delete this pointer' });
        }

        await Marker.findByIdAndDelete(id).exec();
        res.json({ message: 'Pointer deleted', id });
    } catch (err) {
        console.error('Delete pointer error', err);
        res.status(500).json({ message: 'Failed to delete pointer', error: err.message });
    }
});

// ================= ALERTS (RULE-BASED) =================
function generateWeatherAlerts(current) {
    const alerts = [];

    if (current.temp > 35) {
        alerts.push({
            type: 'heat_wave',
            severity: 'high',
            title: '🌡️ High Temperature Alert',
            message: `Very high temperature (${current.temp}°C). Increase irrigation and provide shade for crops.`,
            icon: '🔥',
            color: '#ef4444'
        });
    }

    if (current.temp < 15) {
        alerts.push({
            type: 'cold',
            severity: 'medium',
            title: '❄️ Cool Weather Alert',
            message: `Cool temperature (${current.temp}°C). Protect sensitive plants from cold.`,
            icon: '🧊',
            color: '#3b82f6'
        });
    }

    if (current.wind_speed > 40) {
        alerts.push({
            type: 'wind',
            severity: 'medium',
            title: '💨 Strong Wind Alert',
            message: `High wind speeds (${current.wind_speed} km/h). Secure equipment and structures.`,
            icon: '🌪️',
            color: '#f59e0b'
        });
    }

    if (current.humidity > 85) {
        alerts.push({
            type: 'humidity',
            severity: 'medium',
            title: '💧 High Humidity Alert',
            message: `High humidity (${current.humidity}%). Monitor crops for fungal diseases.`,
            icon: '💦',
            color: '#06b6d4'
        });
    }

    if (alerts.length === 0) {
        alerts.push({
            type: 'normal',
            severity: 'low',
            title: '✅ Weather Normal',
            message: 'Current weather conditions are favorable for farming activities.',
            icon: '🌤️',
            color: '#10b981'
        });
    }

    return alerts;
}

// ================= FARMING ADVICE (RULE ENGINE) =================
function generateFarmingAdvice(current) {
    const temp = current.temp;
    const humidity = current.humidity;
    const windSpeed = current.wind_speed;

    return {
        today: getTodayAdvice(temp, humidity, windSpeed, current.weather_code),
        upcoming: getUpcomingAdvice(temp, current.weather_code),
        general: getGeneralAdvice(),
        seasonal: getSeasonalAdvice()
    };
}

function getTodayAdvice(temp, humidity, windSpeed, weatherCode) {
    const advice = [];

    if (temp > 35) {
        advice.push({
            icon: '🌡️',
            title: 'Extreme Heat Protection',
            description: 'Use shade nets, water early morning and late evening, and add mulching to keep soil moisture.',
            priority: 'high',
            action: 'Immediate',
            crops: 'Tomato, Pepper, Leafy vegetables',
            timeframe: 'Today'
        });
    } else if (temp > 30) {
        advice.push({
            icon: '💧',
            title: 'Increase Irrigation Frequency',
            description: 'Water crops twice daily and check drip lines so plants don’t dry out.',
            priority: 'medium',
            action: 'Today',
            crops: 'All crops',
            timeframe: '2–3 times daily'
        });
    }

    if (temp < 15) {
        advice.push({
            icon: '🌱',
            title: 'Cold Protection Measures',
            description: 'Cover seedlings, reduce irrigation, and harvest sensitive vegetables early.',
            priority: 'high',
            action: 'Before sunset',
            crops: 'Seedlings, Vegetables',
            timeframe: 'Tonight'
        });
    }

    if (humidity > 85) {
        advice.push({
            icon: '🍄',
            title: 'Fungal Disease Prevention',
            description: 'Avoid wetting leaves, improve air flow, and monitor for leaf spots and rotting.',
            priority: 'medium',
            action: 'Morning',
            crops: 'Tomato, Potato, Grapes',
            timeframe: 'Before 10 AM'
        });
    }

    if (humidity < 40) {
        advice.push({
            icon: '🌿',
            title: 'Dry Air Effects',
            description: 'Increase watering and watch for wilting or leaf curl.',
            priority: 'medium',
            action: 'Monitor closely',
            crops: 'All sensitive crops',
            timeframe: 'Throughout day'
        });
    }

    if (windSpeed > 30) {
        advice.push({
            icon: '🌪️',
            title: 'Wind Damage Prevention',
            description: 'Support tall crops, secure nets and covers, and avoid spraying chemicals.',
            priority: 'high',
            action: 'Immediate',
            crops: 'Banana, Coconut, Tall vegetables',
            timeframe: 'Before evening'
        });
    }

    if (weatherCode >= 61 && weatherCode <= 65) {
        advice.push({
            icon: '☔',
            title: 'Rainy Day Management',
            description: 'Check drainage, postpone fertilizer, and keep harvested produce covered.',
            priority: 'high',
            action: 'Before rain intensifies',
            crops: 'All field crops',
            timeframe: 'Next 2–4 hours'
        });
    }

    advice.push({
        icon: '📊',
        title: 'Daily Monitoring',
        description: 'Check soil moisture and look for early pest/disease signs twice a day.',
        priority: 'low',
        action: 'Routine',
        crops: 'All crops',
        timeframe: 'Morning & Evening'
    });

    return advice;
}

function getUpcomingAdvice(currentTemp, weatherCode) {
    const advice = [];

    advice.push({
        icon: '📅',
        title: 'Week Ahead Planning',
        description: 'Plan sowing or transplanting according to expected rain and field condition.',
        priority: 'medium',
        action: 'This week',
        crops: 'Rice, Sugarcane, Cotton',
        timeframe: 'Next 7 days'
    });

    advice.push({
        icon: '🌾',
        title: 'Harvest Planning',
        description: 'Arrange labour and storage in advance if crops are nearing maturity.',
        priority: 'medium',
        action: 'Plan ahead',
        crops: 'Mature crops',
        timeframe: '2–3 weeks'
    });

    if (currentTemp > 30) {
        advice.push({
            icon: '🌡️',
            title: 'Heat Preparation',
            description: 'Plan shade, extra water storage and consider more heat-tolerant varieties.',
            priority: 'medium',
            action: 'Next month',
            crops: 'All crops',
            timeframe: 'Next month'
        });
    }

    return advice;
}

function getGeneralAdvice() {
    return [
        {
            icon: '📱',
            title: 'Smart Weather Monitoring',
            description: 'Use simple apps and rain gauge; note daily conditions in a farm diary.',
            priority: 'medium',
            action: 'Setup once',
            crops: 'All operations',
            timeframe: 'Ongoing'
        }
    ];
}

function getSeasonalAdvice() {
    return [
        {
            icon: '🌧️',
            title: 'Monsoon Preparation',
            description: 'Clean drains, strengthen bunds and prepare fungicides for common diseases.',
            priority: 'high',
            action: 'Before heavy rains',
            crops: 'Rice and vegetables',
            timeframe: 'Pre-monsoon'
        }
    ];
}

// ================= SIMPLE ALERTS TOGGLE =================
router.post('/alerts/toggle', auth, (req, res) => {
    const { enabled } = req.body;
    res.json({
        message: enabled ? 'Alerts enabled' : 'Alerts disabled',
        enabled
    });
});

// ================== AI FARM ADVICE (FREE — GROQ LLaMA) ==================
router.post('/ai/farm-advice', auth, async (req, res) => {
    try {
        const { lat, lon, question } = req.body || {};
        console.log('AI farm advice request:', { lat, lon, question });

        if (typeof lat !== 'number' || typeof lon !== 'number') {
            return res.status(400).json({
                message: 'lat and lon are required as numbers'
            });
        }

        // 1) Live weather for that exact point
        const weatherResponse = await axios.get('https://api.open-meteo.com/v1/forecast', {
            params: {
                latitude: lat,
                longitude: lon,
                current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,surface_pressure,wind_speed_10m',
                timezone: 'auto',
                forecast_days: 1
            },
            timeout: 8000
        });

        const data = weatherResponse.data;
        const current = {
            temp: Math.round(data.current.temperature_2m),
            humidity: data.current.relative_humidity_2m,
            pressure: Math.round(data.current.surface_pressure),
            wind_speed: Math.round(data.current.wind_speed_10m * 3.6),
            feels_like: Math.round(data.current.apparent_temperature),
            weather_code: data.current.weather_code,
            visibility: 10
        };

        const farmingAdvice = generateFarmingAdvice(current);
        const farmerQuestion = question?.trim() || 'What should I do on my farm today?';

        const prompt = `
You are KrishiMitr, an agriculture support AI for small farmers in Kerala.

Weather at farm:
• Temperature: ${current.temp}°C (feels like ${current.feels_like}°C)
• Humidity: ${current.humidity}%
• Wind: ${current.wind_speed} km/h
• Pressure: ${current.pressure} hPa
• Weather code: ${current.weather_code}

Farmer asked:
"${farmerQuestion}"

Answer rules:
- Answer directly, no greeting.
- 1 short sentence describing how the weather will feel today.
- Then give 3–4 bullet points with clear steps the farmer should take today.
- Very simple English (farmer level).
- No technical names, no long theories.
- Max 110 words.
        `.trim();

        const completion = await groq.chat.completions.create({
            model: 'llama-3.1-8b-instant',   // ✅ current supported model
            messages: [
                { role: 'user', content: prompt }
            ]
        });

        const answer = completion.choices[0]?.message?.content ||
            'Sorry, I could not generate advice right now.';

        res.json({
            answer,
            current,
            advice: farmingAdvice
        });
    } catch (error) {
        console.error('AI farm advice error:', error);

        res.status(500).json({
            answer:
                'AI is not responding right now. As a safe rule: avoid spraying before rain, irrigate early morning or evening on hot days, and keep drainage clear.',
            error: error.message
        });
    }
});

module.exports = router;
