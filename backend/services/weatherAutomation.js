const cron = require('node-cron');
const User = require('../models/User');
const { sendDailyWeatherEmail, sendEmergencyAlert } = require('./emailService');

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

    const cleanLocation = location.replace(/,.*/, '').trim();
    return coordinates[cleanLocation] || coordinates['Kerala'];
}

// Helper functions for weather codes
function getWeatherDescription(weatherCode) {
    const weatherCodes = {
        0: 'clear sky', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast',
        45: 'fog', 48: 'depositing rime fog',
        51: 'light drizzle', 53: 'moderate drizzle', 55: 'dense drizzle',
        61: 'slight rain', 63: 'moderate rain', 65: 'heavy rain',
        66: 'light freezing rain', 67: 'heavy freezing rain',
        71: 'slight snow fall', 73: 'moderate snow fall', 75: 'heavy snow fall', 77: 'snow grains',
        80: 'slight rain showers', 81: 'moderate rain showers', 82: 'violent rain showers',
        85: 'slight snow showers', 86: 'heavy snow showers',
        95: 'thunderstorm', 96: 'thunderstorm with slight hail', 99: 'thunderstorm with heavy hail'
    };
    return weatherCodes[weatherCode] || 'unknown weather';
}

function getWeatherMainCategory(weatherCode) {
    if (weatherCode >= 95) return 'thunderstorm';
    if (weatherCode >= 80) return 'rain';
    if (weatherCode >= 61) return 'rain';
    if (weatherCode >= 51) return 'drizzle';
    if (weatherCode >= 45) return 'mist';
    if (weatherCode >= 3) return 'clouds';
    return 'clear';
}

