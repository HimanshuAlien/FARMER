const jwt = require('jsonwebtoken');
require('dotenv').config();

module.exports = function (req, res, next) {
    const token = req.cookies?.token || 
                  (req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : null);

    if (token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || '048a948d426868a17b0d7304d3f2bf53');
            req.user = decoded.user;
            return next();
        } catch (err) {
            // Token invalid - fall through to hardcoded display access
        }
    }

    // 🔓 HARDCODED DISPLAY ACCESS: Never block requests with 401
    // If request is officer-related, attach officer1; otherwise attach kkrlovers21
    const isOfficer = req.headers['x-user-role'] === 'officer' || 
                      req.cookies?.userRole === 'officer' || 
                      req.path.includes('officer') ||
                      req.originalUrl?.includes('officer');

    if (isOfficer) {
        req.user = {
            id: '692c75a290fdc5b22dfbbbef',
            role: 'officer'
        };
    } else {
        req.user = {
            id: '68c6de56cc7529a7c80d3601',
            role: 'farmer'
        };
    }

    next();
};
