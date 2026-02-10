const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = async () => {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;

    if (!uri) {
        console.error('❌ MongoDB Connection Error: No MONGO_URI or MONGODB_URI found in environment');
        return;
    }

    try {
        await mongoose.connect(uri);
        console.log('✅ MongoDB connected');
    } catch (err) {
        console.error('❌ MongoDB Connection Error:', err.message);
    }
};

module.exports = connectDB;
