const nodemailer = require('nodemailer');

// FIXED: Use createTransport (not createTransporter)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
    }
});

// Send daily weather email
async function sendDailyWeatherEmail(userEmail, userName, location, weatherData, suggestions) {
    const mailOptions = {
        from: `"🌾 Kerala Farmer Advisory" <${process.env.GMAIL_USER}>`, // CHANGED THIS LINE
        to: userEmail,
        subject: `🌾 Daily Weather Report - ${location}`,
        html: generateDailyEmailTemplate(userName, location, weatherData, suggestions)
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`✅ Daily weather email sent to ${userEmail}`);
        return true;
    } catch (error) {
        console.error(`❌ Failed to send email to ${userEmail}:`, error);
        return false;
    }
}

// Send emergency weather alert  
async function sendEmergencyAlert(userEmail, userName, location, alertData) {
    const mailOptions = {
        from: `"🚨 Kerala Farmer Alerts" <${process.env.GMAIL_USER}>`, // CHANGED THIS LINE
        to: userEmail,
        subject: `🚨 WEATHER ALERT - ${location}`,
        html: generateAlertEmailTemplate(userName, location, alertData)
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`✅ Emergency alert sent to ${userEmail}`);
        return true;
    } catch (error) {
        console.error(`❌ Failed to send alert to ${userEmail}:`, error);
        return false;
    }
}


// Daily email template
function generateDailyEmailTemplate(userName, location, weather, suggestions) {
    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 20px; border-radius: 8px 8px 0 0;">
                <h1 style="margin: 0;">🌾 Kerala Farmer Advisory</h1>
                <p style="margin: 5px 0 0;">Daily Weather Report - ${location}</p>
            </div>
            
            <div style="background: #f8f9fa; padding: 20px;">
                <h2 style="color: #059669;">Good Morning, ${userName}!</h2>
                
                <div style="background: white; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #10b981;">
                    <h3 style="color: #047857; margin-top: 0;">🌤️ Today's Weather</h3>
                    <p><strong>Temperature:</strong> ${Math.round(weather.main.temp)}°C (feels like ${Math.round(weather.main.feels_like)}°C)</p>
                    <p><strong>Conditions:</strong> ${weather.weather[0].description}</p>
                    <p><strong>Humidity:</strong> ${weather.main.humidity}%</p>
                    <p><strong>Wind:</strong> ${weather.wind.speed} m/s</p>
                </div>
                
                <div style="background: white; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #0ea5e9;">
                    <h3 style="color: #0369a1; margin-top: 0;">🚜 Today's Farming Suggestions</h3>
                    ${suggestions.map(suggestion => `<p>✅ ${suggestion}</p>`).join('')}
                </div>
                
                <div style="text-align: center; margin: 20px 0;">
                    <p style="color: #6b7280; font-size: 14px;">
                        This report was generated automatically based on weather conditions in ${location}
                    </p>
                </div>
            </div>
        </div>
    `;
}

// Emergency alert template
function generateAlertEmailTemplate(userName, location, alert) {
    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #ef4444; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
                <h1 style="margin: 0;">🚨 WEATHER ALERT</h1>
                <p style="margin: 5px 0 0;">${location} - Immediate Attention Required</p>
            </div>
            
            <div style="background: #fef2f2; padding: 20px; border-left: 4px solid #ef4444;">
                <h2 style="color: #dc2626;">Alert: ${alert.type ? alert.type.toUpperCase() : 'WEATHER ALERT'}</h2>
                <p style="font-size: 16px; color: #374151;"><strong>${alert.message || 'Weather alert for your location'}</strong></p>
                
                <div style="background: white; padding: 15px; border-radius: 8px; margin: 15px 0;">
                    <h3 style="color: #dc2626;">🎯 Immediate Actions Required:</h3>
                    ${alert.actions ? alert.actions.map(action => `<p>• ${action}</p>`).join('') : '<p>• Monitor weather conditions closely</p><p>• Take necessary precautions</p>'}
                </div>
                
                <div style="background: #065f46; color: white; padding: 10px; border-radius: 6px; margin-top: 20px;">
                    <p style="margin: 0; text-align: center;">
                        <strong>Stay Safe! Monitor weather conditions closely.</strong>
                    </p>
                </div>
            </div>
        </div>
    `;
}

module.exports = {
    sendDailyWeatherEmail,
    sendEmergencyAlert
};
