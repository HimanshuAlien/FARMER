const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
require('dotenv').config();

// Register new user
router.post('/register', async (req, res) => {
    const {
        username,
        email,
        password,
        role,               // "farmer" | "officer" from frontend
        designation,
        department,
        officeName,
        officeCode,
        district,
        blockName,
        phoneOffice
    } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ message: 'Please enter all fields' });
    }

    if (password.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    try {
        let user = await User.findOne({ email });
        if (user) {
            return res.status(400).json({ message: 'User already exists with this email' });
        }

        // decide role safely (default = farmer)
        const userRole = role === 'officer' ? 'officer' : 'farmer';

        const userData = {
            username,
            email,
            password,
            role: userRole
        };

        // if officer: attach officer profile (your schema will pick this up)
        if (userRole === 'officer') {
            userData.officerProfile = {
                designation: designation || '',
                department: department || '',
                officeName: officeName || '',
                officeCode: officeCode || '',
                district: district || '',
                blockName: blockName || '',
                phoneOffice: phoneOffice || ''
            };
        }

        user = new User(userData);

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(password, salt);
        await user.save();

        const payload = {
            user: {
                id: user.id,
                role: user.role || 'farmer'
            }
        };

        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' });

        res.cookie('token', token, {
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            maxAge: 24 * 60 * 60 * 1000,
            path: '/'
        });

        res.json({
            message: 'Registration successful',
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role || 'farmer'
            }
        });

    } catch (error) {
        console.error(error.message);
        res.status(500).send('Server error');
    }
});

// User login
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: 'Please enter all fields' });
    }

    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: 'Invalid Credentials' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid Credentials' });
        }

        const payload = {
            user: {
                id: user.id,
                role: user.role || 'farmer'
            }
        };

        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' });

        res.cookie('token', token, {
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            maxAge: 24 * 60 * 60 * 1000,
            path: '/'
        });

        res.json({
            message: 'Login successful',
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role || 'farmer'
            }
        });

    } catch (error) {
        console.error(error.message);
        res.status(500).send('Server error');
    }
});

// Logout user
router.post('/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ message: 'Logged out successfully' });
});

module.exports = router;
