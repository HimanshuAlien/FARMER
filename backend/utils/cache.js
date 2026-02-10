const NodeCache = require('node-cache');

// Standard TTL: 60 seconds, Check period: 120 seconds
const cache = new NodeCache({ stdTTL: 60, checkperiod: 120 });

module.exports = {
    // Get data from cache
    get: (key) => {
        const value = cache.get(key);
        if (value) {
            // console.log(`✅ Cache HIT: ${key}`);
            return value;
        }
        // console.log(`❌ Cache MISS: ${key}`);
        return null;
    },

    // Set data to cache (ttl is optional custom time in seconds)
    set: (key, value, ttl) => {
        const success = cache.set(key, value, ttl);
        // if (success) console.log(`💾 Cached: ${key}`);
        return success;
    },

    // Delete specific key
    del: (key) => {
        cache.del(key);
    },

    // Flush all data (use carefully)
    flush: () => {
        cache.flushAll();
    },

    // Get cache stats
    getStats: () => {
        return cache.getStats();
    }
};
