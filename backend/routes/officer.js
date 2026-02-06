const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Query = require('../models/Query');
const User = require('../models/User');

/**
 * Ensure user is Officer
 */
async function ensureOfficer(req, res, next) {
    try {
        const user = await User.findById(req.user.id).select('role username');
        if (!user || user.role !== 'officer') {
            return res.status(403).json({ success: false, message: 'Officer access only' });
        }
        req.officer = user;
        next();
    } catch (err) {
        console.error('Officer check failed:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

/**
 * GET /api/officer/escalated
 * Officer: list of all escalated queries with farmer details
 */
router.get('/escalated', auth, ensureOfficer, async (req, res) => {
    try {
        const queries = await Query.find({ escalated: true })
            .sort({ escalatedAt: -1, createdAt: -1 })
            .populate('userId', 'username email phone location farmSize primaryCrops');

        res.json({
            success: true,
            queries
        });
    } catch (error) {
        console.error('Error fetching escalated queries:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch escalated queries'
        });
    }
});

/**
 * POST /api/officer/respond/:id
 * Officer saves response / remarks for an escalated query
 */
router.post('/respond/:id', auth, ensureOfficer, async (req, res) => {
    try {
        const queryId = req.params.id;
        const { reply } = req.body;

        if (!reply || !reply.trim()) {
            return res.status(400).json({ success: false, message: 'Reply text is required' });
        }

        const query = await Query.findById(queryId);
        if (!query || !query.escalated) {
            return res.status(404).json({ success: false, message: 'Escalated query not found' });
        }

        query.officerResponse = reply.trim();
        query.officerId = req.officer._id;
        query.status = 'officer-replied';
        query.escalationStatus = 'officer-replied';
        query.officerUpdatedAt = new Date();

        await query.save();

        res.json({
            success: true,
            message: 'Officer response saved',
            queryId: query._id
        });
    } catch (error) {
        console.error('Error saving officer response:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to save officer response'
        });
    }
});

/**
 * PUT /api/officer/resolve/:id
 * Officer marks escalated query as resolved/closed
 */
router.put('/resolve/:id', auth, ensureOfficer, async (req, res) => {
    try {
        const queryId = req.params.id;

        const query = await Query.findById(queryId);
        if (!query || !query.escalated) {
            return res.status(404).json({ success: false, message: 'Escalated query not found' });
        }

        query.resolved = true;
        query.status = 'resolved';
        query.escalationStatus = 'resolved';
        query.resolvedAt = new Date();

        await query.save();

        res.json({
            success: true,
            message: 'Query marked as resolved',
            queryId: query._id
        });
    } catch (error) {
        console.error('Error resolving query by officer:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to resolve query'
        });
    }
});

module.exports = router;
