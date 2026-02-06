const fs = require("fs");
const path = require("path");

// Create /logs folder if not exists
const logDir = path.join(__dirname, "..", "logs");
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

const logFile = path.join(logDir, "api_audit.log");

function auditLogger(req, res, next) {
    const startTime = Date.now();

    // Capture response after it finishes
    res.on("finish", () => {
        const log = {
            time: new Date().toISOString(),
            method: req.method,
            endpoint: req.originalUrl,
            status: res.statusCode,
            duration: Date.now() - startTime + "ms",
            ip: req.ip,
            body: req.body,
            query: req.query,
            user: req.user ? req.user.id : "guest"
        };

        fs.appendFileSync(logFile, JSON.stringify(log) + "\n");
    });

    next();
}

module.exports = auditLogger;