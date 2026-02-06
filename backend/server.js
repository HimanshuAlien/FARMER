const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const connectDB = require('./config/db');
require('dotenv').config();
const axios = require('axios');

// 🔴 SOCKET ADDITIONS
const http = require("http");
const { Server } = require("socket.io");

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
});


const app = express();

// 🔴 CREATE HTTP SERVER + SOCKET
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
app.set("io", io);

// 🔹 NEW: satellite insights router
const insightsRouter = require('./routes/insights');
const addressesRouter = require('./routes/addresses');
app.use('/api/addresses', addressesRouter);
app.use("/api/ai", require("./routes/aiAdvice"));

// 🔹 NEW: crop lifecycle routes
const cropRoutes = require('./routes/cropRoutes');
app.use("/api/crops", cropRoutes);

// Connect to MongoDB
if (!process.env.MONGO_URI) {
    console.error('❌ MONGO_URI is not defined in environment variables!');
}
connectDB();

// PAYLOAD LIMITS
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
const nqiRoute = require("./routes/nqi");
app.use("/api/nqi", nqiRoute);

// Middleware
app.use(cookieParser());
app.use(cors({
    origin: [
        'http://localhost:5000',
        'http://127.0.0.1:5000',
        'http://localhost:5500',
        'http://127.0.0.1:5500',
        'https://kerala-farmer-advisory.vercel.app',
        'https://kerala-farmer-advisory-himanshu-mishras-projects-ed75a6e7.vercel.app'
    ],
    credentials: true
}));

// 🔗 ML API PROXY
app.use('/api/ml', async (req, res) => {
    try {
        const mlResponse = await axios({
            method: req.method,
            url: `http://localhost:5001${req.path}`,
            data: req.body,
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000
        });
        res.json(mlResponse.data);
    } catch (error) {
        res.status(500).json({ success: false, error: "ML service unavailable" });
    }
});

// Create upload dirs
const uploadsDir = 'uploads';
const postsDir = 'uploads/posts';
const avatarsDir = 'uploads/avatars';
const pdfDir = path.join(__dirname, '../frontend', 'pdfs');

// Create upload dirs (only if NOT on Vercel)
if (!process.env.VERCEL) {
    [uploadsDir, postsDir, avatarsDir].forEach(dir => {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
    if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
}

// Static serving
// Only serve statically if NOT on Vercel (Vercel handles frontend separately)
if (!process.env.VERCEL) {
    app.use(express.static(path.join(__dirname, '../frontend')));
    app.use('/pdfs', express.static(pdfDir));
}
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Existing routes
app.use('/api/officer', require('./routes/officer'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/user', require('./routes/user'));
app.use('/api/query', require('./routes/query'));
app.use('/api/diagnosis', require('./routes/diagnosis'));
app.use('/api/weather', require('./routes/weather'));
app.use('/api/market', require('./routes/market'));
app.use('/api/community', require('./routes/community'));
app.use('/api/weather-emails', require('./routes/weatherEmails'));
app.use('/api', require('./routes/schemeRoutes'));
app.use('/api/insights', insightsRouter);
app.use('/api', cropRoutes);

// 🔴 ADD SENSOR ROUTE
app.use("/api/sensor", require("./routes/sensor"));

// Error handlers
app.use((error, req, res, next) => {
    console.error(error);
    res.status(500).json({ success: false, message: "Internal server error" });
});

// Root API
app.get('/api', (req, res) => {
    res.json({ success: true, message: 'Smart Farming API Running' });
});

// 🔍 DB Test Route
app.get('/api/test-db', (req, res) => {
    const uri = process.env.MONGO_URI || '';
    res.json({
        success: true,
        state: mongoose.connection.readyState,
        uriExists: !!uri,
        uriLength: uri.length,
        uriStart: uri.substring(0, 20),
        uriEnd: uri.substring(uri.length - 15),
        envKeys: Object.keys(process.env).filter(k => k.includes('MONGO') || k.includes('JWT'))
    });
});

// Weather automation
const { startWeatherAutomation } = require('./services/weatherAutomation');
setTimeout(() => startWeatherAutomation(), 5000);

const PORT = process.env.PORT || 5000;

// 🔴 IMPORTANT: use server.listen only if running directly
if (require.main === module) {
    server.listen(PORT, () => {
        console.log(`🚀 Server started on port ${PORT}`);
    });
}

module.exports = app;

