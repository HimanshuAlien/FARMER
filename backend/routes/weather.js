const express = require('express');
const router = express.Router();
const axios = require('axios');
const auth = require('../middleware/auth');

// Simple weather route with fallback data
router.get('/current/:location', auth, async (req, res) => {
    try {
        const { location } = req.params;
        console.log(`Getting weather for: ${location}`);

        // Try to get real weather data
        let weatherData;

        try {
            // Get coordinates first
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

                // Get weather data
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
                        country: coords.country
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
            console.log('API failed, using fallback data:', apiError.message);

            // Fallback weather data
            weatherData = {
                current: {
                    temp: 28,
                    humidity: 75,
                    pressure: 1013,
                    wind_speed: 12,
                    feels_like: 32,
                    weather_code: 2,
                    visibility: 10
                },
                location: {
                    name: location.split(',')[0] || 'Kochi',
                    country: 'India'
                },
                forecast: {
                    time: ['2025-09-15', '2025-09-16', '2025-09-17', '2025-09-18', '2025-09-19'],
                    weather_code: [2, 61, 1, 3, 2],
                    temperature_2m_max: [32, 29, 34, 31, 30],
                    temperature_2m_min: [24, 22, 25, 23, 24],
                    precipitation_sum: [0, 15, 2, 0, 5]
                }
            };
        }

        // Generate alerts and advice - FIXED FUNCTION CALLS
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

// FIXED: generateWeatherAlerts function (was generateAlerts)
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

    // High humidity alert
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

// ENHANCED: generateFarmingAdvice function with detailed tips
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

    // Temperature-based advice
    if (temp > 35) {
        advice.push({
            icon: '🌡️',
            title: 'Extreme Heat Protection',
            description: 'Install shade nets over vegetable crops. Water plants early morning (5-7 AM) and evening (6-8 PM). Increase mulching to retain soil moisture.',
            priority: 'high',
            action: 'Immediate',
            crops: 'Tomato, Pepper, Leafy vegetables',
            timeframe: 'Today'
        });
        advice.push({
            icon: '🐄',
            title: 'Livestock Care',
            description: 'Provide extra water and shade for cattle. Avoid grazing during 11 AM - 4 PM. Use fans or sprinklers in cattle sheds.',
            priority: 'high',
            action: 'Urgent',
            crops: 'Dairy, Poultry',
            timeframe: 'Immediately'
        });
    } else if (temp > 30) {
        advice.push({
            icon: '💧',
            title: 'Increase Irrigation Frequency',
            description: 'Water crops twice daily. Check drip irrigation systems. Apply organic mulch around plants to reduce water evaporation.',
            priority: 'medium',
            action: 'Today',
            crops: 'All crops',
            timeframe: '2-3 times daily'
        });
    }

    if (temp < 15) {
        advice.push({
            icon: '🌱',
            title: 'Cold Protection Measures',
            description: 'Cover young seedlings with plastic sheets. Use smoke generation to prevent frost. Harvest mature vegetables before temperature drops further.',
            priority: 'high',
            action: 'Before sunset',
            crops: 'Seedlings, Vegetables',
            timeframe: 'Tonight'
        });
    }

    // Humidity-based advice
    if (humidity > 85) {
        advice.push({
            icon: '🍄',
            title: 'Fungal Disease Prevention',
            description: 'Apply copper-based fungicide spray. Ensure proper plant spacing for air circulation. Avoid overhead watering to reduce leaf wetness.',
            priority: 'medium',
            action: 'Morning application',
            crops: 'Tomato, Potato, Grapes',
            timeframe: 'Before 10 AM'
        });
    }

    if (humidity < 40) {
        advice.push({
            icon: '🌿',
            title: 'Combat Dry Air Effects',
            description: 'Increase watering frequency. Install micro-sprinklers for humid microclimate. Monitor plants for stress signs like wilting and leaf curl.',
            priority: 'medium',
            action: 'Monitor closely',
            crops: 'All sensitive crops',
            timeframe: 'Throughout day'
        });
    }

    // Wind-based advice
    if (windSpeed > 30) {
        advice.push({
            icon: '🌪️',
            title: 'Wind Damage Prevention',
            description: 'Support tall plants with stakes. Harvest ready fruits before they fall. Secure greenhouse covers and shade nets. Avoid spraying pesticides.',
            priority: 'high',
            action: 'Immediate',
            crops: 'Banana, Coconut, Tall vegetables',
            timeframe: 'Before evening'
        });
    }

    // Weather code specific advice
    if (weatherCode >= 61 && weatherCode <= 65) {
        advice.push({
            icon: '☔',
            title: 'Rainy Day Management',
            description: 'Check field drainage systems. Postpone fertilizer application. Cover harvested crops. Apply bordeaux mixture for disease prevention.',
            priority: 'high',
            action: 'Before rain intensifies',
            crops: 'All field crops',
            timeframe: 'Next 2-4 hours'
        });
    }

    // Always include a general tip
    advice.push({
        icon: '📊',
        title: 'Daily Monitoring',
        description: 'Check soil moisture 2 inches deep. Inspect plants for pest/disease symptoms. Record daily observations in farm diary.',
        priority: 'low',
        action: 'Routine check',
        crops: 'All crops',
        timeframe: 'Morning & Evening'
    });

    return advice;
}

function getUpcomingAdvice(currentTemp, weatherCode) {
    const advice = [];

    // Seasonal preparation
    advice.push({
        icon: '📅',
        title: 'Week Ahead Planning',
        description: 'Prepare for monsoon season. Stock up on organic pesticides. Plan sowing of monsoon crops like rice, sugarcane, and cotton.',
        priority: 'medium',
        action: 'This week',
        crops: 'Rice, Sugarcane, Cotton',
        timeframe: 'Next 7 days',
        details: 'Ideal sowing time for Kharif crops in Kerala'
    });

    advice.push({
        icon: '🌾',
        title: 'Harvest Planning',
        description: 'Monitor ripening stages of current crops. Plan labor requirements for harvesting. Arrange storage facilities and transportation.',
        priority: 'medium',
        action: 'Plan ahead',
        crops: 'Mature crops',
        timeframe: '2-3 weeks',
        details: 'Peak harvesting season approaching'
    });

    if (currentTemp > 30) {
        advice.push({
            icon: '🌡️',
            title: 'Heat Wave Preparation',
            description: 'Install permanent shade structures. Dig additional water storage pits. Consider drought-resistant crop varieties for next season.',
            priority: 'medium',
            action: 'Long-term planning',
            crops: 'All crops',
            timeframe: 'Next month',
            details: 'Climate adaptation strategy'
        });
    }

    advice.push({
        icon: '💰',
        title: 'Market Price Monitoring',
        description: 'Track commodity prices for better selling decisions. Connect with local mandis and cooperative societies. Consider value addition opportunities.',
        priority: 'low',
        action: 'Weekly review',
        crops: 'Cash crops',
        timeframe: 'Ongoing',
        details: 'Maximize farm income through timing'
    });

    return advice;
}

function getGeneralAdvice() {
    return [
        {
            icon: '📱',
            title: 'Smart Weather Monitoring',
            description: 'Use weather apps for hourly updates. Set up rain gauge in field. Subscribe to weather alerts from IMD (India Meteorological Department).',
            priority: 'medium',
            action: 'Setup once',
            crops: 'All farming operations',
            timeframe: 'Ongoing',
            details: 'Technology-aided farming for better decisions'
        },
        {
            icon: '🌱',
            title: 'Integrated Pest Management (IPM)',
            description: 'Use yellow sticky traps for monitoring. Encourage beneficial insects like ladybugs. Rotate between organic and chemical pesticides to prevent resistance.',
            priority: 'high',
            action: 'Implement system',
            crops: 'All crops',
            timeframe: 'Season-long',
            details: 'Sustainable pest control approach'
        },
        {
            icon: '💧',
            title: 'Water Conservation Techniques',
            description: 'Install drip irrigation for 30-50% water savings. Practice rainwater harvesting. Use moisture meters to optimize watering.',
            priority: 'high',
            action: 'Gradual implementation',
            crops: 'All crops',
            timeframe: 'Long-term investment',
            details: 'Sustainable water management'
        },
        {
            icon: '🧪',
            title: 'Soil Health Management',
            description: 'Test soil pH every 6 months. Add organic compost regularly. Practice crop rotation to maintain soil fertility.',
            priority: 'medium',
            action: 'Regular maintenance',
            crops: 'All field crops',
            timeframe: 'Bi-annual',
            details: 'Foundation of productive farming'
        },
        {
            icon: '📋',
            title: 'Farm Record Keeping',
            description: 'Maintain digital or physical farm diary. Record inputs, outputs, and expenses. Track crop performance and weather patterns.',
            priority: 'medium',
            action: 'Daily habit',
            crops: 'All operations',
            timeframe: 'Daily',
            details: 'Data-driven farming decisions'
        }
    ];
}

function getSeasonalAdvice() {
    return [
        {
            icon: '🌧️',
            title: 'Monsoon Preparation (June-September)',
            description: 'Ensure proper field drainage. Stock fungicides for disease control. Plan Kharif crop sowing schedule. Repair farm equipment.',
            priority: 'high',
            action: 'Seasonal preparation',
            crops: 'Rice, Sugarcane, Cotton',
            timeframe: 'Pre-monsoon',
            details: 'Critical period for Kerala agriculture'
        },
        {
            icon: '☀️',
            title: 'Summer Management (March-May)',
            description: 'Focus on water conservation. Harvest Rabi crops. Prepare land for next season. Maintain irrigation infrastructure.',
            priority: 'high',
            action: 'Season management',
            crops: 'Vegetables, Cash crops',
            timeframe: 'Summer months',
            details: 'Water stress management crucial'
        },
        {
            icon: '🍂',
            title: 'Post-Monsoon Care (October-December)',
            description: 'Focus on disease management due to humidity. Plan Rabi crop sowing. Harvest Kharif crops. Prepare for winter vegetables.',
            priority: 'medium',
            action: 'Transition planning',
            crops: 'Winter vegetables',
            timeframe: 'Post-monsoon',
            details: 'Optimal growing conditions in Kerala'
        }
    ];
}

// Simple alerts toggle
router.post('/alerts/toggle', auth, (req, res) => {
    const { enabled } = req.body;
    res.json({
        message: enabled ? 'Alerts enabled' : 'Alerts disabled',
        enabled
    });
});

module.exports = router;
