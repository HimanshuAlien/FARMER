const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const connectDB = require('./config/db');
require('dotenv').config();

const app = express();

// Connect to MongoDB
connectDB();

// PAYLOAD LIMITS - For handling large images and posts
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Middleware
app.use(cookieParser());
app.use(cors({
    origin: 'http://localhost:5000',
    credentials: true
}));

// CREATE UPLOAD DIRECTORIES - Do this BEFORE serving static files
const uploadsDir = 'uploads';
const postsDir = 'uploads/posts';
const avatarsDir = 'uploads/avatars';

// Create all necessary directories
[uploadsDir, postsDir, avatarsDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`✅ Created directory: ${dir}`);
    }
});

// Serve static files from frontend folder
app.use(express.static(path.join(__dirname, '../frontend')));

// OPTIMIZED: Serve all uploads through single route
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/user', require('./routes/user'));
app.use('/api/query', require('./routes/query'));
app.use('/api/diagnosis', require('./routes/diagnosis'));
app.use('/api/weather', require('./routes/weather'));
app.use('/api/market', require('./routes/market'));
app.use('/api/community', require('./routes/community'));
app.use('/api/weather-emails', require('./routes/weatherEmails'));
// ERROR HANDLING MIDDLEWARE - Add this for better error handling
app.use((error, req, res, next) => {
    console.error('Server Error:', error);

    // Handle multer file upload errors
    if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
            success: false,
            message: 'File too large. Maximum size is 10MB.'
        });
    }

    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({
            success: false,
            message: 'Unexpected file upload.'
        });
    }

    // Handle other multer errors
    if (error.message && error.message.includes('multer')) {
        return res.status(400).json({
            success: false,
            message: 'File upload error: ' + error.message
        });
    }

    // Generic error handler
    res.status(500).json({
        success: false,
        message: 'Internal server error'
    });
});

// 404 HANDLER - Add this for better API responses
app.use('/api/*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'API endpoint not found'
    });
});

// ROOT ROUTE - Optional: Add a simple API status endpoint
app.get('/api', (req, res) => {
    res.json({
        success: true,
        message: 'Kerala Farmer Advisory API is running',
        version: '1.0.0',
        endpoints: [
            '/api/auth',
            '/api/user',
            '/api/query',
            '/api/diagnosis',
            '/api/weather',
            '/api/market',
            '/api/community'
        ]
    });
});// Weather Email Automation
const { startWeatherAutomation } = require('./services/weatherAutomation');

// Start weather automation after server starts
const startTime = setTimeout(() => {
    console.log('🌾 Initializing Kerala Farmer Weather Email System...');
    startWeatherAutomation();
    console.log('✅ Weather email automation is now active!');
    clearTimeout(startTime);
}, 5000); // Start after 5 seconds to ensure everything is loaded


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server started on port ${PORT}`);
    console.log(`🌐 Frontend available at http://localhost:${PORT}`);
    console.log(`📡 API available at http://localhost:${PORT}/api`);
    console.log(`📁 Uploads directory: ${path.resolve(uploadsDir)}`);
});
