const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const { sendDailyWeatherEmail } = require('../services/emailService');

// Helper function to get coordinates for Kerala locations
function getCoordinatesForLocation(location) {
    const coordinates = {
        'Kochi': { lat: 9.9312, lon: 76.2673 },
        'Trivandrum': { lat: 8.5241, lon: 76.9366 },
        'Thiruvananthapuram': { lat: 8.5241, lon: 76.9366 },
        'Kozhikode': { lat: 11.2588, lon: 75.7804 },
        'Thrissur': { lat: 10.5276, lon: 76.2144 },
        'Kollam': { lat: 8.8932, lon: 76.6141 },
        'Palakkad': { lat: 10.7867, lon: 76.6548 },
        'Alappuzha': { lat: 9.4981, lon: 76.3388 },
        'Kannur': { lat: 11.8745, lon: 75.3704 },
        'Kasaragod': { lat: 12.4996, lon: 74.9869 },
        'Kerala': { lat: 10.8505, lon: 76.2711 }
    };

    // Clean location name and find match
    const cleanLocation = location.replace(/,.*/, '').trim();
    return coordinates[cleanLocation] || coordinates['Kerala'];
}

// Helper function to convert Open-Meteo weather codes to descriptions
function getWeatherDescription(weatherCode) {
    const weatherCodes = {
        0: 'clear sky',
        1: 'mainly clear',
        2: 'partly cloudy',
        3: 'overcast',
        45: 'fog',
        48: 'depositing rime fog',
        51: 'light drizzle',
        53: 'moderate drizzle',
        55: 'dense drizzle',
        61: 'slight rain',
        63: 'moderate rain',
        65: 'heavy rain',
        66: 'light freezing rain',
        67: 'heavy freezing rain',
        71: 'slight snow fall',
        73: 'moderate snow fall',
        75: 'heavy snow fall',
        77: 'snow grains',
        80: 'slight rain showers',
        81: 'moderate rain showers',
        82: 'violent rain showers',
        85: 'slight snow showers',
        86: 'heavy snow showers',
        95: 'thunderstorm',
        96: 'thunderstorm with slight hail',
        99: 'thunderstorm with heavy hail'
    };

    return weatherCodes[weatherCode] || 'unknown weather';
}

// Get weather main category for alerts
function getWeatherMainCategory(weatherCode) {
    if (weatherCode >= 95) return 'thunderstorm';
    if (weatherCode >= 80) return 'rain';
    if (weatherCode >= 61) return 'rain';
    if (weatherCode >= 51) return 'drizzle';
    if (weatherCode >= 45) return 'mist';
    if (weatherCode >= 3) return 'clouds';
    if (weatherCode >= 1) return 'clear';
    return 'clear';
}

// Update email preferences
router.post('/preferences', auth, async (req, res) => {
    try {
        const { dailyWeather, emergencyAlerts, weeklyReports } = req.body;
        const userId = req.user.id;

        await User.findByIdAndUpdate(userId, {
            emailPreferences: {
                dailyWeather: dailyWeather,
                emergencyAlerts: emergencyAlerts,
                weeklyReports: weeklyReports
            }
        });

        res.json({
            success: true,
            message: 'Email preferences updated successfully!'
        });

    } catch (error) {
        console.error('Update preferences error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update email preferences'
        });
    }
});

// Get current email preferences
router.get('/preferences', auth, async (req, res) => {
    try {
        const userId = req.user.id;
        const user = await User.findById(userId).select('emailPreferences username email location');

        res.json({
            success: true,
            preferences: user.emailPreferences || {
                dailyWeather: true,
                emergencyAlerts: true,
                weeklyReports: true
            },
            userInfo: {
                username: user.username,
                email: user.email,
                location: user.location
            }
        });

    } catch (error) {
        console.error('Get preferences error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get email preferences'
        });
    }
});

// Test email sending (unchanged - uses mock data)
router.post('/test', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);

        // Mock weather data for testing
        const testWeatherData = {
            main: { temp: 28, feels_like: 30, humidity: 75 },
            weather: [{ description: 'partly cloudy' }],
            wind: { speed: 3.2 }
        };

        const testSuggestions = [
            'Good morning weather for fieldwork',
            'Consider watering plants in the evening',
            'Check for any pest activity',
            'Perfect conditions for harvesting vegetables'
        ];

        const success = await sendDailyWeatherEmail(
            user.email,
            user.username,
            user.location || 'Kerala',
            testWeatherData,
            testSuggestions
        );

        if (success) {
            res.json({
                success: true,
                message: 'Test email sent successfully! Check your inbox.'
            });
        } else {
            throw new Error('Email sending failed');
        }

    } catch (error) {
        console.error('Test email error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to send test email: ' + error.message
        });
    }
});

