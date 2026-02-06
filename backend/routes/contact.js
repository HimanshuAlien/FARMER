// backend/routes/contact.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const crypto = require('crypto');
const { sendSMS } = require('../services/comm');

const OTP_EXPIRY_MIN = Number(process.env.OTP_EXPIRY_MIN || 10);

// POST add contact — sends OTP
router.post('/contact', auth, async (req, res) => {
    try {
        const userId = req.user.id;
        const { name, phone, consent_for_contact } = req.body;
        if (!phone || !name) return res.status(400).json({ message: 'Name and phone required' });

        const otp = String(Math.floor(100000 + Math.random() * 900000));
        const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
        const expiresAt = new Date(Date.now() + OTP_EXPIRY_MIN * 60000);

        const contactObj = {
            id: new Date().getTime().toString(),
            name,
            phone,
            verified: false,
            consent_for_contact: !!consent_for_contact,
            otpHash,
            otpExpiresAt: expiresAt
        };

        // store contact as pending in user.emergency_contacts array
        const user = await User.findById(userId);
        user.emergency_contacts = user.emergency_contacts || [];
        user.emergency_contacts.push(contactObj);
        await user.save();

        // send OTP via SMS
        const smsRes = await sendSMS(phone, `Your verification code is ${otp}. It expires in ${OTP_EXPIRY_MIN} minutes.`);

        res.json({ status: 'ok', verify_sent: true, contactId: contactObj.id, smsRes });
    } catch (err) {
        console.error('add contact error', err);
        res.status(500).json({ message: 'Failed to add contact' });
    }
});

// POST verify OTP
router.post('/contact/verify', auth, async (req, res) => {
    try {
        const userId = req.user.id;
        const { contactId, otp } = req.body;
        if (!contactId || !otp) return res.status(400).json({ message: 'contactId and otp required' });

        const user = await User.findById(userId);
        const contact = (user.emergency_contacts || []).find(c => c.id === contactId);
        if (!contact) return res.status(404).json({ message: 'Contact not found' });

        if (new Date() > new Date(contact.otpExpiresAt)) return res.status(400).json({ message: 'OTP expired' });

        const otpHash = crypto.createHash('sha256').update(String(otp)).digest('hex');
        if (otpHash !== contact.otpHash) return res.status(400).json({ message: 'Invalid OTP' });

        contact.verified = true;
        contact.verifiedAt = new Date();
        contact.otpHash = undefined;
        contact.otpExpiresAt = undefined;
        await user.save();

        res.json({ status: 'ok', verified: true, contact });
    } catch (err) {
        console.error('verify contact error', err);
        res.status(500).json({ message: 'OTP verification failed' });
    }
});

module.exports = router;
