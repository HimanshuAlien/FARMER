const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const auth = require('../middleware/auth');
const Query = require('../models/Query');
const User = require('../models/User');

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Language configurations
const languages = {
    en: {
        name: 'English',
        prompt: 'Answer in English with clear formatting using bullet points and short paragraphs'
    },
    hi: {
        name: 'Hindi',
        prompt: 'जवाब हिंदी में दें और स्पष्ट बुलेट पॉइंट्स का उपयोग करें'
    },
    ml: {
        name: 'Malayalam',
        prompt: 'മലയാളത്തിൽ ഉത്തരം നൽകുക, വ്യക്തമായ പോയിന്റുകൾ ഉപയോഗിച്ച്'
    }
};

/* =========================================================
   FARMER ROUTES
========================================================= */

/**
 * POST /api/query/ask
 * Farmer asks AI question -> save to Query (not escalated by default)
 */
router.post('/ask', auth, async (req, res) => {
    try {
        const { question, language = 'en' } = req.body;
        const userId = req.user.id;

        if (!question || !question.trim()) {
            return res.status(400).json({ message: 'Question is required' });
        }

        console.log('Question:', question);
        console.log('Language:', language);

        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        const languageInstruction = languages[language]?.prompt || languages.en.prompt;

        const prompt = `You are an expert agricultural advisor for Kerala, India farmers. 

${languageInstruction}

Format your response with:
- Clear headings using **bold text**
- Bullet points for lists
- Short paragraphs (2-3 lines max)
- Practical, actionable advice
- Specific to Kerala's climate

Question: "${question}"

Provide helpful farming advice:`;

        console.log('Calling Gemini 2.5 Flash...');

        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();

        text = formatResponse(text);

        console.log('✅ Formatted AI response ready');

        // Save query
        try {
            const newQuery = new Query({
                userId,
                question: question.trim(),
                response: text,
                category: detectCategory(question),
                language,
                resolved: false,
                resolvedBy: null,
                escalated: false,
                status: 'normal',
                escalationStatus: null,
                escalationReason: null,
                escalationNotes: null,
                escalatedAt: null,
                resolvedAt: null,
                officerId: null,
                officerResponse: '',
                officerUpdatedAt: null,
                escalation: {
                    isEscalated: false,
                    status: 'pending',
                    reason: '',
                    requestedAt: null,
                    requestedBy: userId,
                    officerId: null,
                    officerReply: '',
                    officerNotes: '',
                    repliedAt: null
                }
            });

            await newQuery.save();
            console.log('✅ Query saved to database');

            // Clean up old queries (keep only last 100 per user)
            const oldQueries = await Query.find({ userId }).sort({ createdAt: -1 }).skip(100);
            if (oldQueries.length > 0) {
                const oldIds = oldQueries.map(q => q._id);
                await Query.deleteMany({ _id: { $in: oldIds } });
                console.log(`🧹 Cleaned up ${oldQueries.length} old queries`);
            }

        } catch (dbError) {
            console.error('Database save error:', dbError);
        }

        res.json({
            response: text,
            timestamp: new Date().toISOString(),
            language
        });

    } catch (error) {
        console.error('AI Error:', error.message);
        res.status(500).json({
            message: 'AI service error',
            error: error.message
        });
    }
});
router.get('/recent', auth, async (req, res) => {
    try {
        const userId = req.user.id;

        const recentQueries = await Query.find({ userId })
            .sort({ createdAt: -1 })
            .limit(20)
            .select('question response category language createdAt resolved rating escalation');

        res.json({
            success: true,
            queries: recentQueries.map(q => {
                const esc = q.escalation || {};

                // derive a simple flat status for frontend
                let status = 'normal';
                if (q.resolved) {
                    status = 'resolved';
                } else if (esc.status === 'replied') {
                    status = 'officer-replied';
                } else if (esc.isEscalated) {
                    status = 'escalated';
                }

                return {
                    id: q._id,
                    question: q.question,
                    response: q.response,
                    category: q.category,
                    language: q.language,
                    timestamp: q.createdAt.toISOString(),
                    timeAgo: getTimeAgo(q.createdAt),

                    resolved: q.resolved,
                    rating: q.rating || null,

                    // NEW: flat fields used by front-end
                    status,                         // 'normal' | 'escalated' | 'officer-replied' | 'resolved'
                    escalated: !!esc.isEscalated,
                    escalationStatus: esc.status || null,
                    officerResponse: esc.officerReply || '',
                    escalatedAt: esc.requestedAt || null,
                    resolvedAt: q.resolvedAt || null
                };
            })
        });

    } catch (error) {
        console.error('Error fetching recent queries:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch recent queries'
        });
    }
});