// Test Open-Meteo weather API endpoint
router.get('/test-weather/:location', auth, async (req, res) => {
    try {
        const location = req.params.location;
        console.log(`🌍 Testing Open-Meteo weather for ${location}...`);

        const coordinates = getCoordinatesForLocation(location);
        console.log(`📍 Coordinates for ${location}:`, coordinates);

        // FIXED: Correct Open-Meteo API endpoint
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${coordinates.lat}&longitude=${coordinates.lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=Asia/Kolkata&forecast_days=1`;

        console.log('🔗 API URL:', weatherUrl);

        const weatherResponse = await fetch(weatherUrl);
        console.log('📡 Response Status:', weatherResponse.status);

        if (!weatherResponse.ok) {
            const errorText = await weatherResponse.text();
            console.log('❌ Error Response:', errorText);
            throw new Error(`Open-Meteo API failed with status ${weatherResponse.status}: ${errorText}`);
        }

        const weatherData = await weatherResponse.json();
        console.log(`✅ Open-Meteo weather data received for ${location}:`, weatherData);

        // Check if current data exists
        if (!weatherData.current) {
            throw new Error('No current weather data in response');
        }

        // Format data to match your existing structure
        const formattedData = {
            main: {
                temp: weatherData.current.temperature_2m,
                feels_like: weatherData.current.temperature_2m,
                humidity: weatherData.current.relative_humidity_2m
            },
            weather: [{
                main: getWeatherMainCategory(weatherData.current.weather_code),
                description: getWeatherDescription(weatherData.current.weather_code)
            }],
            wind: {
                speed: weatherData.current.wind_speed_10m
            },
            name: location
        };

        res.json({
            success: true,
            location: location,
            currentWeather: formattedData,
            rawData: weatherData,
            message: `Open-Meteo weather data loaded for ${location}`
        });

    } catch (error) {
        console.error('❌ Open-Meteo weather test error:', error);
        res.status(500).json({
            success: false,
            message: 'Open-Meteo API test failed: ' + error.message,
            details: error.toString()
        });
    }
});

// Test daily emails trigger with Open-Meteo
router.post('/test-daily', auth, async (req, res) => {
    try {
        console.log('🧪 Manual test: Daily weather emails with Open-Meteo');

        const users = await User.find({}).limit(3).select('username email location');

        if (users.length === 0) {
            return res.json({
                success: false,
                message: 'No users found in database'
            });
        }

        let emailsSent = 0;
        for (let user of users) {
            try {
                const location = user.location || 'Kerala';
                const coordinates = getCoordinatesForLocation(location);

                // FIXED: Use forecast endpoint for current weather
                const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${coordinates.lat}&longitude=${coordinates.lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=Asia/Kolkata&forecast_days=1`;

                console.log(`🌐 Getting weather for ${user.email} from: ${weatherUrl}`);

                const weatherResponse = await fetch(weatherUrl);

                if (weatherResponse.ok) {
                    const weatherRawData = await weatherResponse.json();

                    // Check if current data exists
                    if (weatherRawData.current) {
                        // Format weather data
                        const weatherData = {
                            main: {
                                temp: weatherRawData.current.temperature_2m,
                                feels_like: weatherRawData.current.temperature_2m,
                                humidity: weatherRawData.current.relative_humidity_2m
                            },
                            weather: [{
                                main: getWeatherMainCategory(weatherRawData.current.weather_code),
                                description: getWeatherDescription(weatherRawData.current.weather_code)
                            }],
                            wind: {
                                speed: weatherRawData.current.wind_speed_10m
                            },
                            name: location
                        };

                        // Generate suggestions based on Open-Meteo data
                        const suggestions = [
                            `Weather: ${weatherData.weather[0].description} (${Math.round(weatherData.main.temp)}°C)`,
                            `Humidity: ${weatherData.main.humidity}% - Monitor plants accordingly`,
                            'Check plants for pests and diseases',
                            'Monitor soil moisture levels'
                        ];

                        // Send email
                        const { sendDailyWeatherEmail } = require('../services/emailService');
                        const success = await sendDailyWeatherEmail(
                            user.email,
                            user.username,
                            location,
                            weatherData,
                            suggestions
                        );

                        if (success) {
                            emailsSent++;
                            console.log(`✅ Test email sent to ${user.email} with Open-Meteo data`);
                        }
                    } else {
                        console.log(`❌ No current weather data for ${location}`);
                    }
                } else {
                    const errorText = await weatherResponse.text();
                    console.log(`❌ Open-Meteo API failed for ${location}: ${weatherResponse.status} - ${errorText}`);
                }

            } catch (userError) {
                console.error(`❌ Failed for user ${user.email}:`, userError);
            }
        }

        res.json({
            success: true,
            message: `Test completed! ${emailsSent} emails sent out of ${users.length} users using Open-Meteo API. Check server logs for details.`
        });

    } catch (error) {
        console.error('❌ Daily test error:', error);
        res.status(500).json({
            success: false,
            message: 'Daily test failed: ' + error.message
        });
    }
});

module.exports = router;