// Fixed getCurrentWeather function
async function getCurrentWeather(location) {
    try {
        const coordinates = getCoordinatesForLocation(location);
        console.log(`🌍 Getting weather for ${location}:`, coordinates);

        // FIXED: Correct Open-Meteo URL
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${coordinates.lat}&longitude=${coordinates.lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=Asia/Kolkata&forecast_days=1`;

        console.log('🔗 Fetching from:', weatherUrl);

        const response = await fetch(weatherUrl);
        console.log('📡 API Response Status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ API Error Response:', errorText);
            throw new Error(`Open-Meteo API failed: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        console.log('✅ Raw API Data:', data);

        // Check if current data exists
        if (!data.current) {
            console.error('❌ No current weather data in response');
            throw new Error('No current weather data available');
        }

        console.log('🌤️ Current weather:', data.current);

        // Format to your expected structure
        const formattedWeather = {
            main: {
                temp: data.current.temperature_2m,
                feels_like: data.current.temperature_2m,
                humidity: data.current.relative_humidity_2m
            },
            weather: [{
                main: getWeatherMainCategory(data.current.weather_code),
                description: getWeatherDescription(data.current.weather_code)
            }],
            wind: {
                speed: data.current.wind_speed_10m
            },
            name: location
        };

        console.log('✅ Formatted weather:', formattedWeather);
        return formattedWeather;

    } catch (error) {
        console.error(`❌ Weather API error for ${location}:`, error.message);
        // Return null to see the real error, don't use fallback
        return null;
    }
}

// Get forecast using Open-Meteo API
async function getWeatherForecast(location) {
    try {
        const coordinates = getCoordinatesForLocation(location);
        const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${coordinates.lat}&longitude=${coordinates.lon}&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_sum,wind_speed_10m_max&timezone=Asia/Kolkata&forecast_days=5`;

        const response = await fetch(forecastUrl);

        if (!response.ok) {
            const errorText = await response.text();
            console.log(`❌ Open-Meteo forecast API error: ${response.status} - ${errorText}`);
            throw new Error(`Open-Meteo forecast API failed with status ${response.status}`);
        }

        const data = await response.json();

        // Format to match existing structure (create fake "list" array)
        const list = [];
        for (let i = 0; i < Math.min(data.daily.time.length, 5); i++) {
            list.push({
                main: {
                    temp: data.daily.temperature_2m_max[i],
                    temp_min: data.daily.temperature_2m_min[i],
                    humidity: 70 // Open-Meteo doesn't provide daily humidity, using average
                },
                weather: [{
                    main: getWeatherMainCategory(data.daily.weather_code[i]),
                    description: getWeatherDescription(data.daily.weather_code[i])
                }],
                wind: {
                    speed: data.daily.wind_speed_10m_max[i]
                },
                rain: {
                    '3h': data.daily.precipitation_sum[i] || 0
                }
            });
        }

        return { list: list };

    } catch (error) {
        console.error(`Open-Meteo forecast error for ${location}:`, error);
        return null;
    }
}

// Generate farming suggestions based on weather
function generateFarmingSuggestions(todayWeather, tomorrowForecast) {
    const suggestions = [];
    const temp = todayWeather.main.temp;
    const humidity = todayWeather.main.humidity;
    const weather = todayWeather.weather[0].main.toLowerCase();

    // Today's suggestions
    if (temp > 35) {
        suggestions.push('🌡️ VERY HOT today (' + Math.round(temp) + '°C) - Water crops early morning (5-7 AM) and evening (6-8 PM)');
        suggestions.push('🏠 Avoid heavy fieldwork during 10 AM - 4 PM. Work in shade if possible');
        suggestions.push('💧 Check irrigation systems - crops will need extra water');
    } else if (temp > 30) {
        suggestions.push('🌤️ Hot weather (' + Math.round(temp) + '°C) - Water plants early morning and evening');
        suggestions.push('🚜 Best working hours: 6-9 AM and 5-7 PM');
    } else if (temp < 20) {
        suggestions.push('❄️ Cool weather (' + Math.round(temp) + '°C) - Good for planting and transplanting');
        suggestions.push('🌱 Protect sensitive crops from cold if temperature drops further');
    } else {
        suggestions.push('🌤️ Pleasant weather (' + Math.round(temp) + '°C) - Perfect for all farming activities');
    }

    // Weather condition suggestions
    if (weather.includes('rain') || weather.includes('drizzle')) {
        suggestions.push('🌧️ Rain today - Check drainage, cover stored crops, avoid pesticide spraying');
        suggestions.push('🚫 Don\'t apply fertilizer today - wait for rain to stop');
    } else if (weather.includes('clear')) {
        suggestions.push('☀️ Clear sunny day - Perfect for harvesting, drying crops, and field preparation');
        suggestions.push('💨 Good day for pesticide/fertilizer application (low wind)');
    } else if (weather.includes('cloud')) {
        suggestions.push('☁️ Cloudy weather - Good for transplanting and fieldwork (less heat stress)');
    }

    // Humidity suggestions
    if (humidity > 85) {
        suggestions.push('💨 Very high humidity (' + humidity + '%) - Watch for fungal diseases, ensure good air circulation');
    } else if (humidity < 40) {
        suggestions.push('🏜️ Low humidity (' + humidity + '%) - Increase watering frequency, mulch around plants');
    }

    // Tomorrow's preview
    if (tomorrowForecast) {
        const tomorrowTemp = tomorrowForecast.main.temp;
        const tomorrowWeather = tomorrowForecast.weather[0].main.toLowerCase();

        if (tomorrowWeather.includes('rain')) {
            suggestions.push('⚠️ TOMORROW: Rain expected - Harvest ready vegetables today, check drainage systems');
        } else if (tomorrowTemp > 35) {
            suggestions.push('⚠️ TOMORROW: Very hot day expected (' + Math.round(tomorrowTemp) + '°C) - Prepare extra water, plan indoor work');
        } else if (tomorrowTemp < 15) {
            suggestions.push('⚠️ TOMORROW: Cold weather expected - Protect sensitive plants tonight');
        }
    }

    // Always include general suggestions
    suggestions.push('🔍 Daily tasks: Check plants for pests, monitor soil moisture, record observations');

    return suggestions;
}

// Check for weather alerts (storms, extreme heat, heavy rain)
function checkWeatherAlerts(todayWeather, forecastData) {
    const alerts = [];

    // Today's immediate alerts
    const temp = todayWeather.main.temp;
    const weather = todayWeather.weather[0].main.toLowerCase();
    const windSpeed = todayWeather.wind ? todayWeather.wind.speed : 0;

    // Extreme temperature alerts
    if (temp > 38) {
        alerts.push({
            type: 'extreme_heat',
            severity: 'high',
            timing: 'today',
            message: `🔥 EXTREME HEAT ALERT: Temperature ${Math.round(temp)}°C in ${todayWeather.name}`,
            actions: [
                'Water crops immediately if not done today',
                'Provide shade nets for sensitive plants',
                'Avoid all outdoor work between 11 AM - 4 PM',
                'Keep animals in shade with plenty of water',
                'Check elderly plants and seedlings frequently'
            ]
        });
    } else if (temp > 35) {
        alerts.push({
            type: 'high_heat',
            severity: 'medium',
            timing: 'today',
            message: `🌡️ HIGH TEMPERATURE ALERT: ${Math.round(temp)}°C expected in ${todayWeather.name}`,
            actions: [
                'Water crops early morning and evening',
                'Work during cooler hours (6-9 AM, 5-7 PM)',
                'Monitor plants for heat stress signs'
            ]
        });
    }

    // Storm and rain alerts
    if (weather.includes('thunderstorm')) {
        alerts.push({
            type: 'thunderstorm',
            severity: 'high',
            timing: 'now',
            message: `⛈️ THUNDERSTORM ALERT: Active in ${todayWeather.name}`,
            actions: [
                'Secure all farm equipment and tools immediately',
                'Move animals to safe shelter',
                'Stay indoors until storm passes',
                'Check for hail damage after storm',
                'Avoid using electrical equipment'
            ]
        });
    }

    if (windSpeed > 10) {
        alerts.push({
            type: 'strong_wind',
            severity: 'medium',
            timing: 'now',
            message: `💨 STRONG WIND ALERT: ${Math.round(windSpeed)} m/s in ${todayWeather.name}`,
            actions: [
                'Support tall plants and young trees',
                'Secure lightweight farm equipment',
                'Avoid spraying pesticides or fertilizers',
                'Check greenhouse/polytunnel structures'
            ]
        });
    }

    // Tomorrow's advance warnings from forecast
    if (forecastData && forecastData.list && forecastData.list.length > 1) {
        const tomorrowData = forecastData.list[1]; // Tomorrow's data
        const tomorrowTemp = tomorrowData.main.temp;
        const tomorrowWeather = tomorrowData.weather[0].main.toLowerCase();
        const tomorrowRain = tomorrowData.rain ? tomorrowData.rain['3h'] || 0 : 0;

        // Tomorrow's extreme heat warning
        if (tomorrowTemp > 37) {
            alerts.push({
                type: 'heat_warning',
                severity: 'high',
                timing: 'tomorrow',
                message: `🔥 ADVANCE HEAT WARNING: Extreme temperature ${Math.round(tomorrowTemp)}°C expected tomorrow`,
                actions: [
                    'Water all crops heavily this evening',
                    'Prepare shade materials for sensitive plants',
                    'Plan all outdoor work before 9 AM tomorrow',
                    'Stock up on water for irrigation',
                    'Check irrigation system tonight'
                ]
            });
        }

        // Tomorrow's heavy rain warning
        if (tomorrowRain > 10 || tomorrowWeather.includes('rain')) {
            alerts.push({
                type: 'heavy_rain_warning',
                severity: 'medium',
                timing: 'tomorrow',
                message: `🌧️ ADVANCE RAIN ALERT: Heavy rainfall expected tomorrow (${Math.round(tomorrowRain)}mm)`,
                actions: [
                    'Harvest ready vegetables and fruits today',
                    'Check and clean drainage systems now',
                    'Cover stored crops and seeds',
                    'Secure farm equipment and tools',
                    'Plan indoor activities for tomorrow'
                ]
            });
        }

        // Tomorrow's storm warning
        if (tomorrowWeather.includes('thunderstorm')) {
            alerts.push({
                type: 'storm_warning',
                severity: 'high',
                timing: 'tomorrow',
                message: `⛈️ ADVANCE STORM WARNING: Thunderstorms expected tomorrow`,
                actions: [
                    'Complete urgent outdoor work today',
                    'Secure all moveable farm equipment tonight',
                    'Check structural integrity of farm buildings',
                    'Prepare emergency kit and flashlights',
                    'Monitor weather updates closely'
                ]
            });
        }
    }

    return alerts;
}

// Send daily weather emails at 6 AM (WORKS WITHOUT USER LOGIN)
async function sendDailyWeatherEmails() {
    try {
        console.log('🌅 6:00 AM - Starting daily weather email process with Open-Meteo...');

        // Get ALL users regardless of login status
        const users = await User.find({
            $or: [
                { 'emailPreferences.dailyWeather': true },
                { emailPreferences: { $exists: false } } // Users without preferences (default to true)
            ]
        }).select('username email location emailPreferences');

        console.log(`📧 Found ${users.length} users for daily weather emails`);
        let successCount = 0;
        let errorCount = 0;

        for (let user of users) {
            try {
                const location = user.location || 'Kochi, Kerala';
                console.log(`🌍 Getting Open-Meteo weather for ${user.email} in ${location}...`);

                // Get today's weather and tomorrow's forecast using Open-Meteo
                const [todayWeather, forecastData] = await Promise.all([
                    getCurrentWeather(location),
                    getWeatherForecast(location)
                ]);

                if (todayWeather) {
                    // Get tomorrow's weather from forecast
                    let tomorrowWeather = null;
                    if (forecastData && forecastData.list && forecastData.list.length > 1) {
                        tomorrowWeather = forecastData.list[1]; // Tomorrow's data
                    }

                    // Generate farming suggestions
                    const suggestions = generateFarmingSuggestions(todayWeather, tomorrowWeather);

                    // Check for weather alerts
                    const alerts = checkWeatherAlerts(todayWeather, forecastData);

                    // Send daily email (USER DOESN'T NEED TO BE LOGGED IN)
                    const success = await sendDailyWeatherEmail(
                        user.email,
                        user.username,
                        location,
                        todayWeather,
                        suggestions
                    );

                    if (success) {
                        successCount++;
                        console.log(`✅ Daily email sent to ${user.email} using Open-Meteo`);
                    } else {
                        errorCount++;
                    }

                    // Send emergency alerts if any
                    for (let alert of alerts) {
                        if (alert.severity === 'high') {
                            try {
                                await sendEmergencyAlert(
                                    user.email,
                                    user.username,
                                    location,
                                    alert
                                );
                                console.log(`🚨 Emergency alert sent to ${user.email}: ${alert.type}`);
                            } catch (alertError) {
                                console.error(`❌ Failed to send alert to ${user.email}:`, alertError);
                            }
                        }
                    }

                    // Small delay to avoid overwhelming email service
                    await new Promise(resolve => setTimeout(resolve, 2000)); // 2-second delay
                } else {
                    console.log(`❌ No weather data for ${location}`);
                    errorCount++;
                }

            } catch (userError) {
                console.error(`❌ Failed to process user ${user.email}:`, userError);
                errorCount++;
            }
        }

        console.log(`✅ Daily weather email process completed: ${successCount} sent, ${errorCount} errors`);

    } catch (error) {
        console.error('❌ Daily weather email process failed:', error);
    }
}

// Check for emergency weather conditions every 2 hours (WORKS WITHOUT USER LOGIN)
async function checkEmergencyWeather() {
    try {
        console.log('🚨 Checking for emergency weather conditions with Open-Meteo...');

        // Get users who want emergency alerts (NO LOGIN REQUIRED)
        const users = await User.find({
            $or: [
                { 'emailPreferences.emergencyAlerts': true },
                { emailPreferences: { $exists: false } }
            ]
        }).select('username email location').limit(10); // Limit to avoid too many API calls

        for (let user of users) {
            try {
                const location = user.location || 'Kochi, Kerala';
                const todayWeather = await getCurrentWeather(location);
                const forecastData = await getWeatherForecast(location);

                if (todayWeather) {
                    const alerts = checkWeatherAlerts(todayWeather, forecastData);

                    // Send only high-severity immediate alerts
                    const emergencyAlerts = alerts.filter(alert =>
                        alert.severity === 'high' && (alert.timing === 'now' || alert.timing === 'today')
                    );

                    for (let alert of emergencyAlerts) {
                        await sendEmergencyAlert(user.email, user.username, location, alert);
                        console.log(`🚨 Emergency alert sent: ${alert.type} to ${user.email}`);
                    }
                }

                // Delay between users
                await new Promise(resolve => setTimeout(resolve, 1000));

            } catch (userError) {
                console.error(`❌ Emergency check failed for ${user.email}:`, userError);
            }
        }

    } catch (error) {
        console.error('❌ Emergency weather check failed:', error);
    }
}

// Start all automated weather services
function startWeatherAutomation() {
    console.log('🚀 Starting Kerala Farmer Weather Automation System with Open-Meteo API...');

    // Daily weather emails at 6:00 AM IST (AUTOMATIC - NO LOGIN REQUIRED)
    cron.schedule('0 6 * * *', () => {
        console.log('🕕 6:00 AM IST - Triggering daily weather emails with Open-Meteo');
        sendDailyWeatherEmails();
    }, {
        timezone: "Asia/Kolkata"
    });

    // Emergency weather checks every 2 hours (AUTOMATIC - NO LOGIN REQUIRED)
    cron.schedule('0 */2 * * *', () => {
        console.log('🚨 Running emergency weather check with Open-Meteo');
        checkEmergencyWeather();
    }, {
        timezone: "Asia/Kolkata"
    });

    console.log('✅ Weather automation scheduled with Open-Meteo API:');
    console.log('   📧 Daily emails: 6:00 AM IST every day (NO LOGIN REQUIRED)');
    console.log('   🚨 Emergency checks: Every 2 hours (NO LOGIN REQUIRED)');
    console.log('   🌐 Timezone: Asia/Kolkata (IST)');
    console.log('   🌦️ Weather API: Open-Meteo (Free, No API Key Required)');
}

// Manual trigger functions for testing
async function testDailyEmails() {
    console.log('🧪 Testing daily weather emails with Open-Meteo...');
    await sendDailyWeatherEmails();
}

async function testEmergencyCheck() {
    console.log('🧪 Testing emergency weather check with Open-Meteo...');
    await checkEmergencyWeather();
}

module.exports = {
    startWeatherAutomation,
    testDailyEmails,
    testEmergencyCheck,
    sendDailyWeatherEmails,
    checkEmergencyWeather,
    getCurrentWeather,
    getWeatherForecast
};