/**
 * GET /api/query/stats
 * Farmer: stats for dashboard
 */
router.get('/stats', auth, async (req, res) => {
    try {
        const userId = req.user.id;

        const totalQueries = await Query.countDocuments({ userId });
        const resolvedQueries = await Query.countDocuments({ userId, resolved: true });
        const thisWeekQueries = await Query.countDocuments({
            userId,
            createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        });
        const thisMonthQueries = await Query.countDocuments({
            userId,
            createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        });

        const categoryStats = await Query.aggregate([
            { $match: { userId } },
            { $group: { _id: '$category', count: { $sum: 1 } } }
        ]);

        res.json({
            success: true,
            stats: {
                total: totalQueries,
                resolved: resolvedQueries,
                thisWeek: thisWeekQueries,
                thisMonth: thisMonthQueries,
                categories: categoryStats.reduce((acc, cat) => {
                    acc[cat._id] = cat.count;
                    return acc;
                }, {})
            }
        });

    } catch (error) {
        console.error('Error fetching query stats:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch query statistics'
        });
    }
});

/**
 * PUT /api/query/:id/resolve
 * Farmer marks query as resolved (happy with answer)
 */
router.put('/:id/resolve', auth, async (req, res) => {
    try {
        const queryId = req.params.id;
        const userId = req.user.id;
        const { rating } = req.body;

        const query = await Query.findOne({ _id: queryId, userId });
        if (!query) {
            return res.status(404).json({ message: 'Query not found' });
        }

        query.resolved = true;
        query.status = 'resolved';
        query.resolvedBy = 'farmer';
        if (!query.resolvedAt) query.resolvedAt = new Date();

        if (rating && rating >= 1 && rating <= 5) {
            query.rating = rating;
        }

        await query.save();

        res.json({
            success: true,
            message: 'Query marked as resolved',
            query: {
                id: query._id,
                resolved: query.resolved,
                rating: query.rating
            }
        });

    } catch (error) {
        console.error('Error resolving query:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to resolve query'
        });
    }
});

/**
 * PUT /api/query/:id/escalate
 * Farmer escalates query to officer
 */
router.put('/:id/escalate', auth, async (req, res) => {
    try {
        const queryId = req.params.id;
        const userId = req.user.id;
        const { reason, notes } = req.body;

        const query = await Query.findOne({ _id: queryId, userId });
        if (!query) {
            return res.status(404).json({ success: false, message: 'Query not found' });
        }

        // Flat fields
        query.escalated = true;
        query.status = 'escalated';
        query.escalationStatus = 'pending';
        query.escalationReason = reason || 'Farmer requested officer review';
        query.escalationNotes = notes && notes.trim() ? notes.trim() : query.escalationNotes;
        query.escalatedAt = query.escalatedAt || new Date();

        // Nested block (so your old UI using escalation.* also works)
        query.escalation.isEscalated = true;
        query.escalation.status = 'pending';
        query.escalation.reason = reason || 'Farmer requested officer review';
        query.escalation.requestedAt = query.escalation.requestedAt || new Date();
        query.escalation.requestedBy = userId;
        if (notes && notes.trim()) {
            query.escalation.officerNotes = notes.trim();
        }

        await query.save();

        res.json({
            success: true,
            message: 'Query escalated to officer',
            queryId: query._id
        });

    } catch (error) {
        console.error('Error escalating query:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to escalate query'
        });
    }
});

/* =========================================================
   OFFICER ROUTES
========================================================= */

// helper: ensure current user is officer / admin
async function requireOfficer(req, res) {
    const user = await User.findById(req.user.id).select('role username email');
    if (!user || !['officer', 'admin'].includes(user.role)) {
        res.status(403).json({ success: false, message: 'Access denied: officer only' });
        return null;
    }
    return user;
}

/**
 * GET /api/query/officer/pending
 * Officer: list all escalated queries that are NOT resolved
 */
router.get('/officer/pending', auth, async (req, res) => {
    try {
        const officer = await requireOfficer(req, res);
        if (!officer) return;

        const queries = await Query.find({
            escalated: true,
            resolved: false
        })
            .sort({ escalatedAt: -1, createdAt: -1 })
            .populate('userId', 'username email location phone');

        res.json({
            success: true,
            officer: { id: officer._id, name: officer.username, role: officer.role },
            queries
        });
    } catch (error) {
        console.error('Error fetching officer pending queries:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch pending escalated queries'
        });
    }
});

