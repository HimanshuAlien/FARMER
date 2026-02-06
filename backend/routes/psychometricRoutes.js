// backend/routes/psychometricRoutes.js
const express = require('express');
const router = express.Router();
const PsychometricAssessment = require('../models/PsychometricAssessment');
const nodemailer = require('nodemailer');

// Email transporter using your ENV vars (do NOT hardcode secrets)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
    }
});

// Helper: compute risk level from answers
function computeRisk(answers = {}) {
    const values = Object.values(answers).map(v => Number(v || 0));
    const totalScore = values.reduce((sum, v) => sum + v, 0);

    let riskLevel = 'LOW';
    if (totalScore >= 32) riskLevel = 'HIGH';
    else if (totalScore >= 20) riskLevel = 'MEDIUM';

    return { totalScore, riskLevel };
}

// Helper: send alert email to close contact
async function sendAlertEmail({ farmerName, farmerEmail, closeContactName, closeContactEmail, totalScore }) {
    if (!closeContactEmail) return;

    const mailOptions = {
        from: process.env.GMAIL_USER,
        to: closeContactEmail,
        subject: `Important wellbeing alert for ${farmerName}`,
        text: `
Dear ${closeContactName || 'Family Member'},

This is an automatic wellbeing alert from the Kerala Agriculture system.

${farmerName || 'The farmer'} recently completed a short mental health check and the score was in a HIGH risk range (score: ${totalScore}).

Please gently check on them, talk to them, and encourage them to seek help from a doctor or counsellor if needed.

This message is confidential and for your awareness only.

– Kerala Agriculture Support System
(Automated message)
`
    };

    await transporter.sendMail(mailOptions);
}

// POST /api/psychometric/submit
router.post('/submit', async (req, res) => {
    try {
        const {
            farmerName,
            farmerPhone,
            farmerEmail,
            district,
            farmerId,
            closeContactName,
            closeContactRelation,
            closeContactPhone,
            closeContactEmail,
            answers
        } = req.body || {};

        if (!farmerName || !farmerEmail || !closeContactName || !closeContactEmail || !answers) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        const { totalScore, riskLevel } = computeRisk(answers);

        const doc = new PsychometricAssessment({
            farmerName,
            farmerPhone,
            farmerEmail,
            district,
            farmerId,
            closeContactName,
            closeContactRelation,
            closeContactPhone,
            closeContactEmail,
            answers,
            totalScore,
            riskLevel
        });

        await doc.save();

        // If risk is high, send alert email
        if (riskLevel === 'HIGH') {
            try {
                await sendAlertEmail({
                    farmerName,
                    farmerEmail,
                    closeContactName,
                    closeContactEmail,
                    totalScore
                });
            } catch (emailErr) {
                console.error('Error sending alert email:', emailErr);
                // don't fail the API just because email failed
            }
        }

        return res.json({
            message: 'Assessment saved successfully',
            totalScore,
            riskLevel
        });
    } catch (err) {
        console.error('Psychometric submit error:', err);
        return res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