/**
 * GET /api/query/officer/handled
 * Officer: list escalated queries that have been resolved (history)
 */
router.get('/officer/handled', auth, async (req, res) => {
    try {
        const officer = await requireOfficer(req, res);
        if (!officer) return;

        const queries = await Query.find({
            escalated: true,
            resolved: true
        })
            .sort({ resolvedAt: -1, updatedAt: -1 })
            .populate('userId', 'username email location phone');

        res.json({
            success: true,
            officer: { id: officer._id, name: officer.username, role: officer.role },
            queries
        });
    } catch (error) {
        console.error('Error fetching officer handled queries:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch handled queries'
        });
    }
});

/**
 * PUT /api/query/officer/:id/respond
 * Officer provides manual response + optionally marks resolved
 * body: { officerResponse: string, markResolved?: boolean, officerNotes?: string }
 */
router.put('/officer/:id/respond', auth, async (req, res) => {
    try {
        const officer = await requireOfficer(req, res);
        if (!officer) return;

        const { officerResponse, markResolved, officerNotes } = req.body;
        const queryId = req.params.id;

        if (!officerResponse || !officerResponse.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Officer response is required'
            });
        }

        const query = await Query.findById(queryId).populate('userId', 'username email location phone');
        if (!query) {
            return res.status(404).json({ success: false, message: 'Query not found' });
        }

        // Flat fields
        query.officerResponse = officerResponse.trim();
        query.officerUpdatedAt = new Date();
        query.escalationStatus = markResolved ? 'resolved_by_officer' : 'in_review';
        query.status = markResolved ? 'resolved' : 'escalated';
        query.escalated = true;
        query.officerId = officer._id;

        if (markResolved) {
            query.resolved = true;
            query.resolvedBy = 'officer';
            if (!query.resolvedAt) query.resolvedAt = new Date();
        }

        if (officerNotes && officerNotes.trim()) {
            query.escalationNotes = officerNotes.trim();
        }

        // Nested block
        query.escalation.isEscalated = true;
        query.escalation.status = markResolved ? 'replied' : 'in_review';
        query.escalation.officerId = officer._id;
        query.escalation.officerReply = officerResponse.trim();
        if (officerNotes && officerNotes.trim()) {
            query.escalation.officerNotes = officerNotes.trim();
        }
        query.escalation.repliedAt = new Date();

        await query.save();

        res.json({
            success: true,
            message: 'Officer response saved',
            query
        });

    } catch (error) {
        console.error('Error saving officer response:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to save officer response'
        });
    }
});

/* =========================================================
   HELPERS
========================================================= */

function formatResponse(text) {
    text = text
        .replace(/\*\*(.*?)\*\*/g, '**$1**')
        .replace(/\* /g, '• ')
        .replace(/\n{3,}/g, '\n')
        .trim();

    text = text.replace(/\*\*(.*?)\*\*/g, '**$1**\n');

    text = text
        .replace(/\n{2,}/g, '\n')
        .replace(/^\n+/, '')
        .replace(/\n+$/, '');

    return text;
}

function detectCategory(question) {
    const lowercaseQuestion = question.toLowerCase();

    if (
        lowercaseQuestion.includes('disease') ||
        lowercaseQuestion.includes('pest') ||
        lowercaseQuestion.includes('fungus') ||
        lowercaseQuestion.includes('insect')
    ) {
        return 'disease';
    }

    if (
        lowercaseQuestion.includes('weather') ||
        lowercaseQuestion.includes('rain') ||
        lowercaseQuestion.includes('season') ||
        lowercaseQuestion.includes('climate')
    ) {
        return 'weather';
    }

    if (
        lowercaseQuestion.includes('price') ||
        lowercaseQuestion.includes('market') ||
        lowercaseQuestion.includes('sell') ||
        lowercaseQuestion.includes('cost')
    ) {
        return 'market';
    }

    if (
        lowercaseQuestion.includes('crop') ||
        lowercaseQuestion.includes('seed') ||
        lowercaseQuestion.includes('fertilizer') ||
        lowercaseQuestion.includes('harvest')
    ) {
        return 'farming';
    }

    return 'general';
}

function getTimeAgo(date) {
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);

    if (diffInSeconds < 60) return 'Just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)}d ago`;
    return date.toLocaleDateString();
}

module.exports = router;
